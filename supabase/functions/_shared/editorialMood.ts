/**
 * Editorial Mood Schema (controlled enums)
 * ─────────────────────────────────────────
 * Replaces the old free-text `vibe` / `texture` strings — which the image
 * model was literalizing into water / fire / smoke — with three controlled
 * axes: emotional tone, lighting mood, palette hint.
 *
 * Image / video prompts only ever read the enum-derived clauses below. They
 * do NOT read the user-facing free-text vibe/texture (those stay in the UI
 * for the user but are never injected into a visual prompt).
 *
 * VO scripts still read the free-text `narrative` / `goal` since text
 * generation can't hallucinate a "literal water bowl" out of an abstract mood.
 */

export const EMOTIONAL_TONES = [
  "quiet-confident",
  "playful-warm",
  "austere-luxe",
  "raw-honest",
  "dreamlike-soft",
  "bold-graphic",
] as const;
export type EmotionalTone = (typeof EMOTIONAL_TONES)[number];

export const LIGHTING_MOODS = [
  "soft-daylight",
  "low-warm-lamp",
  "hard-north-light",
  "golden-hour",
  "overcast-diffuse",
  "single-source-dramatic",
] as const;
export type LightingMood = (typeof LIGHTING_MOODS)[number];

export const PALETTE_HINTS = [
  "warm-neutrals",
  "cool-monochrome",
  "earthy-muted",
  "high-contrast-bw",
  "pastel-soft",
  "saturated-jewel",
] as const;
export type PaletteHint = (typeof PALETTE_HINTS)[number];

export interface EditorialMoodEnums {
  emotionalTone?: EmotionalTone;
  lightingMood?: LightingMood;
  paletteHint?: PaletteHint;
}

/** Defensive coercion: snap an arbitrary string to the nearest allowed enum
 *  value, falling back to a safe default. Lets us be liberal in what we accept
 *  from old drafts / LLM outputs without breaking downstream prompts. */
export function coerceEmotionalTone(v: unknown): EmotionalTone {
  if (typeof v === "string" && (EMOTIONAL_TONES as readonly string[]).includes(v)) {
    return v as EmotionalTone;
  }
  return "quiet-confident";
}
export function coerceLightingMood(v: unknown): LightingMood {
  if (typeof v === "string" && (LIGHTING_MOODS as readonly string[]).includes(v)) {
    return v as LightingMood;
  }
  return "soft-daylight";
}
export function coercePaletteHint(v: unknown): PaletteHint {
  if (typeof v === "string" && (PALETTE_HINTS as readonly string[]).includes(v)) {
    return v as PaletteHint;
  }
  return "warm-neutrals";
}

const EMOTIONAL_TONE_CLAUSE: Record<EmotionalTone, string> = {
  "quiet-confident": "composed, restrained, no theatrics — subject sits in the frame with self-assurance",
  "playful-warm": "warm, easy, lightly imperfect — natural smile, relaxed posture, candid energy",
  "austere-luxe": "spare, deliberate, expensive negative space — no clutter, every element earns its place",
  "raw-honest": "documentary, unretouched, real skin and real fabric — no glamour lighting, no idealisation",
  "dreamlike-soft": "gentle haze of memory — diffused edges, slow tempo, slightly out-of-time feel",
  "bold-graphic": "high contrast, decisive composition, strong shapes and lines — magazine-cover energy",
};

const LIGHTING_MOOD_CLAUSE: Record<LightingMood, string> = {
  "soft-daylight": "soft window daylight, broad and gentle, neutral white balance",
  "low-warm-lamp": "low-level warm lamp light, ~2700K, contained pool of light, deep shadows around it",
  "hard-north-light": "hard cool north window light, crisp shadows, neutral cool white balance",
  "golden-hour": "low golden-hour sun, long warm raking light, no orange filter",
  "overcast-diffuse": "overcast sky diffused light, even and shadowless, flat contrast",
  "single-source-dramatic": "one decisive light source from the side, deep shadow on the opposite half",
};

const PALETTE_HINT_CLAUSE: Record<PaletteHint, string> = {
  "warm-neutrals": "warm neutral palette — bone, sand, warm grey, muted ochre",
  "cool-monochrome": "cool near-monochrome palette — slate, fog, charcoal, hint of blue",
  "earthy-muted": "earthy muted palette — clay, moss, terracotta, soft brown",
  "high-contrast-bw": "near black-and-white with a single restrained accent",
  "pastel-soft": "soft pastel palette — chalk pink, pale lilac, washed mint, all desaturated",
  "saturated-jewel": "deep saturated jewel tones — emerald, sapphire, garnet, against neutral ground",
};

/** Build the safe, abstract mood clause that gets injected into image/video
 *  prompts. Output is purely descriptive of mood/lighting/palette — it never
 *  contains nouns the model could hallucinate as physical objects. */
export function buildSafeMoodClause(enums: EditorialMoodEnums | undefined): string {
  if (!enums) return "";
  const bits: string[] = [];
  if (enums.emotionalTone) bits.push(`tone — ${EMOTIONAL_TONE_CLAUSE[enums.emotionalTone]}`);
  if (enums.lightingMood) bits.push(`light — ${LIGHTING_MOOD_CLAUSE[enums.lightingMood]}`);
  if (enums.paletteHint) bits.push(`palette — ${PALETTE_HINT_CLAUSE[enums.paletteHint]}`);
  if (bits.length === 0) return "";
  return ` MOOD (abstract — interpret as styling, not as physical objects): ${bits.join("; ")}.`;
}
