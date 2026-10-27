// agent-runtime/room/cinematographer.js
//
// The Cinematographer — the SHOT specialist. This is now a DECISION agent, not
// a translator: it absorbs generate-blocks' decision half. Given the Director's
// direction + the assembled shot_knowledge (recipe library, shot bible, scale-
// jump rules, association chains, narrative arc — fed in, never inferred here),
// it decides the shot list and emits the canonical structured shot schema that
// finalize_shots / generate-keyframe / the clip engines / the Editor consume.
//
// THE TWO-MODE RULE (the P-1 lesson) — and it is SYMMETRIC:
//   generationPrompt = RICH & craft-applied, but a STILL: one frozen instant, a
//     static STATE, never an action. ALL the LOOK lives here (composition, light,
//     material, lens, mood); NO motion/action verbs. finalize_shots encodes _ep
//     from THIS string.
//   cameraMotion / subjectMotion = MINIMAL & motion-only — and they OWN the action.
//     The clip engine only MOVES the fixed keyframe. NO style/mood/lighting/quality
//     words — they make the engine re-interpret and wreck the frame.
//   The leak is fatal in BOTH directions: style in the motion wrecks the clip;
//     ACTION in the keyframe makes a still that can't be frozen coherently (a swipe
//     mid-application renders as a masked line / a bullet hovering on a finished
//     lip). Action -> motion ONLY. Style -> keyframe ONLY. Neither crosses. This
//     also feeds clips cleanly: i2v then gets a still START frame + a pure motion
//     instruction, with nothing to fight.
//
// Honours brand visual_dna + anti_identity. Decision-level repetition/collision
// is the Critic's job (shot-level checks); this agent only must not emit two
// ADJACENT identical scales and must flag exactly one isPeakShot.

const { aiComplete } = require("../understanding/proxy");
const models = require("./models");
const { normalizeShot, shotShapeIssues, SHOT_SCALES } = require("./shot_schema");
const { runStoryboard } = require("./storyboard");
const cinematic = require("./skills/cinematic");

// shot-knowledge currently also ships the legacy generate-blocks systemPrompt and
// an empty userPromptShell — a "fill this exact JSON template / output visualBible+
// segments+blocks, exactly N blocks" monolith that fights this agent's own clean
// shot_schema (and costs ~10k tokens/round). Inject ONLY the clean, vertical-specific
// REFERENCE craft; drop the template scaffolding. (iconicShotLibrary / narrativeStages
// are picked up automatically once Lovable surfaces them as structured fields.)
function pickShotReference(sk) {
  if (!sk || typeof sk !== "object") return null;
  const ref = {};
  for (const k of [
    "recipeLibrary",
    "sensoryAttributeMap",
    "verticalAssociationChains",
    "iconicShotLibrary",
    "narrativeStages",
  ]) {
    if (sk[k] != null) ref[k] = sk[k];
  }
  return Object.keys(ref).length ? ref : null;
}

