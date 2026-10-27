// room/blackboard.js - the shared, versioned film artifact (FINAL P2 form).
// Typed events (judgment|mechanical|execution) with ids + warrants: every authority
// act must trace to a judgment event (the warrant invariant; bb_lint walks it).
// client is a FIRST-CLASS actor: ship REQUIRES overseer propose + client approval.
//   board.state     DERIVED (controller/frontend only; agents read fields).
//   critique.status open -> resolved (critic) | overruled (overseer).
//   render          FACTS only.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
// Remote mirror: blackboards live locally on the VPS, but the FRONTEND reads them
// from Supabase `films`. When BB_REMOTE is set, every save also upserts the whole
// film into Supabase so the room the user opens reflects what the agents are doing.
// All DB access goes through the proxy (no service_role key on the VPS).
var _proxy = null;
function _getProxy() { if (!_proxy) { try { _proxy = require("../understanding/proxy"); } catch (e) { _proxy = { dbWrite: null, dbRead: null }; } } return _proxy; }
// /tmp used to erase the room on every host reboot. Keep the local source of
// truth on persistent disk; the Supabase mirror remains the frontend/read
// replica and remote recovery path.
const BB_DIR = process.env.BB_DIR || "/var/lib/corvo/blackboards";
const now = function () { return new Date().toISOString(); };
const uid = function (p) { return (p || "id") + "-" + crypto.randomUUID(); };

