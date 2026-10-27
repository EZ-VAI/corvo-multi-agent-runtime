// room/analyzeProduct.js — Studio "one-click analyze": product image -> selling
// points + poster-ready copy, via OpenAI vision (gpt-4o-mini). Reads the PRODUCT
// only (not brand_skill); brand styling is applied later at poster time. Output
// is dropped into the frontend's editable "product info" box (zero-retention).
const SYS = "You are a senior DTC e-commerce copywriter. Look at the product image and infer what the product is and its likely selling points. Reply in Simplified Chinese ONLY, as a compact set of poster-ready points: 3-5 short selling-point phrases (each <=12 chars), plus one punchy headline candidate (<=8 chars). No preamble, no markdown, no English. Format exactly:\n卖点：A、B、C\n标题：XXXX";

async function analyzeProductImage({ productImageBase64 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set in env");
  if (!productImageBase64) throw new Error("productImageBase64 required");

  // normalize to a data URL the vision API accepts
  const dataUrl = /^data:/.test(String(productImageBase64))
    ? productImageBase64
    : "data:image/png;base64," + productImageBase64;

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: [
        { type: "text", text: "分析这个产品，给出适合上电商海报的中文卖点和一个标题。" },
        { type: "image_url", image_url: { url: dataUrl } },
      ] },
    ],
    max_tokens: 300,
    temperature: 0.4,
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error("openai chat/completions " + resp.status + ": " + text.slice(0, 400));
  const data = JSON.parse(text);
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error("no content in vision response: " + text.slice(0, 300));
  return { productInfo: out.trim() };
}

module.exports = { analyzeProductImage };
