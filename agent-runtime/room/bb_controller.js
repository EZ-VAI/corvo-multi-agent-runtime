// room/bb_controller.js - the MECHANICAL executor. ZERO judgment lives here.
// It does exactly three things: execute moves the Overseer already judged
// (warrant = that judgment event), record mechanical facts, and stall/escalate
// when authority is absent. Delete the Overseer's moves and this cannot act.
// Budgets (deterministic guardrails, ratified): rework 2/board, ask_client 3/film,
// 8 overseer turns/film. RENDER=1 enables real render spend (else plan-only fact).
const BB = require("./blackboard");
const { overseerTurn } = require("./bb_overseer");
const { directorOntoBoard, directorAdjudicate } = require("./bb_director");
const { cineOntoBoard, reworkBoard } = require("./bb_cine");
const { criticOntoBoard, criticRebut } = require("./bb_critic");
const { dbRead, dbWrite } = require("../understanding/proxy");
const { runUnderstandingPipeline } = require("../understanding/routes");
const _und = require("../understanding/routes");

var REWORK_LIMIT = 2, ASK_LIMIT = 3, MAX_TURNS = 14, REBUT_LIMIT = 1;
function CL(film, zh, en) { return (film.inputs && film.inputs.lang === "zh") ? zh : en; }
var ACTS = ["advance", "run_understanding", "run_director", "run_cine", "rework_board", "run_critic", "approve_board", "reject_board",
  "overrule_critique", "escalate_to_director", "critic_rebut", "fetch_references", "render_board", "ask_client", "propose_ship", "say", "hold"];
function uw(r) { var x = r; for (var i = 0; i < 3; i++) { if (x && typeof x === "object" && "data" in x) x = x.data; else break; } return x; }
function countDispatch(film, act, boardId) {
  return (film.events || []).filter(function (e) {
    return e.actor === "controller" && e.action === "dispatch" && e.payload && e.payload.act === act &&
      (boardId == null || String(e.payload.boardId) === String(boardId));
  }).length;
}
function turnsUsed(film) { return (film.events || []).filter(function (e) { return e.actor === "overseer" && e.action === "moves"; }).length; }
function reworkUsedMap(film) {
  var m = {};
  (film.events || []).forEach(function (e) {
    if (e.actor === "controller" && e.action === "dispatch" && e.payload && e.payload.act === "rework_board" && e.payload.boardId)
      m[e.payload.boardId] = (m[e.payload.boardId] || 0) + 1;
  });
  return m;
}
function mapCase(r) {
  return { brand: r.brand, campaign: r.campaign_name, vertical: r.vertical, product_type: r.product_type,
    primary_attribute: r.primary_attribute, sensory_quality: r.sensory_quality,
    metaphor_universe: r.metaphor_universe, specific_metaphor: r.specific_metaphor,
    filmable_scene: r.filmable_scene, bridge_technique: r.bridge_technique,
    association_distance: r.association_distance, emotional_arc: r.emotional_arc,
    hook_technique: r.hook_technique, product_reveal: r.product_reveal_technique,
    ai_adapted_scene: r.ai_adapted_scene, executability: r.ai_executability_score,
    effectiveness: r.effectiveness_notes };
}
async function execFetchReferences(film, query, warrant) {
  var bb = (film.brief || {}).brandBrain || {};
  var rows = null, err = null;
  var q = { limit: 5, order: { column: "ai_executability_score", ascending: false } };
  if (bb.vertical) q.filters = { vertical: bb.vertical };
  try { rows = uw(await dbRead("creative_cases", q)); }
  catch (e1) { try { rows = uw(await dbRead("creative_cases", { limit: 5 })); } catch (e2) { err = e2; } }
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (err || !rows || !rows.length) {
    BB.emit(film, "controller", "fetch_references_failed", "film", { query: query, error: err ? String(err.message).slice(0, 150) : "no rows" }, null, "mechanical", warrant);
    return 0;
  }
  film.brief.referenceCases = ((film.brief.referenceCases || []).concat(rows.map(mapCase))).slice(0, 5);
  BB.emit(film, "controller", "references_fetched", "film", { query: query, count: rows.length }, null, "execution", warrant);
  return rows.length;
}

