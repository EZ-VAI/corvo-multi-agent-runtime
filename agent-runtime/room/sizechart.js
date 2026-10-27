// room/sizechart.js — read a size-chart image into structured rows (vision),
// and suggest the best size for a given model's body measurements.
// Stateless compute; persistence (brand_product table) lives in Supabase.

// ① vision 读尺码表 → 全部行的结构化 JSON
const SIZECHART_SYS = "You are a precise data extractor for apparel size charts. Look at the size-chart image and extract EVERY size row into structured JSON. Reply with ONLY valid JSON, no markdown, no preamble, no explanation. Schema: {\"unit\":\"cm\"|\"in\",\"garment_type\":string,\"measure_type\":\"body\"|\"garment\",\"rows\":[{\"size\":string,\"chest_cm\":number|null,\"shoulder_cm\":number|null,\"sleeve_cm\":number|null,\"back_body_cm\":number|null,\"neck_cm\":number|null,\"waist_cm\":number|null,\"hip_cm\":number|null,\"length_cm\":number|null}]}. Rules: (1) Convert all measurements to CM (if chart is in inches, multiply by 2.54 and set unit to 'cm'). (2) If a chart column is a HALF measurement (e.g. half-chest / pit-to-pit), DOUBLE it to full circumference. (3) measure_type: 'body' if the chart says it reflects body size, 'garment' if it's the garment's own flat dimensions. (4) Map columns to the closest schema field; leave unmapped fields null. (5) Include ALL size rows (XS..XXL etc). Map: chest/bust->chest_cm, shoulder->shoulder_cm, sleeve->sleeve_cm, back body/back length->back_body_cm, neck->neck_cm, waist->waist_cm, hip->hip_cm, length/total length->length_cm.";

async function readSizeChart({ sizeChartImageBase64 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");
  if (!sizeChartImageBase64) throw new Error("sizeChartImageBase64 required");
  const dataUrl = /^data:/.test(String(sizeChartImageBase64))
    ? sizeChartImageBase64 : "data:image/png;base64," + sizeChartImageBase64;

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SIZECHART_SYS },
      { role: "user", content: [
        { type: "text", text: "Extract this size chart into the JSON schema. Every row, all in cm." },
        { type: "image_url", image_url: { url: dataUrl } },
      ] },
    ],
    max_tokens: 1200,
    temperature: 0,
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error("openai vision " + resp.status + ": " + text.slice(0, 400));
  const data = JSON.parse(text);
  let out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error("no content in vision response: " + text.slice(0, 300));
  // strip code fences if any
  out = out.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(out); }
  catch (e) { throw new Error("vision returned non-JSON: " + out.slice(0, 300)); }
  if (!parsed.rows || !Array.isArray(parsed.rows)) throw new Error("no rows in parsed sizechart");
  return parsed;
}

// ② 模特身形 → 推荐码数（最近邻匹配 + 合身余量）
// chart: { measure_type, rows:[{size, chest_cm, shoulder_cm, ...}] }
// model: { height_cm, bust_cm, waist_cm, hip_cm, shoulder_cm }
function suggestSize({ chart, model }) {
  if (!chart || !chart.rows || !chart.rows.length) throw new Error("chart with rows required");
  if (!model) throw new Error("model measurements required");

  // 合身余量：成衣尺寸要比身体大一点才合身；身体尺寸表直接比
  // ease: garment 表给身体加余量后再比；body 表直接比
  const isGarment = chart.measure_type === "garment";
  // 主要看胸围（上衣最关键），辅以肩宽
  const modelChest = model.bust_cm || null;
  const modelShoulder = model.shoulder_cm || null;

  function rowScore(row) {
    let score = 0, terms = 0;
    if (modelChest && row.chest_cm) {
      // 成衣需有正余量(衣服>身体~4-12cm舒适)；身体表直接距离
      const target = isGarment ? modelChest + 6 : modelChest;
      score += Math.abs(row.chest_cm - target); terms++;
    }
    if (modelShoulder && row.shoulder_cm) {
      const target = isGarment ? modelShoulder + 1.5 : modelShoulder;
      score += Math.abs(row.shoulder_cm - target) * 0.6; terms++; // 肩权重略低
    }
    // 没有胸/肩就退而用 waist/hip
    if (terms === 0) {
      if (model.waist_cm && row.waist_cm) { score += Math.abs(row.waist_cm - (isGarment ? model.waist_cm + 4 : model.waist_cm)); terms++; }
      if (model.hip_cm && row.hip_cm) { score += Math.abs(row.hip_cm - (isGarment ? model.hip_cm + 4 : model.hip_cm)); terms++; }
    }
    return terms ? score / terms : Infinity;
  }

  let best = null, bestScore = Infinity, scored = [];
  for (const row of chart.rows) {
    const s = rowScore(row);
    scored.push({ size: row.size, score: Math.round(s * 10) / 10 });
    if (s < bestScore) { bestScore = s; best = row; }
  }
  if (!best) throw new Error("could not match any size");

  // 生成可读理由
  const parts = [];
  if (modelChest && best.chest_cm) parts.push("模特胸围" + modelChest + "cm，" + best.size + "码" + (isGarment ? "成衣" : "身体") + "胸围" + best.chest_cm + "cm");
  const reason = (parts.length ? parts.join("，") + "，最匹配" : (best.size + "码最匹配模特身形"))
    + (isGarment ? "（已计入合身余量）" : "");

  return { recommended_size: best.size, recommended_row: best, reason: reason, all_scores: scored, measure_type: chart.measure_type };
}

module.exports = { readSizeChart, suggestSize };
