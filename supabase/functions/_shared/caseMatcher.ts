/**
 * Case Matcher — Per-Product Creative DNA from `creative_cases`
 * ─────────────────────────────────────────────────────────────
 *
 * The 1,036 entries in `shot_breakdowns` give us STATISTICAL biases
 * (jewelry tilts toward macro_corner / chiaroscuro, etc). The 226 rows
 * in `creative_cases` give us SPECIFIC editorial DNA per real winning ad
 * — the kind of detail that makes "AP Royal Oak — octagonal bezel macro"
 * read totally different from "Cartier Love bracelet — wrist ritual".
 *
 * This matcher takes a product context (name, brand, category, material,
 * description) and finds the top-K most relevant cases from the library
 * via trigram-style scoring against `vertical / primary_attribute /
 * sensory_quality / metaphor_universe / specific_metaphor / color_palette`.
 *
 * Each keyframe slot in a project then gets assigned ONE case so the 5
 * shots reference 5 different real-ad DNAs — no two slots collide, and
 * across projects with the same vertical the matched case set differs by
 * product attributes.
 *
 * Reuses the proven trigram approach from `generate-angle-plan` rather
 * than re-inventing semantic search. ~150-300ms per cold start, cached
 * per (product fingerprint) for the lifetime of the edge fn instance.
 *
 * Used by: generate-editorial-keyframes
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.95.0";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface ProductFingerprint {
  productName?: string;
  brandName?: string;
  category?: string;        // free-text (e.g. "rose gold floral bracelet")
  material?: string;
  description?: string;
}

/** A row pulled from `creative_cases` with the fields we need for prompt
 *  injection. Kept narrow on purpose — we only ship the strings the LLM
 *  actually consumes. */
export interface MatchedCase {
  id: string;
  brand: string;
  campaignName: string;
  vertical: string;
  primaryAttribute: string | null;
  sensoryQuality: string | null;
  specificMetaphor: string | null;
  filmableScene: string | null;
  colorPalette: string | null;
  hookVisualDescription: string | null;
  lightingApproach: string | null;
  /** 0..1 similarity score (logged for debugging, not surfaced in prompt). */
  score: number;
}

// ──────────────────────────────────────────────────────────────────────
// Cache — keyed by product fingerprint, lifetime = edge fn cold start.
// ──────────────────────────────────────────────────────────────────────

const CACHE = new Map<string, MatchedCase[]>();

function fingerprintOf(p: ProductFingerprint): string {
  return [p.productName, p.brandName, p.category, p.material]
    .map((s) => (s ?? "").toLowerCase().trim())
    .join("|");
}

// ──────────────────────────────────────────────────────────────────────
// Scoring — same shape as generate-angle-plan, tuned for keyframe match.
// ──────────────────────────────────────────────────────────────────────

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Cheap trigram-ish similarity (token Jaccard). 0..1. */
function tokenSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = a.toLowerCase();
  const B = b.toLowerCase();
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.7;
  const tokA = new Set(A.split(/\W+/).filter(Boolean));
  const tokB = new Set(B.split(/\W+/).filter(Boolean));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) if (tokB.has(t)) inter++;
  return inter / (tokA.size + tokB.size - inter);
}

/** Normalize free-text category to one of the 7 verticals in the DB. Mirrors
 *  shotDNA.normalizeVertical() so the two systems agree on bucket. */
