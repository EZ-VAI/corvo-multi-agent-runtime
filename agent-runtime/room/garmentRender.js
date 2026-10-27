// room/garmentRender.js — APPAREL pipeline, split by DELIVERY CHECKPOINTS:
//   stageBase:  ① gpt-image-2 triptych identity底图 → ② FASHN 多姿势穿(可多件) → ④裁切
//               → returns N clean studio on-body panels. STOPS at checkpoint ①.
//   stageScene: single full-size panel → add on-brand scene/color (de-AI). Checkpoint ② increment.
//   stagePoster: single panel → finished e-commerce poster. Increment.
// Frontend orchestrates checkpoints; each stage is its own endpoint.
const { runFashnTryon, runFashnMulti } = require("./fashnVTO");
const { callEdits, bufferFromUrl, bufferFromBase64, OUT_DIR, PUBLIC_BASE } = require("./imageEdit");
const fs = require("fs");
const crypto = require("crypto");

function styleLine(a) {
  return "BRAND SHOOTING STYLE — density: " + (a.density||"") + "; color/tone: " + (a.color_temperature||"") +
         "; mood & attitude: " + (a.expression||"") + "; world: " + (a.scene||"") + "; emotional register: " + (a.emotion||"") + ".";
}

// ① 造型决策：vision 看主图(+细节图) + brand_skill → 为这件衣服设计造型方案。
// 不再写死姿势和中性占位；让 gpt 当造型师，根据衣服风格+品牌调性设计搭配和姿势。