const SYS = [
  "You are the Cinematographer on an AI ad team — the shot specialist. The",
  "Director has set the creative direction; you decide the SHOT LIST that",
  "realises it and makes it SELL. You are a real decision-maker, not a",
  "rubber-stamp translator.",
  "",
  "You are given SHOT_KNOWLEDGE: the recipe library, shot bible (scale",
  "definitions ECU..ELS), shot-scale-jump rules, narrative arc, iconic shots,",
  "and association chains for this brand's vertical/filmMode. Treat it as",
  "REFERENCE and proven examples to draw on — NOT a template to fill in. YOU are",
  "the author: you decide the shots and you WRITE the prompts. Let the knowledge",
  "inform you and raise your bar — steal what works, and obey the HARD guardrails",
  "it names (the product must stay anchored; the believability / anti-AI-look",
  "rules; the brand's anti_identity). But never let it flatten every film into the",
  "same recipe: sameness IS the failure mode — two films for two different brands",
  "must never come out looking alike. When the reference and the idea pull apart,",
  "serve the idea.",
  "",
  "THE RENDER-SAFE ENVELOPE — author INSIDE it. This is a capability boundary,",
  "not a style. Image/video models reliably FAIL at: legible text of any kind",
  "(signs, labels, packaging copy, paperwork, UI), human hands and fingers, teeth,",
  "faces held in tight close motion, several objects in intricate contact, and",
  "fragile contact geometry (a bullet balanced on a lip, a pen pinched in fingers).",
  "Do NOT author a shot whose SELL depends on rendering one of these — it comes",
  "back unpublishable. This is not a creativity limit; it is what you compose",
  "AROUND, the way a real DP avoids a setup the camera cannot hold. Inside it the",
  "room is enormous: light, material, surface, reflection, colour, motion, scale,",
  "negative space, environment, abstraction. If an idea seems to need a render-trap,",
  "find the crop or angle that delivers the same feeling without it — imply the",
  "hand and crop to the wrist, show the RESULT not the act, rest the product on a",
  "surface instead of gripping it. This shapes WHAT you author; it is NEVER text",
  "you write into a prompt.",
  "",
  "EVERY SHOT MUST EARN ITS PLACE THROUGH THE PRODUCT. This film is a montage — the",
  "shots need not form a tight causal story, but EACH shot must clearly relate to THIS",
  "product: it shows the product, its world, its moment of use, or the specific desire it",
  "creates. Per-shot swap test: if a shot could sit unchanged in another brand's film —",
  "generic people in a space, a mood with no product thread — it is filler. Cut it and",
  "author one only THIS product's world would contain. A shot where the product is invisible",
  "AND the scene says nothing about it is the failure mode.",
  "",
  "Decide a TIGHT shot list (count follows the total duration — enough to tell",
  "the idea, no filler). For EACH shot output the full structured spec:",
  "",
  "  STRUCTURE (decisions):",
  "  - shotScale: one of ECU CU MCU MS MLS WS ELS. ADJACENT shots must NOT share",
  "    a scale; follow the scale-jump rules in SHOT_KNOWLEDGE.",
  "  - subject, hasHuman",
  "  - generationMode: free | anchored | hybrid. A shot OF the product itself",
  "    must be 'anchored' (free morphs the product — unacceptable).",
  "  - anchorEnd: start | end | both | none",
  "",
  "  PACING (the Editor reads these to cut):",
  "  - narrativePhase: tension | reveal | desire | brand",
  "  - pacingRole: buildup | peak | rest | transition | punctuation",
  "  - emotionalIntensity: integer 1-10",
  "  - isPeakShot: boolean. EXACTLY ONE shot is the emotional peak.",
  "  - duration: integer seconds, MINIMUM 5 (HARD FLOOR — the video engine cannot render a clip shorter than 5s; below 5 is invalid). Choose each length from its real pacing need across a 5-10s range; a beat meant to feel quick still gets at least 5. Never author below 5.",
  "  - engine: seedance | kling-pro | kling-std | veo | minimax (pick what best",
  "    renders THIS shot)",
  "",
  "  PROMPTS (two-mode discipline — non-negotiable). The split is SYMMETRIC: the",
  "  keyframe holds ALL the look and is perfectly STILL; the motion holds ALL the",
  "  movement and none of the look. Action belongs ONLY to motion; style belongs",
  "  ONLY to the keyframe. Neither leaks into the other.",
  "  - generationPrompt: the still-image prompt for the ANCHORED frame (per",
  "    anchorEnd). It depicts a SINGLE FROZEN INSTANT — a static STATE, NOT an",
  "    action or process. NO action/process verbs (applying, completing, gliding,",
  "    pouring, mid-swipe, 'in motion'). If the shot is about an action, this is the",
  "    coherent moment at its START; ALL the action then lives in subjectMotion.",
  "",
  "    THE LOOK IS YOUR DECISION — DERIVE IT, DO NOT DEFAULT. Under pressure your",
  "    instinct is the model's safe average — product centered, light even,",
  "    background neutral — the exact template that makes every AI ad look the same.",
  "    REJECT it. For THIS brand and THIS beat decide a deliberate stance and write",
  "    it as PHYSICAL FACT, because image models act on physics, not adjectives",
  "    ('cinematic / moody / beautiful' produce AI-look artifacts, not a look):",
  "      - COMPOSITION — where the camera sits, where the subject sits in frame, and",
  "        how negative space is used. State positions, not vibes.",
  "      - LIGHT — source position, hardness, direction, angle, falloff, and",
  "        fill-or-none. State the physics of the light, not 'beautiful light'.",
  "      - TREATMENT — the deliberate colour/tonal treatment of the SCENE (never the",
  "        product) as one physical decision.",
  "    TRACEABILITY is the test that kills the template: every look decision must",
  "    trace to a SPECIFIC fact — a line of THIS brand's visual_dna, the reference",
  "    mechanism the Director named, or this beat's emotional intensity. If you",
  "    cannot name what a choice derives from, it is the default in disguise — cut it",
  "    and derive again. Two brands in the SAME mood must arrive at DIFFERENT",
  "    composition/light/treatment, because they derive from different identities,",
  "    not from a menu. Scale how bold you go to the brand's register — its",
  "    visual_dna tells you how far it can be pushed.",
  "",
  "    THE PRODUCT'S OWN APPEARANCE IS NOT YOURS TO WRITE. Never name the product's",
  "    colour, shade, material, finish, logo, or any text on it. Those are fixed by",
  "    the reference image and the fidelity lock — naming them lets the model",
  "    re-interpret and drift (a pink lipstick rendered as 'red'). Your prose owns",
  "    only the SCENE around the product: environment, surface, light, composition,",
  "    negative space, atmosphere. Say WHERE the product is and HOW it is lit —",
  "    never WHAT colour or material it is. Obey visual_dna; never produce optics",
  "    anti_identity forbids.",
  "  - cameraMotion / subjectMotion: MOTION ONLY — they OWN the action; this is the",
  "    ONLY place motion goes. No style, mood, lighting, cinematic, atmosphere, or",
  "    quality words (the keyframe already locks those).",
  "",
  "Return ONLY JSON: { \"shots\": [ { ...all fields above... } ] }",
  "",
  cinematic.forAgents(),
].join("\n");

