// room/agentRoutes.js — Studio Agent 端点 + session 持久化（VPS 本地文件）
// POST /studio/agent — 发消息，起 agent job，返回 jobId
// GET  /studio/agent/job/:jobId — 轮询结果
// GET  /studio/agent/history/:conversationId — 拉对话历史
// session 存 /root/agent-runtime/agent_sessions/<id>.json（重启不丢）

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { runAgentTurn } = require("./studioAgent");

const SESSION_DIR = path.join(__dirname, "..", "agent_sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// agent job 状态（内存，短生命周期；结果拿走即可）
const agentJobs = new Map();
function gcAgentJobs() {
  const now = Date.now();
  for (const [id, j] of agentJobs) {
    if (now - (j.ts || 0) > 3600000) agentJobs.delete(id);
  }
}

// ── session 读写（本地文件持久化）──
function sessionPath(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(SESSION_DIR, safe + ".json");
}
function loadSession(id) {
  const p = sessionPath(id);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { /* corrupt — start fresh */ }
  }
  return { id, history: [], memory: {}, brief: null, created: Date.now() };
}
function saveSession(session) {
  try {
    fs.writeFileSync(sessionPath(session.id), JSON.stringify(session), "utf8");
  } catch (e) {
    console.error("[agent] session save failed:", e && e.message);
  }
}

// 把前端本轮传入的输入合并进 session.memory
// inputs 是前端在用户操作某个 block 后回传的结构化数据
function mergeInputs(session, inputs, brief) {
  if (brief) session.brief = brief;
  if (!inputs) return;
  const mem = session.memory;

  // 选了模特：{ picked_model: { name, refBase64, measurements } }
  if (inputs.picked_model) mem.picked_model = inputs.picked_model;
  // 传了服装：{ garment: { image, detailImages, slot, dims } }
  if (inputs.garment) mem.garment = { ...(mem.garment || {}), ...inputs.garment };
  // 传了产品/饰品图：{ product: { image, info, dims } }
  if (inputs.product) mem.product = { ...(mem.product || {}), ...inputs.product };
  // 传了尺码图（base64）：{ size_chart_image }
  if (inputs.size_chart_image) mem.size_chart_image = inputs.size_chart_image;
  // 模特设定（用于 run_model_profile）：{ profile }
  if (inputs.profile) mem.profile = inputs.profile;
  // 选定的一套组合：{ combo_plan: [...] }
  if (inputs.combo_plan) mem.combo_plan = inputs.combo_plan;
  // 快速选择的结果：{ choice: { key, value } }
  if (inputs.choice && inputs.choice.key) {
    mem.choices = mem.choices || {};
    mem.choices[inputs.choice.key] = inputs.choice.value;
  }
}

