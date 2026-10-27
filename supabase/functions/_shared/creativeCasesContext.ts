// ── creativeCasesContext.ts ──
// Shared helper for fetching "horizontal scan" reference cases from
// the creative_cases table. Used by creative-decision LLMs so they
// reason from real-campaign data instead of training-data defaults.
//
// Q4 decision: vertical-first with fallback.
//   Tier 1: same vertical AND productType keyword overlap (best match)
//   Tier 2: same vertical only (top-up to N)
//   Tier 3: cross-vertical award-winners (last-resort top-up to N)
// Goal: ALWAYS return ≥3 cases so GPT-5 has something to compare against.
//
// We score by (a) productType keyword overlap, (b) ai_executability_score,
// (c) cannes_lions / viral_organic / industry_reference flags.

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ReferenceCase {
  id: string;
  brand: string;
  campaign_name: string;
  vertical: string;
  product_type: string | null;
  primary_attribute: string | null;
  sensory_quality: string | null;
  specific_metaphor: string | null;
  filmable_scene: string | null;
  bridge_technique: string | null;
  lighting_approach: string | null;
  color_palette: string | null;
  hook_technique: string | null;
  hook_visual_description: string | null;
  ai_adapted_scene: string | null;
  texture_materials: string | null;
  dominant_scale: string | null;
  ai_executability_score: number | null;
  cannes_lions: boolean | null;
  viral_organic: boolean | null;
  emotional_arc: string | null;
}

const SELECT_COLS =
  "id,brand,campaign_name,vertical,product_type,primary_attribute,sensory_quality," +
  "specific_metaphor,filmable_scene,bridge_technique,lighting_approach,color_palette," +
  "hook_technique,hook_visual_description,ai_adapted_scene,texture_materials," +
  "dominant_scale,ai_executability_score,cannes_lions,viral_organic,emotional_arc";

function scoreCase(c: ReferenceCase, productTypeKeywords: string[]): number {
  let score = 0;
  const haystack = `${c.product_type || ""} ${c.primary_attribute || ""} ${c.sensory_quality || ""}`.toLowerCase();
  for (const kw of productTypeKeywords) {
    if (kw.length > 2 && haystack.includes(kw)) score += 3;
  }
  score += (c.ai_executability_score || 0) * 0.3;
  if (c.cannes_lions) score += 2;
  if (c.viral_organic) score += 1.5;
  if (c.hook_visual_description) score += 1; // richer cases
  if (c.ai_adapted_scene) score += 1;
  return score;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\s+|[,/]+/).filter((t) => t.length > 2);
}

function dedupe(arr: ReferenceCase[]): ReferenceCase[] {
  const seen = new Set<string>();
  const out: ReferenceCase[] = [];
  for (const c of arr) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Fetch up to `limit` reference cases for horizontal comparison.
 * Vertical-first with fallback per Q4=B.
 */
export async function fetchSimilarCases(
  sb: SB,
  opts: {
    vertical?: string | null;
    productType?: string | null;
    extraKeywords?: string[];
    limit?: number;
  },
): Promise<ReferenceCase[]> {
  const limit = Math.max(3, Math.min(8, opts.limit ?? 4));
  const vertical = (opts.vertical && opts.vertical !== "auto" ? opts.vertical : "").toLowerCase().trim();
  const productType = (opts.productType || "").toLowerCase().trim();
  const keywords = [
    ...tokenize(productType),
    ...(opts.extraKeywords || []).flatMap((k) => tokenize(k)),
  ];

  let pool: ReferenceCase[] = [];

  // Tier 1+2: same vertical (over-fetch, then score)
  if (vertical) {
    try {
      const { data } = await sb
        .from("creative_cases")
        .select(SELECT_COLS)
        .eq("vertical", vertical)
        .limit(40);
      if (data && data.length > 0) pool = data as ReferenceCase[];
    } catch (e) {
      console.warn("[creativeCasesContext] vertical query failed:", e);
    }
  }

  // Tier 3: cross-vertical top-up if we still don't have enough
  if (pool.length < limit) {
    try {
      let q = sb
        .from("creative_cases")
        .select(SELECT_COLS)
        .gte("ai_executability_score", 7)
        .order("ai_executability_score", { ascending: false })
        .limit(limit * 2);
      if (vertical) q = q.neq("vertical", vertical);
      const { data } = await q;
      if (data && data.length > 0) {
        pool = dedupe([...pool, ...(data as ReferenceCase[])]);
      }
    } catch (e) {
      console.warn("[creativeCasesContext] cross-vertical fallback failed:", e);
    }
  }

  if (pool.length === 0) return [];

  // Score + sort + slice
  const scored = pool.map((c) => ({ c, s: scoreCase(c, keywords) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}

/**
 * Render reference cases as a compact LLM-readable block.
 * ~150 chars per case → 4 cases ≈ 600-700 chars. Fits any prompt budget.
 */
export function renderCasesForPrompt(cases: ReferenceCase[]): string {
  if (cases.length === 0) return "";
  const lines = cases.map((c, i) => {
    const parts = [
      `${i + 1}. ${c.brand} — "${c.campaign_name}" (${c.vertical}${c.product_type ? `/${c.product_type}` : ""})`,
      c.primary_attribute && `   attribute: ${c.primary_attribute}`,
      c.sensory_quality && `   sensory: ${c.sensory_quality}`,
      c.specific_metaphor && `   metaphor: ${c.specific_metaphor}`,
      c.lighting_approach && `   lighting: ${c.lighting_approach}`,
      c.color_palette && `   palette: ${c.color_palette}`,
      c.hook_visual_description && `   hook: ${c.hook_visual_description}`,
      c.ai_adapted_scene && `   filmable: ${c.ai_adapted_scene}`,
    ].filter(Boolean);
    return parts.join("\n");
  });
  return `\n\nHORIZONTAL REFERENCE — ${cases.length} real campaigns from this product space:
${lines.join("\n\n")}

These are the established moves in this category. READ THEM, then move sideways.
For each direction you propose, you MUST state in 'differentiationFromReferences'
exactly which of these moves you are NOT doing, and what physical detail of THIS
product is letting you go elsewhere. Vague differentiation = lazy direction.`;
}
