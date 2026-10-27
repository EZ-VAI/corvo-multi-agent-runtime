// Phase A — Common recipe primitives + invariant helpers shared by all 6 modes.

import type {
  RecipeDefinition,
  RecipeShot,
  InvariantViolation,
} from "./_types.ts";

// ─────────── Recipe class taxonomy ───────────
// Each recipe carries semantic class tags so invariants can reason
// without hard-coding recipe names.
export const RECIPE_CLASSES = {
  REVEAL: "reveal",         // Product enters / is unveiled
  HOLD: "hold",             // Static composition, breathing
  INTERACTION: "interaction", // Human↔product touch
  ENVIRONMENT: "environment", // Atmosphere/world-building
  PORTRAIT: "portrait",     // Human-led, no product hero
  TRANSITION: "transition", // Bridge between scenes
} as const;

export type RecipeClass = typeof RECIPE_CLASSES[keyof typeof RECIPE_CLASSES];

// Recipe class lookup by name. Each mode file extends this map.
export const RECIPE_CLASS_MAP: Record<string, RecipeClass> = {};

export function registerRecipeClass(name: string, cls: RecipeClass): void {
  RECIPE_CLASS_MAP[name] = cls;
}

export function getRecipeClass(name: string): RecipeClass | null {
  return RECIPE_CLASS_MAP[name] ?? null;
}

// ─────────── Common invariant helpers ───────────

export function shotsByClass(shots: RecipeShot[], cls: RecipeClass): RecipeShot[] {
  return shots.filter((s) => getRecipeClass(s.recipe) === cls);
}

export function customRatio(shots: RecipeShot[]): number {
  if (shots.length === 0) return 0;
  return shots.filter((s) => s.recipe === "CUSTOM").length / shots.length;
}

export function violation(
  type: string,
  detail: string,
  shotIndex?: number,
): InvariantViolation {
  return shotIndex !== undefined ? { type, detail, shotIndex } : { type, detail };
}

// ─────────── Common invariants applied to ALL modes ───────────
export function commonInvariants(shots: RecipeShot[]): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (shots.length === 0) {
    violations.push(violation("empty_timeline", "Timeline has zero shots"));
    return violations;
  }

  // Hard cap: CUSTOM ratio must not exceed 25% (Phase A: relaxed to 50%).
  // Once we have stable mode coverage we'll tighten back to 25%.
  const ratio = customRatio(shots);
  if (ratio > 0.5) {
    violations.push(
      violation(
        "custom_ratio_exceeded",
        `CUSTOM recipes are ${(ratio * 100).toFixed(0)}% of timeline (max 50% in Phase A)`,
      ),
    );
  }

  // Each shot must have a non-empty motion description.
  shots.forEach((s, i) => {
    if (!s.motion || s.motion.trim().length === 0) {
      violations.push(violation("empty_motion", "Shot has empty motion field", i));
    }
    if (s.durationSec <= 0 || s.durationSec > 15) {
      violations.push(
        violation(
          "invalid_duration",
          `Shot duration ${s.durationSec}s out of range (0, 15]`,
          i,
        ),
      );
    }
  });

  return violations;
}

// ─────────── Recipe registry helpers ───────────
const RECIPE_REGISTRY: Record<string, RecipeDefinition> = {};

export function registerRecipe(def: RecipeDefinition): void {
  RECIPE_REGISTRY[def.name] = def;
}

export function getRecipe(name: string, version?: string): RecipeDefinition | null {
  const def = RECIPE_REGISTRY[name];
  if (!def) return null;
  if (version && def.version !== version) {
    // Version drift — caller is responsible for logging warning.
    // We still return latest so old drafts can render.
    return def;
  }
  return def;
}

export function getRecipeLibrary(): readonly string[] {
  return Object.keys(RECIPE_REGISTRY);
}
