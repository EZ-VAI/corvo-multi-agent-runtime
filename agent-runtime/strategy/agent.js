// Strategy Agent — the bridge between understanding and the creative room.
// Turns "we understand this brand" into "what THIS film should do."
// Deliberately LIGHT: it sets a target, not the creative. The director is
// the soul; strategy only hands the director a brief to aim at.
//
// Two LLM calls (not one, not a full loop):
//   1. propose  — draft the brief from brand_brain + product_brain + inputs
//   2. critique — self-review once: "is this too generic? more brand-specific?"
//                 then revise. Guards against a lazy first-guess without
//                 over-thinking into the director's territory.
//
// Every brief line is tagged source:"agent" so the director may override OR
// challenge it. (User-confirmed lines get upgraded to source:"user_confirmed"
// later, in the present/apply step — then the director may only challenge.)

const { aiComplete } = require("../understanding/proxy");

const PROPOSE_SYS = [
  "You are the strategist on an AI ad team. Brand understanding is already",
  "done. Your job: turn it into a BRIEF for ONE specific film — a target to",
  "aim at, NOT the creative itself. You set the WHAT/WHO; the director decides",
  "the HOW. Stay light. Do not describe shots, beats, hooks, or visuals.",
  "",
  "Use the channel signal in the inputs: aspect ratio + duration imply the",
  "context (e.g. 9:16 / 15s = social hook film; 1:1 or 16:9 / 30s = shelf or",
  "site showcase). Let that shape the brief's intent, not its visuals.",
  "",
  "Produce a SHORT brief, only these fields:",
  "- brand_name: the brand name, written EXACTLY as it should appear on screen (e.g. an end card). Take it verbatim from the brand understanding; if genuinely unknown, use an empty string.",
  "- audience: who this one film speaks to (specific, not 'everyone')",
  "- core_message: the ONE thing this film says (a single idea, not a list)",
  "- emotional_register: the feeling (e.g. 'quiet authority', not a paragraph)",
  "- target_reaction: the one response we want (e.g. 'worth trying')",
  "",
  "Ground every field in THIS brand's specifics (essence, visual_dna,",
  "anti_identity, product value). Avoid anything that fits any brand in the",
  "category. Return ONLY JSON with these fields.",
].join("\n");

const CRITIQUE_SYS = [
  "You are the same strategist, reviewing your own draft brief once before",
  "handing it to the director. Ask yourself honestly:",
  "- Is any field generic enough to fit a competitor? If so, sharpen it to",
  "  THIS brand using its essence / anti_identity / product truth.",
  "- Is core_message truly ONE idea, not a smuggled list?",
  "- Does audience name a real, specific person, not 'beauty lovers'?",
  "Do NOT add creative direction (no shots/beats/hooks). Do NOT pad. If the",
  "draft is already sharp and brand-specific, keep it. Only change what's weak.",
  "Return ONLY the final JSON with the same four fields.",
].join("\n");

async function buildStrategy(ctx) {
  // ctx: { brandBrain, productBrain, brief:{aspectRatio,durationSec,...} }
  const input = {
    brandBrain: ctx.brandBrain || {},
    productBrain: ctx.productBrain || {},
    filmInputs: {
      aspectRatio: ctx.brief && ctx.brief.aspectRatio,
      durationSec: ctx.brief && ctx.brief.durationSec,
      vibe: (ctx.brief && ctx.brief.vibe) || undefined,
      clientIntent: (ctx.brief && ctx.brief.intent) || undefined,
    },
  };

  // 1. propose
  const draft = await aiComplete({
    model: "openai/gpt-5.5",
    system: PROPOSE_SYS,
    user: JSON.stringify(input),
    temperature: 0.6,
  });

  // 2. self-critique + revise (single pass)
  const reviewed = await aiComplete({
    model: "openai/gpt-5.5",
    system: CRITIQUE_SYS,
    user: JSON.stringify({ brand: input.brandBrain, draft: draft }),
    temperature: 0.4,
  });

  const final = reviewed && !reviewed._parseError ? reviewed : draft;

  // tag every line source:"agent" — director may override or challenge.
  const fields = ["audience", "core_message", "emotional_register", "target_reaction"];
  const brief = {};
  for (const f of fields) {
    brief[f] = {
      content: final[f] || (draft && draft[f]) || "",
      source: "agent",
    };
  }
  // brand_name is the brand identity, not a strategy choice: the client owns it,
  // the director may only challenge (never override). Pulled from the strategist output.
  brief.brand_name = {
    content: ((final && final.brand_name) || (draft && draft.brand_name) || "").trim(),
    source: "user_confirmed",
  };
  return brief;
}

module.exports = { buildStrategy };
