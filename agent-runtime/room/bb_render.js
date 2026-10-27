// room/bb_render.js - render_board executor: TOOL LAYER ONLY, zero creative
// judgment. board.execution -> clean grid (carry by seam, from PRIOR board's
// rendered grid) -> eyemask ladder lvl1->lvl2 -> Seedance (tone anchor as FIRST
// reference for fidelity, masked grid as SECOND for beats) -> facts on the board.
// PIPL at max mask level = pipl_rejected FACT (Overseer judges; no auto-fallback).
// One HD tone anchor per film, generated from the first live board's panel 1.
const fs = require("fs"), cp = require("child_process");
const BB = require("./blackboard");
const { renderStoryboardBoard } = require("./storyboardRender");
const { seedanceFromGrid } = require("./seedance");
const { gridQC } = require("./gridQC");
const { inspectClip } = require("./clipQC");
const cinematic = require("./skills/cinematic");
const { dbRead, dbWrite } = require("../understanding/proxy");
const SB_DIR = process.env.STORYBOARD_DIR || "/var/www/html/storyboards", SB_URL = process.env.STORYBOARD_BASE_URL || "";
const PY = "/root/agent-runtime/.cvenv/bin/python", EM = "/root/agent-runtime/room/eyemask.py";
function CL(film, zh, en) { return (film.inputs && film.inputs.lang === "zh") ? zh : en; }
function uw(r) { var x = r; for (var i = 0; i < 3; i++) { if (x && typeof x === "object" && "data" in x) x = x.data; else break; } return x; }
function isPIPL(e) { return /Sensitive|Privacy|real person/i.test((e && e.message) || ""); }
function eyemask(p, level) {
  var ext = p.slice(p.lastIndexOf("."));
  var o = p.slice(0, p.lastIndexOf(".")) + ".maskL" + level + ext;
  var j = JSON.parse(cp.execFileSync(PY, [EM, p, "--out", o, "--level", String(level)], { encoding: "utf8" }));
  var x = (j.results && j.results[0]) || {};
  return { out: o, faces: x.faces || 0, detector: x.detector };
}
async function loadProduct(userId, productKey) {
  var pb = uw(await dbRead("product_brain", { filters: productKey ? { user_id: userId, product_key: productKey } : { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true })) || {};
  var urls = (Array.isArray(pb.product_images) ? pb.product_images : []).slice(0, 3);
  var ca = pb.fidelity && pb.fidelity.colorAnchor;
  var vt = pb.value_translation || {};
  var contract = {
    usage: (typeof vt.filmable_desire === "string") ? vt.filmable_desire.slice(0, 400) : null,
    rules: pb.representation_rules ? JSON.stringify(pb.representation_rules).slice(0, 400) : null,
    blurb: (typeof pb.product_blurb === "string") ? pb.product_blurb.slice(0, 200) : null,
  };
  return { productImages: urls, colorAnchor: (typeof ca === "string") ? ca : null, contract: contract };
}
async function edits(key, prompt, refBuffers) {
  var form = new FormData();
  form.append("model", "gpt-image-2"); form.append("prompt", prompt); form.append("size", "1536x1024");
  for (var i = 0; i < refBuffers.length; i++) form.append("image[]", new Blob([refBuffers[i]], { type: "image/png" }), "r.png");
  return fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: "Bearer " + key }, body: form });
}
async function genToneAnchor(world, panel1, productUrls) {
  var key = process.env.OPENAI_API_KEY; if (!key) throw new Error("no OPENAI_API_KEY");
  var refs = [];
  for (var i = 0; i < productUrls.length; i++) { var r = await fetch(productUrls[i]); if (r.ok) refs.push(Buffer.from(await r.arrayBuffer())); }
  var prompt = [
    "Create ONE cinematic FULL-FRAME photographic still. NOT a storyboard: no grid, no panels, no captions, no borders, no text.",
    "This single frame defines the visual standard for an entire luxury brand film: maximum photographic fidelity, true material texture, deliberate film grade, real light physics. No illustration look.",
    "SCENE: " + String(panel1 || ""),
    "WORLD: " + String(world || ""),
    "NO PEOPLE: this frame contains ZERO human beings — no faces, no figures, no hands. If the scene describes a person, render the same place, light and mood WITHOUT them; their presence may be implied by environment only (a coat on a chair, a glass half-finished, an open door).",
    "The product in frame is the item in the supplied reference image(s) - exact shape, colour, finish; never reinvent it.",
    cinematic.full()
  ].join("\n");
  if (prompt.indexOf(cinematic.SENTINEL_ANCHOR) === -1) throw new Error("tone anchor: cinematic full view missing");
  // gpt-image-2 always processes edit inputs at high fidelity and rejects the
  // legacy input_fidelity field. Send the valid request once.
  var resp = await edits(key, prompt, refs);
  var t = await resp.text();
  if (!resp.ok) throw new Error("anchor edits " + resp.status + ": " + t.slice(0, 300));
  var b64 = JSON.parse(t).data && JSON.parse(t).data[0] && JSON.parse(t).data[0].b64_json;
  if (!b64) throw new Error("anchor: no b64");
  var file = "sb-anchor-" + Date.now() + ".png";
  fs.writeFileSync(SB_DIR + "/" + file, Buffer.from(b64, "base64"));
  return SB_DIR + "/" + file;
}
async function ensureToneAnchor(film, warrant) {
  if (film.toneAnchor && film.toneAnchor.url) return film.toneAnchor;
  var live = BB.liveBoards(film);
  var src = live.filter(function (b) { return b.execution && (b.execution.panels || []).length; })[0];
  if (!src) throw new Error("tone anchor: no executed board to derive from");
  var prod = await loadProduct(film.user_id, film.productKey);
  var cleanPath = await genToneAnchor(src.execution.world, (src.execution.panels || [])[0], prod.productImages);
  var url = SB_URL + "/" + cleanPath.split("/").pop();
  film.toneAnchor = { url: url, cleanPath: cleanPath, faces: 0, fromBoard: src.id };
  BB.emit(film, "render", "tone_anchor", "film", { url: url, faces: 0, fromBoard: src.id }, null, "mechanical", warrant);
  return film.toneAnchor;
}
// panel-1 接缝落地:看着上一段真实末帧,把 panel 1 文字机械对齐到"这一帧的下一瞬"。
// 纯机械翻译(像素事实->文字),不改创意;失败一律返回 null 沿用原文,绝不拦渲染。
async function groundPanel1(frameUrl, p1) {
  var key = process.env.OPENAI_API_KEY;
  if (!key || !frameUrl || !p1) return null;
  try {
    var body = { model: "gpt-4o-mini", temperature: 0.2, max_tokens: 90, messages: [{ role: "user", content: [
      { type: "text", text: "This image is the ACTUAL final frame of the previous 15-second video segment. The next segment's storyboard Panel 1 below was written before this frame existed and may contradict it.\nPlanned Panel 1: \"" + String(p1).slice(0, 300) + "\"\nRewrite Panel 1 as ONE line in the same format (Shot scale: subject action, setting), max 25 words, so it opens on the VERY NEXT INSTANT of exactly what this frame shows — same person state, same place, same light — and then leans toward the planned action. Plain factual shooting language, no poetry. Reply with ONLY the rewritten line." },
      { type: "image_url", image_url: { url: frameUrl } }
    ] }] };
    var r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) });
    var j = await r.json();
    var line = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!line) return null;
    line = String(line).trim().replace(/^["'\u0060]+|["'\u0060]+$/g, "").split("\n")[0].trim();
    if (line.length < 12 || line.length > 220) return null;
    return line;
  } catch (e) { console.warn("[seam-ground] panel1 重写失败(沿用原文):", e.message); return null; }
}

