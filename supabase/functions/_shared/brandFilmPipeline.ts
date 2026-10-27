// Canonical brand_film pipeline request builders.
//
// SINGLE SOURCE OF TRUTH for how analyze → directions → concept → blocks → keyframe
// edge functions are invoked. Both the web frontend (src/pages/Create.tsx) and the
// MCP orchestrator (mcp-orchestrate-brandfilm) should produce IDENTICAL request
// shapes so MCP users get the same 5-layer creative quality as web users.
//
// If you add a new parameter to any generate-* edge function, add it here too.
// Anything not in this file means the two paths have drifted.

/* ============================================================================
 * Shared input shape — everything an orchestrator/caller needs to assemble all
 * 4 pipeline calls. Most fields are optional with sane defaults that match
 * frontend defaults.
 * ========================================================================== */

export interface BrandFilmContext {
  // Identity
  productName?: string;
  brandName?: string;
  brandSlogan?: string;

  // Media
  /** Always-first hero image (the upload the user just gave us). */
  primaryImageUrl: string;
  /** Additional hero images (analyzer picks, library, etc.). Deduped with primary. */
  extraHeroImages?: string[];

  // Intent
  platform?: string;        // default "brand-film"
  goal?: string;            // default "launch"
  style?: string;           // direction "type" — default "cinematic_bold"
  vertical?: string;        // default understanding.category || "auto"
  subcategory?: string;     // default "auto"
  aesthetic?: string;       // default "auto"
  aspectRatio?: string;     // "16:9" | "9:16" | "1:1" | "4:5"  — default "16:9"
  totalDuration?: number;   // seconds — default 30
  blockDurationDefault?: number; // seconds per block — default 3
  blockCount?: number;      // 0 = let generate-blocks auto-compute from duration

  // Director layer (Phase A)
  narrativeMode?: string;
  filmMode?: string;
  filmMood?: string;
  culturalRegister?: string;
  peakMoment?: string;
  environmentPreset?: string;
  filmStockPreset?: string;
  enableOverlays?: boolean;

  // Style modifiers (frontend's "vibe" buttons)
  vibeId?: string;
  textureId?: string;
  colorGrade?: string;
  colorCalibration?: any;

  // Wearable / category routing
  wearable?: { isWearable: boolean; displayMode: "product-only" | "lifestyle" | "both"; category?: string | null };
  productSpecs?: any;

  // Engine
  engine?: string;          // default "kling-std"
  keyframeEngine?: string;  // default "gemini"

  // Brand context (BrandKit-style) — pass through whatever the frontend has
  brandContext?: any;

  // Optional draft persistence
  draftId?: string | null;

  // Free-text creative brief from the user (e.g. MCP `concept` arg, or web
  // "instruction" field). Threaded into generate-directions (as
  // brandContext.freeText) AND generate-concept (as userInstruction) so the
  // 5-layer pipeline actually responds to user intent instead of running on
  // pure defaults.
  userConcept?: string;

  // Internal MCP flag — orchestrators usually want quickMode=false so the
  // full 5-layer creative pipeline runs.
  quickMode?: boolean;
}


/* ============================================================================
 * Helpers
 * ========================================================================== */

const APPAREL_RE = /\b(apparel|clothing|fashion|dress|shirt|pants|outerwear|knitwear|suiting|shoes|sneakers|footwear|hat|bag|handbag)\b/i;

export function resolveWearable(ctx: BrandFilmContext, understanding: any) {
  if (ctx.wearable) return ctx.wearable;
  const cat = String(understanding?.category ?? ctx.vertical ?? "").toLowerCase();
  const isApparel = APPAREL_RE.test(cat);
  return {
    isWearable: isApparel,
    // "both" lets the LLM decide per-block via block.hasHuman. Forcing
    // "product-only" universally kills every human / lifestyle beat that
    // the 5-layer creative pipeline generated. Don't do it.
    displayMode: isApparel ? "both" : "both" as "both",
    category: cat || null,
  };
}

export function resolveHeroImages(ctx: BrandFilmContext, understanding: any): string[] {
  const fromUnderstanding = (understanding?.heroImages?.length ? understanding.heroImages : understanding?.images) ?? [];
  return Array.from(new Set([ctx.primaryImageUrl, ...(ctx.extraHeroImages ?? []), ...fromUnderstanding].filter(Boolean))).slice(0, 3);
}

/** The PRODUCT ANCHOR sentence belongs in `visualIdentity`, NOT in the per-block
 *  `visualDescription`. Frontend keeps it in visualIdentity. Putting it at the
 *  front of every block.visualDescription was the bug that caused every shot
 *  to render as a near-duplicate "exact-replica" product close-up. */
