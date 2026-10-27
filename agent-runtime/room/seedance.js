// room/seedance.js — grid -> Seedance clip (direct Ark, async). v2.1: pipeline mode.
// Refs: [prevLastFrame?] + [anchor?] + grid.
// Music law: Seedance creates diegetic sound only. One ElevenLabs master is mixed
// across the assembled film later; reference-audio carry is intentionally retired.
const ARK = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const MODEL = "doubao-seedance-2-0-260128";
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

async function progress(opts, payload) {
  if (!opts || typeof opts.onProgress !== "function") return;
  try { await opts.onProgress(payload); }
  catch (e) { console.warn("[seedance progress]", e && e.message); }
}

const cinematic = require('./skills/cinematic');

function buildText(opts){
  var t = "Follow the supplied 8-panel storyboard grid in reading order — one beat per panel, hard cuts, never morph or dissolve.";
  if (opts.prevLastFrameUrl) t += " Open exactly on the supplied previous frame and advance the action from it; never restage or rewind.";
  if (opts.anchorUrl) t += " Match the fidelity anchor's grade, grain and texture, not its time of day.";
  if (opts.finalBeat) {
    t += " Final clip: the last beat eases to stillness on the product, a quiet held ending.";
    if (opts.brandText) t += " Then the brand name \"" + opts.brandText + "\" fades in centered, thin minimal type, spelled exactly: \"" + opts.brandText + "\".";
  } else {
    t += " Middle clip: end on momentum, mid-action, pulling into the next segment.";
  }
  t += " FACES — THE SINGLE MOST IMPORTANT RULE: every human face in the footage is SHARP, clear and in full focus at all times. The storyboard grid shows faces blurred; that blur is a PRIVACY MASK applied for legal compliance, it is NOT a depth-of-field choice, NOT a style, NOT part of the film. Reconstruct every masked face as a real, sharp, fully-rendered human face. Never reproduce, imitate, or carry over any blur, smear or bar on a face.";
  t += " Hard rules: real natural speed, never slow motion; no background music, only sound effects; no added text, logos or watermarks except the product's own label.";
  t += " " + cinematic.oneLine();
  if (t.indexOf(cinematic.SENTINEL) === -1) console.error("[seedance] WARNING: cinematic SENTINEL absent — skill not injected");
  return t;
}


async function waitForTask(taskId, opts) {
  opts = opts || {};
  var key = process.env.ARK_API_KEY;
  if (!key) throw new Error("ARK_API_KEY not set in env");
  if (!taskId) throw new Error("waitForTask: no taskId");
  var startedAt = Number(opts.startedAt) || Date.now();
  var lastStatus = null;
  for (var i = 0; i < 180; i++){
    await sleep(5000);
    var pr = await fetch(ARK + "/" + taskId, { headers: { Authorization: "Bearer " + key } });
    var prText = await pr.text();
    if (!pr.ok) throw new Error("seedance poll " + pr.status + ": " + prText.slice(0, 300));
    var pj; try { pj = JSON.parse(prText); } catch (e) { throw new Error("seedance poll non-JSON: " + prText.slice(0,300)); }
    var st = pj.status || (pj.data && pj.data.status);
    // Provider does not expose a reliable percentage. Report a bounded activity
    // estimate, never 100%, and persist at status changes or every 30 seconds.
    if (st !== lastStatus || i % 6 === 0) {
      var estimated = Math.min(92, 8 + Math.round(((i + 1) / 180) * 84));
      await progress(opts, { stage: "polling", taskId: taskId, status: st || "processing", attempt: i + 1,
        elapsedMs: Date.now() - startedAt, progressPct: estimated, estimated: true });
      lastStatus = st;
    }
    if (st === "succeeded"){
      var url = (pj.content && pj.content.video_url) || (pj.data && pj.data.content && pj.data.content.video_url);
      if (!url) throw new Error("seedance succeeded but no video_url; full: " + JSON.stringify(pj).slice(0,500));
      await progress(opts, { stage: "completed", taskId: taskId, status: "succeeded",
        elapsedMs: Date.now() - startedAt, progressPct: 100, estimated: false });
      return url;
    }
    if (st === "failed" || st === "cancelled") {
      await progress(opts, { stage: "failed", taskId: taskId, status: st,
        elapsedMs: Date.now() - startedAt, progressPct: null });
      throw new Error("seedance " + st + ": " + JSON.stringify(pj).slice(0,400));
    }
    if (i % 6 === 0) console.log("   ...polling", st || "(no status)");
  }
  throw new Error("seedance poll timeout for task " + taskId);
}

async function seedanceFromGrid(gridUrl, opts){
  opts = opts || {};
  var key = process.env.ARK_API_KEY;
  if (!key) throw new Error("ARK_API_KEY not set in env");
  // A VPS restart can interrupt local polling while the provider task keeps
  // running. Resume that exact task instead of submitting and paying twice.
  if (opts.taskId) {
    await progress(opts, { stage: "resumed", taskId: opts.taskId, status: "processing", elapsedMs: 0, progressPct: null, estimated: true });
    return waitForTask(opts.taskId, opts);
  }
  if (!gridUrl) throw new Error("seedanceFromGrid: no gridUrl");
  var content = [{ type: "text", text: opts.text || buildText(opts) }];
  if (opts.prevLastFrameUrl) content.push({ type: "image_url", image_url: { url: opts.prevLastFrameUrl }, role: "reference_image" });
  if (opts.anchorUrl) content.push({ type: "image_url", image_url: { url: opts.anchorUrl }, role: "reference_image" });
  content.push({ type: "image_url", image_url: { url: gridUrl }, role: "reference_image" });
  var body = { model: MODEL, content: content, ratio: opts.ratio || "16:9", duration: Math.min(15, Math.max(5, Math.round(opts.duration || 15))) };
  var sub = await fetch(ARK, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) });
  var subText = await sub.text();
  if (!sub.ok) throw new Error("seedance submit " + sub.status + ": " + subText.slice(0, 500));
  var subJson = JSON.parse(subText);
  var taskId = subJson.id || (subJson.data && subJson.data.id) || subJson.task_id;
  if (!taskId) throw new Error("seedance submit: no task id in " + subText.slice(0, 300));
  var startedAt = Date.now();
  await progress(opts, { stage: "submitted", taskId: taskId, status: "queued", elapsedMs: 0, progressPct: 3, estimated: true });
  return waitForTask(taskId, Object.assign({}, opts, { startedAt: startedAt }));
}
module.exports = { seedanceFromGrid, waitForTask, buildText };
