// room/clipQC.js — post-Seedance delivery gate.
//
// The storyboard sent to Seedance intentionally carries a blurred privacy mask
// over faces. That mask is an INPUT-REVIEW workaround only. It is never an
// acceptable property of the final clip. This module samples the generated
// video and asks a vision model for binary, observable defects before assembly.
// A failure blocks delivery but NEVER launches another paid Seedance render.
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

function parseJson(text) {
  var raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(raw);
}

function sampleTimes(duration) {
  var d = Math.max(1, Number(duration) || 15);
  return [0.35, d * 0.25, d * 0.5, d * 0.75, Math.max(0.5, d - 0.45)]
    .map(function (n) { return Math.min(Math.max(0, n), Math.max(0, d - 0.05)); });
}

async function inspectClip(clipUrl, opts) {
  opts = opts || {};
  var key = process.env.OPENAI_API_KEY;
  if (!key) return { pass: false, blocked: true, unavailable: true, reason: "OPENAI_API_KEY missing", violations: [] };
  if (!clipUrl) return { pass: false, blocked: true, unavailable: true, reason: "clip URL missing", violations: [] };

  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "corvo-clip-qc-"));
  try {
    var videoPath = path.join(dir, "clip.mp4");
    var r = await fetch(clipUrl);
    if (!r.ok) throw new Error("clip fetch " + r.status);
    fs.writeFileSync(videoPath, Buffer.from(await r.arrayBuffer()));

    var duration = 15;
    try {
      duration = parseFloat(cp.execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], { encoding: "utf8" }).trim()) || 15;
    } catch (_) {}

    var frames = [];
    sampleTimes(duration).forEach(function (at, index) {
      var framePath = path.join(dir, "frame-" + (index + 1) + ".jpg");
      cp.execFileSync("ffmpeg", ["-y", "-ss", at.toFixed(3), "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath], { stdio: "ignore" });
      if (!fs.existsSync(framePath)) throw new Error("frame sampling failed at " + at.toFixed(2) + "s");
      frames.push({ at: at, data: fs.readFileSync(framePath).toString("base64") });
    });

    var includePeople = opts.includePeople === true;
    var checks = [
      "You are checking five chronological frames sampled from ONE generated advertising clip.",
      "The storyboard input used a deliberate BLURRED PRIVACY MASK over faces only to pass provider input review. The FINAL CLIP must not preserve that mask.",
      includePeople
        ? "PEOPLE ARE EXPECTED. Fail if any visible main face has locally blurred/smeared/covered eyes, nose or mouth, an eyemask-shaped patch, melted features, or materially changes identity between frames. Ordinary motion blur on the entire moving frame and background depth-of-field are not failures."
        : "PEOPLE ARE NOT EXPECTED. Fail if a prominent person, face or hand has appeared unexpectedly.",
      "Fail for obvious duplicate subjects/products, broken anatomy, materially malformed products, invented/garbled prominent packaging text, or a severe visual discontinuity between adjacent samples.",
      opts.characterReference ? "A CANONICAL CHARACTER reference follows after the five samples. If a protagonist is visible, compare identity to it. The reference itself may be a storyboard still; compare identity, hair and core wardrobe, not pose or lighting." : "No canonical character reference is available; judge only within-clip identity consistency.",
      (opts.productImages || []).length ? "Product reference images follow last. Compare only clear, prominent product views; do not fail an intentionally distant or occluded product." : "No separate product reference is available.",
      "Return JSON only: {\"pass\":boolean,\"privacyMaskReconstructed\":boolean|null,\"faceQuality\":\"clean\"|\"defect\"|\"not_applicable\",\"identityConsistent\":boolean|null,\"violations\":[{\"frame\":1,\"timeSec\":0.0,\"code\":\"face_blur|face_melt|identity_drift|unexpected_person|duplicate|anatomy|product_fidelity|text|continuity|other\",\"issue\":\"short factual observation\"}]}. pass=true only if there are no objective violations."
    ].join("\n");

    var content = [{ type: "text", text: checks }];
    frames.forEach(function (f, i) {
      content.push({ type: "text", text: "SAMPLED FRAME " + (i + 1) + " at " + f.at.toFixed(2) + " seconds" });
      content.push({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + f.data, detail: "high" } });
    });
    if (opts.characterReference) {
      content.push({ type: "text", text: "CANONICAL CHARACTER REFERENCE" });
      content.push({ type: "image_url", image_url: { url: opts.characterReference, detail: "high" } });
    }
    (opts.productImages || []).slice(0, 2).forEach(function (url, i) {
      content.push({ type: "text", text: "PRODUCT REFERENCE " + (i + 1) });
      content.push({ type: "image_url", image_url: { url: url, detail: "high" } });
    });

    var response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: process.env.CLIP_QC_MODEL || "gpt-4o-mini", temperature: 0, max_tokens: 650,
        response_format: { type: "json_object" }, messages: [{ role: "user", content: content }] })
    });
    var responseText = await response.text();
    if (!response.ok) throw new Error("clip QC " + response.status + ": " + responseText.slice(0, 220));
    var outer = JSON.parse(responseText);
    var answer = outer && outer.choices && outer.choices[0] && outer.choices[0].message && outer.choices[0].message.content;
    var out = parseJson(answer);
    var violations = Array.isArray(out.violations) ? out.violations.slice(0, 12) : [];
    var pass = out.pass === true && violations.length === 0;
    return { pass: pass, blocked: !pass, unavailable: false,
      privacyMaskReconstructed: out.privacyMaskReconstructed == null ? null : out.privacyMaskReconstructed === true,
      faceQuality: out.faceQuality || null,
      identityConsistent: out.identityConsistent == null ? null : out.identityConsistent === true,
      sampledFrames: frames.length, durationSec: duration, violations: violations };
  } catch (e) {
    return { pass: false, blocked: true, unavailable: true, reason: String(e.message).slice(0, 220), violations: [] };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { inspectClip: inspectClip, sampleTimes: sampleTimes };
