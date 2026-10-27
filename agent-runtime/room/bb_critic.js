// room/bb_critic.js - Critic onto the blackboard. PLUMBING ONLY.
// First review AND re-review: passes the film's open critiques to runCritic; the
// Critic alone judges which are resolved (adapter merely executes its resolve list
// -- never auto-resolves). board objections -> board.critique[]; film-level ->
// film.review. All writes carry the controller's warrant when run under P2.
const BB = require("./blackboard");
const { runCritic, runCriticRebuttal } = require("./critic");
const { reconstructDirection } = require("./bb_cine");
const { buildWorkingBrief } = require("./brief");

async function criticOntoBoard(film, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var b = film.brief || {};
  var brandBrain = b.brandBrain || opts.brandBrain || {};
  var strategy = b.strategy || b;
  var workingBrief = buildWorkingBrief(strategy);
  workingBrief.totalDuration = (strategy && (strategy.runtimeSec || strategy.totalDuration)) || (film.filmPlan && film.filmPlan.runtimeSec) || 60;
  var direction = reconstructDirection(film);
  var live = BB.liveBoards(film);
  // PHASE: before any storyboard is drawn, review the CONCEPT/script only (LAYER 1) so the client
  // approves a vetted concept; once storyboards exist, review their EXECUTION. opts.phase overrides.
  var hasExecution = live.some(function (brd) { return brd.execution && (brd.execution.panels || []).length; });
  var phase = opts.phase || (hasExecution ? "execution" : "concept");
  var storyboards = (phase === "concept") ? [] : live.map(function (brd) {
    var c = brd.concept || {}, e = brd.execution || {};
    return { boardId: brd.id, role: brd.role, seam: c.seam || null, world: e.world, includePeople: e.includePeople, arc: e.arc, panels: e.panels || [] };
  });
  var open = (phase === "concept") ? [] : BB.openCritiques(film);

  var res = await runCritic({ direction: direction, storyboards: storyboards, filmPlan: direction.filmPlan, workingBrief: workingBrief, brandBrain: brandBrain, openCritiques: open, phase: phase });

  var resolved = res.resolvedCritiqueIds || [];
  resolved.forEach(function (cid) {
    var hit = open.filter(function (c) { return c.id === cid; })[0];
    if (hit) BB.resolveCritique(film, hit.boardId, cid, "critic", warrant);
  });
  var objections = res.objections || [];
  var directionObjections = [];
  objections.forEach(function (o) {
    var bid = (phase === "concept") ? null : ((o.board_id != null) ? String(o.board_id) : null);
    var matched = bid ? live.filter(function (x) { return String(x.id) === bid; })[0] : null;
    if (matched) BB.addCritique(film, matched.id, { severity: o.severity || "medium", note: (o.point || "") + (o.fix ? " | FIX: " + o.fix : ""), target: "board" }, "critic", warrant);
    else directionObjections.push(o);
  });
  // CONCEPT phase: speak each concept objection into the room as a visible event so the user can
  // watch the Critic pressure-test the concept BEFORE being asked to approve it.
  if (phase === "concept") {
    directionObjections.forEach(function (o) {
      BB.emit(film, "critic", "concept_critique", "film", { severity: o.severity || "medium" }, (o.point || "") + (o.fix ? " | FIX: " + o.fix : ""), "judgment", warrant);
    });
  }
  BB.recordReview(film, { verdict: res.verdict, convincedScore: res.convincedScore, directionObjections: directionObjections, antiIdentityViolations: res.antiIdentityViolations || [] }, "critic", warrant);
  return { film: film, verdict: res.verdict, score: res.convincedScore, resolved: resolved.length,
    boardObjections: objections.length - directionObjections.length, directionObjections: directionObjections.length, antiViolations: (res.antiIdentityViolations || []).length };
}
async function criticRebut(film, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var boardId = opts.boardId, critiqueId = opts.critiqueId;
  var board = BB.getBoard(film, boardId);
  if (!board) throw new Error("rebut: no board " + boardId);
  var crit = (board.critique || []).filter(function (c) { return c.id === critiqueId; })[0];
  if (!crit) throw new Error("rebut: no critique " + critiqueId + " on " + boardId);
  var b = film.brief || {};
  var brandBrain = b.brandBrain || {};
  var direction = reconstructDirection(film);
  var c = board.concept || {}, e = board.execution || {};
  var storyboard = { boardId: board.id, world: e.world || null, arc: e.arc || null, panels: e.panels || [], title: c.title || null, story: c.story || null };
  var disputeReason = null;
  (film.events || []).forEach(function (ev) {
    if (ev.actor === "director" && ev.action === "director_dispute" && ev.payload && ev.payload.critiqueId === critiqueId) disputeReason = ev.why || disputeReason;
  });
  var res = await runCriticRebuttal({
    objection: { point: crit.note, severity: crit.severity },
    disputeReason: disputeReason, storyboard: storyboard, direction: direction, brandBrain: brandBrain
  });
  BB.emit(film, "critic", "critic_rebuttal", board.id, { critiqueId: critiqueId, stand: !!res.stand }, res.rebuttal || null, "judgment", warrant);
  if (!res.stand) BB.resolveCritique(film, board.id, critiqueId, "critic", warrant);
  return { stand: !!res.stand, rebuttal: res.rebuttal || null, boardId: board.id, critiqueId: critiqueId };
}
module.exports = { criticOntoBoard, criticRebut };
