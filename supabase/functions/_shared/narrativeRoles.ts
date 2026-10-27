// ── narrativeRoles.ts ──
// Functional definitions for the 6-role narrative vocabulary used by
// agent-chat's two-stage generate_keyframes. Each role carries a one-line
// FUNCTIONAL definition (what the shot DOES, not what it shows) so the LLM
// can't drift into "atmosphere = pretty environment shot of the dressing
// table". Plus BAD/GOOD examples and a validator the agent uses to ensure
// the produced 8-shot list actually forms a wave.

export type NarrativeRole =
  | "hook"
  | "atmosphere"
  | "reveal"
  | "interaction"
  | "detail"
  | "resolve";

export const NARRATIVE_ROLES: NarrativeRole[] = [
  "hook",
  "atmosphere",
  "reveal",
  "interaction",
  "detail",
  "resolve",
];

export const NARRATIVE_ROLE_DEFINITIONS = `
NARRATIVE ROLES — what each shot DOES (not what it shows):

• hook        — Pull the viewer in within 0.5s using an UNEXPECTED entry
                 point. Product is usually ABSENT or peripheral. Tension /
                 fragment / gesture / sound-implied. Never a hero product
                 shot. Never a centred macro of the product.
• atmosphere  — Establish the WORLD the product lives in BEFORE we see it
                 clearly. Wide / environmental. Product is small,
                 off-frame, or hidden. Communicates mood + context, not
                 the product itself.
• reveal      — The HERO frame. First clear, recognisable view of the
                 product as the centre of meaning. Confident framing,
                 deliberate composition.
• interaction — Human + product in CAUSAL relationship (using, applying,
                 wearing, opening). Shows the product's verb.
• detail      — ECU / macro on ONE specific physical feature being sold
                 (texture, hardware, finish, edge). NO full product. NO
                 humans unless the human IS the surface (skin, lips).
• resolve     — Emotional aftermath. Reaction shot, signature texture
                 payoff, or a calm "after" frame. Closes the wave.

A real wave for 8 shots = hook → atmosphere → reveal → interaction →
detail → interaction → detail → resolve. Variations are fine, but the
SHAPE must arc. 8 product macros at varying angles is NOT a wave.
`.trim();

export const NARRATIVE_BAD_GOOD_EXAMPLES = `
EXAMPLES — what the role MUST do (and what fails it):

hook
  ❌ "Centred macro of the lipstick on a marble vanity, soft Paris light"
     (this is reveal+detail dressed up — there's no tension, no entry
     point, the product is the subject)
  ✅ "EXTREME CLOSE-UP of a single fingertip pressing into red wax,
     the wax yields and leaves a thumbprint indent — we don't yet see
     it's lipstick"

atmosphere
  ❌ "Lipstick on a marble vanity next to a poetry book and flowers,
     soft window light"  (product centred = not atmosphere, that's a
     resolve still-life)
  ✅ "WIDE: bedroom in pre-dawn blue, curtain breathing, a single
     warm lamp on the vanity in the far background — product
     invisible at this distance"

reveal
  ❌ "Hand picks up the lipstick"  (that's interaction, not reveal —
     reveal needs deliberate hero framing)
  ✅ "MEDIUM SHOT: lipstick stands upright on the vanity, shaft of
     window light hits the engraved cap, camera holds — first time
     we see it whole and named"

interaction
  ❌ "Lipstick floats above an outstretched palm"  (no causal verb)
  ✅ "OVER-THE-SHOULDER: woman twists the base, the bullet rises;
     her wrist follows the click"

detail
  ❌ "Close-up of woman applying lipstick to her lower lip"  (that's
     interaction with macro framing — detail = product surface alone)
  ✅ "ECU of the bullet's bevelled tip — ridges left by the cut,
     pigment catching at the edge"

resolve
  ❌ "Portrait of woman, perfect makeup, looking at camera"  (that's a
     reveal of the result — resolve carries emotional aftermath, not
     a beauty plate)
  ✅ "MCU: she presses her lips together, holds, then a small almost-
     private smile breaks — eyes lower, scene exhales"
`.trim();

/** Stage 1 output schema description for the LLM. */
export const NARRATIVE_PLAN_SCHEMA_HINT = `
Return ONLY valid JSON, no prose:
{
  "narrativeType": "<one of the keys provided in NARRATIVE STRUCTURE LIBRARY, or 'mixed_approach'>",
  "anchor": "<one concrete physical detail of THIS product the wave hinges on>",
  "fiveBeatSkeleton": [
    { "beat": 1, "role": "hook",        "intent": "<what this beat DOES for the viewer in one sentence — not what it shows>" },
    { "beat": 2, "role": "atmosphere",  "intent": "..." },
    { "beat": 3, "role": "reveal",      "intent": "..." },
    { "beat": 4, "role": "interaction", "intent": "..." },
    { "beat": 5, "role": "resolve",     "intent": "..." }
  ]
}
Roles in the skeleton MAY repeat or substitute (interaction/detail are
interchangeable inside the wave) but beats 1, 2, 3, last MUST carry the
hook/atmosphere/reveal/resolve functions respectively.
`.trim();