async function drainInbox(film) {
  if (!process.env.BB_REMOTE) return 0;
  var rows = null;
  try { rows = uw(await dbRead("film_client_inbox", { filters: { film_id: film.film_id, consumed: false } })); }
  catch (e) { console.warn("[inbox]", e.message); return 0; }
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!rows || !rows.length) return 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    try {
      if (r.op === "reject_board" && r.board_id) BB.rejectBoard(film, r.board_id, r.note || "client rejection", "client");
      else if (r.op === "approve_ship") BB.clientApprove(film, r.note || "approved by client");
      else if (r.op === "retry_bgm") {
        film.allowScorelessDelivery = false;
        film.bgm = Object.assign({}, film.bgm || {}, { status: "idle", error: null });
        BB.emit(film, "client", "retry_bgm", "film", null, r.note || "Retry the score.", "judgment");
      }
      else if (r.op === "accept_scoreless") {
        film.allowScorelessDelivery = true;
        BB.emit(film, "client", "accept_scoreless", "film", null, r.note || "Deliver with sound effects only.", "judgment");
      }
      else if (r.op === "direct_agent") {
        BB.clientDirection(film, { agent: r.target_agent, boardId: r.board_id, panel: r.target_panel, note: r.note || "" });
      }
      else if (r.op === "retry_clip_qc" && r.board_id) {
        await require("./bb_render").recheckClipOnBlackboard(film, r.board_id, { note: r.note || "Recheck the existing generated clip." });
      }
      else if (r.op === "pause_film") {
        film.pauseRequestedAt = film.pauseRequestedAt || new Date().toISOString();
        film.status = "paused";
        BB.emit(film, "client", "pause_film", "film", null, r.note || "Pause before the next paid step.", "judgment");
      }
      else if (r.op === "cancel_film") {
        film.cancelRequestedAt = film.cancelRequestedAt || new Date().toISOString();
        film.status = "cancelled";
        BB.emit(film, "client", "cancel_film", "film", null, r.note || "Cancel this film.", "judgment");
      }
      else BB.clientFeedback(film, r.note || "", { boardId: r.board_id, panel: r.target_panel });
      if (film.status === "awaiting_client" && r.op !== "pause_film" && r.op !== "cancel_film") film.status = "deliberating";
    } catch (e) {
      BB.emit(film, "controller", "client_op_failed", "film", { op: r.op, error: String(e.message).slice(0, 150) }, null, "mechanical");
    }
    try { await dbWrite("film_client_inbox", "update", { filters: { id: r.id }, row: { consumed: true } }); }
    catch (e2) { console.warn("[inbox] consume:", e2.message); }
  }
  BB.save(film);
  return rows.length;
}

// ── 第②刀 Film Room 计费:首次渲染前 reserve 上限,每板渲成记 committed,终态按真实板数 finalize ──
var FR_FN_BASE = process.env.STUDIO_BILLING_FN || "";
var FR_PER_BOARD = Number(process.env.FR_CREDITS_PER_BOARD) || 25;
async function frReserveOnce(film) {
  if (film._billingJobId) return film._billingJobId;
  var userId = film.user_id;
  if (!userId) { console.warn("[fr-billing] 无 user_id,跳过计费(需 film-control 注入)"); return null; }
  var live = BB.liveBoards(film);
  var boards = Math.max(1, live.length || (film.filmPlan && film.filmPlan.storyboardCount) || 2);
  var amount = boards * FR_PER_BOARD;
  try {
    var r = await fetch(FR_FN_BASE + "/reserve-studio-job", { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ user_id: userId, engine: "brand_film", amount: amount, draft_id: String(film.film_id) }) });
    var j = await r.json();
    if (!j || !j.ok) { var e = new Error("算力不足"); e._insufficient = (j && j.reason === "insufficient_credits"); e._balance = j && j.balance; e._required = amount; throw e; }
    film._billingJobId = j.job_id; BB.save(film);
    console.log("[fr-billing] reserve", amount, "credits (", boards, "boards)");
    return j.job_id;
  } catch (e) {
    if (e._insufficient) throw e;
    e._billingUnavailable = true;
    console.error("[fr-billing] reserve 失败:", e.message);
    throw e;
  }
}
async function frRecordBoard(film, boardId) {
  if (!film._billingJobId) return;
  film._billedBoards = film._billedBoards || {};
  if (film._billedBoards[String(boardId)]) return;
  try {
    var r = await fetch(FR_FN_BASE + "/record-studio-task", { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ billing_job_id: film._billingJobId, draft_id: String(film.film_id), task_key: String(boardId), amount: FR_PER_BOARD }) });
    if (!r.ok) throw new Error("record-studio-task " + r.status + ": " + (await r.text()).slice(0, 180));
    film._billedBoards[String(boardId)] = true; BB.save(film);
  } catch (e) { console.error("[fr-billing] record 失败:", e.message); }
}
async function frFinalize(film, ok) {
  if (!film._billingJobId || film._billingFinalized) return;
  try {
    var r = await fetch(FR_FN_BASE + "/finalize-brandfilm-job", { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ billing_job_id: film._billingJobId, outcome: ok ? "ready" : "failed" }) });
    if (!r.ok) throw new Error("finalize-brandfilm-job " + r.status + ": " + (await r.text()).slice(0, 180));
    film._billingFinalized = true; film._billingOutcome = ok ? "ready" : "failed"; BB.save(film);
    console.log("[fr-billing] finalize", ok ? "ready" : "failed");
  } catch (e) { console.error("[fr-billing] finalize 失败(cron 兜底):", e.message); }
}

