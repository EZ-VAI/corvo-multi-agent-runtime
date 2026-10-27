/**
 * SHOT DNA — Data-Driven Style Distributions from `shot_breakdowns`
 * ─────────────────────────────────────────────────────────────────
 *
 * Replaces hardcoded "luxury defaults" (eye-level / macro_corner / soft_diffused
 * everywhere) with the ACTUAL distribution learned from 1,036 award-winning
 * advertising shots in the database. The result: every ad's angle / lighting /
 * framing mix matches what real Cannes-Lions winners do for that vertical,
 * and varies meaningfully across projects instead of all looking the same.
 *
 * One DB hit per generate-* call (cached in-memory per cold start).
 * Falls back to a baked-in vertical baseline if the DB query fails or returns
 * empty (so a cold start with no DB never blocks generation).
 *
 * Used by:
 *   - generate-editorial-keyframes (image-gen prompts)
 *   - generate-blocks              (block plan / cinematography fields)
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.95.0";

/** Enum tags that exist in `shot_breakdowns` after normalize-shot-tags. */
export const ANGLE_TAGS = [
  "front_three_quarter", "profile_side", "back_detail", "top_down",
  "low_hero", "macro_corner", "overhead_flat_lay", "front_centered",
  "environmental_wide",
] as const;
export const LIGHTING_TAGS = [
  "hard_directional", "soft_diffused", "golden_hour", "window_natural",
  "clinical_white", "dark_moody", "spotlight", "backlit",
  "practical_mixed", "high_key",
] as const;
export const FRAMING_INTENTS = [
  "hero", "detail", "context", "transition", "human_emotion",
] as const;

export type AngleTag = typeof ANGLE_TAGS[number];
export type LightingTag = typeof LIGHTING_TAGS[number];
export type FramingIntent = typeof FRAMING_INTENTS[number];

/** A single dimension's distribution for a vertical: tag → percentage (0..100). */
export type Distribution<T extends string> = Array<{ tag: T; pct: number; n: number }>;

export interface ShotDNA {
  vertical: string;
  /** Sample size that produced this distribution. */
  sampleSize: number;
  /** Whether this came from the DB or from the baked fallback. */
  source: "db" | "fallback";
  angles: Distribution<AngleTag>;
  lighting: Distribution<LightingTag>;
  framing: Distribution<FramingIntent>;
}

