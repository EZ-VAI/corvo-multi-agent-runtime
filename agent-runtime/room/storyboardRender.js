// room/storyboardRender.js — VPS-side gpt-image-2 storyboard board gen.
// Heavy synchronous media gen belongs on unconstrained compute, not a wall-clocked edge.
const fs = require("fs");
const crypto = require("crypto");
const cinematic = require("./skills/cinematic");

function panelTimeRanges(durationSec) {
  var d = Number(durationSec) || 15, out = [];
  for (var i = 0; i < 8; i++) out.push("P" + (i + 1) + " [" + (d * i / 8).toFixed(1) + "s-" + (d * (i + 1) / 8).toFixed(1) + "s]");
  return out.join(", ");
}
function buildPrompt({ panels, world, includePeople, colorAnchor, characterLock, carry, seam, aspect, productContract, qcFeedback, durationSec }) {
  const vertical = aspect === "9:16" || /vertical|reel|portrait/i.test(String(aspect || ""));
  const peopleLine = includePeople
    ? "Render the people described ALIVE — real feeling on the face (eyes, mouth, micro-expression); never blank or deadpan."
    : "Product-only — no people in any panel.";
  const colorLine = colorAnchor ? ` The product's colour is exactly ${colorAnchor}.` : "";
  const panelList = panels.map((p, i) => `Panel ${i + 1}: ${p}`).join("\n");
  const pc = productContract || {};
  const contractLines = [
    pc.usage ? "HOW THIS PRODUCT IS USED — any hand or gesture interacting with it must show EXACTLY this, never a generic perfume-spray or other default gesture: " + pc.usage : "",
    pc.rules ? "PRODUCT REPRESENTATION RULES (binding): " + pc.rules : "",
    "PHYSICAL COMMON SENSE: the product exists in the real world — it sits INSIDE a bag not propped in front of it, rests on real surfaces with real weight; within any single panel the product appears AT MOST ONCE, one physical unit, never a duplicate or mirrored double.",
  ].filter(Boolean);
  if (Array.isArray(qcFeedback) && qcFeedback.length) {
    contractLines.push("PREVIOUS ATTEMPT FAILED OBJECTIVE QC. Fix EXACTLY these, panel by panel: " + qcFeedback.map(v => "Panel " + v.panel + ": " + v.issue).join(" | "));
  }
  return [
    (vertical
      ? "Create ONE high-resolution professional film storyboard arranged as 4 columns x 2 rows = exactly 8 panels in reading order (top-left -> top-right -> bottom-left -> bottom-right). EVERY panel is a TALL VERTICAL 9:16 cinematic frame (portrait, clearly taller than wide), composed for a vertical reel screen — each panel has a thin black border and generous white gutters between panels."
      : "Create ONE high-resolution HORIZONTAL professional film storyboard: 4 columns x 2 rows = exactly 8 panels in reading order (top-left -> top-right -> bottom-left -> bottom-right). Each panel is a clean rectangular landscape frame with a thin black border; generous white gutters between panels."),
    "Below each panel, print ONE caption line in small, clean black sans-serif: the panel's time range COPIED VERBATIM from this list — " + panelTimeRanges(durationSec) + " — then a plain FACTUAL production note (subject, action, setting, 6 to 10 words). Use EXACTLY these time values, never invent your own. NO feelings, NO metaphors, NO poetry: captions are shooting notes, not copywriting. Spell every word correctly.",
    "CONTINUITY CONTRACT — every panel obeys ONE shared world: " + world,
    peopleLine,
    "The product in every panel is the item in the supplied reference image(s) — render its exact shape, colour, material and finish; do NOT reinvent it. Any text on the product's OWN label or packaging must be copied LETTER-PERFECT from the reference images — never re-spelled, never re-lettered, never approximated; if a panel is too small to render the label legibly, keep it softly blurred rather than inventing letters." + colorLine,
    contractLines.join("\n"),
    characterLock ? "CANONICAL CHARACTER LOCK: a reference from the first people-board that passed QC is supplied. Its protagonist is the identity authority for the ENTIRE film. Match the same facial identity, hair and core wardrobe exactly. Pose, expression and camera angle may change; identity may not. If the immediately previous board has drifted, the CANONICAL reference wins for identity while the previous board wins only for action continuity." : "",
    carry ? "A reference image of the PREVIOUS board is also supplied: this is a CONTINUING board, carry that protagonist forward UNCHANGED (same person, face, wardrobe); do NOT invent a new person." : "",
    seam ? "A further reference image is supplied: it is the ACTUAL FINAL FRAME of the previous 15-second video segment (a real photographic still, not a storyboard). PANEL 1 of THIS board must open on the very NEXT INSTANT after that frame — the same person in the same pose, same place, same light, the action carried one beat forward. Do NOT restart, do NOT jump in time, do NOT re-establish; panel 1 is a seamless continuation of that exact photographed moment. If the WRITTEN description of Panel 1 conflicts with this frame in any detail (pose, place, hands, object, light), the FRAME WINS — draw Panel 1 from the frame itself, and let panels 2-3 steer naturally toward the described action." : "",
    "Vary shot scale across panels (wide / medium / close / extreme close) for rhythm, but keep the SAME world, same identity, same wardrobe, same light and colour grade across all 8.",
    cinematic.panel(),
    "",
    "PANELS — render these 8 sequential, chronologically continuous beats:",
    panelList,
  ].join("\n");
}