async function runCinematographer({ direction, brandBrain, shotKnowledge, brief, round, criticReport }) {
  const totalDuration =
    (brief && brief.totalDuration) ||
    (brief && brief.durationSec) ||
    (direction && direction.totalDuration) ||
    15;

  if ((direction && direction.realizationStrategy) === "storyboard") {
    const fp = direction.filmPlan || null;
    // The Director now hands us a SCRIPT: an array of ~15s story segments. Each segment
    // becomes one storyboard; WE author the world/light/shots from its story. (No more
    // Director-supplied board shot-params; no seams — continuity is via prev_segment_story.)
    const script = (fp && Array.isArray(fp.script) && fp.script.length) ? fp.script : null;
    if (!script) {
      // No structured script (e.g. a thin plan) — author a single standalone storyboard.
      return await runStoryboard({ direction, brandBrain, shotKnowledge, brief, totalDuration, round, criticReport });
    }
    const storyboards = [];
    for (let i = 0; i < script.length; i++) {
      const seg = script[i];
      const prevSegmentStory = i === 0 ? null : (script[i - 1] && script[i - 1].story) || null;
      const r = await runStoryboard({
        direction, brandBrain, shotKnowledge, brief, totalDuration, round, criticReport,
        segment: seg, throughLine: fp.throughLine || null, prevSegmentStory,
        boardIndex: i + 1, boardCount: script.length,
      });
      storyboards.push(Object.assign({
        boardId: seg.segment || (i + 1),
        title: seg.title || null,
        story: seg.story || null,
        panelCount: r.panelCount
      }, r.storyboard));
    }
    return { storyboards, filmPlan: fp, direction };
  }

  const shotReference = pickShotReference(shotKnowledge);
  const payload = {
    direction: direction || {},
    visual_dna: (brandBrain && brandBrain.visual_dna) || {},
    anti_identity: (brandBrain && brandBrain.anti_identity) || {},
    value_translation: (brandBrain && brandBrain.value_translation) || {},
    shot_knowledge: shotReference,
    total_duration_sec: totalDuration,
    round: round || 1,
  };
  if (!shotReference) {
    // shot_knowledge is the moat; flag its absence loudly rather than silently
    // letting the agent re-derive craft badly.
    payload._warning = "SHOT_KNOWLEDGE missing — decide from direction + visual_dna only; quality will be lower.";
  }
  if (round > 1 && criticReport) {
    payload.critic_objections = criticReport.objections || [];
    payload.instruction = "Revise the shots to address the Critic's objections. Keep the two-mode discipline and the structured schema intact.";
  }

  let out;
  for (let attempt = 1; attempt <= 2; attempt++) {
    out = await aiComplete({
      system: SYS,
      user: JSON.stringify(payload),
      temperature: 1,
      model: models.cinematographer,
      maxTokens: attempt === 1 ? 32000 : 48000,
    });
    if (!(out && out._parseError)) break;
    console.warn("[cinematographer] non-JSON (likely truncation) attempt " + attempt + " - retry higher cap");
  }
  if (out && out._parseError) {
    throw new Error("cinematographer returned non-JSON after retry: " + String(out.raw || "").slice(0, 300));
  }

  const _cinLeak = cinematic.detectLeakage(JSON.stringify(out || {}));
  if (_cinLeak.length) console.warn("[cinematographer] cinematic skill leakage:", _cinLeak.join(", "));
  const rawShots = ((out && out.shots) || []).map((s) => Object.assign({}, s, {
    generationPrompt: cinematic.scrub(s && s.generationPrompt),
    frame1Description: cinematic.scrub(s && s.frame1Description),
    frameNDescription: cinematic.scrub(s && s.frameNDescription),
  }));
  const shots = rawShots.map((s, i) =>
    normalizeShot(s, i, { duration: Math.max(5, Math.round(totalDuration / Math.max(1, rawShots.length))) })
  );

  // structural self-check (shape only; creative quality is the Critic's job)
  const shapeIssues = shotShapeIssues(shots);
  // deterministic adjacency note for the Director (do NOT rewrite here — flag)
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].shotScale === shots[i - 1].shotScale) {
      shapeIssues.push(`shots ${i} and ${i + 1} share scale ${shots[i].shotScale}`);
    }
  }

  return { shots, shapeIssues };
}

