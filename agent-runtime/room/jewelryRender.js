// room/jewelryRender.js — jewelry ON-BODY shot. Product placed on a real body part
// (finger/ear/wrist/neck/custom) at TRUE real-world scale, driven by the product's
// real measured dimensions + the body part's real anatomical scale. Highest scale
// fidelity in Studio. Model ref optional (generic body part / brand model / fresh).
const { callEdits, OUT_DIR, PUBLIC_BASE } = require("./imageEdit");
const fs = require("fs");
const crypto = require("crypto");

const SIZE = { "1:1": "1024x1024", "3:4": "1024x1536", "4:3": "1536x1024", "16:9": "1536x1024" };

// real anatomical scale anchors (adult average) per body part
const PART_SCALE = {
  finger: "an adult finger (~1.7cm wide at the band)",
  ear:    "an adult earlobe (~1.8cm tall)",
  wrist:  "an adult wrist (~15-16cm circumference)",
  neck:   "an adult neck/décolletage",
  custom: "the specified body part at true human scale",
};

function b64ToBuffer(input) {
  const m = String(input).match(/^data:.*?;base64,(.*)$/);
  return Buffer.from(m ? m[1] : String(input), "base64");
}

// dims: { type, ...typed fields } e.g. {type:"ring", inner_diameter_mm:17} etc.
function dimsLine(dims) {
  if (!dims) return "";
  const map = {
    inner_diameter_mm: "inner diameter", drop_length_mm: "drop length",
    inner_circumference_mm: "inner circumference", chain_length_mm: "chain length",
    dial_diameter_mm: "dial diameter", length_mm: "length", width_mm: "width", height_mm: "height",
    custom_mm: "size",
  };
  const parts = [];
  for (const k in map) if (dims[k]) parts.push(map[k] + " " + dims[k] + "mm");
  if (dims.custom_note) parts.push(dims.custom_note);
  return parts.length ? ("The product's REAL measured dimensions are: " + parts.join(", ") + ". Render it at exactly this real size relative to the body.") : "";
}

function buildJewelryPrompt({ brief, partKey, customPart, dims, productInfo }) {
  const a = (brief && brief.aesthetic) || {};
  const partScale = partKey === "custom" && customPart ? (customPart + " at true human scale") : (PART_SCALE[partKey] || PART_SCALE.custom);

  return [
    "Create ONE photorealistic, premium JEWELRY ON-BODY product shot.",
    "PRODUCT: the LAST reference image is the jewelry piece. Reproduce its EXACT shape, metal colour, stones, proportions and finish — do NOT redesign it. This is a real product, render it faithfully.",
    "PLACEMENT: the piece is worn correctly on " + partScale + ".",
    "SCALE IS CRITICAL AND MUST MATCH REALITY: " + dimsLine(dims) + " The jewelry must look its true real-world size on the body — never oversized, never toy-like. This is the single most important requirement.",
    "Clean, elegant composition focused on the body part and the piece; soft premium lighting; shallow depth of field acceptable.",
    "On-brand styling — density: " + a.density + "; colour temperature: " + a.color_temperature + "; expression: " + a.expression + ".",
    productInfo ? ("Product context: " + productInfo + ".") : "",
    "Photorealistic, editorial jewelry-campaign quality, no text.",
  ].filter(Boolean).join("\n");
}

// modelRefBase64 optional. If present, body part should match that model's skin/hand.
async function renderJewelryShot({ brief, productImageBase64, modelRefBase64, partKey, customPart, dims, ratio, productInfo, count }) {
  if (!brief) throw new Error("brief required");
  if (!productImageBase64) throw new Error("productImageBase64 required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");

  const size = SIZE[ratio] || "1024x1024";
  const prompt = buildJewelryPrompt({ brief: brief, partKey: partKey || "finger", customPart: customPart, dims: dims, productInfo: productInfo });

  // refs: optional model first (skin/identity), product last
  const refs = [];
  if (modelRefBase64) refs.push(b64ToBuffer(modelRefBase64));
  refs.push(b64ToBuffer(productImageBase64));

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
    const file = "jewelry-" + crypto.randomUUID() + ".png";
    fs.writeFileSync(OUT_DIR + "/" + file, Buffer.from(b64, "base64"));
    images.push(PUBLIC_BASE + "/" + file);
  }
  return { images: images, prompt: prompt };
}

module.exports = { renderJewelryShot, buildJewelryPrompt };
