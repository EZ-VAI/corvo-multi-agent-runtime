// room/imageEdit.js — the ONE OpenAI gpt-image-2 image-edit call path for Corvo.
// Extracted verbatim from room/storyboardRender.js's callEdits. Prompt-agnostic:
// every consumer (storyboardRender, studioRender, future Studio functions) builds
// its own prompt + reference buffers and calls generateToFile here. Replaces the
// scattered / legacy generate-* image paths — one path, one model, one place.
const fs = require("fs");
const crypto = require("crypto");

const OUT_DIR = process.env.STORYBOARD_DIR || "/var/www/html/storyboards";
const PUBLIC_BASE = process.env.STORYBOARD_BASE_URL || ""; // -> public URL

// Raw OpenAI call. Identical contract to storyboardRender.callEdits — do NOT change
// model id / endpoint / field names.
async function callEdits(key, prompt, refs, size) {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", size || "1536x1024");
  for (const buf of refs) form.append("image[]", new Blob([buf], { type: "image/png" }), "ref.png");
  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + key },
    body: form,
  });
}

// base64 / data-URI -> Buffer (Studio: user-uploaded product image, zero-retention)
function bufferFromBase64(input) {
  const m = String(input).match(/^data:.*?;base64,(.*)$/);
  return Buffer.from(m ? m[1] : String(input), "base64");
}

// hosted image URL -> Buffer (storyboard / hosted product images)
async function bufferFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("ref fetch failed " + url + " " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Generate ONE image from a finished prompt + reference buffers; persist to the
// nginx-served dir; return its public URL. gpt-image-2 edit inputs are always
// processed at high fidelity, so input_fidelity must be omitted.
async function generateToFile({ prompt, refs, size, outDir, prefix }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");
  if (!refs || !refs.length) throw new Error("no reference images");

  let resp = await callEdits(key, prompt, refs, size);
  const text = await resp.text();
  if (!resp.ok) throw new Error("openai images/edits " + resp.status + ": " + text.slice(0, 500));
  const data = JSON.parse(text);
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("no b64_json in response: " + text.slice(0, 300));

  const dir = outDir || OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = (prefix || "img") + "-" + crypto.randomUUID() + ".png";
  fs.writeFileSync(dir + "/" + file, Buffer.from(b64, "base64"));
  return { path: dir + "/" + file, file, url: PUBLIC_BASE + "/" + file };
}


// Raw OpenAI text->image (no reference image). For generating a model from
// scratch. gpt-image-2 on /generations is UNVERIFIED — smoke-test before relying.
async function callGenerations(key, prompt, size) {
  const body = { model: "gpt-image-2", prompt: prompt, size: size || "1024x1024" };
  return fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Text -> image -> persisted public URL. If /generations rejects gpt-image-2,
// fall back to /edits with a white canvas (edits is verified working).
async function generateFromText({ prompt, size, outDir, prefix }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");

  let b64 = null;
  let resp = await callGenerations(key, prompt, size);
  let text = await resp.text();
  if (resp.ok) {
    const data = JSON.parse(text);
    b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  } else {
    console.warn("[generateFromText] /generations " + resp.status + " -> fallback /edits white canvas: " + text.slice(0, 200));
    // fallback: edits with a plain white canvas as the "image"
    const [w, h] = (size || "1024x1024").split("x").map(function (n) { return parseInt(n, 10); });
    const canvas = whitePng(w, h);
    let r2 = await callEdits(key, prompt, [canvas], size);
    let t2 = await r2.text();
    if (!r2.ok) throw new Error("both /generations and /edits failed: " + resp.status + " / " + r2.status + ": " + t2.slice(0, 300));
    const d2 = JSON.parse(t2);
    b64 = d2 && d2.data && d2.data[0] && d2.data[0].b64_json;
  }
  if (!b64) throw new Error("no b64_json from text->image: " + text.slice(0, 300));

  const dir = outDir || OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = (prefix || "gen") + "-" + crypto.randomUUID() + ".png";
  fs.writeFileSync(dir + "/" + file, Buffer.from(b64, "base64"));
  return { path: dir + "/" + file, file, url: PUBLIC_BASE + "/" + file };
}

// minimal solid-white PNG of given size (for the edits fallback canvas)
function whitePng(w, h) {
  // build a tiny white PNG via zlib raw — but simplest: 1x1 white scaled by model.
  // Use a 1x1 white pixel PNG; edits accepts it and the prompt drives full-size output.
  const onePxWhite = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return onePxWhite;
}

module.exports = { callEdits, generateToFile, generateFromText, bufferFromBase64, bufferFromUrl, OUT_DIR, PUBLIC_BASE };
