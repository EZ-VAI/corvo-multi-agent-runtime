// Shared product-fidelity preamble for generate-keyframe.
//
// Single source of truth for the hard fidelity guards. Both the canonical
// shot_schema branch and the legacy block branch call this — do NOT inline
// these strings anywhere else or they will drift.
//
// Structure (kept intentionally short — too-dense preambles get ignored
// by Gemini image models):
//   a. NON_APPAREL_1_1_LOCK   — only when productCategory ∈ non-apparel set
//   b. REFERENCE IMAGE AUTHORITY clause — always (when refs > 0)
//   c. PHYSICAL_SCALE guard   — always (when refs > 0)
//
// Intentionally OMITTED for this pass: PHYSICAL_REALISM, PRODUCT_FOCUS.
// Add only after the minimal set is confirmed effective in production.

import { PHYSICAL_SCALE_GUARD } from "./realismGuards.ts";

export const NON_APPAREL_CATEGORIES: ReadonlySet<string> = new Set([
  "cosmetics", "beauty", "fragrance", "skincare", "makeup",
  "jewelry", "watch", "watches", "accessory", "accessories",
  "electronics", "tech", "device", "gadget",
  "food", "beverage", "drink", "spirits", "wine",
  "homegoods", "home", "decor", "furniture",
  "supplement", "wellness", "personal-care",
]);

export interface FidelityPreambleInput {
  /** canonical shot_schema (preferred) or null for legacy callers */
  shot?: { generationMode?: string; category?: string; productCategory?: string } | null;
  /** explicit category signal already resolved by caller; takes precedence over shot.* */
  productCategory?: string | null;
  /** post-fetch base64 refs that actually made it through */
  validProductImages: string[];
}

export interface FidelityPreambleResult {
  /** The assembled preamble string to prepend BEFORE the original creative prompt */
  text: string;
  /** Whether the non-apparel 1:1 lock was applied */
  isNonApparel: boolean;
  /** Resolved category, or null if unresolved */
  resolvedCategory: string | null;
  /** True iff any preamble text was emitted */
  applied: boolean;
}

const NON_APPAREL_1_1_LOCK = `
NON-APPAREL 1:1 REPRODUCTION LOCK — CRITICAL:
This product is NOT clothing. It has a FIXED, UNCHANGEABLE shape.
- SILHOUETTE: pixel-accurate outline match to the reference.
- PROPORTIONS: every ratio (height/width, cap/body, neck/base) IDENTICAL to reference.
- CONSTRUCTION DETAILS: every cap, lid, clasp, label, engraving, facet, logo placement in the EXACT same position and scale.
- MATERIAL FIDELITY: faceted crystal stays faceted; matte stays matte; glossy stays glossy. Do NOT substitute surfaces.
- DO NOT replace the product with a "similar" or "better-looking" version. Any deviation = REJECTED.
`.trim();

const REFERENCE_AUTHORITY_CLAUSE =
  "The attached reference image(s) are the SOLE authority for the product's logo, color, material, proportions, and hardware. " +
  "IGNORE any conflicting product-appearance description in the prompt text below — match the reference exactly; " +
  "adapt only lighting and shadows to the scene.";

export function buildFidelityPreamble(input: FidelityPreambleInput): FidelityPreambleResult {
  const { shot, productCategory, validProductImages } = input;

  // No refs → no preamble (caller falls back to plain prompt path)
  if (!validProductImages || validProductImages.length === 0) {
    return { text: "", isNonApparel: false, resolvedCategory: null, applied: false };
  }

  // Category resolution: explicit signal only. Never infer from `wearable`.
  const raw =
    (typeof productCategory === "string" && productCategory) ||
    (typeof shot?.category === "string" && shot.category) ||
    (typeof shot?.productCategory === "string" && shot.productCategory) ||
    null;
  const resolvedCategory = raw ? raw.toLowerCase().trim() : null;
  const isNonApparel = resolvedCategory ? NON_APPAREL_CATEGORIES.has(resolvedCategory) : false;

  const parts: string[] = [];
  if (isNonApparel) parts.push(NON_APPAREL_1_1_LOCK);
  parts.push(REFERENCE_AUTHORITY_CLAUSE);
  parts.push(PHYSICAL_SCALE_GUARD);

  return {
    text: parts.join("\n\n"),
    isNonApparel,
    resolvedCategory,
    applied: true,
  };
}