/** Stage 2 output schema description for the LLM. */
export const NARRATIVE_SHOTS_SCHEMA_HINT = `
Return ONLY valid JSON, no prose:
{
  "shots": [
    {
      "beatRef": <1-5 — which skeleton beat this shot expands>,
      "narrativeRole": "hook|atmosphere|reveal|interaction|detail|resolve",
      "shot": "<one paragraph in the user's product language — MUST explicitly state subject (atmosphere|product|human|detail), framing (ECU|CU|MCU|MS|WS|EWS|OTS|profile|top-down|low-hero), camera angle, and ONE concrete physical action. Honour the role's FUNCTION above all else.>"
    }
    // ... N entries total, where N = num_keyframes the user requested
  ]
}
Hard rules for the shots[] array:
• Shot 1 MUST have narrativeRole = "hook" or "atmosphere".
• The LAST shot MUST have narrativeRole = "resolve".
• At least 4 distinct narrativeRole values must appear across all shots.
• No two consecutive shots may share the same narrativeRole.
• "hook" and "atmosphere" shots MUST NOT be a centred hero product macro.
`.trim();

export interface PlannedShot {
  beatRef?: number;
  narrativeRole: NarrativeRole | string;
  shot: string;
}

export interface NarrativeValidationIssue {
  index: number;
  reason: string;
}

/**
 * Lightweight server-side check on Stage 2 output. Returns an empty array
 * if the wave is acceptable, otherwise a list of issues. We DO NOT throw —
 * caller decides whether to ask Stage 2 for a targeted rewrite or accept
 * the imperfect wave.
 */
export function validateNarrativeShots(
  shots: PlannedShot[],
): NarrativeValidationIssue[] {
  const issues: NarrativeValidationIssue[] = [];
  if (!Array.isArray(shots) || shots.length === 0) {
    return [{ index: -1, reason: "no shots produced" }];
  }
  const roles = shots.map((s) =>
    String(s?.narrativeRole || "").toLowerCase().trim()
  );

  // Rule 1: shot 1 must be hook or atmosphere
  if (roles[0] !== "hook" && roles[0] !== "atmosphere") {
    issues.push({
      index: 0,
      reason: `first shot role is "${roles[0]}" — must be hook or atmosphere`,
    });
  }

  // Rule 2: last shot must be resolve
  const lastIdx = roles.length - 1;
  if (lastIdx > 1 && roles[lastIdx] !== "resolve") {
    issues.push({
      index: lastIdx,
      reason: `last shot role is "${roles[lastIdx]}" — must be resolve`,
    });
  }

  // Rule 3: ≥4 distinct roles when shots ≥ 5
  if (shots.length >= 5) {
    const distinct = new Set(roles).size;
    if (distinct < 4) {
      issues.push({
        index: -1,
        reason: `only ${distinct} distinct narrativeRole values across ${shots.length} shots — need ≥4`,
      });
    }
  }

  // Rule 4: no two consecutive shots share the same role
  for (let i = 1; i < roles.length; i++) {
    if (roles[i] && roles[i] === roles[i - 1]) {
      issues.push({
        index: i,
        reason: `shot ${i + 1} repeats previous role "${roles[i]}" — break the pattern`,
      });
    }
  }

  return issues;
}

/**
 * Compact role hint we paste into the per-shot image prompt body so
 * gemini-3-pro-image-preview honours the role's FUNCTION (not just the
 * shot text). Kept short so it doesn't dilute attention from the
 * compositing / fidelity guards.
 */
export function roleWritingConstraint(role: string): string {
  switch (String(role || "").toLowerCase().trim()) {
    case "hook":
      return "NARRATIVE ROLE — HOOK: unexpected entry point; product peripheral or absent; create tension, NOT a centred hero macro.";
    case "atmosphere":
      return "NARRATIVE ROLE — ATMOSPHERE: wide environmental establishing shot; product small / off-frame / hidden; sells the WORLD, not the SKU.";
    case "reveal":
      return "NARRATIVE ROLE — REVEAL: deliberate hero framing; first clear, confident view of the whole product as the centre of meaning.";
    case "interaction":
      return "NARRATIVE ROLE — INTERACTION: human + product in a causal verb (using, applying, wearing, opening); show the product DOING its job.";
    case "detail":
      return "NARRATIVE ROLE — DETAIL: ECU / macro on ONE physical feature only; no full product, no humans unless the human IS the surface.";
    case "resolve":
      return "NARRATIVE ROLE — RESOLVE: emotional aftermath; reaction or signature texture payoff; quiet exhale that closes the wave.";
    default:
      return "";
  }
}