async function captureLiveControl(film, warrant) {
  if (!process.env.BB_REMOTE) return null;
  var rows = null;
  try { rows = uw(await dbRead("film_client_inbox", { filters: { film_id: film.film_id, consumed: false } })); }
  catch (e) { console.warn("[render-control]", e.message); return null; }
  if (rows && !Array.isArray(rows)) rows = [rows];
  var control = (rows || []).filter(function (r) { return r.op === "pause_film" || r.op === "cancel_film"; });
  for (var i = 0; i < control.length; i++) {
    var r = control[i], at = new Date().toISOString();
    if (r.op === "cancel_film") {
      film.cancelRequestedAt = film.cancelRequestedAt || at;
      film.status = "cancelling";
      BB.emit(film, "client", "cancel_film", "film", { afterCurrentPaidTask: true }, r.note || "Stop after the current paid task.", "judgment", warrant);
      BB.emit(film, "overseer", "say", "film", null, CL(film,
        "收到。我不会再启动新的付费步骤；当前已经提交的镜头会先安全收回，然后终止这部片。",
        "Understood. I will start no new paid work; I will safely collect the clip already submitted, then cancel the film."), "execution", warrant);
    } else if (!film.cancelRequestedAt) {
      film.pauseRequestedAt = film.pauseRequestedAt || at;
      BB.emit(film, "client", "pause_film", "film", { afterCurrentPaidTask: true }, r.note || "Pause after the current paid task.", "judgment", warrant);
      BB.emit(film, "overseer", "say", "film", null, CL(film,
        "收到。这一镜完成后暂停，不会继续启动下一项付费任务。",
        "Understood. I will pause after this clip and start no further paid task."), "execution", warrant);
    }
    try { await dbWrite("film_client_inbox", "update", { filters: { id: r.id }, row: { consumed: true } }); }
    catch (e2) { console.warn("[render-control consume]", e2.message); }
  }
  if (control.length) BB.save(film);
  return film.cancelRequestedAt ? "cancel" : film.pauseRequestedAt ? "pause" : null;
}

