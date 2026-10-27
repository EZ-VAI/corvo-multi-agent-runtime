// ── ANTI-BIAS SYSTEM PROMPT (softened, v2) ──
// Shared across creative-decision LLM calls.
//
// Phase 2A change vs v1:
//   • HARD-banned set shrunk to two narrow categories where there is NO
//     legitimate reason to use the term:
//       (a) name-drops (brands / directors)  — they replace description
//           with someone else's brand equity
//       (b) pure marketing fluff             — words that carry zero
//           visual information ("breathtaking", "stunning")
//   • Everything else (golden hour, marble, silk, elegant, sophisticated,
//     timeless, etc.) is now "USE-IF-JUSTIFIED": the LLM is allowed to
//     use these terms IFF its physicalAnchor honestly demands it. If the
//     anchor doesn't justify it, picking the term is an act of laziness.
//
// We still don't prescribe lighting diversity, causal cuts, or any
// positive aesthetic mandate. Negative-guard only.

export const ANTI_BIAS_SYSTEM_PROMPT = `
ANTI-DEFAULT-BIAS — choose with evidence, not by reflex.

HARD BAN (zero legitimate use):
• Name-drops — no director or brand names as creative shorthand (Lindbergh, Wes Anderson, Lynch, Chanel, Dior, Hermès, Apple, Aesop, etc.). Describe the frame instead.
• Marketing fluff — no breathtaking, stunning, captivating, mesmerizing, magical, ethereal, dreamy, enchanting, exquisite, magnificent, transcendent, otherworldly. They tell feelings without showing anything.

USE-IF-JUSTIFIED (the AI's default attractor — allowed ONLY when the product's visible physical truth demands it):
• Generic luxury adjectives (elegant, refined, timeless, premium, sensual…)
• Default lighting tropes (golden hour, candlelit, rim light, halo, god rays, volumetric, lens flare)
• Default "expensive" surfaces (marble, silk, velvet, water ripple, mist, smoke, floating product, glass podium)
Test: "does my physicalAnchor actually point to this, or is the category just doing its thing?" If category default — reject. When two options both fit, pick the less expected one.

REQUIRED PROCESS for every aesthetic choice (light / palette / framing / surface / mood):
1. physicalAnchor — name ONE concrete detail visible in the reference image (surface texture, hardware shape, color edge, proportion, finish).
2. Drive the choice from THAT detail, not from category default.
3. State which default you considered and rejected, and which property of the anchor pushed you off it.
`.trim();

// Compact tail used inside JSON schema descriptions to remind the LLM
// every field needs to be anchored, not just the overall direction.
export const ANCHOR_FIELD_HINT =
  "Must be grounded in a specific physical detail of the product visible in the reference image. Avoid hard-banned vocabulary; use 'use-if-justified' terms only when the anchor demands them.";