function registerAgent(app, auth) {
  // ── 发消息：起 agent job ──
  // body: { message, conversationId?, brief, inputs? }
  //   inputs = 用户操作某个 block 后回传的结构化数据（选的模特/传的图/选择等）
  app.post("/studio/agent", auth, function (req, res) {
    const b = req.body || {};
    const message = (b.message || "").trim();
    if (!message && !b.inputs) {
      return res.status(400).json({ error: "message or inputs required" });
    }
    gcAgentJobs();

    // 会话 id
    const conversationId = b.conversationId || crypto.randomUUID();
    const session = loadSession(conversationId);
    if (b.user_id) { session.user_id = b.user_id; session._userId = b.user_id; }
    if (b.lang === "en" || b.lang === "zh") session.lang = b.lang;  // 按用户归属（前端传来）
    mergeInputs(session, b.inputs, b.brief);
    // 方案B：前端点确认卡按钮发的 execute_pending 信号
    if (b.inputs && b.inputs.execute_pending) session._executePending = true;
    // 精修：前端点"精修这张"发的 refine_panel_index 信号
    if (b.inputs && b.inputs.refine_panel_index !== undefined && b.inputs.refine_panel_index !== null) {
      session._refinePanelIndex = b.inputs.refine_panel_index;
    }
    saveSession(session); // 先存一次（输入已并入）

    const jobId = crypto.randomUUID();
    agentJobs.set(jobId, { status: "running", reply: "", blocks: [], progress: "", conversationId, error: null, ts: Date.now() });
    res.json({ jobId, conversationId });

    // 后台跑
    (async function () {
      try {
        const onProgress = (txt) => {
          const j = agentJobs.get(jobId);
          if (j) { j.progress = txt; j.ts = Date.now(); }
        };
        const userMsg = message || "[用户提供了输入]";
        const out = await runAgentTurn(session, userMsg, onProgress);
        saveSession(session); // 存更新后的 history + memory
        agentJobs.set(jobId, {
          status: "done", reply: out.reply, blocks: out.blocks, progress: "",
          conversationId, error: null, ts: Date.now(),
        });
      } catch (e) {
        console.error("[studio/agent]", e && e.message);
        agentJobs.set(jobId, {
          status: "error", reply: "", blocks: [], progress: "",
          conversationId, error: String((e && e.message) || e), ts: Date.now(),
        });
      }
    })();
  });

  // ── 轮询 agent job ──
  app.get("/studio/agent/job/:jobId", auth, function (req, res) {
    const j = agentJobs.get(req.params.jobId);
    if (!j) return res.status(404).json({ error: "job not found" });
    res.json(j);
  });

  // ── 拉对话历史 ──
  app.get("/studio/agent/history/:conversationId", auth, function (req, res) {
    const session = loadSession(req.params.conversationId);
    // 越权校验：只能看自己的对话
    const uid = req.query.user_id || null;
    if (session.user_id && uid && session.user_id !== uid) {
      return res.status(403).json({ error: "forbidden" });
    }
    res.json({
      conversationId: session.id,
      history: session.history || [],
      memory_summary: summarizeMemory(session.memory),
    });
  });

  // ── 列出某用户的所有对话（侧边栏历史）──
  // GET /studio/agent/conversations?user_id=xxx
  //   -> [{ conversationId, title, updatedAt, messageCount }]  按时间倒序
  app.get("/studio/agent/conversations", auth, function (req, res) {
    const uid = req.query.user_id || null;
    let files = [];
    try { files = fs.readdirSync(SESSION_DIR).filter(function (f) { return f.endsWith(".json"); }); }
    catch (e) { return res.json({ conversations: [] }); }

    const out = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(SESSION_DIR, f), "utf8");
        const s = JSON.parse(raw);
        // 只列该用户的（session 没 user_id 的旧对话：uid 传了就跳过，保证隔离）
        if (uid) { if (s.user_id !== uid) continue; }
        const hist = s.history || [];
        // title = 首条 user 消息前 24 字
        let title = "新对话";
        for (const m of hist) {
          if (m.role === "user" && m.content) { title = String(m.content).slice(0, 24); break; }
        }
        // updatedAt：用文件 mtime（避免解析大 memory）
        let mtime = s.created || 0;
        try { mtime = fs.statSync(path.join(SESSION_DIR, f)).mtimeMs; } catch (e) {}
        out.push({
          conversationId: s.id || f.replace(/\.json$/, ""),
          title: title,
          updatedAt: mtime,
          messageCount: hist.length,
        });
      } catch (e) { /* skip corrupt */ }
    }
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    res.json({ conversations: out });
  });

  console.log("[agent] routes registered: POST /studio/agent, GET /studio/agent/job/:id, GET /studio/agent/history/:id");
}

function summarizeMemory(mem) {
  if (!mem) return {};
  return {
    has_model: !!mem.picked_model,
    model_name: mem.picked_model ? mem.picked_model.name : null,
    has_garment: !!(mem.garment && mem.garment.image),
    has_product: !!(mem.product && mem.product.image),
    has_sizechart: !!mem.size_chart,
    recommended_size: mem.recommended_size || null,
    garment_panels: (mem.garment_panels || []).length,
    generated_count: (mem.generated_assets || []).length,
  };
}

module.exports = { registerAgent };