// ── Baked fallback distributions (computed offline from current DB snapshot). ──
// Used only if the DB query fails or returns nothing for the vertical.
// Keep this small — it's a safety net, not the source of truth.
const FALLBACK_BY_VERTICAL: Record<string, Pick<ShotDNA, "angles" | "lighting" | "framing">> = {
  fashion: {
    angles: [
      { tag: "macro_corner", pct: 32, n: 84 },
      { tag: "front_centered", pct: 18, n: 46 },
      { tag: "environmental_wide", pct: 15, n: 40 },
      { tag: "low_hero", pct: 14, n: 36 },
      { tag: "front_three_quarter", pct: 13, n: 34 },
      { tag: "profile_side", pct: 7, n: 19 },
      { tag: "top_down", pct: 5, n: 14 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 47, n: 139 },
      { tag: "hard_directional", pct: 17, n: 51 },
      { tag: "practical_mixed", pct: 9, n: 28 },
      { tag: "window_natural", pct: 6, n: 18 },
      { tag: "golden_hour", pct: 6, n: 17 },
      { tag: "spotlight", pct: 5, n: 16 },
    ],
    framing: [
      { tag: "detail", pct: 47, n: 139 },
      { tag: "human_emotion", pct: 19, n: 57 },
      { tag: "hero", pct: 17, n: 49 },
      { tag: "context", pct: 16, n: 46 },
    ],
  },
  beauty: {
    angles: [
      { tag: "macro_corner", pct: 35, n: 64 },
      { tag: "front_centered", pct: 18, n: 32 },
      { tag: "front_three_quarter", pct: 13, n: 23 },
      { tag: "top_down", pct: 11, n: 19 },
      { tag: "low_hero", pct: 9, n: 17 },
      { tag: "environmental_wide", pct: 8, n: 14 },
      { tag: "profile_side", pct: 6, n: 12 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 58, n: 113 },
      { tag: "practical_mixed", pct: 11, n: 21 },
      { tag: "hard_directional", pct: 8, n: 16 },
      { tag: "spotlight", pct: 8, n: 15 },
      { tag: "golden_hour", pct: 4, n: 7 },
    ],
    framing: [
      { tag: "detail", pct: 60, n: 115 },
      { tag: "human_emotion", pct: 20, n: 39 },
      { tag: "context", pct: 10, n: 19 },
      { tag: "hero", pct: 10, n: 19 },
    ],
  },
  jewelry: {
    angles: [
      { tag: "macro_corner", pct: 35, n: 43 },
      { tag: "low_hero", pct: 16, n: 20 },
      { tag: "environmental_wide", pct: 14, n: 17 },
      { tag: "front_three_quarter", pct: 11, n: 14 },
      { tag: "front_centered", pct: 7, n: 9 },
      { tag: "profile_side", pct: 7, n: 8 },
      { tag: "top_down", pct: 5, n: 6 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 43, n: 53 },
      { tag: "hard_directional", pct: 15, n: 19 },
      { tag: "golden_hour", pct: 14, n: 17 },
      { tag: "spotlight", pct: 11, n: 13 },
      { tag: "dark_moody", pct: 6, n: 7 },
    ],
    framing: [
      { tag: "detail", pct: 56, n: 67 },
      { tag: "hero", pct: 18, n: 22 },
      { tag: "human_emotion", pct: 15, n: 18 },
      { tag: "context", pct: 12, n: 14 },
    ],
  },
  fragrance: {
    angles: [
      { tag: "environmental_wide", pct: 22, n: 38 },
      { tag: "macro_corner", pct: 17, n: 30 },
      { tag: "low_hero", pct: 16, n: 27 },
      { tag: "front_centered", pct: 15, n: 26 },
      { tag: "front_three_quarter", pct: 15, n: 26 },
      { tag: "profile_side", pct: 7, n: 12 },
      { tag: "top_down", pct: 4, n: 7 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 43, n: 76 },
      { tag: "golden_hour", pct: 18, n: 31 },
      { tag: "practical_mixed", pct: 14, n: 25 },
      { tag: "hard_directional", pct: 8, n: 14 },
      { tag: "backlit", pct: 6, n: 11 },
    ],
    framing: [
      { tag: "detail", pct: 33, n: 58 },
      { tag: "human_emotion", pct: 26, n: 45 },
      { tag: "context", pct: 23, n: 40 },
      { tag: "hero", pct: 17, n: 30 },
    ],
  },
  skincare: {
    angles: [
      { tag: "macro_corner", pct: 40, n: 32 },
      { tag: "front_centered", pct: 19, n: 15 },
      { tag: "low_hero", pct: 10, n: 8 },
      { tag: "front_three_quarter", pct: 10, n: 8 },
      { tag: "top_down", pct: 9, n: 7 },
      { tag: "overhead_flat_lay", pct: 6, n: 5 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 64, n: 53 },
      { tag: "backlit", pct: 11, n: 9 },
      { tag: "hard_directional", pct: 5, n: 4 },
    ],
    framing: [
      { tag: "detail", pct: 66, n: 55 },
      { tag: "hero", pct: 24, n: 20 },
      { tag: "context", pct: 6, n: 5 },
      { tag: "human_emotion", pct: 4, n: 3 },
    ],
  },
  electronics: {
    angles: [
      { tag: "macro_corner", pct: 23, n: 15 },
      { tag: "low_hero", pct: 20, n: 13 },
      { tag: "front_centered", pct: 19, n: 12 },
      { tag: "front_three_quarter", pct: 14, n: 9 },
      { tag: "top_down", pct: 14, n: 9 },
      { tag: "profile_side", pct: 8, n: 5 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 56, n: 37 },
      { tag: "hard_directional", pct: 15, n: 10 },
      { tag: "practical_mixed", pct: 11, n: 7 },
    ],
    framing: [
      { tag: "detail", pct: 69, n: 45 },
      { tag: "hero", pct: 18, n: 12 },
      { tag: "context", pct: 9, n: 6 },
    ],
  },
  luxury_goods: {
    angles: [
      { tag: "macro_corner", pct: 30, n: 30 },
      { tag: "low_hero", pct: 19, n: 19 },
      { tag: "environmental_wide", pct: 17, n: 17 },
      { tag: "front_centered", pct: 12, n: 12 },
      { tag: "front_three_quarter", pct: 8, n: 8 },
      { tag: "top_down", pct: 6, n: 6 },
    ],
    lighting: [
      { tag: "soft_diffused", pct: 58, n: 57 },
      { tag: "hard_directional", pct: 12, n: 12 },
      { tag: "clinical_white", pct: 7, n: 7 },
      { tag: "practical_mixed", pct: 7, n: 7 },
      { tag: "spotlight", pct: 5, n: 5 },
    ],
    framing: [
      { tag: "detail", pct: 50, n: 50 },
      { tag: "context", pct: 18, n: 18 },
      { tag: "hero", pct: 16, n: 16 },
      { tag: "human_emotion", pct: 16, n: 16 },
    ],
  },
};

