// agent-runtime/room/brief.js
//
// The power model for the creative room. The strategy agent hands the room a
// brief whose fields are tagged source:"agent" or source:"user_confirmed".
//
//   source:"agent"          → the director may OVERRIDE (replace the value) or CHALLENGE.
//   source:"user_confirmed" → the director may ONLY CHALLENGE. An override attempt is
//                             physically downgraded to a challenge; the value is NEVER
//                             mutated. This is the HARD FUSE — the one safety-critical
//                             invariant of the whole team structure.
//
// Brief shape (from strategy/agent.js buildStrategy):
//   { audience: {content, source}, core_message: {...}, emotional_register: {...},
//     target_reaction: {...} }

const BRIEF_FIELDS = ["brand_name", "audience", "core_message", "emotional_register", "target_reaction"];

// Normalise the strategy brief into a mutable working brief. Each field gains a
// challenges[] log and a history[] of applied overrides. Deep-copied so the
// original input is never touched.
function buildWorkingBrief(rawBrief) {
  const raw = rawBrief || {};
  const working = {};
  for (const f of BRIEF_FIELDS) {
    const cell = raw[f] || {};
    working[f] = {
      content: typeof cell === "string" ? cell : (cell.content || ""),
      source: cell.source === "user_confirmed" ? "user_confirmed" : "agent",
      challenges: [],
      history: [],
    };
  }
  return working;
}

// Apply the director's rulings against the working brief, enforcing the hard fuse.
// rulings: [{ field, action: "override"|"challenge", value?, reason }]
// Returns { brief, applied, fuseEvents } — `brief` is the same object, mutated.
function applyRulings(working, rulings) {
  const applied = [];
  const fuseEvents = [];
  for (const r of rulings || []) {
    const field = r && r.field;
    const item = field && working[field];
    if (!item) {
      applied.push({ field, action: "ignored", reason: "unknown brief field" });
      continue;
    }
    const action = r.action === "override" ? "override" : "challenge";

    if (item.source === "user_confirmed") {
      // HARD FUSE: never mutate a user_confirmed value. Force any override to a challenge.
      if (action === "override") {
        fuseEvents.push({
          field,
          attempted: "override",
          forcedTo: "challenge",
          proposedValue: r.value,
          reason: r.reason || "",
        });
      }
      item.challenges.push({ reason: r.reason || "", proposedValue: r.value, fused: action === "override" });
      applied.push({ field, action: "challenge", forcedFromOverride: action === "override" });
      continue;
    }

    // source:"agent" — override and challenge both permitted.
    if (action === "override") {
      item.history.push({ from: item.content, to: r.value, reason: r.reason || "" });
      item.content = r.value != null ? r.value : item.content;
      applied.push({ field, action: "override" });
    } else {
      item.challenges.push({ reason: r.reason || "", proposedValue: r.value });
      applied.push({ field, action: "challenge" });
    }
  }
  return { brief: working, applied, fuseEvents };
}

// Render the working brief as text for an agent prompt, with source tags visible
// so the director knows what it may override vs. only challenge.
function renderBrief(working) {
  return BRIEF_FIELDS.map((f) => {
    const it = working[f] || {};
    const tag = it.source === "user_confirmed" ? "[USER-CONFIRMED — challenge only]" : "[agent — overridable]";
    const ch = (it.challenges || []).length ? ` (open challenges: ${it.challenges.length})` : "";
    return `- ${f} ${tag}: ${it.content || "(empty)"}${ch}`;
  }).join("\n");
}

module.exports = { BRIEF_FIELDS, buildWorkingBrief, applyRulings, renderBrief };
