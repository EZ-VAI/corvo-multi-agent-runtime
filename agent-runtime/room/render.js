// agent-runtime/room/render.js
//
// RENDER ORCHESTRATOR. Turns the creative room's shot plan into keyframes (cheap)
// then clips (expensive), with a vision_critique gate before any clip spend.
//
// Heavy lifting (image gen, Kling/Seedance calls, polling endpoints) lives in the
// Lovable edge tools, reached via toolInvoke. This file SEQUENCES them and enforces
// what the tools can't: STAGING (render keyframes, stop, let a human eyeball cheap
// images before spending on video) and the GATE (vision_critique after each
// keyframe, bounded retry / reject-to-room, never animate a failing keyframe).
//
// Two phases:
//   KEYFRAME  sends the canonical shot to generate-keyframe; shot.generationPrompt is
//             the authoritative image prompt. finalize is NOT applied here -- its
//             clip-oriented rewrites would hurt a still. STAGE "keyframes" stops here.
//   CLIP      finalize-shots sanitizes motion + clamps duration, then each kept
//             keyframe is animated with a MOTION-ONLY prompt (two-mode) -> poll.

const { toolInvoke } = require("../understanding/proxy");

// ---- tunables ----
const MAX_KEYFRAME_RETRIES = 3;
const MAX_REJECTS_TO_ROOM = 1;
const HUMAN_REVIEW_FLAG = "未达标·需人工复核";
const POLL_MAX_TRIES = 60;
const POLL_INTERVAL_MS = 5000;

function needsKeyframe(shot) {
  return shot.generationMode === "anchored" || shot.generationMode === "hybrid";
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// real toolInvoke returns { ok, data:<payload> } (single-wrapped for these tools;
// shot-knowledge was double). Peel envelopes only, stop at the real payload.
function unwrap(r) {
  let x = r;
  for (let i = 0; i < 3; i++) {
    if (x && typeof x === "object" && !Array.isArray(x) && "data" in x && ("ok" in x || Object.keys(x).length <= 2)) {
      x = x.data;
    } else break;
  }
  return x;
}

// =====================================================================
// LOVABLE TOOL ADAPTERS  (the only contract-coupled code)
// =====================================================================

// finalize-shots: { shots, globalStyle? } -> { shots|blocks:[shot&{_ep}], globalPrefix, flags }
// Input is already our canonical shots. Output naming may be legacy "blocks" (or
// renamed "shots"); accept either. Job is deterministic _ep + clamps + flags only.
async function callFinalizeShots(shots, ctx) {
  const data = unwrap(await toolInvoke("finalize-shots", {
    shots,
    globalStyle: ctx.globalStyle || null,
  })) || {};
  return { shots: data.shots || data.blocks || shots, globalPrefix: data.globalPrefix || "", flags: data.flags || [] };
}

// generate-keyframe consumes the canonical shot DIRECTLY (Lovable side updated to
// match): shot.generationPrompt is the AUTHORITATIVE image prompt; the tool keeps
// its product-image conditioning / data:->upload / AR machinery around it, but does
// NOT rebuild or dilute the prompt. No legacy "block" translation here.
async function callGenerateKeyframe(shot, ctx, frameType, feedback, edit) {
  const shotForKf = feedback
    ? Object.assign({}, shot, { generationPrompt: (shot.generationPrompt || "") + "\n\nREVISION NOTE: " + feedback })
    : shot;
  const data = unwrap(await toolInvoke("generate-keyframe", {
    shot: shotForKf,
    productImages: ctx.productImages || [],
    aspectRatio: ctx.aspectRatio || "9:16",
    frameType: frameType || "start",
    brand: ctx.brand || undefined,
    colorCalibration: ctx.colorCalibration || undefined,
    editBaseUrl: (edit && edit.baseUrl) || undefined,
    editInstruction: (edit && edit.instruction) || undefined,
  })) || {};
  return { url: data.keyframeUrl || null, prompt: data.prompt || "", frameType: data.frameType || frameType || "start", raw: data };
}

// vision-critique (Critic's eyes): grade a rendered keyframe. LAST LINE OF DEFENSE,
// so it FAILS CLOSED -- if we can't evaluate (no url, tool error, missing verdict),
// we return "retry", never "pass".
async function callVisionCritique(keyframe, shot, ctx) {
  if (!keyframe || !keyframe.url) {
    return { verdict: "retry", score: 0, dimension: "unrenderable", issues: ["no keyframe to evaluate"], feedback: "regenerate keyframe" };
  }
  try {
    const data = unwrap(await toolInvoke("vision-critique", {
      keyframeUrl: keyframe.url,
      shot,
      productImages: ctx.productImages || [],
      antiIdentity: ctx.antiIdentity,
      brand: ctx.brand,
    })) || {};
    return {
      verdict: (data.verdict || "retry").toLowerCase(), // fail closed: missing verdict != pass
      fix: data.fix, // critic's retry scope: "local" => edit-in-place, else regenerate
      score: typeof data.score === "number" ? data.score : 0,
      dimension: data.dimension || null,
      issues: data.issues || [],
      feedback: data.feedback || "",
    };
  } catch (e) {
    return { verdict: "retry", score: 0, dimension: "critique_error", issues: [e && e.message ? e.message : String(e)], feedback: "vision-critique failed; re-evaluate" };
  }
}

// clip engine. TWO-MODE discipline: when a keyframe exists (i2v) the image already
// locks color/light/material, so the clip prompt is MOTION ONLY (cameraMotion +
// subjectMotion = "what moves and how"). Only free shots (t2v, no keyframe) need the
// full scene. We deliberately do NOT send _ep (= encoded generationPrompt) -- feeding
// the image prompt to the engine is the legacy assumption that fights the keyframe.
async function callClipEngine(shot, keyframe, ctx) {
  const eng = shot.engine || "seedance";
  const isKling = eng.indexOf("kling") === 0;
  const tool = isKling ? "generate-content-kling" : "generate-content-seedance";
  const motion = [shot.cameraMotion, shot.subjectMotion].filter(Boolean).join(". ");
  const hasKf = !!(keyframe && keyframe.url);
  const prompt = hasKf
    ? motion                                                        // i2v: motion only
    : [shot.generationPrompt, motion].filter(Boolean).join(" -- "); // t2v: full scene + motion
  const body = {
    prompt,
    keyframeImage: hasKf ? keyframe.url : undefined,
    endKeyframeImage: keyframe ? keyframe.endUrl : undefined,
    duration: Math.min(10, Math.max(5, Math.round(Number(shot.duration) || 5))), // GUARD: seedance/kling reject sub-5s -> 500; floor 5, cap 10
    aspectRatio: ctx.aspectRatio || "9:16",
    hasHuman: !!shot.hasHuman,
    colorGrade: ctx.colorGrade || undefined,
  };
  if (isKling) body.mode = eng === "kling-pro" ? "pro" : "std";
  const r = unwrap(await toolInvoke(tool, body)) || {};

  if (r.uri) return { url: r.uri, status: "completed" }; // kling sync path
  if (r.status === "polling" && r.taskId) {
    return await pollClip(isKling ? "kling" : "seedance", r);
  }
  console.warn("[clip] " + tool + " (engine=" + eng + ") unrecognized/error:", JSON.stringify(r).slice(0, 700));
  return { url: null, status: "unknown", error: (r && (r.error || r.message)) || null, raw: r };
}

async function pollClip(engine, polling) {
  const tool = engine === "kling" ? "poll-kling-status" : "poll-seedance-status";
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await sleep(POLL_INTERVAL_MS);
    const body = engine === "kling"
      ? { taskId: polling.taskId, endpoint: polling.pollEndpoint }
      : { taskId: polling.taskId };
    const r = unwrap(await toolInvoke(tool, body)) || {};
    if (r.status === "completed") return { url: r.uri, status: "completed" };
    if (r.status === "failed") return { url: null, status: "failed", error: r.error };
    // processing -> keep polling
  }
  return { url: null, status: "timeout" };
}

