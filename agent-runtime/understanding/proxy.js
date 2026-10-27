const { AsyncLocalStorage } = require("async_hooks");
const LANG_ALS = new AsyncLocalStorage();
// agent-runtime/understanding/proxy.js
//
// The SINGLE pipe between the VPS agent and Lovable Cloud. The agent holds NO
// keys — it calls vps-proxy, which holds service_role + the AI key on the cloud
// side. This is a "hand with a key", not a brain: it performs DB/AI/tool actions
// the agent decides on. All reasoning stays in the agent (agent.js).
//
// Checks against "did we turn the agent back into an edge function?":
//   - proxy carries NO task logic. It does db.read/db.write/ai.complete/tool.invoke
//     and nothing else. Delete it + give the agent direct keys → agent code unchanged.

const PROXY_URL = process.env.VPS_PROXY_URL;
const SECRET = process.env.VPS_SHARED_SECRET;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

async function call(action, params) {
  if (!PROXY_URL || !SECRET) throw new Error("VPS_PROXY_URL / VPS_SHARED_SECRET not set in .env");
  const timeoutMs = action === "ai.complete" ? 300000 : (action === "tool.invoke" ? 90000 : 30000);
  let res, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 2000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vps-secret": SECRET },
        body: JSON.stringify({ action, params }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error(`proxy ${action} timed out after ${timeoutMs}ms`);
      lastErr = e;
      if (attempt < 2) { console.warn(`[proxy] ${action} fetch failed, retry ${attempt + 1}: ${e && e.message}`); continue; }
      throw e;
    }
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if ((res.status >= 500 || res.status === 429) && attempt < 2) { console.warn(`[proxy] ${action} ${res.status}, retry ${attempt + 1}`); lastErr = new Error(`proxy ${action} ${res.status}`); continue; }
      throw new Error(`proxy ${action} ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw lastErr || new Error(`proxy ${action} failed after retries`);
}

// ── DB ────────────────────────────────────────────────────────────────────
async function dbRead(table, { filters, order, limit, single } = {}) {
  return call("db.read", { table, filters, order, limit, single });
}
async function dbWrite(table, op, { row, rows, onConflict, filters } = {}) {
  return call("db.write", { table, op, row, rows, onConflict, filters });
}

// ── AI (thin passthrough — the agent supplies the prompt; proxy just relays) ──
// `images` (optional): [{ url }] or [{ base64, mimeType }]. The cloud ai.complete
// handler fetches/inlines them as Gemini image parts (same as vision-critique).
// Harmless if the cloud ignores it: the call simply stays text-only.
// Direct OpenAI call from the VPS. Bypasses the Lovable gateway (and its 150s
// idle wall). The VPS is long-running with no serverless time limit, so a
// multi-minute reasoning call simply completes. Only openai/* route here;
// google/* (vision) still goes through the edge.
async function openaiDirect({ system, user, model, images, maxTokens, reasoningEffort, temperature }) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set in .env");
  const oaModel = (model || "gpt-5.5").replace(/^openai\//, "");
  let userContent = user;
  if (Array.isArray(images) && images.length) {
    userContent = [{ type: "text", text: user }].concat(images.map(function (im) {
      const url = im.url || ("data:" + (im.mimeType || "image/jpeg") + ";base64," + im.base64);
      return { type: "image_url", image_url: { url: url } };
    }));
  }
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: userContent });
  const body = { model: oaModel, messages: messages };
  if (typeof maxTokens === "number" && maxTokens > 0) body.max_completion_tokens = maxTokens;
  if (!/gpt-5/i.test(oaModel) && temperature !== undefined) body.temperature = temperature;
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  let res, data;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(function (r) { setTimeout(r, attempt * 2000); });
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 600000);
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error("openai ai.complete timed out after 600000ms");
      if (attempt < 2) { console.warn("[aiComplete] openai fetch failed, retry " + (attempt + 1) + ": " + (e && e.message)); continue; }
      throw e;
    }
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text().catch(function () { return ""; });
      if ((res.status >= 500 || res.status === 429) && attempt < 2) { console.warn("[aiComplete] openai " + res.status + ", retry " + (attempt + 1)); continue; }
      throw new Error("openai " + res.status + ": " + t.slice(0, 300));
    }
    data = await res.json();
    break;
  }
  const ch = data && data.choices && data.choices[0];
  if (ch && ch.finish_reason === "length") console.warn("[aiComplete] finish_reason=length (truncated) model=" + oaModel);
  return (ch && ch.message && ch.message.content) || "";
}

async function aiComplete({ system, user, temperature, json = true, model, images, maxTokens, reasoningEffort }) {
  // 房间双语：从 ALS 取当前 film 的 lang，中文时在 system 尾部注入语言指令（一处生效，所有角色）
  const _langStore = LANG_ALS.getStore();
  if (_langStore && _langStore.lang === "zh" && system) {
    system = system + "\n\nLANGUAGE: 所有面向客户的输出（对话、理由、评语、标题、板书文字）一律用简体中文，语气平实自然，像真实创作团队开会说话。不要翻译腔，不要\u201c让我们\u201d\u201c综上所述\u201d\u201c值得注意的是\u201d这类表达，不要堆形容词。例外（必须保持英文）：JSON 的 key 和枚举值、技术标识符、以及一切用于图像或视频生成的 prompt 字段（generationPrompt、prompt 等）——生成模型吃英文，这些字段转中文会毁掉出图质量。";
  }
  let text;
  if (/^openai\//i.test(model || "") || /^gpt-/i.test(model || "")) {
    text = await openaiDirect({ system, user, model, images, maxTokens, reasoningEffort, temperature });
  } else {
    const params = { system, user };
    if (model) params.model = model;
    if (!/gpt-5/i.test(model || "") && temperature !== undefined) params.temperature = temperature;
    if (Array.isArray(images) && images.length) params.images = images;
    if (typeof maxTokens === "number" && maxTokens > 0) params.maxTokens = maxTokens;
    const out = await call("ai.complete", params);
    text = out?.text ?? "";
  }
  if (!json) return text;
  text = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); } catch { return { _parseError: true, raw: text }; }
}

// ── Tools (whitelisted existing edge functions) ───────────────────────────────
function normalizeToolInvokeResponse(name, out) {
  // vps-proxy has two contracts while the migration is in progress:
  //   wrapped tools:   { ok, data } | { ok:false, error, status? }
  //   legacy tools:    { status, result }
  // Never turn an HTTP-200 error envelope into a successful tool result. That
  // used to make analyze_product look successful while productData contained
  // only `{ ok:false, error }`, allowing understanding to continue ungrounded.
  if (out && out.ok === false) {
    return {
      ok: false,
      error: String(out.error || `${name} failed`),
      status: typeof out.status === "number" ? out.status : undefined,
    };
  }
  if (out && out.ok === true && Object.prototype.hasOwnProperty.call(out, "data")) {
    return { ok: true, data: out.data };
  }
  if (out && typeof out.status === "number") {
    if (out.status >= 400) {
      var detail = out.result && (out.result.error || out.result.message);
      return { ok: false, error: String(detail || `${name} ${out.status}`), status: out.status };
    }
    return { ok: true, data: out.result };
  }
  return { ok: true, data: out };
}

async function toolInvoke(name, body) {
  const out = await call("tool.invoke", { name, body });
  return normalizeToolInvokeResponse(name, out);
}

// cases.search — pgvector retrieval over creative_cases (Lovable adds this action).
// Returns top-N relevant reference ads for the director. Non-fatal if absent.
async function casesSearch(query, topN) {
  const out = await call("cases.search", { query, topN: topN || 4 });
  return out;
}

module.exports = { dbRead, dbWrite, aiComplete, toolInvoke, casesSearch, normalizeToolInvokeResponse, LANG_ALS };