// =====================================================================
// reviseShot — the RETRY path made real.
//
// When vision-critique (the human eye) does NOT pass a rendered keyframe with
// verdict "retry", the failure is an EXECUTION flaw, not a broken idea. The fix
// is NOT to staple the critic's note onto the same prompt and re-roll the dice
// (that re-renders the same root cause and gets bounced again). A real
// cinematographer reads the note, works out WHY their prompt produced that flaw,
// and rewrites the prompt to remove the cause. That is what this does.
//
// It keeps the shot's IDENTITY fixed (scale / subject / mode / human / phase) --
// changing those is a concept change, which is the Director's job (reject path).
// It only rewrites the still-image side: generationPrompt (+ frame descriptions).
// It is given the FULL attempt history so it never repeats a prompt that already
// failed or oscillates between two broken versions: each round it knows more.
//
// (Text-only for now: it acts on the critic's distilled report, which is the
// eye's job to produce. Passing the failed image itself is a clean upgrade once
// the room's aiComplete is confirmed to carry image content.)
const REVISE_SYS = [
  "You are the Cinematographer on an AI ad team. A keyframe you specified was",
  "rendered, and a sharp, fashion-literate, human-eyed critic looked at the ACTUAL",
  "image and did not pass it. Revise like a real cinematographer who reads the",
  "director's note, understands why the shot failed, and reshoots it correctly.",
  "You are NOT bolting a note onto your old prompt — you are rewriting the prompt",
  "to remove the ROOT CAUSE of what the critic saw.",
  "",
  "You are given: your current shot spec, the critic's reaction + issues + the one",
  "fix they asked for, and the FULL history of what you already tried on this shot",
  "and what the critic said each time. Use the history: do NOT re-issue a prompt",
  "that already failed, and do NOT swing back to an earlier broken version.",
  "",
  "YOUR EYES: you are shown the ACTUAL rendered frame(s) from your previous",
  "attempt(s) — the LAST image is the one you must fix. LOOK at it. See how your",
  "prompt actually manifested, which specific part went wrong, and — critically —",
  "whether your LAST fix made things WORSE. Trust what you see over your",
  "assumptions about what the prompt 'should' have produced. (If no image is",
  "shown, work from the critic's report.)",
  "",
  "RULES:",
  "- PICK THE FIX WITH THE LEAST RENDERING RISK. Image models reliably fail at",
  "  certain things: visible hands and fingers, teeth, intricate contact geometry,",
  "  generated text, several interacting objects. Do NOT introduce one of these to",
  "  solve a simpler problem — e.g. do not add a gripping hand to fix a 'floating",
  "  product'; rest it on a surface, stand it, or re-crop. If the fix truly needs a",
  "  render-minefield element the shot didn't call for, prefer to re-frame/crop it",
  "  out; and if you cannot fix it without one, set concept_broken:true so the",
  "  Director re-specs a shot that doesn't need it. Routing around what the renderer",
  "  can't do is part of the craft.",
  "- MORE WORDS != BETTER. Revision is not always addition. If the prior attempt was",
  "  already heavily specified, or you'd be piling a third constraint onto the same",
  "  region, SIMPLIFY: strip conflicting or over-precise micro-specs and let the",
  "  model breathe. An over-dense prompt can fail to render at all — if a prior",
  "  attempt produced NO image, your next prompt MUST be shorter and cleaner.",
  "- This is an EXECUTION fix, not a concept change. Keep the shot's identity:",
  "  shotScale, subject, generationMode, hasHuman, narrativePhase stay as-is. You",
  "  fix HOW it renders, not WHAT it is. If you are convinced the IDEA itself",
  "  cannot work no matter how it's rendered, do not silently mutate it — set",
  '  "concept_broken": true and explain in "diagnosis"; that escalates to the',
  "  Director.",
  "- DIAGNOSE first, in one line: name what in YOUR prompt caused the flaw the",
  "  critic saw (e.g. \"I wrote the bullet 'near' the lips, so it rendered floating;",
  "  it must be in contact, at the colour boundary\").",
  "- Then rewrite generationPrompt to kill that cause, with the same craft",
  "  discipline (composition, contact/physics, light, material, lens). TWO-MODE",
  "  rule holds: generationPrompt is the STILL-image prompt — never put motion in",
  "  it. Obey visual_dna; never produce optics anti_identity forbids.",
  "- Fix what the critic flagged; do NOT regress the parts already fine, and do NOT",
  "  chase tiny imperfections the critic did not raise.",
  "",
  "Return ONLY JSON: {",
  '  "diagnosis": "<one line: why your prompt caused the flaw>",',
  '  "concept_broken": false,',
  '  "generationPrompt": "<the rewritten still-image prompt>",',
  '  "frame1Description": "<optional revised start-frame desc; omit if unchanged>",',
  '  "frameNDescription": "<optional revised end-frame desc; omit if unchanged>"',
  "}",
  "",
  cinematic.forAgents(),
].join("\n");

