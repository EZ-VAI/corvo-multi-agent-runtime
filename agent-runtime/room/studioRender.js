// room/studioRender.js — Studio e-commerce POSTER generation (gpt-image-2).
// Consumes composeBrandBrief output (brand visual language) + the user's product
// image + optional copy points, and produces a finished marketing poster (key
// visual), not a plain product photo. Goes through imageEdit.js.
const { generateToFile, bufferFromBase64 } = require("./imageEdit");

const SIZE = { "1:1": "1024x1024", "3:4": "1024x1536", "4:3": "1536x1024" };

function buildPosterPrompt({ brief, subtype, productInfo }) {
  const a = (brief && brief.aesthetic) || {};
  const pos = (brief && brief.positioning) || {};
  const posLine = Object.keys(pos).map(function (k) { return k + "\uFF1A" + pos[k]; }).join("\uFF0C");

  const bgLine = subtype === "scene"
    ? "Set the product inside an on-brand lifestyle SCENE (a real environment with mood lighting) matching the brand aesthetic."
    : "Set the product on a clean, premium studio background (seamless or minimal surface) matching the brand aesthetic.";

  return [
    "Create ONE high-resolution E-COMMERCE MARKETING POSTER — a finished advertising key visual a premium DTC brand would publish, NOT a plain product photo.",
    "The product is the item in the supplied reference image(s): render its EXACT shape, colour, material, finish and logo — do NOT reinvent, redraw or restyle the product itself.",
    bgLine,
    "BRAND VISUAL LANGUAGE — density: " + a.density + "; colour temperature: " + a.color_temperature + "; expression: " + a.expression + "." + (a.scene ? " Preferred scene: " + a.scene + "." : "") + (a.emotion ? " Emotional register: " + a.emotion + "." : ""),
    posLine ? ("BRAND POSITIONING — " + posLine + ". Let this drive the mood, styling and copy tone.") : "",
    productInfo
      ? ("Lay out CHINESE marketing copy on the poster, drawn from these product points: " + productInfo + ". Include a short punchy headline (max 8 Chinese characters) and one supporting line (max 20 Chinese characters), placed with intentional on-brand layout. Spell every Chinese character correctly; keep all text crisp and fully legible.")
      : "If any text is added, keep it to a short, correctly-spelled, legible Chinese headline (max 8 characters).",
    "Typography, colour and spacing must express the brand above — a restrained brand gets minimal type and generous space; a bold brand gets stronger type and contrast.",
    "Photorealistic product, premium editorial quality, high resolution.",
  ].filter(Boolean).join("\n");
}

// Returns { images: [publicUrl...], prompt }. n separate calls = n real variations.
async function renderEcommercePoster({ brief, subtype, ratio, productInfo, productImageBase64, count }) {
  if (!productImageBase64) throw new Error("productImageBase64 required");
  if (!brief) throw new Error("brief required");
  const size = SIZE[ratio] || "1024x1024";
  const refs = [bufferFromBase64(productImageBase64)];
  const prompt = buildPosterPrompt({ brief: brief, subtype: subtype || "white", productInfo: productInfo });

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 6);
  const images = [];
  for (let i = 0; i < n; i++) {
    const r = await generateToFile({ prompt: prompt, refs: refs, size: size, prefix: "studio" });
    images.push(r.url);
  }
  return { images: images, prompt: prompt };
}

module.exports = { renderEcommercePoster, buildPosterPrompt };
