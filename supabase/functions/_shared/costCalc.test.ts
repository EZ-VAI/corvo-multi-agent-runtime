// Deno tests for shared cost + tier gating logic.
//
// Run from project root with the supabase--test_edge_functions tool, or:
//   deno test supabase/functions/_shared/costCalc.test.ts --allow-net --allow-env
//
// These guard the contract that powers checkpoints #1 (cost preview),
// #3 (cost_mismatch defense), and #9 (engine tier gating).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeGenerationCost,
  checkEngineTierGating,
  tierAllowsEngine,
} from "./costCalc.ts";

// ── computeGenerationCost ────────────────────────────────────────────────

Deno.test("brand_film: 4 clips × kling-std, no long-form → 4×2 keyframes + 4×5 clips = 28cr", () => {
  const cost = computeGenerationCost({
    pipelineMode: "brand_film",
    engine: "kling-std",
    clipCount: 4,
    hasLongForm: false,
  });
  assertEquals(cost.total, 28);
  assertEquals(cost.lines[0].label, "Keyframes");
  assertEquals(cost.lines[0].qty, 4);
  assertEquals(cost.lines[1].label, "Clips (kling-std)");
});

Deno.test("brand_film: long-form merges end-keyframes into ONE 'incl. long-form' line", () => {
  const cost = computeGenerationCost({
    pipelineMode: "brand_film",
    engine: "kling-std",
    clipCount: 4,
    hasLongForm: true,
  });
  // 8 keyframes (4×2) + 4×5 clips
  assertEquals(cost.total, 8 * 2 + 4 * 5);
  assertEquals(cost.lines[0].label, "Keyframes (incl. long-form)");
  assertEquals(cost.lines[0].qty, 8);
});

Deno.test("editorial: clip-only billing (no keyframe line at this layer)", () => {
  const cost = computeGenerationCost({
    pipelineMode: "editorial",
    engine: "seedance",
    clipCount: 3,
    hasLongForm: false,
  });
  // 3 × 20 = 60
  assertEquals(cost.total, 60);
  assertEquals(cost.lines.length, 1);
});

// ── checkEngineTierGating ────────────────────────────────────────────────

Deno.test("free tier blocked from kling-pro / mix only (seedance + kling-std allowed)", () => {
  for (const eng of ["kling-pro", "mix"] as const) {
    const r = checkEngineTierGating("free", eng);
    assert(r !== null, `expected ${eng} gated for free`);
    assertEquals(r!.reason, "engine_gated");
    assertEquals(r!.requiredTier, "starter");
  }
  // seedance is NOT in PREMIUM_ENGINES → free tier can use it on main site,
  // so embedded modal must match.
  assertEquals(checkEngineTierGating("free", "seedance"), null);
  assertEquals(checkEngineTierGating("free", "kling-std"), null);
});

Deno.test("starter UNLOCKS all engines (matches PREMIUM_TIERS in useCredits.ts)", () => {
  for (const eng of ["kling-std", "kling-pro", "seedance", "mix"] as const) {
    assertEquals(checkEngineTierGating("starter", eng), null, `starter/${eng}`);
    assert(tierAllowsEngine("starter", eng), `starter should allow ${eng}`);
  }
});

Deno.test("launcher / pro / business unlock all engines", () => {
  for (const tier of ["launcher", "pro", "business"] as const) {
    for (const eng of ["kling-std", "kling-pro", "seedance", "mix"] as const) {
      assertEquals(checkEngineTierGating(tier, eng), null, `${tier}/${eng}`);
    }
  }
});