function reviseHistory(attempts) {
  return (attempts || []).map((a, i) => ({
    attempt: a.attempt || i + 1,
    generationPrompt: a.shot ? a.shot.generationPrompt : undefined,
    critic_verdict: a.vc ? a.vc.verdict : undefined,
    critic_reaction: a.vc ? a.vc.reaction : undefined,
    critic_issues: a.vc ? a.vc.issues : undefined,
    critic_feedback: a.vc ? a.vc.feedback : undefined,
  }));
}

async function reviseShot({ shot, critique, attempts, brandBrain, shotKnowledge }) {
  if (!shot) return null;
  const payload = {
    current_shot: {
      id: shot.id,
      shotScale: shot.shotScale,
      subject: shot.subject,
      generationMode: shot.generationMode,
      hasHuman: shot.hasHuman,
      narrativePhase: shot.narrativePhase,
      compositionRule: shot.compositionRule,
      cameraAngle: shot.cameraAngle,
      focusTechnique: shot.focusTechnique,
      generationPrompt: shot.generationPrompt,
      frame1Description: shot.frame1Description,
      frameNDescription: shot.frameNDescription,
    },
    critic_said: {
      verdict: critique && critique.verdict,
      reaction: critique && critique.reaction,
      issues: (critique && critique.issues) || [],
      fix_requested: critique && critique.feedback,
      dimension: critique && critique.dimension,
    },
    history: reviseHistory(attempts),
    visual_dna: (brandBrain && brandBrain.visual_dna) || {},
    anti_identity: (brandBrain && brandBrain.anti_identity) || {},
  };
  const ref = pickShotReference(shotKnowledge);
  if (ref) payload.shot_knowledge = ref;

  // EYES: the frames this shot actually produced. Last = the one to fix; the one
  // before lets it see whether its previous fix made things worse. Cap at 2 to keep
  // tokens/cost bounded. (Cloud ai.complete inlines these for Gemini; if it ignores
  // them, reviseShot quietly stays text-only.)
  const frames = (attempts || []).map((a) => a && a.keyframe && a.keyframe.url).filter(Boolean);
  const images = frames.length ? frames.slice(-2).map((url) => ({ url })) : undefined;

  const out = await aiComplete({
    system: REVISE_SYS,
    user: JSON.stringify(payload),
    temperature: 0.7,
    model: models.cinematographer,
    images,
    maxTokens: 8000,
  });
  if (out && out._parseError) {
    throw new Error("reviseShot returned non-JSON: " + String(out.raw || "").slice(0, 300));
  }
  if (!out || !out.generationPrompt) {
    // nothing usable -> tell the caller so it can fall back instead of rendering blind
    return Object.assign({}, shot, {
      _reviseFailed: true,
      _diagnosis: (out && out.diagnosis) || null,
      _conceptBroken: !!(out && out.concept_broken),
    });
  }
  // Only the still-image side changes; identity fields stay. The shot was already
  // schema-normalized when first authored, so overriding prompt strings is safe.
  const revised = Object.assign({}, shot, { generationPrompt: cinematic.scrub(out.generationPrompt) });
  if (out.frame1Description) revised.frame1Description = cinematic.scrub(out.frame1Description);
  if (out.frameNDescription) revised.frameNDescription = cinematic.scrub(out.frameNDescription);
  revised._diagnosis = out.diagnosis || null;
  revised._conceptBroken = !!out.concept_broken;
  return revised;
}

module.exports = { runCinematographer, reviseShot };
