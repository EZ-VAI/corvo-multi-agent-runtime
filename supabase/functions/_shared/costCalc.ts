// Shared cost-calculation helper. Mirrors `src/hooks/useCredits.ts` so that
// server-side (embedded-create-draft, advance-generation-state) and client-side
// (cost preview in EmbeddedShell modal) produce IDENTICAL numbers. Mismatch
// between the two → embedded-create-draft returns 409 cost_mismatch.

export const CREDIT_COSTS = {
  keyframe: 2,
  "end-keyframe": 2,
  "clip-kling-std": 5,
  "clip-kling-pro": 18,
  "clip-minimax": 4,
  "clip-seedance": 20,
  "clip-mix": 14,
  "editorial-free-mode": 16,
  "music-gen": 3,
  "sfx-gen": 2,
  "export-final": 0,
  "qc-check": 0,
  assembly: 0,
} as const;

export type SubscriptionTier = "free" | "launcher" | "starter" | "pro" | "business";
export type ClipEngine = "kling-std" | "kling-pro" | "seedance" | "minimax" | "mix";
export type PipelineMode = "brand_film" | "editorial" | "presenter";

// Per-tier engine allow-list. MUST mirror `PREMIUM_ENGINES` + `PREMIUM_TIERS`
// in src/hooks/useCredits.ts (the main-site source of truth).
//
//   PREMIUM_ENGINES = ["kling-pro", "mix"]          → premium-only
//   PREMIUM_TIERS   = ["launcher","starter","pro","business"]  → can use premium
//   seedance / kling-std / minimax                  → available to ALL tiers
//
// Therefore: only `free` is restricted (no kling-pro, no mix). Starter+ unlocks
// everything. Shopify embedded modal must behave identically to main site.
const ALL_ENGINES: ReadonlySet<ClipEngine> = new Set<ClipEngine>([
  "kling-std", "kling-pro", "seedance", "minimax", "mix",
]);
const TIER_ENGINE_ALLOW: Record<SubscriptionTier, ReadonlySet<ClipEngine>> = {
  free:      new Set<ClipEngine>(["kling-std", "seedance", "minimax"]),
  starter:   ALL_ENGINES,
  launcher:  ALL_ENGINES,
  pro:       ALL_ENGINES,
  business:  ALL_ENGINES,
};

export function getClipCreditCost(engine: string): number {
  switch (engine) {
    case "kling-std": return CREDIT_COSTS["clip-kling-std"];
    case "kling-pro": return CREDIT_COSTS["clip-kling-pro"];
    case "minimax": return CREDIT_COSTS["clip-kling-std"];
    case "veo": return CREDIT_COSTS["clip-kling-pro"];
    case "seedance": return CREDIT_COSTS["clip-seedance"];
    case "mix": return CREDIT_COSTS["clip-mix"];
    default: return CREDIT_COSTS["clip-kling-std"];
  }
}

/** First tier (in upgrade order) whose allow-list includes the engine. */
function minTierFor(engine: ClipEngine): SubscriptionTier {
  const order: SubscriptionTier[] = ["free", "starter", "launcher", "pro", "business"];
  for (const t of order) {
    if (TIER_ENGINE_ALLOW[t].has(engine)) return t;
  }
  return "launcher";
}

export interface CostInput {
  pipelineMode: PipelineMode;
  engine: ClipEngine;
  clipCount: number;
  /** for brand_film: long-form keyframes (>5s clips need an extra end-keyframe) */
  hasLongForm?: boolean;
}

export interface CostBreakdown {
  total: number;
  lines: Array<{ label: string; qty: number; unit: number; subtotal: number }>;
}

/**
 * Compute the reservation amount for a single embedded generation run.
 * Editorial: Free Mode flat-rate (16cr) OR per-clip Seedance cost × N.
 * Brand film: keyframes (2 × N, +N more end-keyframes if long-form) + clips (engine × N).
 */
export function computeGenerationCost(input: CostInput): CostBreakdown {
  const { pipelineMode, engine, clipCount, hasLongForm } = input;
  const lines: CostBreakdown["lines"] = [];

  if (pipelineMode === "editorial") {
    // Editorial uses Free Mode-style flat or per-clip; default per-clip for now.
    const clipUnit = getClipCreditCost(engine);
    lines.push({ label: `Editorial clips (${engine})`, qty: clipCount, unit: clipUnit, subtotal: clipUnit * clipCount });
  } else {
    // brand_film + presenter share keyframe + clip structure
    const kfUnit = CREDIT_COSTS.keyframe;
    const kfQty = hasLongForm ? clipCount * 2 : clipCount;
    const kfLabel = hasLongForm ? "Keyframes (incl. long-form)" : "Keyframes";
    lines.push({ label: kfLabel, qty: kfQty, unit: kfUnit, subtotal: kfUnit * kfQty });

    const clipUnit = getClipCreditCost(engine);
    lines.push({ label: `Clips (${engine})`, qty: clipCount, unit: clipUnit, subtotal: clipUnit * clipCount });
  }

  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  return { total, lines };
}

/**
 * Per-tier engine allow-list check.
 *   Free + Starter   → kling-std only
 *   Launcher / Pro / Business → all engines
 *
 * Returns null on allow, otherwise { reason, requiredTier, engine } where
 * `requiredTier` is the lowest tier that unlocks `engine`. The embedded modal
 * uses `requiredTier` to render an accurate "Upgrade to <Launcher>" CTA.
 */
export function checkEngineTierGating(tier: SubscriptionTier, engine: ClipEngine):
  | null
  | { reason: "engine_gated"; requiredTier: SubscriptionTier; engine: string }
{
  if (TIER_ENGINE_ALLOW[tier]?.has(engine)) return null;
  return { reason: "engine_gated", requiredTier: minTierFor(engine), engine };
}

/** Exported for client mirror (modal pre-block + tests). */
export function tierAllowsEngine(tier: SubscriptionTier, engine: ClipEngine): boolean {
  return TIER_ENGINE_ALLOW[tier]?.has(engine) ?? false;
}