// =====================================================================
// GATE: render one shot's keyframe, critique with bounded retry.
// =====================================================================
async function renderShotKeyframe(shot, ctx, gate, reviseShot) {
  const frameType = shot.anchorEnd === "end" ? "end" : "start";
  if (gate === false) {
    try {
      const keyframe = await callGenerateKeyframe(shot, ctx, frameType, "");
      return { status: keyframe.url ? "pass" : "error", keyframe, vc: null, shot, attempts: [{ shot, keyframe, vc: null, attempt: 1 }], error: keyframe.url ? undefined : "keyframe returned no url" };
    } catch (e) {
      return { status: "error", keyframe: { url: null }, vc: null, shot, attempts: [], error: e && e.message ? e.message : String(e) };
    }
  }
  const attempts = [];
  let currentShot = shot;     // the shot is RE-AUTHORED across retries, not stapled
  let fallbackNote = "";      // only used if no real reviser is wired (standalone/tests)
  let edit = null;            // {baseUrl,instruction} => LOCAL edit this frame; null => fresh/regenerate
  for (let i = 0; i <= MAX_KEYFRAME_RETRIES; i++) {
    let keyframe;
    try {
      keyframe = await callGenerateKeyframe(currentShot, ctx, frameType, fallbackNote, edit);
    } catch (e) {
      keyframe = { url: null }; // gen failed -> critique will fail closed to retry
    }
    const vc = await callVisionCritique(keyframe, currentShot, ctx);
    attempts.push({ shot: currentShot, keyframe, vc, attempt: i + 1 });
    if (vc.verdict === "pass") return { status: "pass", keyframe, vc, shot: currentShot, attempts };
    if (vc.verdict === "reject") return { status: "reject", keyframe, vc, shot: currentShot, attempts };
    if (i < MAX_KEYFRAME_RETRIES) {
      // RETRY has two modes, and the CRITIC decides which (vc.fix) -- not this code:
      //   LOCAL  -> the frame is fundamentally right; EDIT this render in place so the
      //            parts already correct are PRESERVED (no re-rolling the dice). The
      //            critic's feedback is the edit instruction; the reviser is skipped.
      //   REGEN  -> the foundation is wrong; the reviser rewrites generationPrompt (seeing
      //            every prior attempt, so it can't repeat/oscillate) and we render fresh.
      // Only an explicit "local" + a real url edits; everything else (regenerate, or any
      // fail-closed/no-url case) regenerates. No reviser wired -> weaker note-append.
      fallbackNote = "";
      edit = null;
      if (vc.fix === "local" && keyframe && keyframe.url) {
        edit = { baseUrl: keyframe.url, instruction: vc.feedback || (vc.issues || []).join("; ") };
        // currentShot UNCHANGED: same prompt; the edit instruction carries the single fix.
      } else if (typeof reviseShot === "function") {
        try {
          const revised = await reviseShot({ shot: currentShot, critique: vc, attempts });
          if (revised && revised.generationPrompt && !revised._reviseFailed) {
            currentShot = revised;
          } else {
            fallbackNote = vc.feedback || (vc.issues || []).join("; ");
          }
        } catch (e) {
          fallbackNote = vc.feedback || (vc.issues || []).join("; ");
        }
      } else {
        fallbackNote = vc.feedback || (vc.issues || []).join("; ");
      }
    }
  }
  const best = attempts.reduce((a, b) => (b.vc.score > a.vc.score ? b : a), attempts[0]);
  return { status: "flagged", keyframe: best.keyframe, vc: best.vc, shot: best.shot, attempts, flag: HUMAN_REVIEW_FLAG };
}

