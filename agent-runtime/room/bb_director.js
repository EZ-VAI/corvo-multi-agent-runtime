// room/bb_director.js - Director onto the blackboard. PLUMBING ONLY.
// round 1: brief -> filmPlan + boards. round>1 (refocus/pivot, ordered by the
// Overseer): rebuilds criticReport/priorDirection/overseerDirective FROM the
// board, retires every live board (superseded), writes the new generation
// (ids "N~gG"). director.js untouched; all writes carry the warrant.
const BB = require("./blackboard");
const { runDirector, runDirectorAdjudicate } = require("./director");
const { buildWorkingBrief } = require("./brief");
const { reconstructDirection } = require("./bb_cine");

function buildCriticReport(film) {
  var rv = film.review || {};
  var objections = [];
  (rv.directionObjections || []).forEach(function (o) { objections.push({ severity: o.severity, layer: o.layer || "direction", point: o.point, fix: o.fix }); });
  BB.openCritiques(film).forEach(function (c) { objections.push({ severity: c.severity, layer: "board", board_id: c.boardId, point: c.note }); });
  return { verdict: rv.verdict || null, objections: objections };
}
function lastOverseerPayload(film) {
  var evs = (film.events || []).filter(function (e) { return e.actor === "overseer" && e.action === "moves"; });
  return evs.length ? (evs[evs.length - 1].payload || {}) : {};
}

async function directorOntoBoard(film, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var round = opts.round || 1;
  var b = film.brief || {};
  var strategy = b.strategy || b;
  var brandBrain = b.brandBrain || opts.brandBrain || {};
  var referenceCases = b.referenceCases || opts.referenceCases || [];
  var workingBrief = buildWorkingBrief(strategy);
  // The client's chosen format (asked by the Overseer before creative) lands in film.inputs.
  // It is the strongest signal of how long the film should be -- prefer it over the brief's
  // default, so a 15s reel is actually planned as a 15s reel (fewer boards), not a 60s arc.
  workingBrief.totalDuration =
    (film.inputs && typeof film.inputs.runtimeSec === "number" && film.inputs.runtimeSec > 0 && film.inputs.runtimeSec) ||
    (strategy && (strategy.runtimeSec || strategy.totalDuration)) || opts.runtimeSec || 60;
  if (film.inputs) {
    if (film.inputs.aspectRatio) workingBrief.aspectRatio = film.inputs.aspectRatio;
    if (film.inputs.intent) workingBrief.formatKind = film.inputs.intent;
  }

  var args = { workingBrief: workingBrief, brandBrain: brandBrain, referenceCases: referenceCases, round: round };
  if (round > 1) {
    args.criticReport = buildCriticReport(film);
    args.priorDirection = reconstructDirection(film);
    var op = lastOverseerPayload(film);
    args.overseerDirective = { steer: opts.steer || null, directive: opts.instruction || null,
      macroProblems: op.macro_problems || [], triviaToDrop: op.trivia_to_drop || [] };
    BB.liveBoards(film).forEach(function (lb) {
      BB.rejectBoard(film, lb.id, "superseded by director re-derivation (" + (opts.steer || "recut") + ")", "overseer", warrant);
    });
  }
  var res = await runDirector(args);
  var dir = res.direction || {};
  var fp = dir.filmPlan || {};
  var gen = 1;
  film.boards.forEach(function (x) { if ((x.gen || 1) >= gen) gen = (x.gen || 1) + (round > 1 ? 1 : 0); });
  if (round === 1) gen = 1;

  var script = Array.isArray(fp.script) ? fp.script : [];
  BB.setFilmPlan(film, {
    concept: dir.concept || null, sellMechanism: dir.sell_mechanism || null,
    emotionalArc: dir.emotional_arc || null, rationale: dir.rationale || null,
    realizationStrategy: dir.realizationStrategy || "storyboard",
    runtimeSec: fp.runtimeSec || workingBrief.totalDuration,
    storyboardCount: fp.storyboardCount || script.length,
    whyThisScript: fp.whyThisScript || null,
    script: script,
    throughLine: fp.throughLine || null,
    voiceover: fp.voiceover || null, referenceUsed: res.referenceUsed || null
  }, "director", warrant);

  script.forEach(function (seg, idx) {
    var segNo = seg.segment || (idx + 1);
    var bid = (gen > 1) ? (String(segNo) + "~g" + gen) : String(segNo);
    BB.addBoard(film, { id: bid, gen: gen }, "director", warrant);
    // The board's "concept" now holds the Director's STORY for this segment; the
    // Cinematographer fills execution (world/light/8 panels) later.
    BB.setBoardConcept(film, bid, {
      title: seg.title || null,
      story: seg.story || null
    }, "director", warrant);
  });
  return { film: film, direction: dir, referenceUsed: res.referenceUsed || null, gen: gen };
}
async function directorAdjudicate(film, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var boardId = opts.boardId, critiqueId = opts.critiqueId;
  var board = BB.getBoard(film, boardId);
  if (!board) throw new Error("adjudicate: no board " + boardId);
  var crit = (board.critique || []).filter(function (c) { return c.id === critiqueId; })[0];
  if (!crit) throw new Error("adjudicate: no critique " + critiqueId + " on " + boardId);
  var b = film.brief || {};
  var brandBrain = b.brandBrain || {};
  var fp = film.filmPlan || {};
  var liveScript = BB.liveBoards(film).map(function (lb) {
    var lc = lb.concept || {};
    return { segment: lb.id, title: lc.title || null, story: lc.story || null };
  });
  var c0 = board.concept || {};
  var segment = { segment: board.id, title: c0.title || null, story: c0.story || null };
  var dissentReason = null;
  (film.events || []).forEach(function (e) {
    if (e.actor === "cinematographer" && e.action === "cinematographer_dissent" &&
        e.payload && e.payload.critiqueId === critiqueId) dissentReason = e.why || dissentReason;
  });
  var ruling = await runDirectorAdjudicate({
    objection: { point: crit.note, severity: crit.severity },
    dissentReason: dissentReason, segment: segment, script: liveScript,
    throughLine: fp.throughLine || null, brandBrain: brandBrain
  });
  var verdict = ruling.verdict || null;
  BB.emit(film, "director", "director_adjudicate", board.id, { critiqueId: critiqueId, verdict: verdict }, ruling.reasoning || null, "judgment", warrant);
  if (verdict === "own" && ruling.revisedSegment) {
    var rev = ruling.revisedSegment;
    var newTitle = rev.title || c0.title || null, newStory = rev.story || c0.story || null;
    BB.setBoardConcept(film, board.id, { title: newTitle, story: newStory }, "director", warrant);
    board.gen = (board.gen || 1) + 1;
    var liveNow = BB.liveBoards(film), pos = liveNow.indexOf(board);
    if (Array.isArray(fp.script) && pos >= 0 && pos < fp.script.length) {
      var newScript = fp.script.slice(), prev = newScript[pos] || {};
      newScript[pos] = { segment: prev.segment, title: newTitle, story: newStory };
      BB.setFilmPlan(film, Object.assign({}, fp, { script: newScript }), "director", warrant);
    }
  } else if (verdict === "dispute") {
    BB.emit(film, "director", "director_dispute", board.id, { critiqueId: critiqueId }, ruling.disputeReason || null, "judgment", warrant);
  }
  return { verdict: verdict, bounceInstruction: ruling.bounceInstruction || null, disputeReason: ruling.disputeReason || null, boardId: board.id, critiqueId: critiqueId };
}
module.exports = { directorOntoBoard, directorAdjudicate };
