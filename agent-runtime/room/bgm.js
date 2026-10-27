// room/bgm.js — 机械翻译器:filmPlan.music + script -> composition_plan -> generate-bgm 边缘函数 -> film.bgmUrl
// 零创意判断:悬置/落地是剪辑工艺法则,焊死在此;创意 brief 由 Director 写在 filmPlan.music。
const BB = require("./blackboard");
const fs = require("fs");
const SB_DIR = process.env.STORYBOARD_DIR || "/var/www/html/storyboards";
const FN_URL = process.env.BGM_FUNCTION_URL || "";
var _inflight = {};

function _state(film, status, patch) {
  film.bgm = Object.assign({}, film.bgm || {}, patch || {}, { status: status, updatedAt: new Date().toISOString() });
}

function _durMs(film) {
  var live = BB.liveBoards(film);
  var s = live.reduce(function (a, b) { return a + ((b.execution && b.execution.durationSec) || 15); }, 0) || 30;
  return Math.max(3000, Math.min(600000, Math.round(s * 1000)));
}

function _brief(film) {
  var fp = film.filmPlan || {};
  if (fp.music) return String(fp.music) + " Instrumental only, no vocals. It begins already in motion, stays suspended and leaning forward through the middle, and resolves ONLY at the very end into a quiet, settled close.";
  var bn = (film.brief && film.brief.brand_name && (film.brief.brand_name.content || film.brief.brand_name)) || "a premium brand";
  return "Cinematic instrumental score for a premium brand film for " + bn + ": intimate, warm, elegant — modern classical with subtle electronic textures, slow-building and evocative. It begins already in motion, stays suspended and leaning forward through the middle, and resolves ONLY at the very end into a quiet, settled close. Instrumental only, no vocals.";
}

function _plan(film) {
  var fp = film.filmPlan || {}; var script = fp.script || [];
  if (!fp.music || !script.length) return null;
  var live = BB.liveBoards(film);
  return {
    positive_global_styles: [String(fp.music), "cinematic", "instrumental"],
    negative_global_styles: ["vocals", "lyrics", "harsh", "lo-fi"],
    sections: script.map(function (seg, i) {
      var last = (i === script.length - 1);
      var d = ((live[i] && live[i].execution && live[i].execution.durationSec) || 15) * 1000;
      return {
        section_name: String(seg.title || ("part " + (i + 1))).slice(0, 60),
        positive_local_styles: [last ? "resolving, conclusive, settling into a quiet close" : "unresolved, suspended, leaning forward, no cadence"],
        negative_local_styles: [last ? "abrupt ending" : "fade-out, closing feeling"],
        duration_ms: d, lines: []
      };
    })
  };
}

async function ensureFilmBgm(film, opts) {
  opts = opts || {};
  var key = String(film.film_id || "film");
  if (film.bgmUrl) { _state(film, "ready", { url: film.bgmUrl, error: null }); return film.bgmUrl; }
  var det = SB_DIR + "/" + key + "_bgm.mp3";
  if (fs.existsSync(det)) { _state(film, "ready", { error: null }); return det; } // 文件已就位,stitch 自会发现
  if (_inflight[key]) return _inflight[key];
  if (film.bgm && film.bgm.status === "failed" && !opts.force) return null;
  var sec = process.env.VPS_SHARED_SECRET;
  if (!sec) {
    _state(film, "failed", { error: "bgm_service_not_configured" });
    BB.emit(film, "render", "bgm_failed", "film", { code: "service_not_configured" }, "Background score service is unavailable.", "mechanical");
    BB.save(film);
    return null;
  }
  _state(film, "generating", { error: null });
  BB.emit(film, "render", "bgm_progress", "film", { status: "generating", progressPct: 10 }, "Composing the score.", "mechanical");
  BB.save(film);
  _inflight[key] = (async function () {
    var ms = _durMs(film); var plan = _plan(film);
    async function call(body) {
      var r = await fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-vps-secret": sec }, body: JSON.stringify(body) });
      var t = await r.text();
      if (!r.ok) throw new Error("generate-bgm " + r.status + ": " + t.slice(0, 300));
      var j = JSON.parse(t);
      if (!j.url) throw new Error("generate-bgm 返回无 url: " + t.slice(0, 200));
      return j.url;
    }
    var url = null;
    if (plan) { try { url = await call({ film_id: key, music_length_ms: ms, composition_plan: plan }); } catch (e) { console.warn("[bgm] composition_plan 被拒,回退 prompt 模式:", e.message); } }
    if (!url) url = await call({ film_id: key, music_length_ms: ms, prompt: _brief(film) });
    film.bgmUrl = url;
    _state(film, "ready", { url: url, error: null });
    BB.emit(film, "render", "bgm_ready", "film", { url: url, ms: ms, mode: plan ? "plan" : "prompt" }, null, "mechanical");
    BB.save(film);
    console.log("[bgm] 母带就绪:", url);
    return url;
  })().catch(function (e) {
    var msg = String((e && e.message) || e).slice(0, 240);
    console.error("[bgm] 生成失败,交付将等待客户选择:", msg);
    _state(film, "failed", { error: "provider_failed" });
    BB.emit(film, "render", "bgm_failed", "film", { code: "provider_failed" }, "The score could not be generated.", "mechanical");
    BB.emit(film, "overseer", "say", "film", null,
      (film.inputs && film.inputs.lang === "zh")
        ? "配乐生成失败了。我不会悄悄交付一支没有配乐的片。你可以让我重试，或明确选择只保留现场音效。"
        : "The score failed to generate. I will not quietly deliver a film without music. Ask me to retry, or explicitly approve a sound-effects-only delivery.",
      "execution");
    BB.save(film);
    return null;
  }).finally(function () { delete _inflight[key]; });
  return _inflight[key];
}
module.exports = { ensureFilmBgm: ensureFilmBgm };