function newFilm(o) {
  o = o || {};
  return { film_id: o.filmId || uid("film"), user_id: o.userId || null, schema_version: 2,
    status: "deliberating", stage: o.stage || "understanding", brief: o.brief || null, filmPlan: null,
    boards: [], directives: [], events: [], review: null,
    shipProposal: null, clientApproval: null, ship: null,
    created_at: now(), updated_at: now() };
}
function emit(bb, actor, action, target, payload, why, kind, warrant) {
  var ev = { id: uid("ev"), ts: now(), actor: actor, action: action, target: target || null,
    payload: payload || null, why: why || null, kind: kind || "execution", warrant: warrant || null };
  bb.events.push(ev); bb.updated_at = now(); return ev;
}
function setBrief(bb, brief, actor, warrant) { bb.brief = brief; return emit(bb, actor || "strategist", "set_brief", "film", null, null, "judgment", warrant); }
function setFilmPlan(bb, fp, actor, warrant) { bb.filmPlan = fp; return emit(bb, actor || "director", "set_filmplan", "film", null, null, "judgment", warrant); }
function addBoard(bb, o, actor, warrant) {
  o = o || {};
  var board = { id: String(o.id != null ? o.id : uid("board")), role: o.role || null, gen: o.gen || 1,
    concept: null, execution: null, critique: [], render: null, decisions: [] };
  bb.boards.push(board); emit(bb, actor || "director", "add_board", board.id, { role: board.role, gen: board.gen }, null, "execution", warrant); return board;
}
function getBoard(bb, id) { return bb.boards.filter(function (b) { return String(b.id) === String(id); })[0] || null; }
function lastDecision(b) { return (b.decisions && b.decisions.length) ? b.decisions[b.decisions.length - 1] : null; }
function liveBoards(bb) { return bb.boards.filter(function (b) { var d = lastDecision(b); return !(d && d.kind === "reject"); }); }
function setBoardConcept(bb, id, concept, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  b.concept = concept; return emit(bb, actor || "director", "set_concept", b.id, null, null, "judgment", warrant);
}
function setBoardExecution(bb, id, ex, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  if (ex && ex.durationSec == null) ex.durationSec = 15;
  b.execution = ex; return emit(bb, actor || "cinematographer", "set_execution", b.id, null, null, "judgment", warrant);
}
function addCritique(bb, id, o, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  o = o || {};
  var c = { id: uid("crit"), by: actor || "critic", severity: o.severity || "minor", note: o.note || "", target: o.target || "board", status: "open", why: null };
  b.critique.push(c); emit(bb, c.by, "raise_critique", b.id, { critiqueId: c.id, severity: c.severity, target: c.target }, c.note, "judgment", warrant); return c;
}
function findCritique(b, cid) { return b.critique.filter(function (x) { return x.id === cid; })[0] || null; }
function resolveCritique(bb, id, cid, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  var c = findCritique(b, cid); if (!c) throw new Error("no critique " + cid);
  if (actor && actor !== "critic") throw new Error("only critic may resolve a critique (got " + actor + ")");
  c.status = "resolved"; return emit(bb, "critic", "resolve_critique", b.id, { critiqueId: cid }, null, "judgment", warrant);
}
function overruleCritique(bb, id, cid, why, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  var c = findCritique(b, cid); if (!c) throw new Error("no critique " + cid);
  if (actor && actor !== "overseer") throw new Error("only overseer may overrule a critique (got " + actor + ")");
  c.status = "overruled"; c.why = why || null; return emit(bb, "overseer", "overrule_critique", b.id, { critiqueId: cid }, why, "judgment", warrant);
}
function recordRenderFact(bb, id, fact, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  var ok = ["pending", "rendered", "render_failed", "pipl_rejected", "qc_blocked", "clip_qc_blocked"];
  if (fact && fact.status && ok.indexOf(fact.status) === -1)
    throw new Error("render.status must be a FACT: " + ok.join("|") + " (got " + fact.status + ") -- clip quality judgments go through addCritique(target:clip)");
  b.render = Object.assign({}, b.render, fact); return emit(bb, "render", "render_fact", b.id, { status: b.render.status, attempts: b.render.attempts }, null, "mechanical", warrant);
}
function recordReview(bb, review, actor, warrant) {
  if (actor && actor !== "critic") throw new Error("only critic may record a review (got " + actor + ")");
  review = review || {};
  bb.review = { by: "critic", verdict: review.verdict || null, convincedScore: (typeof review.convincedScore === "number") ? review.convincedScore : null,
    directionObjections: review.directionObjections || [], antiIdentityViolations: review.antiIdentityViolations || [], at: now() };
  return emit(bb, "critic", "review", "film", { verdict: bb.review.verdict, score: bb.review.convincedScore }, null, "judgment", warrant);
}
function addDirective(bb, o, actor, warrant) {
  o = o || {};
  var d = { id: uid("dir"), by: actor || "overseer", span: o.span || "", triggers: o.triggers || [], status: "active", at: now() };
  bb.directives.push(d); emit(bb, d.by, "directive", "film", { directiveId: d.id, span: d.span, triggers: d.triggers }, null, "judgment", warrant); return d;
}
function approveBoard(bb, id, why, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  var who = actor || "overseer";
  if (["overseer", "client"].indexOf(who) === -1) throw new Error("only overseer or client may approve a board (got " + who + ")");
  b.decisions.push({ kind: "approve", by: who, at: now(), why: why || null });
  return emit(bb, who, "approve_board", b.id, null, why, "judgment", warrant);
}
function rejectBoard(bb, id, why, actor, warrant) {
  var b = getBoard(bb, id); if (!b) throw new Error("no board " + id);
  var who = actor || "overseer";
  if (["overseer", "client"].indexOf(who) === -1) throw new Error("only overseer or client may reject a board (got " + who + ")");
  b.decisions.push({ kind: "reject", by: who, at: now(), why: why || null });
  return emit(bb, who, "reject_board", b.id, null, why, "judgment", warrant);
}
function proposeShip(bb, why, actor, warrant) {
  if (actor && actor !== "overseer") throw new Error("only overseer may propose ship (got " + actor + ")");
  var ev = emit(bb, "overseer", "propose_ship", "film", null, why, "judgment", warrant);
  bb.shipProposal = { by: "overseer", at: now(), note: why || null, eventId: ev.id };
  bb.status = "awaiting_client"; return ev;
}
function clientApprove(bb, why) {
  if (!bb.shipProposal) throw new Error("client approval requires a ship proposal from the overseer first");
  var ev = emit(bb, "client", "approve_ship", "film", { proposalEvent: bb.shipProposal.eventId }, why, "judgment", bb.shipProposal.eventId);
  bb.clientApproval = { by: "client", at: now(), note: why || null, eventId: ev.id };
  return ev;
}
function clientFeedback(bb, note, o) {
  o = o || {};
  var boardId = o.boardId != null ? String(o.boardId) : null;
  var panel = Number(o.panel);
  if (!Number.isFinite(panel) || panel < 1 || panel > 8) panel = null;
  return emit(bb, "client", "feedback", boardId || "film",
    (boardId || panel) ? { boardId: boardId, panel: panel, routing: "automatic" } : null,
    note, "judgment");
}
function clientDirection(bb, o) {
  o = o || {};
  var allowed = ["overseer", "director", "cinematographer", "critic"];
  var agent = allowed.indexOf(String(o.agent || "").toLowerCase()) >= 0 ? String(o.agent).toLowerCase() : "overseer";
  var boardId = o.boardId != null ? String(o.boardId) : null;
  var panel = Number(o.panel);
  if (!Number.isFinite(panel) || panel < 1 || panel > 8) panel = null;
  return emit(bb, "client", "direct_agent", boardId || "film",
    { agent: agent, boardId: boardId, panel: panel }, String(o.note || "").slice(0, 2000), "judgment");
}
function ship(bb, why, actor) {
  if (!bb.shipProposal) throw new Error("ship requires overseer propose_ship first");
  if (!bb.clientApproval) throw new Error("ship requires CLIENT approval (the plan must pass the client) -- call clientApprove first");
  bb.ship = { by: actor || "overseer", approved: true, at: now(), note: why || null, proposal: bb.shipProposal.eventId, clientApproval: bb.clientApproval.eventId };
  bb.status = "shipped"; return emit(bb, actor || "overseer", "ship", "film", { proposal: bb.shipProposal.eventId, clientApproval: bb.clientApproval.eventId }, why, "execution", bb.clientApproval.eventId);
}
function boardState(b) {
  var last = lastDecision(b);
  if (last && last.kind === "reject") return "rejected";
  if ((b.critique || []).some(function (c) { return c.status === "open"; })) return "in_review";
  var r = b.render || {};
  if (r.status === "rendered") return "done";
  if (r.status === "qc_blocked" || r.status === "clip_qc_blocked") return "in_review";
  if (r.status === "pending" || r.status === "render_failed" || r.status === "pipl_rejected") return "rendering";
  if (last && last.kind === "approve") return "approved";
  if (b.execution) return "executed";
  if (b.concept) return "conceived";
  return "empty";
}
function filmView(bb) { return Object.assign({}, bb, { boards: bb.boards.map(function (b) { return Object.assign({ state: boardState(b) }, b); }) }); }
function openCritiques(bb) { var out = []; bb.boards.forEach(function (b) { (b.critique || []).forEach(function (c) { if (c.status === "open") out.push(Object.assign({ boardId: b.id }, c)); }); }); return out; }
// Per-film serial write chain. Without this, save() fires saveRemote() without
// awaiting, so several upserts for the same film race through the proxy and can
// land out of order -- an older whole-film snapshot overwriting a newer one
// (which silently dropped events like client_question). We chain each film's
// writes so they apply in the order they were issued.
var _writeChains = {};
function _enqueueRemote(bb) {
  var id = bb.film_id;
  // snapshot the bb at issue time so a later in-place mutation can't change what we persist
  var snap = JSON.parse(JSON.stringify(bb));
  var prev = _writeChains[id] || Promise.resolve();
  var next = prev.then(function () {
    return saveRemote(snap).catch(function (e) { console.warn("[bb saveRemote]", id, e && e.message); });
  });
  // keep the chain from growing unbounded / holding rejections
  _writeChains[id] = next.catch(function () {});
  return next;
}
function save(bb) {
  fs.mkdirSync(BB_DIR, { recursive: true }); bb.updated_at = now();
  // Atomic replace prevents a process interruption from leaving a truncated
  // JSON file that neither boot recovery nor resume can parse.
  var dest = path.join(BB_DIR, bb.film_id + ".json");
  var tmp = dest + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(bb, null, 2));
  fs.renameSync(tmp, dest);
  if (process.env.BB_REMOTE) { _enqueueRemote(bb); }
  return bb;
}
function load(filmId) { return JSON.parse(fs.readFileSync(path.join(BB_DIR, filmId + ".json"), "utf8")); }

