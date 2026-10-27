// room/modelShotRender.js — generate a MODEL SHOT: the brand's model (anchored by
// the locked three-view sheet OR uploaded photos) presenting a NON-APPAREL product
// (lipstick / fragrance / bag / etc). Both the model reference and the product
// come in as base64 (frontend converts; VPS never fetches private buckets).
const { callEdits, OUT_DIR, PUBLIC_BASE } = require("./imageEdit");
const fs = require("fs");
const crypto = require("crypto");

const SIZE = { "1:1": "1024x1024", "3:4": "1024x1536", "4:3": "1536x1024", "9:16": "1024x1536" };

function b64ToBuffer(input) {
  const m = String(input).match(/^data:.*?;base64,(.*)$/);
  return Buffer.from(m ? m[1] : String(input), "base64");
}

function buildModelShotPrompt({ brief, framing, productInfo, dims }) {
  const a = (brief && brief.aesthetic) || {};
  const pos = (brief && brief.positioning) || {};
  const posLine = Object.keys(pos).map(function (k) { return k + "\uFF1A" + pos[k]; }).join("\uFF0C");

  const frameLine = framing === "full"
    ? "FULL-BODY shot: the model is shown head to (at least) mid-thigh, presenting / holding the product naturally."
    : framing === "half"
    ? "HALF-BODY shot: the model from roughly the waist up, presenting / holding the product near the upper body or face."
    : "CLOSE shot: tight on the model's hands / face area interacting with the product, model partially in frame.";

  const dimLine = dims && dims.height_cm
    ? ("The model's real proportions are height " + dims.height_cm + "cm, bust " + dims.bust_cm + ", waist " + dims.waist_cm + ", hips " + dims.hip_cm + " — keep the body true to these; do not idealize.")
    : "";

  return [
    "Create ONE photorealistic, premium fashion/commerce MODEL SHOT.",
    "MODEL IDENTITY: the FIRST reference image defines the model — same face, hair, skin tone and body. Reproduce THIS person faithfully; do not invent a different model.",
    "WARDROBE: IGNORE the plain activewear the model wears in the reference image. Dress the model in a complete, tasteful, fashionable outfit that suits THIS brand's aesthetic and is appropriate for presenting this product (e.g. polished editorial styling for beauty/fragrance). The outfit must look intentional and on-brand — never underwear, never the reference activewear. Keep the SAME face, hair and body; only change the clothing.",
    dimLine,
    "PRODUCT: the LAST reference image is the product. Render its EXACT shape, colour, material, finish and logo — do NOT redesign it.",
    "REALISTIC SCALE IS MANDATORY: the product must appear at its true real-world size relative to the model's hands and body. A small item (e.g. lipstick, perfume bottle) stays small — never oversized. Hands hold it naturally and correctly.",
    frameLine,
    productInfo ? ("Product context (for styling, not text): " + productInfo + ".") : "",
    "On-brand styling — density: " + a.density + "; colour temperature: " + a.color_temperature + "; expression: " + a.expression + "." + (a.scene ? " Scene: " + a.scene + "." : "") + (a.emotion ? " Mood: " + a.emotion + "." : ""),
    posLine ? ("Brand positioning — " + posLine + ".") : "",
    "The model looks alive — real expression in eyes and face, natural pose. Photorealistic editorial quality, clean composition, no text overlays.",
  ].filter(Boolean).join("\n");
}

async function renderModelShot({ brief, modelRefBase64, productImageBase64, framing, ratio, productInfo, dims, count }) {
  if (!modelRefBase64) throw new Error("modelRefBase64 required");
  if (!productImageBase64) throw new Error("productImageBase64 required");
  if (!brief) throw new Error("brief required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");

  const size = SIZE[ratio] || "1024x1536";
  const prompt = buildModelShotPrompt({ brief: brief, framing: framing || "half", productInfo: productInfo, dims: dims });
  // ORDER MATTERS: model ref first (identity), product last (the prompt refers to first/last).
  const refs = [b64ToBuffer(modelRefBase64), b64ToBuffer(productImageBase64)];

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 4);
  const images = [];
  for (let i = 0; i < n; i++) {
    let resp = await callEdits(key, prompt, refs, size);
    const text = await resp.text();
    if (!resp.ok) throw new Error("openai images/edits " + resp.status + ": " + text.slice(0, 400));
    const data = JSON.parse(text);
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error("no b64_json: " + text.slice(0, 200));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = "modelshot-" + crypto.randomUUID() + ".png";
    fs.writeFileSync(OUT_DIR + "/" + file, Buffer.from(b64, "base64"));
    images.push(PUBLIC_BASE + "/" + file);
  }
  return { images: images, prompt: prompt };
}


// renderModelPoster — a MODEL SHOT that is also a finished marketing POSTER:
// model presenting the product + on-brand Chinese copy laid out as a key visual.
async function renderModelPoster({ brief, modelRefBase64, productImageBase64, framing, ratio, productInfo, dims, count }) {
  if (!modelRefBase64) throw new Error("modelRefBase64 required");
  if (!productImageBase64) throw new Error("productImageBase64 required");
  if (!brief) throw new Error("brief required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");

  const size = SIZE[ratio] || "1024x1536";
  const base = buildModelShotPrompt({ brief: brief, framing: framing || "half", productInfo: productInfo, dims: dims });
  const copyLine = productInfo
    ? ("POSTER COPY: lay out CHINESE marketing copy on the image — a short punchy headline (max 8 Chinese characters) and one supporting line (max 20 Chinese characters), drawn from: " + productInfo + ". Place type with intentional on-brand layout; spell every character correctly; keep text crisp and fully legible.")
    : "POSTER COPY: if any text is added, a short correctly-spelled legible Chinese headline only (max 8 characters).";
  const prompt = base + "\n" + "This is a finished E-COMMERCE POSTER (advertising key visual), not a plain photo. " + copyLine + " Typography and spacing must express the brand.";

  const refs = [b64ToBuffer(modelRefBase64), b64ToBuffer(productImageBase64)];
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 4);
  const images = [];
  for (let i = 0; i < n; i++) {
    let resp = await callEdits(key, prompt, refs, size);
    const text = await resp.text();
    if (!resp.ok) throw new Error("openai images/edits " + resp.status + ": " + text.slice(0, 400));
    const data = JSON.parse(text);
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error("no b64_json: " + text.slice(0, 200));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = "modelposter-" + crypto.randomUUID() + ".png";
    fs.writeFileSync(OUT_DIR + "/" + file, Buffer.from(b64, "base64"));
    images.push(PUBLIC_BASE + "/" + file);
  }
  return { images: images, prompt: prompt };
}

module.exports = { renderModelShot, renderModelPoster, buildModelShotPrompt };
