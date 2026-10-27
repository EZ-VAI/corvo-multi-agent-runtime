// room/bb_cine.js - Cinematographer onto the blackboard. PLUMBING ONLY.
// cineOntoBoard: executes ALL live boards (runCinematographer storyboard loop).
// reworkBoard: surgical single-board re-author (runStoryboard round 2, fed the
// board's open critiques + the Overseer's instruction). Prompts untouched.
const BB = require("./blackboard");
const { runCinematographer } = require("./cinematographer");
const { runStoryboard } = require("./storyboard");

function reconstructDirection(film) {
  var fp = film.filmPlan || {};
  var boards = BB.liveBoards(film);
  // Rebuild the SCRIPT the Cinematographer consumes. Prefer the stored filmPlan.script;
  // fall back to the per-board story/title (each live board carries one segment's story).
  // Crucially, each script entry's `segment` MUST equal its board id, so the storyboards
  // the Cinematographer returns map back onto the right board via boardId.
  var script;
  if (Array.isArray(fp.script) && fp.script.length === boards.length && boards.length > 0) {
    script = boards.map(function (b, i) {
      var seg = fp.script[i] || {};
      var c = b.concept || {};
      return { segment: b.id, title: seg.title || c.title || null, story: seg.story || c.story || null };
    });
  } else {
    script = boards.map(function (b) {
      var c = b.concept || {};
      return { segment: b.id, title: c.title || null, story: c.story || null };
    });
  }
  return {
    realizationStrategy: fp.realizationStrategy || "storyboard",
    concept: fp.concept || null, sell_mechanism: fp.sellMechanism || null,
    emotional_arc: fp.emotionalArc || null, rationale: fp.rationale || null,
    filmPlan: {
      runtimeSec: fp.runtimeSec || null,
      storyboardCount: fp.storyboardCount || script.length,
      whyThisScript: fp.whyThisScript || null,
      throughLine: fp.throughLine || null, voiceover: fp.voiceover || null,
      script: script
    }
  };
}

async function cineOntoBoard(film, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var b = film.brief || {};
  var brandBrain = b.brandBrain || opts.brandBrain || {};
  var direction = reconstructDirection(film);
  var brief = { totalDuration: (film.filmPlan && film.filmPlan.runtimeSec) || opts.runtimeSec || 60 };
  var res = await runCinematographer({ direction: direction, brandBrain: brandBrain, shotKnowledge: opts.shotKnowledge || null, brief: brief, round: 1 });
  var storyboards = res.storyboards || [];
  storyboards.forEach(function (sb) {
    BB.setBoardExecution(film, sb.boardId, {
      panels: sb.panels || [], includePeople: !!sb.includePeople,
      world: sb.world || null, arc: sb.arc || null,
      panelCount: sb.panelCount || (sb.panels || []).length
    }, "cinematographer", warrant);
  });
  return { film: film, count: storyboards.length };
}

async function reworkBoard(film, boardId, opts) {
  opts = opts || {};
  var warrant = opts.warrant || null;
  var board = BB.getBoard(film, boardId);
  if (!board) throw new Error("rework: no board " + boardId);
  if (!board.concept) throw new Error("rework: board " + boardId + " has no concept");
  var live = BB.liveBoards(film);
  var idx = live.indexOf(board);
  if (idx < 0) throw new Error("rework: board " + boardId + " is retired");
  var b = film.brief || {};
  var brandBrain = b.brandBrain || {};
  var direction = reconstructDirection(film);
  var fp = direction.filmPlan || {};
  var c = board.concept;
  var objections = (board.critique || []).filter(function (x) { return x.status === "open"; })
    .map(function (x) { return { id: x.id, severity: x.severity, point: x.note }; });
  if (opts.instruction) objections.unshift({ severity: "high", point: "OVERSEER DIRECTIVE: " + opts.instruction });
  var r = await runStoryboard({
    direction: direction, brandBrain: brandBrain, shotKnowledge: opts.shotKnowledge || null,
    brief: { totalDuration: fp.runtimeSec || 60 }, totalDuration: fp.runtimeSec || 60,
    round: 2, criticReport: { objections: objections },
    segment: { segment: board.id, title: c.title || null, story: c.story || null },
    prevSegmentStory: (idx > 0 && live[idx - 1] && live[idx - 1].concept) ? (live[idx - 1].concept.story || null) : null,
    throughLine: fp.throughLine || null,
    boardIndex: idx + 1, boardCount: live.length
  });
  var sb = r.storyboard || {};
  BB.setBoardExecution(film, board.id, {
    panels: sb.panels || [], includePeople: !!sb.includePeople,
    world: sb.world || null, arc: sb.arc || null, panelCount: r.panelCount
  }, "cinematographer", warrant);
  var reply = (r.reply || "").trim();
  if (reply) BB.emit(film, "cinematographer", "cinematographer_reply", board.id, {}, reply, "judgment", warrant);
  var dissent = r.dissent || null;
  var dissentValid = !!(dissent && dissent.critiqueId && (board.critique || []).some(function (c) { return c.id === dissent.critiqueId && c.status === "open"; }));
  if (dissentValid) {
    BB.emit(film, "cinematographer", "cinematographer_dissent", board.id, { critiqueId: dissent.critiqueId }, dissent.reason || null, "judgment", warrant);
  }
  return { film: film, boardId: board.id, panels: (sb.panels || []).length, dissent: dissentValid ? dissent : null };
}
module.exports = { cineOntoBoard, reworkBoard, reconstructDirection };
