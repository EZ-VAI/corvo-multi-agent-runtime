// agent-runtime/room/deliberate.js
//
// The deliberation loop. Orchestrates the three roles with the power model wired in:
//
//   director → (apply rulings to brief) → [shot-knowledge] → cinematographer → critic → director → ...
//
// Bounded: maxRounds (default 4) with a "must advance" guard — if a round produces
// no change vs. the previous one, we stop rather than spin. Converges early when the
// Critic says it sells with no high-severity objections.
//
// Two retrievals feed the room, both NON-FATAL:
//   - reference cases (collision engine ammunition) — once.
//   - shot-knowledge (the recipe library / shot bible / arc, the moat) — fetched via
//     the shot-knowledge tool, MEMOISED by (vertical, filmMode, subcategory). vertical
//     and subcategory are FACTS read off the brand; filmMode is a Director decision, so
//     a cache miss in a later round (Director changed filmMode) simply re-fetches.
//
// The Cinematographer now emits the canonical structured shot schema; its mechanical
// shapeIssues + the Critic's shot-level objections both flow back to the Director (the
// objections via the existing criticReport path), so direction and shots co-evolve.

const { casesSearch, toolInvoke } = require("../understanding/proxy");
const { buildWorkingBrief, applyRulings } = require("./brief");
const { runDirector } = require("./director");
const { runCinematographer } = require("./cinematographer");
const { runCritic } = require("./critic");
const { runOverseer } = require("./overseer");

async function getReferenceCases(working) {
  const parts = [
    working.core_message && working.core_message.content,
    working.audience && working.audience.content,
    working.emotional_register && working.emotional_register.content,
  ].filter(Boolean);
  const query = parts.join(" — ");
  if (!query) return [];
  try {
    const out = await casesSearch(query, 4);
    if (Array.isArray(out)) return out;
    if (out && Array.isArray(out.cases)) return out.cases;
    if (out && Array.isArray(out.data)) return out.data;
    if (out && Array.isArray(out.results)) return out.results;
    return [];
  } catch (e) {
    console.warn("[room] cases.search unavailable (non-fatal):", e.message);
    return [];
  }
}

// vertical + subcategory are FACTS on the brand/product; filmMode is the Director's
// decision (may be absent in early rounds → shot-knowledge returns broad reference).
function resolveShotContext(direction, brandBrain) {
  const bb = brandBrain || {};
  const vertical =
    bb.vertical || bb.category ||
    (bb.essence && bb.essence.vertical) ||
    (bb.product && bb.product.vertical) || null;
  const subcategory =
    bb.subcategory ||
    (bb.product && (bb.product.subcategory || bb.product.category)) || null;
  const d = direction || {};
  const filmMode = d.film_mode || d.filmMode || null;
  return { vertical, subcategory, filmMode };
}

// Memoised shot-knowledge fetch. Non-fatal: on any failure the Cinematographer is
// told SHOT_KNOWLEDGE is missing and decides from direction + visual_dna only.
function makeShotKnowledgeGetter() {
  const cache = new Map();
  return async function getShotKnowledge(ctx) {
    const key = [ctx.vertical || "", ctx.filmMode || "", ctx.subcategory || ""].join("|");
    if (cache.has(key)) return cache.get(key);
    let sk = null;
    try {
      const r = await toolInvoke("shot-knowledge", {
        vertical: ctx.vertical,
        filmMode: ctx.filmMode,
        subcategory: ctx.subcategory,
      });
      if (r && r.ok) {
        sk = r.data;
        // vps-proxy wraps whitelisted tools in an always-200 {ok,data}/{ok,error}
        // envelope, and proxy.toolInvoke wraps once more — so r.data can itself BE
        // that envelope. Unwrap defensively (mirrors routes.js unwrap()) so the
        // Cinematographer gets the real knowledge object, not a wrapper, and gets
        // null (not an error object) when the tool failed.
        if (sk && typeof sk === "object" && "ok" in sk && ("data" in sk || "error" in sk)) {
          sk = sk.ok ? (sk.data != null ? sk.data : null) : null;
        }
      } else {
        console.warn("[room] shot-knowledge tool returned error (non-fatal):", r && r.error);
      }
    } catch (e) {
      console.warn("[room] shot-knowledge unavailable (non-fatal):", e.message);
    }
    cache.set(key, sk);
    return sk;
  };
}

function signature(direction, critic) {
  const concept = (direction && direction.concept) || "";
  const points = ((critic && critic.objections) || [])
    .map((o) => (o && o.point) || "")
    .sort()
    .join("|");
  return concept + "||" + points;
}