export function buildProductAnchorVisualIdentity(baseVisualIdentity: string, productName: string): string {
  const anchor = `PRODUCT ANCHOR: the uploaded reference image is the absolute ground truth for ${productName}. ` +
    `Preserve exact silhouette, color, material, proportions, cap/label/logo/details, gold trim, jewel/inlay, ` +
    `mother-of-pearl insets. The product may appear at varied scale/angle/context per shot — but its physical ` +
    `identity is identical to the reference across all shots. Do NOT substitute with a category-generic stand-in.`;
  return [baseVisualIdentity || "", anchor].filter(Boolean).join("\n");
}

/* ============================================================================
 * Request builders — one per edge function
 * Returns the raw JSON body to send. Caller does the actual fetch / invoke.
 * ========================================================================== */

export function buildAnalyzeProductRequest(ctx: BrandFilmContext) {
  // Use uploadedImages, NOT `url` — analyze-product treats `url` as a webpage to scrape.
  return {
    uploadedImages: [ctx.primaryImageUrl, ...(ctx.extraHeroImages ?? [])].filter(Boolean),
    productTitle: ctx.productName ?? "Product",
  };
}

export function buildDirectionsRequest(ctx: BrandFilmContext, understanding: any) {
  // Merge user's free-text creative brief into brandContext.freeText so
  // generate-directions actually steers from it (it's the only field that
  // surfaces free-form intent into the directions LLM).
  const mergedBrandContext = ctx.userConcept
    ? {
        ...(ctx.brandContext ?? {}),
        freeText: [ctx.brandContext?.freeText, `User brief: ${ctx.userConcept}`]
          .filter(Boolean)
          .join("\n"),
      }
    : ctx.brandContext;
  return {
    understanding,
    platform: ctx.platform ?? "brand-film",
    goal: ctx.goal ?? "launch",
    style: ctx.style ?? undefined,
    vertical: ctx.vertical ?? understanding?.category ?? undefined,
    wearable: resolveWearable(ctx, understanding),
    brandContext: mergedBrandContext,
    narrativeMode: ctx.narrativeMode,
    filmMode: ctx.filmMode,
    filmMood: ctx.filmMood,
    culturalRegister: ctx.culturalRegister,
  };
}

export function buildConceptRequest(ctx: BrandFilmContext, understanding: any, direction: any) {
  return {
    understanding,
    direction,
    platform: ctx.platform ?? "brand-film",
    goal: ctx.goal ?? "launch",
    style: ctx.style ?? undefined,
    vertical: ctx.vertical ?? understanding?.category ?? undefined,
    aesthetic: ctx.aesthetic ?? undefined,
    totalDuration: ctx.totalDuration ?? 30,
    wearable: resolveWearable(ctx, understanding),
    brandContext: ctx.brandContext,
    brandNameOverride: ctx.brandName ?? "",
    currentConcept: null,
    // Thread the user's free-text brief here — generate-concept reads this as
    // a steer/refine signal. Without it, concept runs on pure defaults.
    userInstruction: ctx.userConcept ?? null,
    narrativeMode: ctx.narrativeMode,
    filmMode: ctx.filmMode,
    filmMood: ctx.filmMood,
    culturalRegister: ctx.culturalRegister,
  };
}


export function buildBlocksRequest(ctx: BrandFilmContext, understanding: any, direction: any, concept: any) {
  return {
    understanding,
    direction,
    concept,
    platform: ctx.platform ?? "brand-film",
    goal: ctx.goal ?? "launch",
    style: ctx.style ?? undefined,
    totalDuration: ctx.totalDuration ?? 30,
    blockDurationDefault: ctx.blockDurationDefault ?? 3,
    blockCount: ctx.blockCount ?? 0,            // 0 → backend auto-derives from duration
    wearable: resolveWearable(ctx, understanding),
    engine: ctx.engine ?? "kling-std",
    vertical: ctx.vertical ?? understanding?.category ?? undefined,
    subcategory: ctx.subcategory ?? undefined,
    aesthetic: ctx.aesthetic ?? undefined,
    brandSlogan: ctx.brandSlogan ?? "",
    brandNameOverride: ctx.brandName ?? "",
    environmentPreset: ctx.environmentPreset ?? undefined,
    filmStockPreset: ctx.filmStockPreset ?? undefined,
    brandContext: ctx.brandContext,
    peakMoment: ctx.peakMoment && ctx.peakMoment !== "auto" ? ctx.peakMoment : undefined,
    narrativeMode: ctx.narrativeMode,
    enableOverlays: ctx.enableOverlays ?? true,
    filmMode: ctx.filmMode,
    mood: ctx.filmMood,                          // generate-blocks param is `mood`, not `filmMood`
    culturalRegister: ctx.culturalRegister,
    draftId: ctx.draftId ?? null,
  };
}

