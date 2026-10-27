// Contract test for the shared brand_film pipeline builders.
//
// Purpose: lock the shape of the request bodies produced by buildKeyframeRequest
// (and friends) so that if anyone hand-writes an `invoke("generate-keyframe", {...})`
// body elsewhere and it drifts, this test fails loudly. The web frontend
// (src/pages/Create.tsx), the Shopify embedded path
// (supabase/functions/advance-generation-state), and the MCP orchestrator
// (supabase/functions/mcp-orchestrate-brandfilm) must ALL produce identical
// shapes — otherwise the symptom is the recurring "duplicate keyframes on
// Shopify only" bug. See mem://features/shopify-integration/pipeline-parity.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAnalyzeProductRequest,
  buildBlocksRequest,
  buildConceptRequest,
  buildDirectionsRequest,
  buildKeyframeRequest,
  type BrandFilmContext,
} from "./brandFilmPipeline.ts";

const ctx: BrandFilmContext = {
  productName: "Acme Watch",
  brandName: "Acme",
  primaryImageUrl: "https://example.com/hero.jpg",
  extraHeroImages: ["https://example.com/macro.jpg"],
  aspectRatio: "9:16",
  platform: "brand-film",
  vibeId: "editorial",
  textureId: "filmic",
  colorGrade: "editorial_warm",
  keyframeEngine: "gemini",
  filmMode: "premium",
  filmMood: "serene",
  culturalRegister: "modern",
  quickMode: false,
};

const understanding = {
  title: "Acme Watch",
  brand: { brandName: "Acme" },
  category: "watch",
  visualIdentity: "Minimalist matte case, sapphire crystal",
  heroImages: ["https://example.com/hero.jpg", "https://example.com/macro.jpg"],
  physicalTraits: { weight_g: 80 },
};

Deno.test("buildKeyframeRequest — every field generate-keyframe relies on is present", () => {
  const body = buildKeyframeRequest(ctx, understanding, {
    block: { id: "b1", title: "Hero", visualDescription: "wrist shot", hasHuman: true },
    blockIndex: 0,
    totalBlocks: 4,
    previousKeyframes: ["https://example.com/prev.jpg"],
    frameType: "start",
    visualBible: { palette: ["#fff", "#000"], lighting: "soft north" },
    concept: { anchorWord: "weightless", sensoryPalette: ["cool"], humanState: "calm" },
  });

  // === Hard contract — these are the fields whose absence caused the
  // "every keyframe looks the same" homogenization bug. Pin them here. ===
  const required = [
    "block", "productImages", "brand", "platform", "aspectRatio",
    "visualIdentity", "visualBible", "previousKeyframes", "totalBlocks",
    "blockIndex", "wearable", "frameType", "colorCalibration", "sizingContext",
    "productSpecs", "physicalTraits", "quickMode", "keyframeEngine",
    "vibeId", "textureId", "colorGrade",
    "anchorWord", "sensoryPalette", "humanState",
    "filmMode", "filmMood", "culturalRegister", "siblingAnchorUrl",
  ];
  for (const k of required) {
    assert(k in body, `buildKeyframeRequest body MUST include '${k}' (drift breaks main-site ↔ embedded parity)`);
  }

  assertEquals(body.aspectRatio, "9:16");
  assertEquals(body.frameType, "start");
  assertEquals(body.totalBlocks, 4);
  assertEquals(body.blockIndex, 0);
  assert(Array.isArray(body.productImages));
  assertEquals((body.visualBible as any).lighting, "soft north");
  assertEquals(body.anchorWord, "weightless");
  assertEquals((body.previousKeyframes as string[])[0], "https://example.com/prev.jpg");
  // siblingAnchorUrl must fall back to last previousKeyframe
  assertEquals(body.siblingAnchorUrl, "https://example.com/prev.jpg");
  // PRODUCT ANCHOR must be threaded into visualIdentity (where frontend keeps it)
  assert(String(body.visualIdentity).includes("PRODUCT ANCHOR"));
});

Deno.test("buildAnalyzeProductRequest — uploadedImages, not url", () => {
  const body = buildAnalyzeProductRequest(ctx);
  assert("uploadedImages" in body, "must use uploadedImages — analyze-product treats `url` as a webpage to scrape");
  assert(!("url" in body));
  assertEquals(body.productTitle, "Acme Watch");
});

Deno.test("buildDirectionsRequest — threads userConcept into brandContext.freeText", () => {
  const body = buildDirectionsRequest(
    { ...ctx, userConcept: "feel of cold morning steel" },
    understanding,
  );
  assert(String(body.brandContext?.freeText ?? "").includes("cold morning steel"));
});

Deno.test("buildConceptRequest — passes userInstruction so concept actually steers from user brief", () => {
  const body = buildConceptRequest(
    { ...ctx, userConcept: "lonely runway moment" },
    understanding,
    { title: "Editorial Hush" },
  );
  assertEquals(body.userInstruction, "lonely runway moment");
});

Deno.test("buildBlocksRequest — passes mood (not filmMood) per generate-blocks contract", () => {
  const body = buildBlocksRequest(ctx, understanding, { title: "Editorial Hush" }, { anchorWord: "weightless" });
  assertEquals(body.mood, "serene");
  assert(!("filmMood" in body), "generate-blocks reads `mood`, not `filmMood`");
});