// Cross-vertical fallback (used when vertical is unknown / not in DB).
const GLOBAL_FALLBACK: Pick<ShotDNA, "angles" | "lighting" | "framing"> = {
  angles: [
    { tag: "macro_corner", pct: 30, n: 298 },
    { tag: "front_centered", pct: 16, n: 152 },
    { tag: "low_hero", pct: 14, n: 140 },
    { tag: "environmental_wide", pct: 13, n: 131 },
    { tag: "front_three_quarter", pct: 12, n: 122 },
    { tag: "top_down", pct: 7, n: 68 },
    { tag: "profile_side", pct: 6, n: 59 },
  ],
  lighting: [
    { tag: "soft_diffused", pct: 51, n: 528 },
    { tag: "hard_directional", pct: 12, n: 126 },
    { tag: "practical_mixed", pct: 9, n: 97 },
    { tag: "golden_hour", pct: 7, n: 77 },
    { tag: "spotlight", pct: 6, n: 62 },
    { tag: "window_natural", pct: 3, n: 35 },
  ],
  framing: [
    { tag: "detail", pct: 51, n: 529 },
    { tag: "human_emotion", pct: 17, n: 177 },
    { tag: "hero", pct: 16, n: 168 },
    { tag: "context", pct: 14, n: 148 },
  ],
};

// ── In-memory cache (per cold start). ──
const CACHE = new Map<string, ShotDNA>();

/**
 * Normalize a free-text vertical/category string to one of the 7 canonical
 * verticals in the DB. Anything unknown falls back to "luxury_goods" (the
 * most generic of the seven, since it's the biggest catch-all).
 */
export function normalizeVertical(input?: string | null): string {
  if (!input) return "luxury_goods";
  const s = input.toLowerCase().trim();
  if (/(beauty|cosmetic|makeup|lipstick|mascara|foundation|blush)/.test(s)) return "beauty";
  if (/(skincare|skin care|serum|moisturi[zs]er|cream|lotion|cleanser|sunscreen)/.test(s)) return "skincare";
  if (/(fragrance|perfume|cologne|eau de|scent)/.test(s)) return "fragrance";
  if (/(jewelry|jewellery|ring|earring|necklace|bracelet|pendant|watch|gem|diamond)/.test(s)) return "jewelry";
  if (/(electronics|tech|gadget|phone|laptop|headphone|speaker|camera|drone|wearable tech)/.test(s)) return "electronics";
  if (/(fashion|apparel|clothing|dress|jacket|coat|shirt|pants|jeans|shoe|sneaker|handbag|bag)/.test(s)) return "fashion";
  return "luxury_goods";
}

/**
 * Fetch the angle / lighting / framing distribution for a vertical, learned
 * from real winning ads. One query, three GROUP BYs in parallel.
 *
 * Cached in-memory for the lifetime of the edge fn instance — typically
 * the first call in a cold start pays the ~150-300ms; subsequent calls are
 * synchronous map lookups.
 */