// =====================================================================
// renderFilm: orchestrate the whole plan.
//   input: { shots, direction?, ctx:{ vertical, subcategory, productImages, brand, aspectRatio, colorGrade, visualBible } }
//   opts:  { stage:"keyframes"|"clips"|"all", gate?:bool, onProgress?, reDeriveShot? }
// =====================================================================
async function renderFilm(input, opts = {}) {
  const stage = opts.stage || "keyframes";
  const gate = opts.gate !== false;
  const ctx = input.ctx || {};
  const progress = typeof opts.onProgress === "function" ? opts.onProgress : async () => {};
  const shots = input.shots || [];

  // KEYFRAME PHASE (original craft prompt; no finalize)
  let rejectsUsed = 0;
  const results = [];
  for (let idx = 0; idx < shots.length; idx++) {
    let shot = shots[idx];
    await progress({ phase: "keyframe", shotId: shot.id, index: idx, total: shots.length });
    if (!needsKeyframe(shot)) {
      results.push({ shot, keyframe: null, status: "free", clip: null });
      continue;
    }
    let res = await renderShotKeyframe(shot, ctx, gate, opts.reviseShot);
    if (res.status === "reject" && rejectsUsed < MAX_REJECTS_TO_ROOM && typeof opts.reDeriveShot === "function") {
      rejectsUsed++;
      await progress({ phase: "reject_to_room", shotId: shot.id });
      const reDerived = await opts.reDeriveShot(shot, res.vc);
      if (reDerived) { shot = reDerived; res = await renderShotKeyframe(shot, ctx, gate, opts.reviseShot); }
    }
    if (res.status === "reject") res = { ...res, status: "flagged", flag: HUMAN_REVIEW_FLAG };
    const finalShot = res.shot || shot; // the (possibly) revised shot that actually rendered
    results.push({ shot: finalShot, keyframe: res.keyframe, status: res.status, vc: res.vc, attempts: (res.attempts || []).length, flag: res.flag || null, error: res.error || null, clip: null, diagnosis: (finalShot && finalShot._diagnosis) || null });
  }

  if (stage === "keyframes") {
    return { stage, shots: results, flagged: results.filter((r) => r.flag).map((r) => r.shot.id) };
  }

  // CLIP PHASE: finalize sanitizes the motion fields + clamps duration (its legit
  // deterministic job); we then animate each kept keyframe using the FINALIZED shot,
  // building a MOTION-ONLY clip prompt (two-mode). _ep is intentionally unused.
  await progress({ phase: "finalize" });
  const finalShots = results.map((r) => r.shot); // includes any keyframe-stage revisions
  const fin = await callFinalizeShots(finalShots, ctx);
  const finById = {};
  (fin.shots || []).forEach((b) => { if (b && b.id != null) finById[b.id] = b; });

  for (const r of results) {
    await progress({ phase: "clip", shotId: r.shot.id });
    const finShot = finById[r.shot.id] || r.shot;
    const clip = await callClipEngine(finShot, r.keyframe, ctx);
    r.clip = clip.url;
    r.clipStatus = clip.status;
    r.clipError = clip.error || null;
  }
  return { stage, shots: results, flagged: results.filter((r) => r.flag).map((r) => r.shot.id) };
}

module.exports = { renderFilm, renderShotKeyframe, needsKeyframe };