function extractLastFrame(clip, gridPath, gridUrl) {
  var dirLocal = gridPath ? gridPath.replace(/\/[^\/]+$/, "") : SB_DIR;
  var dirUrl = gridUrl ? gridUrl.replace(/\/[^\/]+$/, "") : SB_URL;
  var base = (gridPath || ("board-" + Date.now())).replace(/^.*\//, "").replace(/\.[A-Za-z0-9]+$/, "");
  var name = base + "_last.jpg", local = dirLocal + "/" + name;
  try {
    cp.execFileSync("ffmpeg", ["-y", "-sseof", "-0.5", "-i", clip, "-vsync", "0", "-q:v", "2", "-update", "1", local], { stdio: "ignore" });
    if (!fs.existsSync(local)) throw new Error("no output");
    return dirUrl + "/" + name;
  } catch (e) {
    console.warn("[lastframe] 本板末帧抽取失败(clip 已入档;下一板将按 clipUrl 现场抽帧兜底,那里失败才断路):", e.message);
    return null;
  }
}

async function completeClip(film, board, clip, meta, warrant) {
  meta = meta || {};
  var ex = board.execution || {};
  var prod = meta.prod || await loadProduct(film.user_id, film.productKey);
  var lastFrameUrl = extractLastFrame(clip, meta.gridPath, meta.gridUrl);
  if (film.cancelRequestedAt) {
    var cancelledFact = { status: "rendered", clipUrl: clip, lastFrameUrl: lastFrameUrl,
      gridUrl: meta.gridUrl, gridPath: meta.gridPath, maskedUrl: meta.maskedUrl, maskedPath: meta.maskedPath || null,
      faces: meta.faces, maskLevel: meta.maskLevel, anchorUrl: meta.anchorUrl, attempts: meta.attempts,
      providerTaskId: meta.providerTaskId || null, providerStartedAt: meta.providerStartedAt || null,
      clipQc: { pass: null, skipped: true, reason: "film_cancelled_after_provider_submission" } };
    BB.recordRenderFact(film, board.id, cancelledFact, warrant);
    BB.emit(film, "render", "clip_collected_after_cancel", board.id, { clipUrl: clip },
      "paid provider result was collected; post-render QC skipped because the film is cancelling", "mechanical", warrant);
    BB.save(film);
    return { status: "rendered", clipUrl: clip, boardId: board.id, qc: cancelledFact.clipQc, seedanceSpent: true, cancelled: true };
  }
  BB.emit(film, "render", "clip_qc_started", board.id, { sampledFrames: 5 }, "checking generated frames before delivery", "mechanical", warrant);
  BB.save(film);
  var qc = await inspectClip(clip, { includePeople: ex.includePeople === true,
    characterReference: film.characterLock && film.characterLock.gridUrl || null,
    productImages: prod.productImages || [] });
  BB.emit(film, "render", "clip_qc", board.id, qc,
    qc.pass ? "generated clip passed delivery QC" : qc.unavailable ? "clip QC unavailable; delivery held for review" : "generated clip has objective delivery defects",
    "mechanical", warrant);
  var fact = { clipUrl: clip, lastFrameUrl: lastFrameUrl, gridUrl: meta.gridUrl, gridPath: meta.gridPath,
    maskedUrl: meta.maskedUrl, maskedPath: meta.maskedPath || null, faces: meta.faces, maskLevel: meta.maskLevel,
    anchorUrl: meta.anchorUrl, attempts: meta.attempts, providerTaskId: meta.providerTaskId || null,
    providerStartedAt: meta.providerStartedAt || null, clipQc: qc };
  if (!qc.pass) {
    BB.recordRenderFact(film, board.id, Object.assign({}, fact, { status: "clip_qc_blocked",
      error: qc.unavailable ? "post-render QC unavailable" : "post-render clip QC failed" }), warrant);
    BB.emit(film, "render", "clip_qc_blocked", board.id, { qc: qc, clipUrl: clip, seedanceRetryStarted: false },
      "delivery blocked; no automatic Seedance retry was started", "mechanical", warrant);
    BB.emit(film, "overseer", "say", "film", null, CL(film,
      qc.unavailable
        ? "镜头已经生成，但成片检查暂时不可用。我先保留镜头并暂停交付，不会自动再烧一次生成费用。"
        : "镜头已经生成，但成片检查发现了脸部或画面问题。我先拦住交付，不会擅自再烧一次生成费用。",
      qc.unavailable
        ? "The clip is generated, but final-frame inspection is unavailable. I am holding delivery and will not spend on an automatic rerender."
        : "The clip is generated, but final-frame inspection found a face or image defect. I am holding delivery and will not spend on an automatic rerender."), "execution", warrant);
    BB.save(film);
    return { status: "clip_qc_blocked", clipUrl: clip, boardId: board.id, qc: qc, seedanceSpent: true };
  }
  BB.recordRenderFact(film, board.id, Object.assign({}, fact, { status: "rendered", error: null }), warrant);
  BB.emit(film, "cinematographer", "board_rendered", board.id, { clipUrl: clip, boardId: board.id, clipQc: "passed" },
    CL(film, "第" + board.id + "板视频生成并通过成片检查。", "Board " + board.id + " is ready and passed final clip QC."), "execution", warrant);
  BB.save(film);
  return { status: "rendered", clipUrl: clip, boardId: board.id, qc: qc, seedanceSpent: true };
}

async function recheckClipOnBlackboard(film, boardId, opts) {
  opts = opts || {};
  var board = BB.getBoard(film, boardId);
  if (!board || !board.render || !board.render.clipUrl) throw new Error("clip QC recheck: no generated clip for board " + boardId);
  var r = board.render;
  BB.emit(film, "client", "retry_clip_qc", board.id, null, opts.note || "Recheck the existing generated clip.", "judgment", opts.warrant || null);
  return completeClip(film, board, r.clipUrl, {
    gridUrl: r.gridUrl, gridPath: r.gridPath, maskedUrl: r.maskedUrl, maskedPath: r.maskedPath,
    faces: r.faces, maskLevel: r.maskLevel, anchorUrl: r.anchorUrl, attempts: r.attempts,
    providerTaskId: r.providerTaskId, providerStartedAt: r.providerStartedAt,
  }, opts.warrant || null);
}
async function renderBoardOnBlackboard(film, boardId, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var board = BB.getBoard(film, boardId);
  if (!board) throw new Error("render: no board " + boardId);
  var live = BB.liveBoards(film);
  var idx = live.indexOf(board);
  if (idx < 0) throw new Error("render: board " + boardId + " is retired");
  var ex = board.execution;
  if (!ex || !(ex.panels || []).length) throw new Error("render: board " + boardId + " has no execution");
  var existing = board.render || {};
  // Idempotency guard: never pay twice for a board that already has a usable
  // clip or a clip waiting at post-render QC.
  if (existing.status === "rendered" && existing.clipUrl)
    return { status: "rendered", clipUrl: existing.clipUrl, boardId: board.id, reused: true, seedanceSpent: false };
  if (existing.status === "clip_qc_blocked" && existing.clipUrl)
    return { status: "clip_qc_blocked", clipUrl: existing.clipUrl, boardId: board.id, qc: existing.clipQc || null, reused: true, seedanceSpent: true };
  // If the VPS restarted after provider submission, keep polling the exact
  // Seedance task instead of redrawing and resubmitting the board.
  if (existing.status === "pending" && existing.providerTaskId && existing.maskedUrl) {
    BB.emit(film, "render", "render_resumed", board.id, { provider: "seedance", taskId: existing.providerTaskId }, "resuming the provider task saved before restart", "mechanical", warrant);
    BB.save(film);
    try {
      var resumedClip = await seedanceFromGrid(existing.maskedUrl, { taskId: existing.providerTaskId,
        startedAt: existing.providerStartedAt ? Date.parse(existing.providerStartedAt) : null,
        onProgress: async function (p) {
          BB.emit(film, "render", "render_progress", board.id, { provider: "seedance", stage: p.stage,
            status: p.status, progressPct: p.progressPct, elapsedMs: p.elapsedMs, estimated: p.estimated === true,
            resumed: true }, null, "mechanical", warrant);
          await captureLiveControl(film, warrant);
          BB.save(film);
        }
      });
      return completeClip(film, board, resumedClip, {
        gridUrl: existing.gridUrl, gridPath: existing.gridPath, maskedUrl: existing.maskedUrl, maskedPath: existing.maskedPath,
        faces: existing.faces, maskLevel: existing.maskLevel, anchorUrl: existing.anchorUrl, attempts: existing.attempts,
        providerTaskId: existing.providerTaskId, providerStartedAt: existing.providerStartedAt,
      }, warrant);
    } catch (resumeError) {
      BB.recordRenderFact(film, boardId, { status: "render_failed", error: String(resumeError.message).slice(0, 200), attempts: existing.attempts || 1 }, warrant);
      BB.save(film);
      return { status: "render_failed", boardId: board.id, error: resumeError.message, seedanceSpent: true };
    }
  }
  var attempts = ((board.render && board.render.attempts) || 0) + 1;
  BB.recordRenderFact(film, boardId, { status: "pending", attempts: attempts }, warrant);
  BB.save(film);
  var prod = await loadProduct(film.user_id, film.productKey);
  var anchor = await ensureToneAnchor(film, warrant);
  var carry = null, _seamLastFrame = null;
  if (idx > 0) {
    var prev = live[idx - 1];
    if (prev.render && prev.render.gridPath) carry = prev.render.gridPath;
    if (prev.render && prev.render.lastFrameUrl) _seamLastFrame = prev.render.lastFrameUrl;
    if (!carry && !_seamLastFrame) BB.emit(film, "render", "carry_unavailable", board.id, { prev: prev.id }, "prior board has no rendered grid or last frame; rendering without visual carry", "mechanical", warrant);
  }
  var _inp = film.inputs || {};
  var _ar = String(_inp.aspectRatio || "").trim();
  var _vert = (_inp.vertical === true) || /9\s*:\s*16|vertical|portrait/i.test(_ar) || (/reel|story|tiktok|short/i.test(String(_inp.intent || "")) && _inp.vertical !== false);
  var aspect = _vert ? "9:16" : "16:9";
  // A previous-board carry chain preserves the last transition but compounds
  // identity drift over long films. Every later people-board also receives one
  // immutable canonical reference: the first people-board that passed QC.
  var _characterRef = film.characterLock && film.characterLock.gridUrl ? film.characterLock.gridUrl : null;
  // Seam grounding:渲 grid 前,panel 1 对齐上一段真实末帧(纸面惯性从此打不过像素事实)
  if (_seamLastFrame && ex.panels && ex.panels.length) {
    var _g1line = await groundPanel1(_seamLastFrame, String(ex.panels[0] || ""));
    if (_g1line && _g1line !== ex.panels[0]) {
      BB.emit(film, "render", "panel1_grounded", board.id, { before: String(ex.panels[0]).slice(0, 140), after: _g1line.slice(0, 140) }, "panel 1 re-grounded on the previous segment's real final frame", "mechanical", warrant);
      ex.panels = ex.panels.slice(); ex.panels[0] = _g1line;
      BB.save(film);
    }
  }
  var g = await renderStoryboardBoard({ panels: ex.panels, world: ex.world, includePeople: ex.includePeople,
    productImages: prod.productImages, colorAnchor: prod.colorAnchor, productContract: prod.contract, outDir: SB_DIR,
    canonicalCharacterImage: _characterRef, priorBoardImage: carry, seamLastFrame: _seamLastFrame, aspect: aspect, durationSec: ex.durationSec });
  var gridUrl = SB_URL + "/" + g.file;
  BB.emit(film, "cinematographer", "say", "film", null, (film.inputs && film.inputs.lang === "zh") ? ("第" + board.id + "板分镜画好了，开始生成视频（这步最久，约几分钟）。") : ("Board " + board.id + " storyboard is drawn -- generating the video now (the longest step, a few minutes)."), "execution", warrant);
  BB.save(film);
  // Objective QC is a hard pre-spend gate. One repair attempt is allowed; a
  // second failure or an unavailable QC service stops before Seedance.
  var _qcFinal = null;
  try {
    var _qcBn = film.brief && film.brief.brand_name;
    var _qcLabel = (_qcBn && typeof _qcBn === "object") ? (_qcBn.content || null) : (typeof _qcBn === "string" ? _qcBn : null);
    var qc = await gridQC(gridUrl, { contract: prod.contract, labelText: _qcLabel, characterReference: _characterRef });
    BB.emit(film, "render", "grid_qc", board.id, qc, qc.pass ? "grid passed objective QC" : ("QC violations: " + (qc.violations || []).map(function(v){return "p"+v.panel+" "+v.issue;}).join("; ").slice(0, 180)), "mechanical", warrant);
    _qcFinal = qc;
    if (!qc.pass && !qc.unavailable && (qc.violations || []).length) {
      var g2 = await renderStoryboardBoard({ panels: ex.panels, world: ex.world, includePeople: ex.includePeople,
        productImages: prod.productImages, colorAnchor: prod.colorAnchor, productContract: prod.contract, outDir: SB_DIR,
        canonicalCharacterImage: _characterRef, priorBoardImage: carry, seamLastFrame: _seamLastFrame, aspect: aspect, durationSec: ex.durationSec, qcFeedback: qc.violations });
      var url2 = SB_URL + "/" + g2.file;
      var qc2 = await gridQC(url2, { contract: prod.contract, labelText: _qcLabel, characterReference: _characterRef });
      BB.emit(film, "render", "grid_qc_retry", board.id, qc2, qc2.pass ? "re-render passed QC" : "re-render still has objective violations", "mechanical", warrant);
      _qcFinal = qc2;
      // The retry is the latest attempted correction and is the artifact the
      // room must inspect/rework, whether it passes or remains blocked.
      g = g2; gridUrl = url2;
    }
  } catch (e) {
    _qcFinal = { pass: false, blocked: true, unavailable: true, reason: "exception", violations: [], error: String(e.message).slice(0, 160) };
    BB.emit(film, "render", "grid_qc_error", board.id, _qcFinal, "QC failed to run; Seedance spend blocked", "mechanical", warrant);
  }
  if (!_qcFinal || _qcFinal.pass !== true) {
    var _qcWhy = _qcFinal && _qcFinal.unavailable ? "objective QC is unavailable" : "objective QC still fails after one repair";
    BB.recordRenderFact(film, boardId, { status: "qc_blocked", gridUrl: gridUrl, gridPath: g.path,
      qc: _qcFinal || { pass: false }, attempts: attempts, error: _qcWhy }, warrant);
    BB.emit(film, "render", "grid_qc_blocked", board.id, { reason: _qcWhy, qc: _qcFinal || null }, "Seedance was not called", "mechanical", warrant);
    BB.emit(film, "overseer", "say", "film", null, CL(film,
      "这块分镜没有通过客观检查，所以我先拦住了视频费用。团队会先修正画面，再重新送审。",
      "This board did not clear objective QC, so I stopped before video spend. The room will correct the frame and submit it again."), "execution", warrant);
    BB.save(film);
    return { status: "qc_blocked", boardId: board.id, qc: _qcFinal || null };
  }
  if (ex.includePeople && !film.characterLock) {
    film.characterLock = { status: "locked", sourceBoardId: board.id, gridUrl: gridUrl, gridPath: g.path, createdAt: new Date().toISOString() };
    BB.emit(film, "render", "character_lock", "film", { sourceBoardId: board.id, gridUrl: gridUrl }, "canonical protagonist locked from the first people-board that passed QC", "mechanical", warrant);
  }
  BB.save(film);
  for (var lvl = 1; lvl <= 2; lvl++) {
    var m = eyemask(g.path, lvl);
    var maskedUrl = SB_URL + "/" + m.out.split("/").pop();
    console.log("   board " + board.id + " mask lvl" + lvl + " faces " + m.faces);
    try {
      // 链式延续：本板若非首板，取前一块已渲染 board 的 clip 作为延续参考，
      // 让 Seedance 从上一段结尾无缝接着生成（画面与音频在段边界连续）。
      var _prevLastRef = null, _prevClipRef = null;
      if (idx > 0) {
        for (var _p = idx - 1; _p >= 0; _p--) {
          var _pb = live[_p];
          if (_pb && _pb.render && _pb.render.status === "rendered" && (_pb.render.lastFrameUrl || _pb.render.clipUrl)) { _prevLastRef = _pb.render.lastFrameUrl || null; _prevClipRef = _pb.render.clipUrl || null; break; }
        }
      }
      var _isFinal = (idx === live.length - 1);
      var _cpx = require("child_process"), _fsx = require("fs");
      var _fdirL = g.path.replace(/\/[^\/]+$/, "");
      var _fdirU = gridUrl.replace(/\/[^\/]+$/, "");
      var _gbase = g.path.replace(/^.*\//, "").replace(/\.[A-Za-z0-9]+$/, "");
      // 开场参考:优先已存末帧;只有前段 clip 时现场抽帧(像素事实永不缺席;失败=断路)
      if (!_prevLastRef && _prevClipRef) {
        try {
          var _plName = _gbase + "_prevlast.jpg";
          _cpx.execSync('ffmpeg -y -sseof -0.5 -i "' + _prevClipRef + '" -vsync 0 -q:v 2 -update 1 "' + _fdirL + "/" + _plName + '" 2>/dev/null');
          if (!_fsx.existsSync(_fdirL + "/" + _plName)) throw new Error("no output");
          _prevLastRef = _fdirU + "/" + _plName;
        } catch (e) { throw new Error("[pipeline] 前段真实末帧抽取失败,拒绝渲染必然硬缝的片段: " + e.message); }
      }
      // Reference-audio-to-Seedance was retired: the provider copied audio
      // behavior instead of preserving score identity. BGM now has one owner:
      // ElevenLabs master generation plus final-film mixing in stitchFilm().
      // 品牌名:只认 film 级字段;查不到就末板不渲字(宁可无字,不渲错字)
      var _brandText = null;
      if (_isFinal) {
        var _bn = film.brief && film.brief.brand_name;
        _brandText = (_bn && typeof _bn === "object") ? (_bn.content || null) : (typeof _bn === "string" ? _bn : null);
        if (_brandText) _brandText = String(_brandText).slice(0, 40);
        else console.warn("[brand] 未找到品牌名字段,末板保持无字干净收束");
      }
      var clip = await seedanceFromGrid(maskedUrl, { duration: ex.durationSec || 15, anchorUrl: anchor.url, prevLastFrameUrl: _prevLastRef, brandText: _brandText, ratio: aspect, finalBeat: _isFinal,
        onProgress: async function (p) {
          if (p.taskId && (p.stage === "submitted" || p.stage === "resumed")) {
            BB.recordRenderFact(film, board.id, { status: "pending", attempts: attempts,
              providerTaskId: p.taskId, providerStartedAt: new Date().toISOString(),
              gridUrl: gridUrl, gridPath: g.path, maskedUrl: maskedUrl, maskedPath: m.out,
              faces: m.faces, maskLevel: lvl, anchorUrl: anchor.url }, warrant);
          }
          BB.emit(film, "render", "render_progress", board.id, {
            provider: "seedance", stage: p.stage, status: p.status, progressPct: p.progressPct,
            elapsedMs: p.elapsedMs, estimated: p.estimated === true, taskId: p.taskId || null,
          }, null, "mechanical", warrant);
          await captureLiveControl(film, warrant);
          BB.save(film);
        }
      });
      var _task = board.render && board.render.providerTaskId || null;
      var _taskStarted = board.render && board.render.providerStartedAt || null;
      return completeClip(film, board, clip, { prod: prod, gridUrl: gridUrl, gridPath: g.path,
        maskedUrl: maskedUrl, maskedPath: m.out, faces: m.faces, maskLevel: lvl, anchorUrl: anchor.url,
        attempts: attempts, providerTaskId: _task, providerStartedAt: _taskStarted }, warrant);
    } catch (e) {
      if (isPIPL(e) && lvl < 2) { console.log("   PIPL@lvl" + lvl + " -> escalate mask"); continue; }
      if (isPIPL(e)) {
        BB.recordRenderFact(film, boardId, { status: "pipl_rejected", gridUrl: gridUrl, gridPath: g.path,
          maskedUrl: maskedUrl, faces: m.faces, maskLevel: lvl, attempts: attempts }, warrant);
        BB.save(film);
        return { status: "pipl_rejected", boardId: board.id };
      }
      BB.recordRenderFact(film, boardId, { status: "render_failed", gridUrl: gridUrl, gridPath: g.path,
        error: String(e.message).slice(0, 200), attempts: attempts }, warrant);
      BB.save(film);
      return { status: "render_failed", boardId: board.id, error: e.message };
    }
  }
}
async function stitchFilm(film) {
  var live = BB.liveBoards(film);
  var missing = live.filter(function (b) { return !(b.render && b.render.status === "rendered" && b.render.clipUrl); });
  if (missing.length) throw new Error("stitch: unrendered boards: " + missing.map(function (b) { return b.id; }).join(", "));
  var urls = live.map(function (b) { return b.render.clipUrl; });
  var wd = "/tmp/sbst-" + Date.now(); fs.mkdirSync(wd, { recursive: true });
  var local = [];
  for (var i = 0; i < urls.length; i++) {
    var r = await fetch(urls[i]); if (!r.ok) throw new Error("clip fetch " + r.status);
    var lp = wd + "/c" + i + ".mp4"; fs.writeFileSync(lp, Buffer.from(await r.arrayBuffer())); local.push(lp);
  }
  var SEAM_TRIM = 0.6; // 非首段掐头秒数:剪掉与前段末拍重叠的重演/回稳帧(match cut)
  var inp = local.map(function (p, i) { return (i > 0 ? ('-ss ' + SEAM_TRIM + ' ') : '') + '-i "' + p + '"'; }).join(" ");
  var lastDur = 15;
  try { lastDur = parseFloat(cp.execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 "' + local[local.length - 1] + '"', { encoding: "utf8" }).trim()) || 15; } catch (e) {}
  if (local.length > 1) lastDur = Math.max(1, lastDur - SEAM_TRIM);
  var nm = local.map(function (_, i) {
    var chain = "[" + i + ":v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1";
    if (i === local.length - 1) chain += ",fade=t=out:st=" + Math.max(0, lastDur - 1.0).toFixed(2) + ":d=1.0,tpad=stop_mode=clone:stop_duration=0.6";
    return chain + "[v" + i + "]";
  }).join(";");
  var ct = local.map(function (_, i) { return "[v" + i + "]"; }).join("");
  var out = SB_DIR + "/" + film.film_id + ".mp4";
  var _vTmp = out.replace(/\.mp4$/, "_v.mp4"); if (_vTmp === out) _vTmp = out + ".v.mp4";
  cp.execSync('ffmpeg -y ' + inp + ' -filter_complex "' + nm + ";" + ct + 'concat=n=' + local.length + ':v=1:a=0[v]" -map "[v]" "' + _vTmp + '"', { stdio: "inherit" });
  // 音频缝合:拼点两侧各 0.2s 淡出/淡入(不用 acrossfade,重叠会让音轨比硬拼视频短,音画逐段脱轨)
  // + 末段 1s 淡出;任一环节失败回退纯视频成片
  try {
    var _durs = local.map(function(f, i){ var d = parseFloat(cp.execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 "' + f + '"').toString().trim()) || 15; return (i > 0 ? Math.max(0.1, d - SEAM_TRIM) : d); });
    var _tot = _durs.reduce(function(a, b){ return a + b; }, 0);
    var _fmt = "aformat=sample_rates=48000:sample_fmts=fltp:channel_layouts=stereo";
    var _af = local.map(function(f, i){
      var ch = [_fmt];
      if (i > 0) ch.push("afade=t=in:st=0:d=0.2");
      if (i < local.length - 1) ch.push("afade=t=out:st=" + Math.max(0, _durs[i] - 0.2).toFixed(2) + ":d=0.2");
      return "[" + i + ":a]" + ch.join(",") + "[a" + i + "]";
    }).join(";");
    var _cat = local.map(function(f, i){ return "[a" + i + "]"; }).join("") + "concat=n=" + local.length + ":v=0:a=1,afade=t=out:st=" + Math.max(0, _tot - 1).toFixed(2) + ":d=1[a]";
    var _aTmp = _vTmp + ".m4a";
    cp.execSync('ffmpeg -y ' + inp + ' -filter_complex "' + _af + ";" + _cat + '" -map "[a]" -c:a aac -b:a 192k "' + _aTmp + '"', { stdio: "inherit" });
    // BGM 母带:确定性文件 <film_id>_bgm.mp3 或 film.bgmUrl,存在则铺底,diegetic 音效垫在下面
    var _bgmLoc = null, _detBgm = SB_DIR + "/" + film.film_id + "_bgm.mp3";
    if (fs.existsSync(_detBgm)) _bgmLoc = _detBgm;
    else if (film.bgmUrl) { try { var _br = await fetch(film.bgmUrl); if (_br.ok) { _bgmLoc = wd + "/bgm.mp3"; fs.writeFileSync(_bgmLoc, Buffer.from(await _br.arrayBuffer())); } } catch (e) { console.warn("[stitch-bgm] bgmUrl 拉取失败:", e.message); } }
    if (_bgmLoc) {
      var _aMix = _vTmp + ".mix.m4a";
      cp.execSync('ffmpeg -y -i "' + _aTmp + '" -i "' + _bgmLoc + '" -filter_complex "[0:a]volume=0.45[sfx];[1:a]' + _fmt + ',atrim=0:' + _tot.toFixed(2) + ',afade=t=out:st=' + Math.max(0, _tot - 1.5).toFixed(2) + ':d=1.5[bgm];[sfx][bgm]amix=inputs=2:duration=first:normalize=0[a]" -map "[a]" -c:a aac -b:a 192k "' + _aMix + '"', { stdio: "inherit" });
      _aTmp = _aMix;
      console.log("[stitch-bgm] 母带铺底完成 (音效垫底 0.45):", _bgmLoc);
    } else {
      console.log("[stitch-bgm] 未发现母带(" + _detBgm + " 或 film.bgmUrl),成片仅 diegetic 音效");
    }
    cp.execSync('ffmpeg -y -i "' + _vTmp + '" -i "' + _aTmp + '" -map 0:v -map 1:a -c:v copy -c:a copy -shortest "' + out + '"', { stdio: "inherit" });
    console.log("[stitch-audio] 拼点淡化 + 末段淡出完成,音画时长严格对齐");
  } catch (e) {
    console.error("[stitch-audio] 音频缝合失败,回退纯视频成片:", e.message);
    cp.execSync('cp -f "' + _vTmp + '" "' + out + '"');
  }
  var url = SB_URL + "/" + film.film_id + ".mp4";
  film.finalFilmUrl = url;
  BB.emit(film, "render", "final_stitch", "film", { url: url, clips: urls.length }, null, "mechanical");
  BB.save(film);
  return url;
}
module.exports = { renderBoardOnBlackboard, recheckClipOnBlackboard, stitchFilm, ensureToneAnchor };