export async function getShotDNA(
  rawVertical: string | null | undefined,
  sb?: SupabaseClient,
): Promise<ShotDNA> {
  const vertical = normalizeVertical(rawVertical);
  const cached = CACHE.get(vertical);
  if (cached) return cached;

  const client = sb ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  try {
    // Fetch all tagged shots for the vertical in ONE query, then bucket in JS.
    // Cheaper than 3 round-trips and the row count is bounded (< 500/vertical).
    const { data, error } = await client
      .from("shot_breakdowns")
      .select("angle_tag,lighting_tag,framing_intent,case_id,creative_cases!inner(vertical)")
      .eq("creative_cases.vertical", vertical)
      .not("angle_tag", "is", null)
      .limit(2000);

    if (error || !data || data.length === 0) {
      return cacheAndReturn(vertical, "fallback", FALLBACK_BY_VERTICAL[vertical] ?? GLOBAL_FALLBACK, 0);
    }

    const angles = bucketize<AngleTag>(data.map(r => r.angle_tag), ANGLE_TAGS, ["off_screen"]);
    const lighting = bucketize<LightingTag>(data.map(r => r.lighting_tag), LIGHTING_TAGS, []);
    const framing = bucketize<FramingIntent>(data.map(r => r.framing_intent), FRAMING_INTENTS, []);

    return cacheAndReturn(vertical, "db", { angles, lighting, framing }, data.length);
  } catch (e) {
    console.error("[shotDNA] DB query failed, using fallback:", e instanceof Error ? e.message : e);
    return cacheAndReturn(vertical, "fallback", FALLBACK_BY_VERTICAL[vertical] ?? GLOBAL_FALLBACK, 0);
  }
}

function cacheAndReturn(
  vertical: string,
  source: "db" | "fallback",
  dist: Pick<ShotDNA, "angles" | "lighting" | "framing">,
  sampleSize: number,
): ShotDNA {
  const dna: ShotDNA = { vertical, source, sampleSize, ...dist };
  CACHE.set(vertical, dna);
  return dna;
}

function bucketize<T extends string>(
  raw: Array<string | null>,
  allowedTags: readonly T[],
  excludeTags: string[],
): Distribution<T> {
  const counts = new Map<T, number>();
  let total = 0;
  const allowed = new Set<string>(allowedTags as readonly string[]);
  const excluded = new Set(excludeTags);
  for (const r of raw) {
    if (!r || excluded.has(r) || !allowed.has(r)) continue;
    counts.set(r as T, (counts.get(r as T) ?? 0) + 1);
    total++;
  }
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([tag, n]) => ({ tag, n, pct: Math.round((n / total) * 100) }))
    .sort((a, b) => b.n - a.n);
}

// ─────────────────────────────────────────────────────────────────────────
//  PROMPT-FRIENDLY HELPERS
// ─────────────────────────────────────────────────────────────────────────

/** Human-readable label for an angle tag (used in prompts). */
const ANGLE_LABELS: Record<AngleTag, string> = {
  front_three_quarter: "front three-quarter (the iconic editorial 3/4 view)",
  profile_side: "side profile",
  back_detail: "from behind / back-detail angle",
  top_down: "top-down looking down on the subject",
  low_hero: "low hero angle (camera low, looking up — power)",
  macro_corner: "macro corner detail (extreme close-up on a single edge or feature)",
  overhead_flat_lay: "overhead flat-lay",
  front_centered: "front-on, centred composition",
  environmental_wide: "environmental wide (subject small in its world)",
};
const LIGHT_LABELS: Record<LightingTag, string> = {
  hard_directional: "hard directional key with sculpted shadows",
  soft_diffused: "soft diffused key, gentle shadows",
  golden_hour: "golden-hour warm raking light",
  window_natural: "natural window light",
  clinical_white: "clean clinical white light",
  dark_moody: "dark moody low-key with deep shadows",
  spotlight: "single spotlight on the subject, surroundings dropping to black",
  backlit: "backlit silhouette / rim light",
  practical_mixed: "mixed practical sources (lamps, screens, neon)",
  high_key: "bright high-key, near-shadowless",
};
const FRAMING_LABELS: Record<FramingIntent, string> = {
  hero: "HERO — product or talent commands the frame",
  detail: "DETAIL — close, focused on a single feature or texture",
  context: "CONTEXT — show the environment / world the product lives in",
  transition: "TRANSITION — bridge from previous shot",
  human_emotion: "HUMAN EMOTION — face / gesture / reaction is the subject",
};

/** Pick top N tags. */
function top<T extends string>(d: Distribution<T>, n: number): Distribution<T> {
  return d.slice(0, n);
}