// Upsert the WHOLE film into Supabase `films` (columns the frontend reads:
// film_id, user_id, status, data, updated_at). data carries the entire blackboard.
async function saveRemote(bb) {
  var dbWrite = _getProxy().dbWrite;
  if (!dbWrite) return null;
  return dbWrite("films", "upsert", {
    row: { film_id: bb.film_id, user_id: bb.user_id, status: bb.status || "deliberating", data: bb, updated_at: now() },
    onConflict: "film_id",
  });
}
// Read a film back from Supabase (used on resume when the local json is gone,
// e.g. after a VPS restart wiped /tmp). Returns the blackboard object or throws.
async function loadRemote(filmId) {
  var dbRead = _getProxy().dbRead;
  if (!dbRead) throw new Error("no proxy for loadRemote");
  var r = await dbRead("films", { filters: { film_id: filmId }, single: true });
  var row = (r && typeof r === "object" && "data" in r) ? r.data : r;
  if (!row || !row.data) throw new Error("film not found remotely: " + filmId);
  return row.data;
}

module.exports = { newFilm: newFilm, emit: emit, setBrief: setBrief, setFilmPlan: setFilmPlan,
  addBoard: addBoard, getBoard: getBoard, liveBoards: liveBoards, setBoardConcept: setBoardConcept, setBoardExecution: setBoardExecution,
  addCritique: addCritique, resolveCritique: resolveCritique, overruleCritique: overruleCritique,
  recordRenderFact: recordRenderFact, recordReview: recordReview, addDirective: addDirective,
  approveBoard: approveBoard, rejectBoard: rejectBoard,
  proposeShip: proposeShip, clientApprove: clientApprove, clientFeedback: clientFeedback, clientDirection: clientDirection, ship: ship,
  boardState: boardState, filmView: filmView, openCritiques: openCritiques, save: save, load: load, saveRemote: saveRemote, loadRemote: loadRemote };
