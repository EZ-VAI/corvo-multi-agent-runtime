// Prompt sanitizer — Phase B split into TWO surfaces:
//
//   1. sanitizeClipPrompt (i2v) — STRICT. Used for video clip prompts where
//      the first frame is already locked by the keyframe. Aesthetic words
//      like "extreme macro / shallow DOF / rim light / hero of composition"
//      cannot reframe the locked first frame; they only seed AI artifacts
//      (lens-flare halos, soap-bubble bokeh). So we ban them.
//
//   2. sanitizeKeyframePrompt — LENIENT. Used for keyframe (Gemini /
//      gpt-image) prompts. The image model genuinely controls composition,
//      angle, lighting setup and palette — these aesthetic words are
//      legitimate creative tools here. Only block SI engineering jargon
//      and proven artifact triggers (volumetric, lens flare, halo bloom,
//      starburst, soap-bubble bokeh, anamorphic flare, hyper-realistic, 8k).
//
//   3. sanitizeFreeClipPrompt (t2v) — MEDIUM. Free-mode clips have no first
//      frame; composition words DO take effect. Block SI jargon + the truly
//      destructive artifact triggers, but allow composition language.
//
// `sanitizePrompt` (legacy) = `sanitizeClipPrompt` for back-compat.

const SI_UNIT_PATTERNS = [
  /\d+\s*mm\s*(lens|focal|prime|wide|tele)/gi,
  /\d+\s*fps\b/gi,
  /\d+\s*frames?\s*per\s*second/gi,
  /shutter\s*\d+/gi,
  /iso\s*\d+/gi,
  /f\/?\d+(\.\d+)?\b/gi, // f/2.8, f2.8
];

// Words that produce AI-look artifacts in ANY surface (image OR video).
// Keep this list tight — these are proven artifact triggers, not aesthetic
// preferences.
const HARD_ARTIFACT_BLACKLIST = [
  "volumetric lighting",
  "lens flare",
  "soap-bubble bokeh",
  "anamorphic flare",
  "bloom halo",
  "starburst",
  "cinematic", // memory rule: ban "cinematic" jargon everywhere
  "8k",
  "ultra-realistic",
  "hyper-realistic",
];

// Composition / framing / lighting words that are LEGITIMATE in a keyframe
// prompt (image model can render them) but USELESS-AND-HARMFUL in an i2v
// clip prompt (first frame is locked; words only seed artifacts).
const I2V_ONLY_BLACKLIST = [
  "extreme macro",
  "orbital camera",
  "shallow depth of field",
  "rim light",
  "raking light",
  "hero of composition",
  "dominant in frame",
];

export interface SanitizeResult {
  ok: boolean;
  sanitized: string;
  violations: Array<{ type: string; match: string }>;
}

function runChecks(input: string, blacklists: string[][]): SanitizeResult {
  const violations: Array<{ type: string; match: string }> = [];
  const out = input;

  for (const pat of SI_UNIT_PATTERNS) {
    const matches = out.match(pat);
    if (matches) {
      for (const m of matches) violations.push({ type: "si_unit", match: m });
    }
  }

  const lower = out.toLowerCase();
  for (const list of blacklists) {
    for (const word of list) {
      if (lower.includes(word)) {
        violations.push({ type: "aesthetic_blacklist", match: word });
      }
    }
  }

  return { ok: violations.length === 0, sanitized: out, violations };
}

/** STRICT — for i2v clip prompts (Kling/Seedance with starting frame). */
export function sanitizeClipPrompt(input: string): SanitizeResult {
  return runChecks(input, [HARD_ARTIFACT_BLACKLIST, I2V_ONLY_BLACKLIST]);
}

/** LENIENT — for keyframe (Gemini / gpt-image) prompts. */
export function sanitizeKeyframePrompt(input: string): SanitizeResult {
  return runChecks(input, [HARD_ARTIFACT_BLACKLIST]);
}

/** MEDIUM — for free-mode (t2v) clip prompts; composition words allowed. */
export function sanitizeFreeClipPrompt(input: string): SanitizeResult {
  return runChecks(input, [HARD_ARTIFACT_BLACKLIST]);
}

/** @deprecated Legacy alias = sanitizeClipPrompt (i2v strict). */
export const sanitizePrompt = sanitizeClipPrompt;

// Neutral motion fallback — used after 2 failed retries.
export const NEUTRAL_MOTION_FALLBACK =
  "Subject remains in held composition. Camera is locked. Light is even and natural.";

// Build a SHORT retry feedback message (only the violations from this attempt,
// not the full director prompt — prevents LLM from re-thinking the whole brief).
export function buildRetryFeedback(
  violations: Array<{ type: string; match: string }>,
): string {
  const grouped = violations.reduce((acc, v) => {
    (acc[v.type] ||= []).push(v.match);
    return acc;
  }, {} as Record<string, string[]>);

  const lines: string[] = [];
  if (grouped.si_unit?.length) {
    lines.push(
      `Previous attempt used SI units / engineering numbers: ${grouped.si_unit.join(", ")}. ` +
      `Replace with visual anchors (e.g. "close to the product" not "30mm lens").`,
    );
  }
  if (grouped.aesthetic_blacklist?.length) {
    lines.push(
      `Previous attempt used banned aesthetic words: ${grouped.aesthetic_blacklist.join(", ")}. ` +
      `Use physical descriptions only (e.g. "soft natural light" not "volumetric lighting").`,
    );
  }
  return lines.join(" ");
}
