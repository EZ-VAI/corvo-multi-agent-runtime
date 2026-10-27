// room/fashnVTO.js — FASHN Try-On Max adapter. Garment + model -> on-body image
// with garment shape/print/fabric faithfully preserved. Real numeric size data
// goes straight into the prompt (empirically the strongest fit signal — tested).
const API = "https://api.fashn.ai/v1";

// dims: { size_label, chest_cm, shoulder_cm, sleeve_cm, back_body_cm, neck_cm, model_height_cm, fit, garment_type }
function buildSizePrompt(dims) {
  if (!dims) return "";
  const m = [];
  if (dims.chest_cm) m.push("chest " + dims.chest_cm + "cm");
  if (dims.shoulder_cm) m.push("shoulder width " + dims.shoulder_cm + "cm");
  if (dims.sleeve_cm) m.push("sleeve length " + dims.sleeve_cm + "cm");
  if (dims.back_body_cm) m.push("back body length " + dims.back_body_cm + "cm");
  if (dims.neck_cm) m.push("neck " + dims.neck_cm + "cm");
  const g = dims.garment_type || "garment";
  const sz = dims.size_label ? ("size " + dims.size_label + " ") : "";
  let s = "This is a " + sz + g + ".";
  if (m.length) s += " Body measurements for this size: " + m.join(", ") + ".";
  if (dims.model_height_cm) s += " Model height " + dims.model_height_cm + "cm.";
  if (m.length) s += " Fit the garment precisely to these measurements.";
  return s;
}

// returns { url } — the on-body try-on image hosted on FASHN CDN
async function runFashnTryon({ modelImage, garmentImage, dims, resolution, extraPrompt }) {
  const key = process.env.FASHN_API_KEY;
  if (!key) throw new Error("FASHN_API_KEY not set in env");
  const prompt = [buildSizePrompt(dims), extraPrompt].filter(Boolean).join(" ");

  const body = {
    model_name: "tryon-max",
    inputs: {
      model_image: modelImage,
      product_image: garmentImage,
      resolution: resolution || "2k",
      ...(prompt ? { prompt } : {}),
    },
  };
  const r = await fetch(API + "/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error("FASHN /run failed: " + JSON.stringify(j).slice(0, 300));

  for (let i = 0; i < 80; i++) {
    await new Promise(res => setTimeout(res, 3000));
    const s = await fetch(API + "/status/" + j.id, { headers: { Authorization: "Bearer " + key } });
    const sj = await s.json();
    if (sj.status === "completed") {
      const url = sj.output && sj.output[0];
      if (!url) throw new Error("FASHN completed but no output");
      return { url: url };
    }
    if (["failed", "canceled", "time_out"].includes(sj.status)) {
      throw new Error("FASHN " + sj.status + ": " + (sj.error ? JSON.stringify(sj.error) : ""));
    }
  }
  throw new Error("FASHN polling timeout");
}


// 多件穿：FASHN 一次只穿一件，串行把多件依次穿到同一个模特身上。
// garments: [{ image, dims }]，按顺序穿（一般先穿下装再上装，或调用方排好序）。
// 每次把上一次的结果作为下一次的 model_image，最终得到穿齐多件的图。
async function runFashnMulti({ modelImage, garments, resolution }) {
  if (!garments || !garments.length) throw new Error("garments required");
  let current = modelImage;
  let lastUrl = null;
  for (const g of garments) {
    const r = await runFashnTryon({ modelImage: current, garmentImage: g.image, dims: g.dims, resolution: resolution || "2k" });
    lastUrl = r.url;
    // 下一件穿在这次结果上：取回图转 base64 作为新 model_image
    const { bufferFromUrl } = require("./imageEdit");
    const buf = await bufferFromUrl(r.url);
    current = "data:image/png;base64," + Buffer.from(buf).toString("base64");
  }
  return { url: lastUrl };
}

module.exports = { runFashnTryon, runFashnMulti, buildSizePrompt };