// deliberate({ brief, brandBrain }, { maxRounds?, onProgress? })
async function deliberate({ brief, brandBrain }, opts = {}) {
  // maxRounds is now only a COST-SAFETY bound, not the arbiter of "done". The Overseer
  // decides when the work converges; this just stops a runaway loop.
  const maxRounds = opts.maxRounds || 8;
  const onProgress = opts.onProgress;

  const working = buildWorkingBrief(brief);
  const referenceCases = await getReferenceCases(working);
  const referenceSummary = (referenceCases || []).slice(0, 5).map((c) => ({
    brand: c.brand,
    campaign: c.campaign_name,
    mechanism: c.bridge_technique || c.specific_metaphor,
  }));

  const getShotKnowledge = makeShotKnowledgeGetter();

  const log = [];
  let direction = null;
  let shots = null;
  let critic = null;
  let overseer = null; // the Overseer's read of the LAST round — drives the next round
  let chosen = null;   // set ONLY when the Overseer converges on a publishable cut

  // Degenerate fallback ONLY: if the loop hits the cost-safety bound without the Overseer
  // ever converging, surface the least-bad round seen, flagged not-publishable. Never the
  // normal ship path (that is the Overseer's converge); tracked by score only to pick which
  // below-bar attempt to show.
  let fallback = null;
  let fallbackScore = -1;

  for (let round = 1; round <= maxRounds; round++) {
    const d = await runDirector({
      workingBrief: working,
      brandBrain,
      referenceCases,
      round,
      criticReport: critic,
      priorDirection: direction,
      overseerDirective: overseer,
    });
    direction = d.direction;
    const ruling = applyRulings(working, d.rulings);

    const shotContext = resolveShotContext(direction, brandBrain);
    const shotKnowledge = await getShotKnowledge(shotContext);

    const cine = await runCinematographer({
      direction,
      brandBrain,
      shotKnowledge,
      brief: working,
      round,
      criticReport: critic,
    });
    shots = cine.shots;

    critic = await runCritic({
      direction,
      shots,
      workingBrief: working,
      brandBrain,
      shapeIssues: cine.shapeIssues,
    });

    const entry = {
      round,
      direction,
      reference_used: d.referenceUsed,
      rulings: d.rulings,
      ruling_applied: ruling.applied,
      fuse_events: ruling.fuseEvents,
      response_to_critic: d.responseToCritic,
      shot_context: shotContext,
      shot_knowledge_loaded: !!shotKnowledge,
      shape_issues: cine.shapeIssues,
      shots,
      critic,
    };
    log.push(entry);

    // THE OVERSEER — the executive eye. Reads the WHOLE trajectory (incl. this round) and
    // owns the consequential calls: significance triage, the neglected macro, the steer,
    // the holistic publish gate. Its judgment — not a formula — drives the loop.
    overseer = await runOverseer({ trajectory: log, brief: working, brandBrain });
    entry.overseer = overseer;

    if (typeof onProgress === "function") {
      try { await onProgress({ round, status: "deliberating", steer: overseer.steer }); } catch (e) {}
    }

    // THE BAR — a guard enforcing thresholds the AGENTS produced, not a judgment: Critic's
    // honest score >= 80, no high-severity objection, AND the Overseer's converge + publish_ok.
    // Only then is the work done; ship the cut the Overseer blessed.
    const score = critic.convincedScore || 0;
    const hasHigh = (critic.objections || []).some((o) => (o.severity || "").toLowerCase() === "high");
    if (overseer.steer === "converge" && overseer.publishOk && score >= 80 && !hasHigh) {
      chosen = { direction, shots, critic, overseer, round };
      break;
    }

    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = { direction, shots, critic, overseer, round };
    }

    // Otherwise the Overseer's steer (pivot/refocus/proceed) drives the next round. There
    // is NO mechanical stall-exit: a deadlock is the Overseer's to break, not a
    // string-compare's to surrender to.
  }

  const shipped = chosen || fallback || { direction, shots, critic, overseer, round: log.length };
  const publishable = !!chosen;

  return {
    direction: shipped.direction,
    shots: shipped.shots,
    brief: working,
    publishable, // false => loop hit the cost bound below bar; do NOT auto-ship
    result: {
      reference_cases: referenceSummary,
      verdict: shipped.critic && shipped.critic.verdict,
      convinced_score: shipped.critic && shipped.critic.convincedScore,
      objections: (shipped.critic && shipped.critic.objections) || [],
      anti_identity_violations: (shipped.critic && shipped.critic.antiIdentityViolations) || [],
      macro_read: shipped.overseer && shipped.overseer.macroRead,
      macro_problems: (shipped.overseer && shipped.overseer.macroProblems) || [],
      steer: shipped.overseer && shipped.overseer.steer,
      publishable,
      rounds: log.length,
      chosen_round: shipped.round,
    },
    log,
  };
}
module.exports = { deliberate };