async function callEdits(key, prompt, refs, size) {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", size || "1536x1024");
  for (const buf of refs) form.append("image[]", new Blob([buf], { type: "image/png" }), "ref.png");
  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
}

async function renderStoryboardBoard({ panels, world, includePeople, productImages, colorAnchor, outDir, canonicalCharacterImage, priorBoardImage, seamLastFrame, aspect, productContract, qcFeedback, durationSec }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");
  const vertical = aspect === "9:16" || /vertical|reel|portrait/i.test(String(aspect || ""));
  const size = vertical ? "1024x1024" : "1536x1024";
  const prompt = buildPrompt({ panels, world, includePeople, colorAnchor, characterLock: !!canonicalCharacterImage, carry: !!priorBoardImage, seam: !!seamLastFrame, aspect, productContract, qcFeedback, durationSec });
  if (prompt.indexOf(cinematic.SENTINEL) === -1) throw new Error("storyboard: cinematic panel view missing");

  const refs = [];
  const refKeys = new Set();
  async function pushRef(ref, label) {
    if (!ref || refKeys.has(String(ref))) return;
    try {
      let buf;
      if (/^https?:/i.test(ref)) { const rr = await fetch(ref); if (!rr.ok) throw new Error(String(rr.status)); buf = Buffer.from(await rr.arrayBuffer()); }
      else buf = fs.readFileSync(ref);
      refs.push(buf); refKeys.add(String(ref));
    } catch (e) { console.warn(label + " load failed", ref, e.message); }
  }
  // Identity authority first. Immediate carry and seam follow, then the real
  // product references. Prompt text names each role explicitly.
  await pushRef(canonicalCharacterImage, "character-lock");
  if (priorBoardImage) {
    await pushRef(priorBoardImage, "carry-ref");
  }
  // 上一段视频的真实末帧:panel 1 的交接锚(像素事实,非纸面 panel 8)
  if (seamLastFrame) {
    await pushRef(seamLastFrame, "seam-lastframe");
  }
  // Keep the request bounded while guaranteeing at least one product truth
  // reference even on long-film boards with three continuity refs.
  const productLimit = Math.max(1, 5 - refs.length);
  let productAdded = 0;
  for (const url of (productImages || []).slice(0, productLimit)) {
    const r = await fetch(url);
    if (!r.ok) { console.warn("ref fetch failed", url, r.status); continue; }
    refs.push(Buffer.from(await r.arrayBuffer())); productAdded += 1;
  }
  if (!productAdded) throw new Error("no product reference images fetched");

  // gpt-image-2 edit inputs are high-fidelity by default; the model rejects
  // the legacy input_fidelity parameter, so do not spend a guaranteed 400.
  let resp = await callEdits(key, prompt, refs, size);
  const text = await resp.text();
  if (!resp.ok) throw new Error("openai images/edits " + resp.status + ": " + text.slice(0, 500));
  const data = JSON.parse(text);
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("no b64_json in response: " + text.slice(0, 300));

  const dir = outDir || process.env.STORYBOARD_DIR || "/var/www/html/storyboards";
  fs.mkdirSync(dir, { recursive: true });
  const file = "sb-" + crypto.randomUUID() + ".png";
  fs.writeFileSync(dir + "/" + file, Buffer.from(b64, "base64"));
  return { path: dir + "/" + file, file, prompt };
}

module.exports = { renderStoryboardBoard, buildPrompt };