// 第二层：潮流检索（可选）。用 gpt-5-search-api 走 chat/completions 搜这类单品的当季流行搭配。
// 只在 useTrend=true 时调用；返回一段简短潮流摘要，喂给 decideStyling 的造型决策。
async function fetchTrend({ garmentStyleHint, brief }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const year = new Date().getFullYear();
  const a = (brief && brief.aesthetic) || {};
  const q = "For a " + (garmentStyleHint || "fashion garment") + " in a " + (a.expression || "premium") +
    " style, what are the current " + year + " styling trends? Focus on: how to pair it (bottoms, shoes, bags, accessories), trending colours, silhouettes and details this season. Give a concise practical summary a stylist can act on. 2-4 sentences.";

  const body = {
    model: "gpt-5-search-api",
    web_search_options: {},
    messages: [
      { role: "system", content: "You are a fashion trend researcher. Search the web and summarise current-season styling trends concisely and practically. No preamble." },
      { role: "user", content: q },
    ],
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error("fetchTrend " + resp.status + ": " + text.slice(0,300));
  const data = JSON.parse(text);
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return (out || "").trim();
}

async function decideStyling({ mainImage, detailImages, brief, filledSlots, lowerMode, trendSummary }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const a = (brief && brief.aesthetic) || {};
  const pos = (brief && brief.positioning) || {};
  const posLine = Object.keys(pos).map(function(k){ return k + "：" + pos[k]; }).join("，");

  // 用户已上传的槽位（这些是真实商品，造型师不要替换，只为"缺的必需槽"设计搭配）
  const filled = Array.from(filledSlots || []);
  const needStyling = ["top","bottom","shoes"].filter(function(s){ return filled.indexOf(s) === -1; });

  const SYS = "You are a senior fashion stylist and creative director for a high-end brand. You look at a garment and design a complete, tasteful styling for an editorial e-commerce shoot — the outfit pairing AND the model's posing — appropriate to THIS specific garment's style and THIS brand's identity. A delicate cropped cardigan is styled and posed completely differently from a formal polo. Reply with ONLY valid JSON, no markdown, no preamble.";

  const schema = 'JSON schema: {"garment_style":string (e.g. "delicate feminine cropped cardigan"),"pairing":{"bottom":string|null,"shoes":string|null,"bag":string|null,"accessory":string|null},"poses":[string,string,string] (three DISTINCT model poses tailored to this garment\'s vibe — for a delicate cardigan think graceful, poised, feminine gestures; for a formal polo think confident, relaxed stances; each pose one vivid sentence incl. body angle, head orientation, hands, expression),"scene_hint":string,"mood":string}';

  const rules = [
    "The garment shown is the MAIN product and must be worn as-is (do not restyle the garment itself).",
    needStyling.length
      ? ("Design tasteful pairing pieces ONLY for these missing slots: " + needStyling.join(", ") + ". These pairings must SUIT this garment's style and the brand — e.g. a delicate cropped cardigan pairs with a skirt and a small shoulder bag, NOT generic khaki chinos. Leave a slot null if it should stay bare (e.g. half-body).")
      : "The user supplied all main pieces; keep pairing minimal.",
    lowerMode === "half" ? "This is a half-body composition; bottom/shoes can be null." : "",
    "Design THREE poses that specifically fit THIS garment's personality and the brand mood — do NOT default to generic walking/hand-in-pocket stances unless they truly fit. The three poses must be visibly different from each other.",
    "Brand aesthetic — density: " + a.density + "; colour: " + a.color_temperature + "; expression: " + a.expression + (a.scene ? "; world: " + a.scene : "") + (a.emotion ? "; mood: " + a.emotion : "") + ".",
    posLine ? ("Brand positioning — " + posLine + ".") : "",
    (function(){
      var range = (brief && brief.target_age_range) || null;
      if (!range) return "";
      var m = {
        "18-25": "Target customers are 18-25: lean the styling younger, more current and playful.",
        "25-35": "Target customers are 25-35: polished, contemporary styling.",
        "35-45": "Target customers are 35-45: classic, restrained, elevated styling.",
        "45+": "Target customers are 45+: timeless, sophisticated styling.",
      };
      var line = m[range] || "";
      if (!line) return "";
      return line + " CRITICAL: even for mature audiences, the styling must read modern, high-end and aspirational — NEVER conservative, dated, dowdy or matronly. Age guides maturity of taste, not a downgrade in fashion-forwardness.";
    })(),
    trendSummary ? ("CURRENT-SEASON TREND CONTEXT (incorporate tastefully where it fits this brand — do NOT force it if it clashes with the brand's identity): " + trendSummary) : "",
    schema,
  ].filter(Boolean).join(" ");

  const content = [{ type: "text", text: rules }];
  const md = /^data:/.test(String(mainImage)) ? mainImage : "data:image/jpeg;base64," + mainImage;
  content.push({ type: "image_url", image_url: { url: md } });
  (detailImages || []).slice(0,3).forEach(function(di){
    const u = /^data:/.test(String(di)) ? di : "data:image/jpeg;base64," + di;
    content.push({ type: "image_url", image_url: { url: u } });
  });

  const body = { model: "gpt-5.5", messages: [ { role:"system", content: SYS }, { role:"user", content: content } ], max_completion_tokens: 700 };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error("decideStyling vision " + resp.status + ": " + text.slice(0,300));
  let out = JSON.parse(text).choices[0].message.content.trim();
  out = out.replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim();
  try { return JSON.parse(out); }
  catch(e) { throw new Error("decideStyling non-JSON: " + out.slice(0,200)); }
}

function saveBuf(buf, prefix) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = prefix + "-" + crypto.randomUUID() + ".png";
  fs.writeFileSync(OUT_DIR + "/" + file, buf);
  return { url: PUBLIC_BASE + "/" + file, path: OUT_DIR + "/" + file };
}
function saveB64(b64, prefix) { return saveBuf(Buffer.from(b64, "base64"), prefix); }