/**
 * Build a compact prompt clause that tells the model:
 *   "for this vertical, real winning ads use angles X (40%), Y (25%), Z (15%);
 *    bias your selection to that distribution but don't repeat the same shot."
 *
 * Used by generate-blocks (LLM directing). The model uses this to pick
 * cinematography fields per block in a way that statistically matches what
 * actually wins for that category.
 */
export function shotDnaDirectorClause(dna: ShotDNA): string {
  const a = top(dna.angles, 5).map(d => `${labelAngle(d.tag)} ${d.pct}%`).join(", ");
  const l = top(dna.lighting, 4).map(d => `${labelLight(d.tag)} ${d.pct}%`).join(", ");
  const f = top(dna.framing, 4).map(d => `${labelFraming(d.tag)} ${d.pct}%`).join(", ");
  const provenance = dna.source === "db"
    ? `Learned from ${dna.sampleSize} shots in award-winning ${dna.vertical} campaigns.`
    : `Baseline distribution for ${dna.vertical} (DB unavailable).`;
  return `\nDATA-DRIVEN SHOT DNA — ${dna.vertical.toUpperCase()} (USE AS YOUR DISTRIBUTION TARGET):
${provenance}
ANGLES (target distribution): ${a}.
LIGHTING (target distribution): ${l}.
FRAMING INTENT (target distribution): ${f}.
HOW TO USE: Across the full block sequence, your chosen cameraAngle/lighting/composition values should ROUGHLY MATCH this distribution — not match it exactly, but bias selection toward what actually works for this category. Specifically:
 • Treat the highest-percentage angle as your baseline, but mix in 3-4 other angles across the sequence — never use the same angle for >2 adjacent blocks.
 • Lighting style should anchor on the dominant tag but vary across scene transitions.
 • Framing intent should follow the rhythm of the narrative (hero ↔ detail ↔ context ↔ human_emotion) — do not stack >2 detail-only blocks in a row.
This is not optional flavour — it's the empirical signature of what wins in this vertical.`;
}

/**
 * Sample a single angle for a SHOT-LEVEL image-gen prompt
 * (generate-editorial-keyframes). Deterministic per shotId so re-runs of the
 * same shot keep the same angle, but different shots in the same project
 * land on different angles in proportion to the distribution.
 */
export function sampleAngleForShot(dna: ShotDNA, shotId: string): {
  tag: AngleTag;
  label: string;
} {
  // Deterministic 0..99 hash of shotId.
  let h = 0;
  for (let i = 0; i < shotId.length; i++) h = (h * 31 + shotId.charCodeAt(i)) | 0;
  const r = Math.abs(h) % 100;

  let cum = 0;
  for (const d of dna.angles) {
    cum += d.pct;
    if (r < cum) return { tag: d.tag, label: labelAngle(d.tag) };
  }
  // Distribution didn't sum to 100 (rounding); use the top tag as final fallback.
  const top0 = dna.angles[0] ?? { tag: "front_three_quarter" as AngleTag };
  return { tag: top0.tag, label: labelAngle(top0.tag) };
}

/**
 * Compact per-shot DNA clause for an image-gen prompt. Unlike the director
 * clause, this names ONE specific angle + lighting bias + framing intent for
 * the current shot only.
 */
export function shotDnaPromptClause(
  dna: ShotDNA,
  shotId: string,
  framingHint?: FramingIntent,
): string {
  const a = sampleAngleForShot(dna, shotId);
  const l = top(dna.lighting, 1)[0];
  const f = framingHint ?? top(dna.framing, 1)[0]?.tag ?? "detail";
  const lightLabel = l ? labelLight(l.tag) : "soft diffused key";
  const framingLabel = labelFraming(f);
  return ` SHOT DNA for this frame (learned from real ${dna.vertical} winners): use ${a.label}, dominant lighting style for this category is ${lightLabel}, framing intent: ${framingLabel}.`;
}

function labelAngle(t: AngleTag): string { return ANGLE_LABELS[t] ?? t; }
function labelLight(t: LightingTag): string { return LIGHT_LABELS[t] ?? t; }
function labelFraming(t: FramingIntent): string { return FRAMING_LABELS[t] ?? t; }
