// room/bb_lint.js - mechanical warrant-invariant lint. ZERO LLM, ZERO judgment.
// Walks the event ledger; flags any authority act that cannot cite a judgment.
//   L1 every warrant points to an EARLIER event of kind=judgment
//   L2 actor "controller" never emits kind=judgment (the controller must not think)
//   L3 ship chain: ship -> client approve_ship -> overseer propose_ship (all present, ordered)
//   L4 controller dispatches (action=dispatch) always carry a warrant
//   L5 resolve_critique only by critic; overrule_critique only by overseer
// usage: node room/bb_lint.js <film-id>   (or require: lint(film) -> {pass, problems})
function lint(film) {
  var evs = film.events || [], problems = [];
  var byId = {}; evs.forEach(function (e, i) { if (e.id) byId[e.id] = { e: e, i: i }; });
  evs.forEach(function (e, i) {
    if (e.warrant) {
      var w = byId[e.warrant];
      if (!w) problems.push("L1 " + e.actor + ":" + e.action + " warrant " + e.warrant + " not found");
      else if (w.i >= i) problems.push("L1 " + e.actor + ":" + e.action + " warrant is not earlier");
      else if (w.e.kind !== "judgment") problems.push("L1 " + e.actor + ":" + e.action + " warrant -> " + w.e.actor + ":" + w.e.action + " which is kind=" + w.e.kind + ", not judgment");
    }
    if (e.actor === "controller" && e.kind === "judgment") problems.push("L2 controller emitted a judgment: " + e.action);
    if (e.actor === "controller" && e.action === "dispatch" && !e.warrant) problems.push("L4 controller dispatch without warrant: " + JSON.stringify(e.payload).slice(0, 80));
    if (e.action === "resolve_critique" && e.actor !== "critic") problems.push("L5 resolve_critique by " + e.actor);
    if (e.action === "overrule_critique" && e.actor !== "overseer") problems.push("L5 overrule_critique by " + e.actor);
  });
  var shipEv = evs.filter(function (e) { return e.action === "ship"; })[0];
  if (shipEv) {
    var ca = evs.filter(function (e) { return e.action === "approve_ship" && e.actor === "client"; })[0];
    var ps = evs.filter(function (e) { return e.action === "propose_ship" && e.actor === "overseer"; })[0];
    if (!ca) problems.push("L3 ship without client approve_ship");
    if (!ps) problems.push("L3 ship without overseer propose_ship");
    if (ca && shipEv.warrant !== ca.id) problems.push("L3 ship warrant does not cite the client approval");
    if (ca && ca.warrant && (!ps || ca.warrant !== ps.id)) problems.push("L3 client approval does not cite the overseer proposal");
  }
  return { pass: problems.length === 0, problems: problems, events: evs.length };
}
module.exports = { lint };
if (require.main === module) {
  var BB = require("./blackboard");
  var id = process.argv[2];
  if (!id) { console.error("usage: node room/bb_lint.js <film-id>"); process.exit(1); }
  var r = lint(BB.load(id));
  console.log("lint", id, ":", r.pass ? "PASS" : "FAIL", "|", r.events, "events");
  r.problems.forEach(function (p) { console.log("  -", p); });
  process.exit(r.pass ? 0 : 1);
}