// 下身处理（选项1/2 在底图prompt控制；3多件在FASHN层；4占位不到这）
function buildWardrobe(filledSlots, lowerMode) {
  // filledSlots: Set of slots the USER uploaded (FASHN will dress these). gpt fills the rest of the REQUIRED slots.
  // Required slots a complete outfit must have: top, bottom, shoes.
  if (lowerMode === "half") {
    // 半身：只需上半身，下装/鞋不强求；但上衣槽若用户没传仍需基础层
    const parts = [];
    parts.push(filledSlots.has("top")
      ? "the upper body wears a plain minimal fitted base layer (it will be replaced — keep plain and form-fitting)."
      : "the upper body wears a plain neutral fitted top.");
    return "Compose as an UPPER-BODY / half-body shot (waist up). " + parts.join(" ");
  }
  const required = ["top", "bottom", "shoes"];
  const labels = {
    top: { filled: "a plain minimal fitted base top (will be replaced — keep plain & form-fitting so it can be swapped)",
           placeholder: "a plain neutral fitted top (neutral placeholder, not a branded item)" },
    bottom: { filled: "a plain minimal fitted base for the lower body (will be replaced — keep plain so it can be swapped)",
              placeholder: "plain neutral khaki/chino trousers (neutral placeholder, not a branded item)" },
    shoes: { filled: "the feet kept clearly visible with a minimal base shoe (will be replaced — keep plain)",
             placeholder: "clean minimal neutral shoes (e.g. simple loafers or sneakers — neutral placeholder). The model must NOT be barefoot" },
  };
  const desc = required.map(function (slot) {
    const f = filledSlots.has(slot);
    return labels[slot][f ? "filled" : "placeholder"];
  });
  // 用户上传的可选槽（hat/bag等）也要在底图留位
  const optionalFilled = [];
  filledSlots.forEach(function (s) { if (required.indexOf(s) === -1) optionalFilled.push(s); });
  let line = "WARDROBE — the model must be FULLY DRESSED with a complete outfit. Specifically: " + desc.join("; ") + ".";
  if (optionalFilled.length) {
    line += " Leave natural room for these accessory items to be added: " + optionalFilled.join(", ") + ".";
  }
  return line;
}
// 姿势数 → 等分面板的三联/多联底图 prompt
function buildBasePrompt({ a, poses, lowerMode, filledSlots, styling }) {
  const n = poses;
  // 姿势：优先用 styling.poses（为这件衣服定制），否则退回通用
  const stylePoses = (styling && Array.isArray(styling.poses) && styling.poses.length) ? styling.poses : null;
  const fallback = [
    "a relaxed confident standing pose, face toward camera",
    "a mid-stride walking pose, body three-quarters, face turned slightly aside",
    "a casual hand-in-pocket lean, head at a different angle, gaze aside",
    "a turning three-quarter-back pose, head looking back over the shoulder",
  ];
  const poseArr = (stylePoses || fallback).slice(0, n);
  const chosen = poseArr.map(function(p, i){ return "panel " + (i+1) + ": " + p; }).join("; ");

  // 搭配：优先用 styling.pairing 为缺的槽设计的具体单品，否则退回 buildWardrobe 的中性占位
  let wardrobe;
  if (styling && styling.pairing) {
    const p = styling.pairing;
    const filled = filledSlots || new Set();
    const dressed = [];
    if (!filled.has("bottom") && lowerMode !== "half") dressed.push(p.bottom ? ("a " + p.bottom) : "a tasteful bottom suited to the top");
    if (!filled.has("shoes") && lowerMode !== "half") dressed.push(p.shoes ? ("" + p.shoes) : "clean minimal shoes (not barefoot)");
    if (p.bag) dressed.push("carrying " + p.bag);
    if (p.accessory) dressed.push(p.accessory);
    const half = lowerMode === "half" ? "Compose as an upper-body / half-body shot. " : "";
    wardrobe = "WARDROBE — the model is fully and tastefully styled for this brand. " + half +
      "The MAIN garment (top) will be replaced later, so render it as a plain fitted base top for now. " +
      (dressed.length ? ("Style the rest of the outfit as: " + dressed.join("; ") + ". The model must NOT be barefoot unless half-body.") : "");
  } else {
    wardrobe = "WARDROBE NOTE: the top layer that will be replaced should stay plain and form-fitting. " + buildWardrobe(filledSlots, lowerMode);
  }

  const moodLine = styling && styling.mood ? (" Overall mood: " + styling.mood + ".") : "";
  return [
    "Using the person in the reference image as the model identity (same face, hair, skin tone, body), create ONE image containing " + n + " full-body shots (FULL BODY, head to feet, feet included) of THIS SAME model, arranged as " + n + " EQUAL vertical panels side by side separated by thin clean gutters — a lookbook triptych.",
    "CRITICAL: each panel is a DISTINCTLY DIFFERENT pose with a different head orientation / expression, tailored to this garment — do NOT reuse the same frontal face. Specifically — " + chosen + ".",
    "The three faces must look naturally different in direction and expression, as in a real photoshoot. It MUST remain the IDENTICAL person in every panel — same facial identity, body, proportions.",
    styleLine(a) + moodLine,
    "BACKGROUND in all panels MUST be CLEAN and SIMPLE for now: a plain seamless neutral studio backdrop. No scene yet (scene added later).",
    wardrobe,
    "Photorealistic, even soft studio light, no text, no labels. " + n + " equal panels, each full body head to feet with footwear visible (unless half-body), clean gutters.",
  ].join("\n");
}// ① + ② + ④  →  N 张裁切好的干净棚拍上身图
function sortGarments(garments) {
  // 物理穿衣顺序：下装 → 上衣 → 外套 → 鞋 → 帽 → 包/配饰
  const order = {
    bottom:0, pants:0, trousers:0, lower:0, skirt:0, shorts:0,
    top:1, shirt:1, polo:1, tshirt:1, blouse:1, sweater:1, dress:1,
    jacket:2, outer:2, coat:2, blazer:2,
    shoes:3, shoe:3, sneakers:3, loafers:3, boots:3,
    hat:4, cap:4, beanie:4,
    bag:5, accessory:5, scarf:5, belt:5,
  };
  function rank(g) {
    const s = (g.slot || (g.dims && g.dims.garment_type) || "").toLowerCase();
    return order[s] !== undefined ? order[s] : 1;
  }
  return garments.slice().sort(function (a, b) { return rank(a) - rank(b); });
}async function stageBase({ brief, identityImage, garments, poses, ratioPerPanel, lowerMode, resolution, detailImages, useTrend }) {
  if (!brief) throw new Error("brief required");
  if (!identityImage) throw new Error("identityImage required (model three-view from brand_model)");
  if (!garments || !garments.length) throw new Error("at least one garment required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const a = (brief.aesthetic) || {};
  const n = Math.min(Math.max(parseInt(poses, 10) || 3, 1), 4);

  // ① 多联底图（identityImage 为 base64 或 URL）
  const idBuf = /^https?:/i.test(identityImage) ? await bufferFromUrl(identityImage) : bufferFromBase64(identityImage);
  // 多联横图尺寸：每格竖向，整体横向
  const baseSize = n >= 3 ? "1536x1024" : "1024x1024";
  // 计算用户上传商品占了哪些槽（FASHN 穿这些；gpt 补其余必需槽）
  function slotOf(g) {
    const s = (g.slot || (g.dims && g.dims.garment_type) || "").toLowerCase();
    if (["bottom","pants","trousers","skirt","shorts","lower"].indexOf(s) >= 0) return "bottom";
    if (["shoes","shoe","sneakers","loafers","boots"].indexOf(s) >= 0) return "shoes";
    if (["hat","cap","beanie"].indexOf(s) >= 0) return "hat";
    if (["bag","accessory","scarf","belt"].indexOf(s) >= 0) return "bag";
    return "top"; // 默认上衣
  }
  const filledSlots = new Set(garments.map(slotOf));
  // ① 造型决策：让 gpt 当造型师，为这件衣服设计搭配+姿势（vision 读主图+细节图）
  let styling = null;
  let trendSummary = null;
  // 第二层（可选）：先搜当季潮流
  if (useTrend) {
    try {
      // 先用主商品品类粗提一个 hint 给搜索（用 slot 或 garment_type）
      const g0 = garments[0] || {};
      const hint = (g0.dims && g0.dims.garment_type) || g0.slot || "garment";
      trendSummary = await fetchTrend({ garmentStyleHint: hint, brief: brief });
      console.log("[stageBase] trend:", (trendSummary||"").slice(0, 300));
    } catch (e) {
      console.error("[stageBase] fetchTrend failed, proceeding without trend:", e && e.message);
    }
  }
  try {
    const mainImg = garments[0] && garments[0].image;
    styling = await decideStyling({ mainImage: mainImg, detailImages: detailImages, brief: brief, filledSlots: filledSlots, lowerMode: lowerMode, trendSummary: trendSummary });
    console.log("[stageBase] styling:", JSON.stringify(styling).slice(0, 400));
  } catch (e) {
    console.error("[stageBase] decideStyling failed, fallback to neutral:", e && e.message);
  }
  const basePrompt = buildBasePrompt({ a, poses: n, lowerMode, filledSlots, styling });
  let r1 = await callEdits(key, basePrompt, [idBuf], baseSize);
  const t1 = await r1.text();
  if (!r1.ok) throw new Error("stageBase ① " + r1.status + ": " + t1.slice(0,300));
  const baseImg = saveB64(JSON.parse(t1).data[0].b64_json, "g-base");

  // ② FASHN 在多联底图上穿衣（多件串行）
  const baseB64 = "data:image/png;base64," + Buffer.from(await bufferFromUrl(baseImg.url)).toString("base64");
  let vtoUrl;
  if (garments.length === 1) {
    const r = await runFashnTryon({ modelImage: baseB64, garmentImage: garments[0].image, dims: garments[0].dims, resolution });
    vtoUrl = r.url;
  } else {
    const r = await runFashnMulti({ modelImage: baseB64, garments: sortGarments(garments), resolution });
    vtoUrl = r.url;
  }

  // ④ 裁切成 N 张
  const panels = await splitPanels(vtoUrl, n);
  return { panels, baseUrl: baseImg.url, vtoUrl, styling, trendSummary };
}

// 裁切：把多联图等分成 N 张
async function splitPanels(url, n) {
  let sharp;
  try { sharp = require("sharp"); } catch { return [url]; } // 无 sharp 退化为整图
  const buf = await bufferFromUrl(url);
  const meta = await sharp(buf).metadata();
  const w = Math.floor(meta.width / n), h = meta.height;
  const out = [];
  for (let i = 0; i < n; i++) {
    const panelBuf = await sharp(buf).extract({ left: i*w, top: 0, width: w, height: h }).png().toBuffer();
    out.push(saveBuf(panelBuf, "g-panel").url);
  }
  return out;
}

// 增值①：单张全尺寸加场景/色调 + 去AI味（锁版型脸比例）
async function stageScene({ brief, panelImage, identityImage, detailImages, ratio }) {
  if (!brief) throw new Error("brief required");
  if (!panelImage) throw new Error("panelImage required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const a = (brief.aesthetic) || {};
  const pos = (brief.positioning) || {};
  const posLine = Object.keys(pos).map(function(k){ return k + "\uFF1A" + pos[k]; }).join("\uFF0C");
  const SIZE = { "1:1":"1024x1024","3:4":"1024x1536","4:3":"1536x1024","9:16":"1024x1536" };

  const prompt = [
    "The FIRST reference image shows a model wearing a garment on a clean studio background. If a SECOND reference image is provided, it defines the model identity — keep the SAME face and person as that identity reference.",
    "PRESERVE EXACTLY: the garment fit/shape/length/sleeves/collar/print/logo/proportions, and the model's face, body and proportions. Do NOT change how the garment fits or the body looks.",
    "Replace the plain background with a polished on-brand SCENE and lighting/color treatment (now is the time for scene — the garment is locked).",
    styleLine(a),
    posLine ? ("Brand positioning — " + posLine + ".") : "",
    "KILL the AI look: natural skin texture with pores, non-uniform realistic light, slight film grain, natural fabric micro-wrinkles. Must read as a real photograph.",
    "If additional close-up detail reference images are provided (e.g. buttons, embroidery, logo, hardware), use them to FAITHFULLY correct and sharpen those specific garment details — buttons, logos and trims must match the real close-ups, not be blurred or invented.",
    "Photorealistic editorial e-commerce quality.",
  ].filter(Boolean).join("\n");

  const pBuf = /^https?:/i.test(panelImage) ? await bufferFromUrl(panelImage) : bufferFromBase64(panelImage);
  const sceneRefs = [pBuf];
  if (identityImage) { sceneRefs.push(/^https?:/i.test(identityImage) ? await bufferFromUrl(identityImage) : bufferFromBase64(identityImage)); }
  for (const di of (detailImages || []).slice(0,2)) { sceneRefs.push(/^https?:/i.test(di) ? await bufferFromUrl(di) : bufferFromBase64(di)); }
  let r = await callEdits(key, prompt, sceneRefs, SIZE[ratio] || "1024x1536");
  const t = await r.text();
  if (!r.ok) throw new Error("stageScene " + r.status + ": " + t.slice(0,300));
  return { url: saveB64(JSON.parse(t).data[0].b64_json, "g-scene").url };
}

// 增值②：单张 → 电商海报（图文）
async function stagePoster({ brief, panelImage, identityImage, detailImages, productInfo, ratio }) {
  if (!brief) throw new Error("brief required");
  if (!panelImage) throw new Error("panelImage required");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const a = (brief.aesthetic) || {};
  const pos = (brief.positioning) || {};
  const posLine = Object.keys(pos).map(function(k){ return k + "\uFF1A" + pos[k]; }).join("\uFF0C");
  const SIZE = { "1:1":"1024x1024","3:4":"1024x1536","4:3":"1536x1024","9:16":"1024x1536" };

  const prompt = [
    "The reference image shows a model wearing a garment. PRESERVE EXACTLY the garment fit/shape/print/logo/proportions and the model's face and body — do NOT change them.",
    "Turn this into a finished E-COMMERCE POSTER (advertising key visual) for this brand: add an on-brand background/scene, intentional composition, and lay out CHINESE marketing copy.",
    productInfo
      ? ("POSTER COPY drawn from: " + productInfo + ". A short punchy headline (max 8 Chinese characters) + one supporting line (max 20 Chinese characters), placed with intentional on-brand layout, correctly spelled, fully legible.")
      : "POSTER COPY: a short correctly-spelled legible Chinese headline only (max 8 characters).",
    styleLine(a),
    posLine ? ("Brand positioning — " + posLine + ".") : "",
    "If additional close-up detail reference images are provided (buttons, embroidery, logo, hardware), use them to faithfully render those specific garment details accurately.",
    "Also kill the AI look (real skin texture, natural light, slight grain). Photorealistic editorial quality, typography expresses the brand.",
  ].filter(Boolean).join("\n");

  const pBuf = /^https?:/i.test(panelImage) ? await bufferFromUrl(panelImage) : bufferFromBase64(panelImage);
  const posterRefs = [pBuf];
  if (identityImage) { posterRefs.push(/^https?:/i.test(identityImage) ? await bufferFromUrl(identityImage) : bufferFromBase64(identityImage)); }
  for (const di of (detailImages || []).slice(0,2)) { posterRefs.push(/^https?:/i.test(di) ? await bufferFromUrl(di) : bufferFromBase64(di)); }
  let r = await callEdits(key, prompt, posterRefs, SIZE[ratio] || "1024x1536");
  const t = await r.text();
  if (!r.ok) throw new Error("stagePoster " + r.status + ": " + t.slice(0,300));
  return { url: saveB64(JSON.parse(t).data[0].b64_json, "g-poster").url };
}

module.exports = { stageBase, stageScene, stagePoster, splitPanels };