export interface KeyframeBuildOpts {
  block: any;
  blockIndex: number;
  totalBlocks: number;
  previousKeyframes: string[];      // last 1-2 frame URLs for continuity
  frameType?: "start" | "end";      // default "start"
  /** Visual bible from generate-blocks output (data.visualBible). Falls back to concept.visualBible. */
  visualBible?: any;
  concept?: any;
  characterReferenceUrl?: string;
  productSensitivity?: "none" | "sizing" | "appearance" | "both";
  /**
   * CLUSTER MODE ONLY. The shared "sibling angle" anchor — an already-rendered
   * frame of the SAME beat that this keyframe must match EXACTLY (only the
   * camera angle differs). Pass this ONLY from the cluster path
   * (handleGenerateClusterKeyframes / generate-angle-plan flows).
   *
   * 🚨 DO NOT default this to previousKeyframes in normal brand-film mode.
   * In normal mode every block is a DISTINCT shot; treating the chronologically
   * previous (different) shot as a "sibling — everything identical except angle"
   * chains each frame to the prior one and collapses all N keyframes into one
   * image. That was the root cause of the 5-identical-keyframes / homogenization
   * bug. Leave undefined for normal mode → generate-keyframe will use the
   * previousKeyframes only as a light color/lighting continuity reference.
   */
  siblingAnchorUrl?: string;
}

export function buildKeyframeRequest(
  ctx: BrandFilmContext,
  understanding: any,
  opts: KeyframeBuildOpts,
) {
  const heroImages = resolveHeroImages(ctx, understanding);
  const wearable = resolveWearable(ctx, understanding);
  const baseVisualIdentity = String(understanding?.visualIdentity ?? "");
  const productName = ctx.productName ?? understanding?.title ?? "Product";

  return {
    block: opts.block,                         // ← UNTOUCHED. Don't mutate visualDescription, don't override blockType.
    productImages: heroImages,
    brand: {
      brandName: understanding?.brand?.brandName ?? ctx.brandName ?? productName,
      productName,
    },
    platform: ctx.platform ?? "brand-film",
    aspectRatio: ctx.aspectRatio ?? "16:9",
    // PRODUCT ANCHOR rides in visualIdentity (where frontend puts it).
    visualIdentity: buildProductAnchorVisualIdentity(baseVisualIdentity, productName),
    visualBible: opts.visualBible ?? opts.concept?.visualBible ?? {},
    previousKeyframes: (opts.previousKeyframes ?? []).slice(-2),
    totalBlocks: opts.totalBlocks,
    blockIndex: opts.blockIndex,
    wearable,
    frameType: opts.frameType ?? "start",
    colorCalibration: ctx.colorCalibration,
    sizingContext: {
      isSizingSensitive: opts.productSensitivity === "sizing" || opts.productSensitivity === "both",
    },
    productSpecs: ctx.productSpecs,
    characterReferenceUrl: opts.characterReferenceUrl,
    physicalTraits: (understanding as any)?.physicalTraits ?? null,
    quickMode: ctx.quickMode ?? false,
    keyframeEngine: ctx.keyframeEngine ?? "gemini",
    vibeId: ctx.vibeId,
    textureId: ctx.textureId,
    colorGrade: ctx.colorGrade,
    anchorWord: opts.concept?.anchorWord,
    sensoryPalette: opts.concept?.sensoryPalette,
    humanState: (opts.concept as any)?.humanState,
    filmMode: ctx.filmMode,
    filmMood: ctx.filmMood,
    culturalRegister: ctx.culturalRegister,
    // CLUSTER-ONLY. Only set when the caller explicitly passes a sibling anchor
    // (multi-angle coverage of the SAME beat). In normal brand-film mode this is
    // undefined, so generate-keyframe will NOT apply the "everything identical
    // except angle" sibling lock — which previously chained every distinct shot
    // to the prior frame and collapsed all keyframes into one image.
    siblingAnchorUrl: opts.siblingAnchorUrl,
  };
}

/* ============================================================================
 * Clip (kling) builder — used by MCP finalize phase.
 * ========================================================================== */

export function buildKlingClipRequest(
  ctx: BrandFilmContext,
  block: any,
  keyframeUrl: string,
  sessionMeta: { sessionId: string; blockId: string; userId?: string },
) {
  return {
    prompt: block.generationPrompt ?? block.visualDescription ?? block.purpose ?? "Cinematic product shot",
    keyframeImage: keyframeUrl,
    duration: Number(block.duration) > 0 ? Number(block.duration) : 5,
    aspectRatio: ctx.aspectRatio ?? "16:9",
    mode: ctx.engine === "kling-pro" ? "pro" : "std",
    hasHuman: !!block.hasHuman,
    taskMeta: sessionMeta,
  };
}
