const { LANG_ALS } = require("../understanding/proxy");
function L2(lang, zh, en) { return lang === "zh" ? zh : en; }
// room/bb_routes.js - film lifecycle endpoints (frontend -> film-control edge fn -> here).
// POST /films {userId, strategy, vertical, subcategory, runtimeSec} -> create + start
// POST /films/:id/resume -> continue after client input (extends turn budget by 4)
// GET  /films/:id -> filmView fallback (frontend normally reads Supabase mirror)
const BB = require("./blackboard");
const { runFilm } = require("./bb_controller");
const { dbRead } = require("../understanding/proxy");
const { buildStrategy } = require("../strategy/agent");
const running = new Set();
function uw(r) { var x = r; for (var i = 0; i < 3; i++) { if (x && typeof x === "object" && "data" in x) x = x.data; else break; } return x; }
async function assembleBrandBrain(userId, vertical, subcategory) {
  var bb = uw(await dbRead("brand_brain", { filters: { user_id: userId }, single: true })) || {};
  var pb = uw(await dbRead("product_brain", { filters: { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true }));
  if (pb) {
    var vt = pb.value_translation || {};
    var fd = (vt.filmable_desire && typeof vt.filmable_desire === "object") ? vt.filmable_desire : {};
    bb.value_translation = { product_specific_truths: vt.product_specific_truths || [], core_desire: fd.core_desire || vt.core_desire || "", texture_language: fd.texture_language || [], sensory_translations: fd.sensory_translations || vt.sensory_translations || [] };
    bb.fidelity = pb.fidelity || null;
  }
  if (vertical) bb.vertical = vertical;
  if (subcategory) bb.subcategory = subcategory;
  return bb;
}
function fire(film, opts) {
  if (running.has(film.film_id)) return false;
  running.add(film.film_id);
  runFilm(film, opts || {})
    .then(function (r) { console.log("[film]", film.film_id, "->", r.status); })
    .catch(function (e) { console.error("[film]", film.film_id, "FAILED:", e.message); })
    .finally(function () { running.delete(film.film_id); });
  return true;
}
function registerFilms(app, auth) {
  app.use(function (req, res, next) { LANG_ALS.run({ lang: undefined }, next); });
  // 重启孤儿恢复：进程重启会丢内存 running 集，正在跑的片会以 deliberating 卡死。
  // 启动时把它们置为 stalled 并对客户说明——一句回复(resume)即可续跑。
  try {
    var _fs = require("fs"), _path = require("path");
    var _dir = process.env.BB_DIR || "/var/lib/corvo/blackboards";
    _fs.readdirSync(_dir).forEach(function (fn) {
      if (!/\.json$/.test(fn)) return;
      try {
        var f = JSON.parse(_fs.readFileSync(_path.join(_dir, fn), "utf8"));
        if (f && f.status === "deliberating") {
          f.status = "stalled";
          BB.emit(f, "overseer", "say", "film", null, (f.inputs && f.inputs.lang === "zh") ? "服务器重启打断了我们。回我一句，我马上接着做。" : "A restart interrupted us. Say anything and I will pick it right back up.", "execution");
          BB.save(f);
          console.log("[boot-recovery]", f.film_id, "deliberating -> stalled");
        }
      } catch (e) {}
    });
  } catch (e) { console.warn("[boot-recovery]", e.message); }
  app.post("/films", auth, async function (req, res) {
    try {
      var b = req.body || {};
      if (!b.userId) return res.status(400).json({ error: "userId required" });
      // The film is born EMPTY in the understanding stage. No brand brain, no brief,
      // no strategist pre-run -- the Overseer gathers all of that inside the room
      // (greet -> ask for URL -> run_understanding -> brief -> client confirms).
      // We only carry the client's film inputs (length / vertical / vibe) as metadata.
      var film = BB.newFilm({ userId: b.userId, stage: "understanding" });
      var lang = (b.lang === "zh" || b.lang === "en") ? b.lang : "en";
      var _st = LANG_ALS.getStore(); if (_st) _st.lang = lang;
      film.inputs = {
        lang: lang,
        runtimeSec: b.runtimeSec || 60,
        aspectRatio: b.aspectRatio || "16:9",
        vertical: b.vertical || null,
        subcategory: b.subcategory || null,
        vibe: b.vibe || ((typeof b.strategy === "string") ? b.strategy : null),
        intent: b.intent || null,
      };
      // ── Scripted opening (zero LLM cost). Tailor to new vs returning client. ──
      var priorFilms = 0;
      try {
        var rows = await dbRead("films", { filters: { user_id: b.userId }, limit: 50 });
        priorFilms = Array.isArray(rows) ? rows.length : 0;
      } catch (e) { priorFilms = 0; }
      var ASK = L2(lang, "欢迎。开工之前，先把研究品牌的入口发我：你的官网、某个产品页、店铺链接，哪怕只有一张产品图也行。比如：yourbrand.com、一个亚马逊产品页、或你想让这部片卖的那件商品的链接。", "Welcome. Before we make anything, send me where we should study the brand: your website, a specific product page, storefront link, or even a product image if that is all you have. For example: yourbrand.com, an Amazon product page, or a link to the exact item you want the film to sell.");
      if (priorFilms <= 1) {
        BB.emit(film, "overseer", "say", "film", null, L2(lang, "欢迎来到 Corvo。我是总监，这间创作室由我负责——保证我们做的每一步都真正为你的品牌服务。来，认识一下你的团队。", "Hi! Welcome to Corvo! I'm the Overseer — I run this room and make sure everything we make actually serves your brand. Let me introduce your team."), "execution");
        BB.emit(film, "analyst", "say", "film", null, L2(lang, "我是分析师。我负责研究你的品牌和产品，直到我们真正搞懂你是谁。", "Hi! I'm your Analyst. I study your brand and product until we really understand what you're about."), "execution");
        BB.emit(film, "director", "say", "film", null, L2(lang, "我是导演。我决定这部片到底讲什么，并且让每个选择都守住它。", "Hi! I'm your Director. I decide what your film is really about, and hold every choice to it."), "execution");
        BB.emit(film, "cinematographer", "say", "film", null, L2(lang, "我是摄影指导。我把想法变成画面——每个镜头怎么看、怎么动。", "Hi! I'm your Cinematographer. I turn the idea into images — how every shot looks and moves."), "execution");
        BB.emit(film, "critic", "say", "film", null, L2(lang, "我是评审。我只负责挑毛病，而且挑到位——离开这间房的东西，必须配得上它想激起的渴望。", "Hi! I'm your Critic. I push back hard, so what leaves this room earns the desire it's after."), "execution");
        BB.emit(film, "overseer", "say", "film", null, L2(lang, "这就是你的团队。现在——告诉我从哪里开始。", "That's your team. Now — show me where to start."), "execution");
        BB.emit(film, "controller", "client_question", "film", { question: ASK }, "greet and ask for the source", "execution");
      } else {
        BB.emit(film, "overseer", "say", "film", null, L2(lang, "我是总监。老朋友了，团队你都认识——我们直接开始。", "Hi! I'm the Overseer. You already know your team, so let's get right to it."), "execution");
        BB.emit(film, "controller", "client_question", "film", { question: ASK }, "returning client; ask for the source", "execution");
      }
      film.status = "awaiting_client";
      BB.save(film);
      res.json({ film_id: film.film_id, status: "running" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/films/:id/resume", auth, async function (req, res) {
    try {
      if (running.has(req.params.id)) return res.json({ film_id: req.params.id, status: "already_running" });
      var film;
      try { film = BB.load(req.params.id); } catch (_) { film = await BB.loadRemote(req.params.id); }
      if (film.status === "shipped") return res.status(409).json({ error: "film already shipped" });
      if (film.status === "cancelled" || film.cancelRequestedAt) return res.status(409).json({ error: "film cancelled; start a new film instead" });
      // Resume is explicit client intent. Clear only a pause; cancellation is
      // terminal and is guarded above.
      if (film.pauseRequestedAt || film.status === "paused") {
        film.pauseRequestedAt = null;
        film.status = "deliberating";
        BB.emit(film, "client", "resume_film", "film", null, "Continue the room.", "judgment");
        BB.save(film);
      }
      var used = (film.events || []).filter(function (e) { return e.actor === "overseer" && e.action === "moves"; }).length;
      fire(film, { maxTurns: used + 6 });
      res.json({ film_id: film.film_id, status: "resuming" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/films/:id", auth, async function (req, res) {
    try {
      var film;
      try { film = BB.load(req.params.id); } catch (_) { film = await BB.loadRemote(req.params.id); }
      res.json(BB.filmView(film));
    } catch (e) { res.status(404).json({ error: e.message }); }
  });
}
module.exports = { registerFilms };