async function shipIfReady(film) {
  if (!film.clientApproval || film.ship) return null;
  var live = BB.liveBoards(film);
  var unrendered = live.filter(function (b) { return !(b.render && b.render.status === "rendered"); });
  if (unrendered.length) return null;
  var bgm = null;
  if (!film.allowScorelessDelivery) bgm = await require("./bgm").ensureFilmBgm(film, { force: !!(film.bgm && film.bgm.status === "idle") });
  if (!bgm && !film.allowScorelessDelivery) {
    film.status = "awaiting_client";
    var alreadyAsked = (film.events || []).some(function (e) { return e.action === "bgm_delivery_blocked" && e.ts > ((film.bgm && film.bgm.updatedAt) || ""); });
    if (!alreadyAsked) {
      BB.emit(film, "controller", "bgm_delivery_blocked", "film", { choices: ["retry_bgm", "accept_scoreless"] }, "Score is required unless the client explicitly accepts sound-effects-only delivery.", "mechanical");
      BB.emit(film, "controller", "client_question", "film", { question: CL(film,
        "配乐还没有生成成功。要我重试，还是明确按“仅现场音效”交付？",
        "The score is not ready. Should I retry, or deliver explicitly with sound effects only?") }, "delivery choice required", "execution");
    }
    BB.save(film);
    return { status: "awaiting_client", blocker: "bgm", film: film };
  }
  // Assembly must succeed before the film can be marked shipped or billed ready.
  try {
    var R = require("./bb_render");
    if (!film.finalFilmUrl) await R.stitchFilm(film);
  } catch (e) {
    film.status = "assembly_failed";
    BB.emit(film, "controller", "stitch_failed", "film", { error: String(e.message).slice(0, 150) }, "Final assembly failed; delivery is blocked.", "mechanical");
    BB.emit(film, "overseer", "say", "film", null, CL(film,
      "最后合片出了问题，我还没有把它标成交付。我会保留已经完成的镜头，修复后继续。",
      "Final assembly hit a problem, so I have not marked the film delivered. The finished shots are safe and we can resume after the fix."), "execution");
    BB.save(film);
    return { status: "assembly_failed", film: film };
  }
  BB.ship(film, "client approved; final assembly verified", "overseer");
  await frFinalize(film, true);
  BB.save(film);
  return { status: "shipped", filmUrl: film.finalFilmUrl || null, film: film };
}
async function runFilm(film, opts) {
  opts = opts || {};
  // 动态回合预算:板越多需要越多轮(每板 render+approve 各占回合)。
  // 单板 30s ≈ 14 不变;四板 60s ≈ 26。opts.maxTurns 显式传入时优先。
  var _liveN = (typeof BB.liveBoards === "function") ? (BB.liveBoards(film) || []).length : 0;
  var _dynTurns = 10 + Math.max(1, _liveN || (film.filmPlan && film.filmPlan.storyboardCount) || 2) * 4;
  var maxTurns = opts.maxTurns || Math.max(MAX_TURNS, _dynTurns);
  var log = function () { console.log.apply(console, arguments); };
  while (turnsUsed(film) < maxTurns) {
    var drained = await drainInbox(film);
    if (drained) console.log("   [inbox] drained " + drained + " client message(s)");
    if (film.cancelRequestedAt || film.status === "cancelled") {
      film.status = "cancelled";
      BB.emit(film, "controller", "film_cancelled", "film", { billingOutcome: "failed" }, "no further paid tasks will start", "mechanical");
      await frFinalize(film, false); BB.save(film);
      return { status: "cancelled", film: film };
    }
    if (film.pauseRequestedAt || film.status === "paused") {
      film.status = "paused"; BB.save(film);
      return { status: "paused", film: film };
    }
    var shipped = await shipIfReady(film);
    if (shipped) return shipped;
    var turn = turnsUsed(film) + 1;
    var ru = reworkUsedMap(film);
    var asksUsed = countDispatch(film, "ask_client", null);
    log("\n== overseer turn " + turn + " ==");
    var t = await overseerTurn(film, { turn: turn, budgets: {
      reworkLimit: REWORK_LIMIT, reworkUsed: ru,
      clientQuestionsLeft: Math.max(0, ASK_LIMIT - asksUsed), turnsLeft: maxTurns - turn } });
    BB.save(film);
    log("   macro:", String(t.macroRead || "").slice(0, 160));
    if (!t.moves.length) {
      BB.emit(film, "controller", "no_moves", "film", null, "overseer issued no moves", "mechanical", t.judgmentEventId);
      film.status = "stalled";
      BB.emit(film, "overseer", "say", "film", null, CL(film, "我这轮没能定出下一步。跟我说一句你的想法，我马上继续。", "I could not settle a next move this round. Say a word about what you want and I will pick it right up."), "execution", t.judgmentEventId);
      BB.save(film); return { status: "stalled", film: film };
    }
    if (t.nextStage && typeof t.nextStage === "string") {
      film.stage = t.nextStage;
      if (t.nextStage === "creative" && film.brief) film.brief.briefConfirmed = true;
      BB.emit(film, "overseer", "stage_advance", "film", { to: t.nextStage }, null, "judgment", t.judgmentEventId);
      BB.save(film);
    }
    var directorRan = false;
    for (var i = 0; i < t.moves.length; i++) {
      var m = t.moves[i] || {};
      log("   -> " + (m.act || "?") + (m.boardId ? " " + m.boardId : ""));
      if (m.act === "advance") {
        var to = (m.to && typeof m.to === "string") ? m.to : "creative";
        // The Overseer may carry the client's chosen format into creative. Fold it into
        // film.inputs so the Director plans for the right length/orientation/use.
        if (m.format && typeof m.format === "object") {
          film.inputs = film.inputs || {};
          if (typeof m.format.runtimeSec === "number" && m.format.runtimeSec > 0) film.inputs.runtimeSec = m.format.runtimeSec;
          if (typeof m.format.aspectRatio === "string" && m.format.aspectRatio) film.inputs.aspectRatio = m.format.aspectRatio;
          if (typeof m.format.vertical === "boolean") film.inputs.vertical = m.format.vertical;
          if (typeof m.format.intent === "string" && m.format.intent) film.inputs.intent = m.format.intent;
          BB.emit(film, "overseer", "format_set", "film", { format: m.format }, m.why || null, "judgment", t.judgmentEventId);
        }
        film.stage = to;
        if (to === "creative" && film.brief) film.brief.briefConfirmed = true;
        BB.emit(film, "overseer", "stage_advance", "film", { to: to }, m.why || null, "judgment", t.judgmentEventId);
        BB.save(film);
        continue;
      }
      if (ACTS.indexOf(m.act) === -1) {
        BB.emit(film, "controller", "invalid_move", "film", { move: m }, "unknown act; batch stopped, escalating to overseer", "mechanical", t.judgmentEventId);
        BB.save(film); break;
      }
      try {
        if (m.act === "run_understanding") {
          BB.emit(film, "controller", "dispatch", "film", { act: m.act }, m.why, "execution", t.judgmentEventId);
          var pUrl = null, pImg = null;
          var cev = (film.events || []).filter(function (e) { return e.actor === "client"; });
          for (var ci = cev.length - 1; ci >= 0; ci--) {
            var nt = (cev[ci].why || "") + " " + ((cev[ci].payload && cev[ci].payload.note) || "");
            var mm = nt.match(/https?:\/\/[^\s]+/);
            if (mm) {
              var u = mm[0];
              if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u) || /\/storage\/v1\/object\//i.test(u)) { if (!pImg) pImg = u; }
              else if (!pUrl) { pUrl = u; }
            }
            if (pUrl && pImg) break;
          }
          if (pUrl) {
            var productKeyFromUrl = require("../productKey").productKeyFromUrl;
            film.productKey = productKeyFromUrl(pUrl);
            try { BB.save(film); } catch (e) {}
          }
          var deps = { persist: _und.persist, writeBrain: _und.writeBrain };
          var restudy = !!(film.brief && film.brief.understandingDone);
          var feedback = null;
          if (restudy) {
            var evs = film.events || [];
            var lastUnderstood = -1;
            for (var ui = evs.length - 1; ui >= 0; ui--) { if (evs[ui].action === "understanding_done" || evs[ui].action === "brief_proposed") { lastUnderstood = ui; break; } }
            var notes = [];
            for (var uj = lastUnderstood + 1; uj < evs.length; uj++) {
              if (evs[uj].actor === "client") notes.push(evs[uj].why || (evs[uj].payload && evs[uj].payload.note) || "");
            }
            feedback = notes.filter(Boolean).join(" | ") || null;
          }
          var ur = await runUnderstandingPipeline(film.user_id, {
            productUrl: pUrl, productImageUrl: pImg, aspectRatio: "16:9", durationSec: (film.inputs && film.inputs.runtimeSec) || (film.brief && film.brief.runtimeSec) || 60,
            feedback: feedback,
          }, deps, function (step, payload) {
            try { BB.emit(film, "strategist", step, "film", payload || null, null, "execution", t.judgmentEventId); BB.save(film); } catch (e) {}
          });
          if (ur && ur.brief) {
            var prevBrief = film.brief || {};
            BB.setBrief(film, Object.assign({}, prevBrief, { strategy: ur.brief, understandingDone: true, productImageUrl: pImg || prevBrief.productImageUrl || null }), "strategist", t.judgmentEventId);
          }
          BB.emit(film, "strategist", "brief_proposed", "film", { brief: ur && ur.brief || null }, "brand understood; brief drafted for your review", "judgment", t.judgmentEventId);
          BB.save(film);
        } else if (m.act === "run_director") {
          var round = film.filmPlan ? 2 : 1;
          film.conceptLocked = false; // a (re-)derived script is not yet client-approved; it re-locks only at run_cine
          BB.emit(film, "controller", "dispatch", "film", { act: m.act, steer: m.steer || null }, m.why, "execution", t.judgmentEventId);
          await directorOntoBoard(film, { round: round, steer: m.steer || null, instruction: m.instruction || null, warrant: t.judgmentEventId });
          directorRan = true;
          // The Director has written the SCRIPT. We do NOT auto-run the Cinematographer:
          // the script (story + whyThisScript) goes to the CLIENT for approval first. The
          // Overseer shows it and waits; only after the client is happy does it run_cine.
          BB.emit(film, "director", "script_ready", "film", { storyboardCount: (film.filmPlan && film.filmPlan.storyboardCount) || null }, "the script is on the board for your read", "judgment", t.judgmentEventId);
        } else if (m.act === "run_cine") {
          film.conceptLocked = true; // client approved the script; concept is locked -- changes need re-approval
          BB.emit(film, "controller", "dispatch", "film", { act: m.act }, m.why, "execution", t.judgmentEventId);
          BB.emit(film, "cinematographer", "say", "film", null, CL(film, "开始把剧本画成分镜——每段 8 联画格，需要几分钟。", "Turning the script into storyboards now -- 8 panels per segment, this takes a few minutes."), "execution", t.judgmentEventId);
          BB.save(film);
          await cineOntoBoard(film, { warrant: t.judgmentEventId });
          BB.emit(film, "cinematographer", "say", "film", null, CL(film, "分镜画完了，都在板上。", "Storyboards are done and on the board."), "execution", t.judgmentEventId);
        } else if (m.act === "rework_board") {
          if (directorRan) {
            BB.emit(film, "controller", "superseded_target", m.boardId || "film", { move: m }, "board superseded by run_director in this batch; skipped", "mechanical", t.judgmentEventId);
          } else if ((ru[m.boardId] || 0) >= REWORK_LIMIT) {
            BB.emit(film, "controller", "rework_budget_exceeded", m.boardId, { used: ru[m.boardId] }, "rework budget exhausted; board escalates", "mechanical", t.judgmentEventId);
          } else {
            BB.emit(film, "controller", "dispatch", m.boardId, { act: m.act, boardId: m.boardId }, m.why, "execution", t.judgmentEventId);
            ru[m.boardId] = (ru[m.boardId] || 0) + 1;
            await reworkBoard(film, m.boardId, { instruction: m.instruction || null, warrant: t.judgmentEventId });
          }
        } else if (m.act === "run_critic") {
          BB.emit(film, "controller", "dispatch", "film", { act: m.act, phase: m.phase || null }, m.why, "execution", t.judgmentEventId);
          await criticOntoBoard(film, { warrant: t.judgmentEventId, phase: m.phase || null });
        } else if (m.act === "critic_rebut") {
          var rebutsUsed = (film.events || []).filter(function (e) {
            return e.actor === "controller" && e.action === "dispatch" && e.payload && e.payload.act === "critic_rebut" && String(e.payload.critiqueId) === String(m.critiqueId);
          }).length;
          if (rebutsUsed >= REBUT_LIMIT) {
            BB.emit(film, "controller", "rebut_budget_exceeded", m.boardId, { critiqueId: m.critiqueId }, "critic rebuttal used (1); you must now overrule or uphold", "mechanical", t.judgmentEventId);
          } else {
            BB.emit(film, "controller", "dispatch", m.boardId, { act: m.act, boardId: m.boardId, critiqueId: m.critiqueId }, m.why, "execution", t.judgmentEventId);
            await criticRebut(film, { boardId: m.boardId, critiqueId: m.critiqueId, warrant: t.judgmentEventId });
          }
        } else if (m.act === "approve_board") {
          BB.approveBoard(film, m.boardId, m.why, "overseer", t.judgmentEventId);
        } else if (m.act === "reject_board") {
          BB.rejectBoard(film, m.boardId, m.why, "overseer", t.judgmentEventId);
        } else if (m.act === "overrule_critique") {
          BB.overruleCritique(film, m.boardId, m.critiqueId, m.why, "overseer", t.judgmentEventId);
        } else if (m.act === "escalate_to_director") {
          if (directorRan) {
            BB.emit(film, "controller", "superseded_target", m.boardId || "film", { move: m }, "board re-derived by run_director this batch; escalate skipped", "mechanical", t.judgmentEventId);
          } else {
            BB.emit(film, "controller", "dispatch", m.boardId, { act: m.act, boardId: m.boardId, critiqueId: m.critiqueId }, m.why, "execution", t.judgmentEventId);
            var adj = await directorAdjudicate(film, { boardId: m.boardId, critiqueId: m.critiqueId, warrant: t.judgmentEventId });
            if (adj.verdict === "own") {
              if (film.conceptLocked) {
                BB.emit(film, "controller", "concept_change_pending", m.boardId, { critiqueId: m.critiqueId }, "the Director's ruling revises the client-APPROVED concept; it must be re-approved before redraw", "mechanical", t.judgmentEventId);
              } else {
                await reworkBoard(film, m.boardId, { warrant: t.judgmentEventId });
              }
            } else if (adj.verdict === "bounce" && adj.bounceInstruction) {
              await reworkBoard(film, m.boardId, { instruction: adj.bounceInstruction, warrant: t.judgmentEventId });
            }
          }
        } else if (m.act === "fetch_references") {
          BB.emit(film, "controller", "dispatch", "film", { act: m.act, query: m.query || null }, m.why, "execution", t.judgmentEventId);
          var n = await execFetchReferences(film, m.query || null, t.judgmentEventId);
          log("      references:", n);
        } else if (m.act === "render_board") {
          if (!process.env.RENDER) {
            BB.emit(film, "controller", "render_skipped", m.boardId, { reason: "PLAN_ONLY (set RENDER=1 to spend)" }, m.why, "mechanical", t.judgmentEventId);
          } else {
            BB.emit(film, "controller", "dispatch", m.boardId, { act: m.act, boardId: m.boardId }, m.why, "execution", t.judgmentEventId);
            BB.emit(film, "cinematographer", "say", "film", null, CL(film, "开始渲染这块分镜成片——这是最耗时的一步。", "Rendering this board into footage -- the longest step."), "execution", t.judgmentEventId);
            BB.save(film);
            var R = require("./bb_render");
            try { await frReserveOnce(film); }
            catch (e) {
              var _billAct = e._insufficient ? "billing_insufficient" : "billing_unavailable";
              BB.emit(film, "controller", _billAct, "film", { required: e._required, balance: e._balance, error: String(e.message).slice(0, 160) },
                e._insufficient ? "credits insufficient for render" : "billing reservation unavailable; render spend blocked", "mechanical", t.judgmentEventId);
              BB.emit(film, "overseer", "say", "film", null, e._insufficient
                ? CL(film, "算力不足，无法开始渲染。请充值后让我继续。", "Not enough credits to start rendering. Top up and I will continue.")
                : CL(film, "计费确认暂时不可用，所以我没有启动视频费用。稍后重试即可。", "Billing confirmation is temporarily unavailable, so I did not start video spend. Retry shortly."),
                "execution", t.judgmentEventId);
              film.status = "awaiting_client"; BB.save(film);
              return { status: "awaiting_client", blocker: e._insufficient ? "credits" : "billing", film: film };
            }
            var renderResult = await R.renderBoardOnBlackboard(film, m.boardId, { warrant: t.judgmentEventId });
            // A QC-blocked grid never reached Seedance, so it must not be
            // recorded as billable board work. Return control to the Overseer
            // so it can order a rework from the factual violation list.
            if (renderResult && (renderResult.status === "rendered" || (renderResult.status === "clip_qc_blocked" && renderResult.seedanceSpent))) {
              await frRecordBoard(film, m.boardId);
            }
            if (film.cancelRequestedAt) {
              film.status = "cancelled";
              await frFinalize(film, false); BB.save(film);
              return { status: "cancelled", film: film };
            }
            if (film.pauseRequestedAt) {
              film.status = "paused"; BB.save(film);
              return { status: "paused", film: film };
            }
            if (renderResult && renderResult.status === "rendered") {
              // Start the score only after the film has cleared objective QC
              // and produced at least one real clip. A blocked grid should not
              // spend on music either.
              require("./bgm").ensureFilmBgm(film);
            } else if (renderResult && renderResult.status === "clip_qc_blocked") {
              BB.emit(film, "controller", "delivery_qc_blocked", m.boardId,
                { blocker: "post_render_clip_qc", qc: renderResult.qc || null, seedanceSpent: renderResult.seedanceSpent === true },
                "the generated clip is preserved; no automatic rerender will start", "mechanical", t.judgmentEventId);
              film.status = "awaiting_client"; BB.save(film);
              break;
            } else if (renderResult && renderResult.status === "qc_blocked") {
              BB.emit(film, "controller", "paid_render_blocked", m.boardId,
                { blocker: "objective_qc", qc: renderResult.qc || null },
                "Seedance and board billing were not called; the room must rework the blocked grid", "mechanical", t.judgmentEventId);
              BB.save(film);
              break;
            }
          }
        } else if (m.act === "ask_client") {
          if (asksUsed >= ASK_LIMIT) {
            BB.emit(film, "controller", "ask_budget_exceeded", "film", { question: m.question }, "client question budget (3) exhausted", "mechanical", t.judgmentEventId);
          } else {
            BB.emit(film, "controller", "dispatch", "film", { act: m.act }, m.why, "execution", t.judgmentEventId);
            BB.emit(film, "controller", "client_question", "film", { question: m.question }, m.why, "execution", t.judgmentEventId);
            film.status = "awaiting_client";
            BB.save(film);
            return { status: "awaiting_client", question: m.question, film: film };
          }
        } else if (m.act === "propose_ship") {
          // GUARD: in render mode a board that was never rendered (render is null) cannot ship.
          // Block propose_ship and tell the Overseer to render first, so the film can't deadlock unshippable.
          var liveShip = BB.liveBoards(film);
          var neverRendered = liveShip.filter(function (bd) { return !(bd.render && bd.render.status === "rendered" && bd.render.clipUrl); });
          if (process.env.RENDER && neverRendered.length) {
            BB.emit(film, "controller", "ship_blocked_unrendered", "film", { boards: neverRendered.map(function (bd) { return bd.id; }) }, "cannot propose_ship: these approved boards were never rendered -- render_board them first", "mechanical", t.judgmentEventId);
          } else {
            BB.proposeShip(film, m.note || m.why || null, "overseer", t.judgmentEventId);
            BB.save(film);
            return { status: "awaiting_client_approval", film: film };
          }
        } else if (m.act === "say") {
          BB.emit(film, "overseer", "say", "film", null, String(m.text || m.note || "").slice(0, 400), "execution", t.judgmentEventId);
          BB.save(film);
        } else if (m.act === "hold") {
          BB.emit(film, "controller", "held", "film", null, m.note || m.why || null, "execution", t.judgmentEventId);
          film.status = "held";
          BB.emit(film, "overseer", "say", "film", null, (m.note || m.why) ? String(m.note || m.why).slice(0, 300) : CL(film, "我需要停一下等你。回我一句就继续。", "I need to pause for you here. Reply and we continue."), "execution", t.judgmentEventId);
          BB.save(film);
          return { status: "held", note: m.note || m.why || null, film: film };
        }
      } catch (e) {
        var _sig = (m.act || "?") + "|" + String(e.message).slice(0, 80);
        film._failSigs = film._failSigs || {};
        film._failSigs[_sig] = (film._failSigs[_sig] || 0) + 1;
        BB.emit(film, "controller", "move_failed", m.boardId || "film", { act: m.act, error: String(e.message).slice(0, 200) }, "batch stopped; overseer will see this", "mechanical", t.judgmentEventId);
        if (e && e.code === "product_analysis_unavailable") {
          film.status = "awaiting_client";
          BB.emit(film, "overseer", "say", "film", null, CL(film,
            "我现在读不到这个产品页，所以没有继续猜。你可以稍后让我重试，或者直接上传一张产品图，我会从真实图片继续。",
            "I cannot read that product page right now, so I stopped instead of guessing. Ask me to retry later, or upload a product image and I can continue from the real visual reference."),
            "execution", t.judgmentEventId);
          BB.emit(film, "controller", "client_question", "film", { question: CL(film,
            "要重试产品页，还是上传产品图？",
            "Retry the product page, or upload a product image?") }, "product grounding is required", "execution", t.judgmentEventId);
          BB.save(film);
          return { status: "awaiting_client", blocker: "product_analysis", film: film };
        }
        if (film._failSigs[_sig] >= 2) {
          BB.emit(film, "controller", "move_disabled", "film", { act: m.act, error: String(e.message).slice(0, 120) }, "this exact move failed twice with the same error -- do NOT retry it; choose a different path, or say/ask_client to involve the client", "mechanical", t.judgmentEventId);
          BB.emit(film, "overseer", "say", "film", null, CL(film, "我这边有个步骤连续出错，我换个方式处理，不会卡住你。", "One of my steps keeps failing; I am taking a different route so we do not stall."), "execution", t.judgmentEventId);
        }
        log("      MOVE FAILED:", e.message);
        BB.save(film); break;
      }
      BB.save(film);
    }
  }
  BB.emit(film, "controller", "max_turns", "film", { max: maxTurns }, "turn budget exhausted", "mechanical");
  film.status = "out_of_turns";
  BB.emit(film, "overseer", "say", "film", null, CL(film, "这轮的回合额度用完了。回我任何一句话，我就带着团队接着做。", "I have used this round's turn budget. Reply with anything and the team picks right back up."), "execution");
  BB.save(film);
  return { status: "max_turns", film: film };
}
module.exports = { runFilm };