function normalizeVertical(input?: string | null): string {
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

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

const TOP_K = 5;

/**
 * Find the top-K most relevant `creative_cases` for this product.
 * One DB query per cold start per product fingerprint, cached in-memory.
 *
 * Scoring weights (tuned to favour vertical match + attribute relevance):
 *   • exact vertical match → +0.40 (huge — keeps jewelry away from electronics DNA)
 *   • product/category text overlap with case product_type/primary_attribute → +0.25
 *   • brand text overlap with case sensory_quality/metaphor_universe → +0.20
 *   • description text overlap with case specific_metaphor/filmable_scene → +0.15
 *
 * Returns [] on any failure (caller falls back to generic scene pool).
 */
export async function matchCasesForProduct(
  product: ProductFingerprint,
  sb?: SupabaseClient,
): Promise<MatchedCase[]> {
  const key = fingerprintOf(product);
  const cached = CACHE.get(key);
  if (cached) return cached;

  const client =
    sb ??
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY")!,
    );

  const vertical = normalizeVertical(product.category);
  const attribute = `${safeStr(product.category)} ${safeStr(product.material)}`.trim();
  const productText = `${safeStr(product.productName)} ${safeStr(product.description)}`.trim();
  const brandText = safeStr(product.brandName);

  try {
    // Pull all rows in the same vertical (typically 25-50) plus a small cross-
    // vertical sample so unusual products still find SOMETHING relevant.
    const { data, error } = await client
      .from("creative_cases")
      .select(
        "id, brand, campaign_name, vertical, product_type, primary_attribute, sensory_quality, metaphor_universe, specific_metaphor, filmable_scene, color_palette, hook_visual_description, lighting_approach",
      )
      .or(`vertical.eq.${vertical},vertical.eq.luxury_goods`)
      .limit(200);

    if (error || !data || data.length === 0) {
      console.warn("[caseMatcher] DB query empty/failed:", error?.message ?? "no rows");
      CACHE.set(key, []);
      return [];
    }

    const scored = data.map((c: any) => {
      let score = 0;

      // Vertical match — massive weight. We pulled vertical OR luxury_goods,
      // so reward exact match strongly and partial match (luxury_goods) less.
      if (c.vertical && String(c.vertical).toLowerCase() === vertical) {
        score += 0.40;
      } else if (c.vertical === "luxury_goods") {
        score += 0.05;
      }

      // Product/material match against case product_type + primary_attribute.
      const caseProductBlob = `${safeStr(c.product_type)} ${safeStr(c.primary_attribute)}`;
      score += 0.25 * tokenSim(attribute, caseProductBlob);

      // Brand/sensory match.
      const caseSensoryBlob = `${safeStr(c.sensory_quality)} ${safeStr(c.metaphor_universe)}`;
      score += 0.20 * tokenSim(brandText, caseSensoryBlob);

      // Description match against specific_metaphor + filmable_scene.
      const caseSceneBlob = `${safeStr(c.specific_metaphor)} ${safeStr(c.filmable_scene)}`;
      score += 0.15 * tokenSim(productText, caseSceneBlob);

      return { c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOP_K).map(({ c, score }) => ({
      id: String(c.id),
      brand: safeStr(c.brand),
      campaignName: safeStr(c.campaign_name),
      vertical: safeStr(c.vertical),
      primaryAttribute: c.primary_attribute ?? null,
      sensoryQuality: c.sensory_quality ?? null,
      specificMetaphor: c.specific_metaphor ?? null,
      filmableScene: c.filmable_scene ?? null,
      colorPalette: c.color_palette ?? null,
      hookVisualDescription: c.hook_visual_description ?? null,
      lightingApproach: c.lighting_approach ?? null,
      score,
    }));

    console.log(
      `[caseMatcher] vertical=${vertical} matched ${top.length}/${data.length}: ${top
        .map((c) => `${c.brand}/${c.campaignName.slice(0, 24)}@${c.score.toFixed(2)}`)
        .join(" · ")}`,
    );

    CACHE.set(key, top);
    return top;
  } catch (e) {
    console.error(
      "[caseMatcher] failed:",
      e instanceof Error ? e.message : String(e),
    );
    CACHE.set(key, []);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-shot assignment — round-robin across the matched cases so the 5
// keyframes in one project pull from 5 different real-ad DNAs.
// Hash by (shotId, draftId) so two drafts with the same product still
// pick a different starting offset and don't collide visually.
// ──────────────────────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Pick which matched case this shot should reference. Deterministic per
 * (shotId, draftId) so retries land on the same case but different shots
 * in the project rotate across all available cases.
 */
export function caseForShot(
  cases: MatchedCase[],
  shotId: string,
  draftId: string | undefined,
  shotIndex: number,
): MatchedCase | null {
  if (cases.length === 0) return null;
  const offset = hash32(draftId ?? "default") % cases.length;
  const idx = (offset + shotIndex + hash32(shotId)) % cases.length;
  return cases[idx];
}

// ──────────────────────────────────────────────────────────────────────
// Prompt clause — what gets injected into the keyframe prompt.
// Compact (≤500 chars) so it doesn't blow the budget. The model is told
// to USE the case as DNA inspiration, NOT copy specific brand artefacts.
// ──────────────────────────────────────────────────────────────────────

/** Build the inspiration clause for a single shot. Returns "" if no case
 *  matched (caller still has signature scene pool as a floor). */
export function caseInspirationClause(
  c: MatchedCase | null,
  productName: string,
): string {
  if (!c) return "";

  const bits: string[] = [];
  if (c.filmableScene) bits.push(`scene reference — ${truncate(c.filmableScene, 220)}`);
  if (c.specificMetaphor) bits.push(`narrative DNA — ${truncate(c.specificMetaphor, 160)}`);
  if (c.sensoryQuality) bits.push(`sensory anchor — ${truncate(c.sensoryQuality, 120)}`);
  if (c.colorPalette) bits.push(`palette reference — ${c.colorPalette}`);
  if (c.lightingApproach) bits.push(`lighting reference — ${truncate(c.lightingApproach, 120)}`);

  if (bits.length === 0) return "";

  return ` CASE-MATCHED CREATIVE DNA (use as inspiration for composition + mood — NEVER copy brand-specific motifs, product shapes, logos, or named artefacts; the product in this frame must remain ${productName}): ${bits.join("; ")}.`;
}

/** Build a model archetype clause from a case's primary_attribute +
 *  sensory_quality. Replaces the default "a young woman" so two products
 *  matched to different cases get visibly different model energy. */
export function modelArchetypeFromCase(c: MatchedCase | null): string {
  if (!c) return "a young woman";
  const attr = (c.primaryAttribute ?? "").toLowerCase();
  const sensory = (c.sensoryQuality ?? "").toLowerCase();

  // Map common attribute keywords → physical archetype hints. The hints are
  // intentionally short and physical (age range, demeanour, build) — never
  // a name, never a celebrity, never a specific brand reference.
  if (/(rule[- ]?breaking|disrupt|provocative|bold|graphic)/.test(attr)) {
    return "a woman in her late twenties with strong features and a poised, slightly defiant demeanour";
  }
  if (/(architectur|geometric|precision|craft)/.test(attr)) {
    return "a woman in her early thirties with clean angular features and a composed, deliberate stillness";
  }
  if (/(heritage|ritual|devotion|legacy)/.test(attr)) {
    return "a woman in her mid thirties with warm classical features and a quiet, considered presence";
  }
  if (/(seduct|sensual|alive|coil|wrap)/.test(attr) || /(coil|wrap|alive|skin)/.test(sensory)) {
    return "a woman in her late twenties with expressive eyes and a slow, intentional movement quality";
  }
  if (/(question|intellectu|enigma|refuse)/.test(attr)) {
    return "a woman in her early thirties with thoughtful features who never quite looks at the camera";
  }
  if (/(playful|warm|joyful|spontaneous)/.test(attr)) {
    return "a woman in her mid twenties with open warm features and natural unposed gestures";
  }
  if (/(quiet|calm|minimal|austere)/.test(attr)) {
    return "a woman in her early thirties with restrained classical features and minimal expression";
  }
  // Generic fallback — still better than "a young woman" because it varies
  // by case.brand hash so two different cases give two different defaults.
  const seed = hash32(c.id) % 4;
  const variants = [
    "a woman in her late twenties with quiet confident presence",
    "a woman in her early thirties with natural unposed features",
    "a woman in her mid twenties with poised understated demeanour",
    "a woman in her early thirties with calm classical features",
  ];
  return variants[seed];
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
