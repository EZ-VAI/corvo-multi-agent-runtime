/**
 * Shared realism guards used by image generation edge functions.
 *
 * 1. PHYSICAL_SCALE_GUARD — prevents anti-commonsense scale errors
 *    (e.g. a sports car shrunk down so a hand looks larger than the wheel).
 *    Always include this whenever a product can co-appear with a human.
 *
 * 2. PHYSICAL_REALISM_GUARD — bans the "imagined physics" the image model
 *    auto-invents on every render: starburst flares on gems, mirror-wet
 *    floors, halo glows, free-floating product, motion-blur trails on
 *    static objects, soap-bubble bokeh, etc. Always-on; safe for every
 *    photoreal prompt regardless of vibe / grade.
 *
 * 3. ANTI_CINEMATIC_GUARD — auto-injected when the user picks the
 *    "realistic-honest" vibe or "realistic-true" texture. Strips out
 *    the cinematic / filtered look users explicitly opted out of.
 *
 * BUDGET NOTE:
 * - Image generation (Gemini): NO hard char limit. Very long prompts may not
 *   be fully executed but won't be rejected. We do NOT enforce a budget on
 *   image-gen prompts.
 * - Video generation: hard/effective per-engine limits. Kling = 2200 chars,
 *   MiniMax = 1900 chars, Veo = 2200 chars, Seedance = 3200 chars.
 *   Use `assertVideoPromptBudget(engine, prompt)` in video-gen edge functions.
 */

/**
 * Always-on guard. Compact ~430-char version. Lists only the highest-
 * frequency physics-violation defaults Gemini hallucinates. Detailed
 * examples were removed to fit the prompt budget — phrasing is now
 * dense ban-list style which diffusion models still respond to.
 */
export const PHYSICAL_REALISM_GUARD = `
PHYSICAL REALISM: raw camera optics. NO sparkle/lens-flare/bloom/god-ray FX, no HDR neon, no CGI polish, no soap-bubble bokeh. Surfaces not mirror-wet unless wet. Static objects have no speed blur, real contact shadows.
`.trim();


/**
 * Compact ~440-char version. Removed verbose category-by-category
 * size table; kept the inverse-scale rule which is the actual fix.
 */
export const PHYSICAL_SCALE_GUARD = `
PHYSICAL SCALE: preserve true product size against body/object references. Hand≈18cm, face≈22cm. Rings, watches, cosmetics, earbuds are smaller than a hand; bags, garments, appliances dwarf a hand. If scale feels inverted, pull camera back. NEVER enlarge product toward lens, shrink large goods, or make body parts emerge from/inside products.
`.trim();

/**
 * Returns the anti-cinematic guard string when the user has explicitly opted
 * for realistic / unfiltered look. Returns empty string otherwise.
 *
 * Compact ~480-char version. Same intent (strip cinematic defaults) with
 * dense ban-list phrasing instead of repeated rationale.
 */
export function buildAntiCinematicGuard(
  vibeId?: string | null,
  textureId?: string | null,
): string {
  const wantsRealistic =
    vibeId === "realistic-honest" || textureId === "realistic-true";
  if (!wantsRealistic) return "";

  return `
REALISTIC MODE — user opted out of cinematic look. BAN: lens flare, halation, bloom, teal-orange grade, vintage LUTs, film filters, dramatic shallow DOF, dreamy bokeh backgrounds, volumetric haze, fog, god-rays, dust-mote light beams, hard rim lighting, letterboxing, painterly motion blur. Render as a normal modern phone photo (or 35-50mm DSLR at f/4-5.6) under daylight: flat even light, deep DOF, neutral white balance, no saturation push, slightly imperfect framing. Should look like an unedited iPhone shot, NOT a film still.`;
}

/**
 * Per-engine video prompt char budgets. Kling and Seedance both reject /
 * silently truncate prompts beyond their published max. Logs a warning
 * when a final assembled video prompt is over budget so we catch
 * regressions before the engine drops the tail (where creative content
 * usually lives).
 *
 * Call as: assertVideoPromptBudget("kling", finalPrompt)
 *          assertVideoPromptBudget("seedance", finalPrompt)
 */
export const VIDEO_PROMPT_BUDGETS = {
  kling: 2500,
  minimax: 1900,
  veo: 2200,
  seedance: 3200,
} as const;

export type VideoEngine = keyof typeof VIDEO_PROMPT_BUDGETS;

export function assertVideoPromptBudget(engine: VideoEngine, prompt: string): void {
  const max = VIDEO_PROMPT_BUDGETS[engine];
  const len = prompt.length;
  if (len > max) {
    console.warn(
      `[VIDEO PROMPT BUDGET WARN] ${engine}: ${len} chars (over by ${len - max}, max ${max}). ` +
      `Engine will truncate the tail — verify creative content is not lost.`
    );
  } else {
    console.log(`[VIDEO PROMPT BUDGET OK] ${engine}: ${len}/${max} chars`);
  }
}

/**
 * SYSTEM RULE — guard-first prompt assembly. Use this for EVERY video-gen
 * call site instead of naive string concat + assertVideoPromptBudget.
 *
 * Why: Seedance/Kling silently truncate the TAIL when over budget. If
 * physical-scale / motion-realism / physical-realism guards are appended
 * at the end (the natural place for "rules"), they are the FIRST thing
 * dropped — exactly the bug we keep chasing (oversized rings, weird
 * sparkle reflections, melted product silhouettes).
 *
 * This helper guarantees:
 *   - `head` (audio cue + ALL guards) is ALWAYS kept verbatim, at the front.
 *   - `body` (creative description) is truncated from its tail at a
 *     sentence boundary if needed.
 *   - `tail` (e.g. "No humans, product only.") is also always preserved.
 *
 * Returns the final safe prompt. Always logs final length for observability.
 */
export function enforceVideoPromptBudget(
  engine: VideoEngine,
  parts: { head: string; body: string; tail?: string },
): string {
  const max = VIDEO_PROMPT_BUDGETS[engine];
  let head = parts.head.trim();
  const tail = (parts.tail ?? "").trim();
  const body = parts.body.trim();

  const tailLen = tail ? tail.length + 1 : 0;
  if (head.length + tailLen + 1 > max) {
    head = safeTrimPrompt(head, Math.max(0, max - tailLen - 1), `${engine}:head`);
  }
  const fixedLen = head.length + tailLen + 1; // spaces
  const bodyBudget = Math.max(0, max - fixedLen);

  let safeBody = body;
  if (body.length > bodyBudget) {
    // Truncate body at last sentence boundary within bodyBudget.
    const sliced = body.slice(0, bodyBudget);
    const lastDot = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("."));
    safeBody = (lastDot > bodyBudget * 0.4 ? sliced.slice(0, lastDot + 1) : sliced).trim();
    console.warn(
      `[VIDEO PROMPT BUDGET ENFORCED] ${engine}: body truncated ${body.length} → ${safeBody.length} ` +
      `chars (head=${head.length}, tail=${tail.length}, max=${max}). Guards preserved at front.`
    );
  }

  const final = [head, safeBody, tail].filter(Boolean).join(" ").trim();
  console.log(`[VIDEO PROMPT BUDGET OK] ${engine}: ${final.length}/${max} chars (guard-first)`);
  return final;
}

/**
 * IMAGE_PROMPT_BUDGET — Gemini 3 Pro Image / Nano Banana 2 attention budget.
 *
 * Why: image models follow the FRONT of the prompt strongly and progressively
 * lose adherence after ~1800 chars (~450 tokens). Past 2500 chars, late
 * rules are effectively ignored. This is what caused the "hand emerging
 * from polo collar" failure — PHYSICAL_REALISM_GUARD (688) + HUMAN_FACE_GUARD
 * (965) + NEGATIVE were stuffed at the END of a 3.2k char prompt, so the
 * model only "saw" the scene description and the suggestive composition
 * hint, with NONE of the anatomy rules in attention range.
 *
 * Budget: 2200 chars. Same guard-first contract as video — head (guards)
 * is sacred, body (creative) is truncated at sentence boundary.
 */
// Raised 2200 -> 3000: at 2200 the head guards (1000-1960 chars) left as little
// as ~90-630 chars for the creative body, truncating each block's unique
// Scene/Shot/Camera and homogenizing the film. 3000 is well within the image
// model's real context; the per-block SHOT BRIEF is also pinned at body offset 0
// (see generate-keyframe) so it survives even if this is tuned back down.
export const IMAGE_PROMPT_BUDGET = 3000;

/**
 * PRODUCT_FOCUS_GUARD — soft visual-hierarchy rule (NOT a ban).
 *
 * Solves the "stylist took over" failure: AI keeps inventing handbags,
 * sunglasses, jewelry, scarves and giving them hero composition slots,
 * so a Polo shirt ad ends up with shots where the bag is the subject.
 *
 * Philosophy: real wardrobe styling is allowed (real people wear
 * accessories), but accessories must read as SUPPORTING wardrobe — never
 * compete with the product for the viewer's eye. Phrased as visual-weight
 * rules, not negative bans, so it composes with creative direction
 * instead of flattening it.
 *
 * ~380 chars. Inject at the END of the keyframe/clip head — after the
 * physical guards (which are higher priority) but before the creative
 * body. Skip when the shot is already product-only (no styling possible).
 */
export function buildProductFocusGuard(
  productName?: string | null,
  category?: string | null,
): string {
  const subject = (productName && productName.trim()) || (category ? `the ${category}` : "the product");
  return `
PRODUCT FOCUS: ${subject} is the visual subject. Other styling items (bags, sunglasses, jewelry, watches, scarves, hats) may appear if they would naturally accompany this look, but they read as supporting wardrobe — smaller in frame, partially cropped, lower contrast, or out of focus. They do not share the focal plane with the product, do not sit on a hero composition point, and do not get their own light. If a styling item would compete for the eye, omit it.
`.trim();
}

export function enforceImagePromptBudget(
  parts: { head: string; body: string; tail?: string },
  label: string = "image",
): string {
  const max = IMAGE_PROMPT_BUDGET;
  let head = parts.head.trim();
  const tail = (parts.tail ?? "").trim();
  const body = parts.body.trim();

  const tailLen = tail ? tail.length + 1 : 0;
  if (head.length + tailLen + 1 > max) {
    head = safeTrimPrompt(head, Math.max(0, max - tailLen - 1), `${label}:head`);
  }
  const fixedLen = head.length + tailLen + 1;
  const bodyBudget = Math.max(0, max - fixedLen);

  let safeBody = body;
  if (body.length > bodyBudget) {
    const sliced = body.slice(0, bodyBudget);
    const lastDot = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf("."));
    safeBody = (lastDot > bodyBudget * 0.4 ? sliced.slice(0, lastDot + 1) : sliced).trim();
    console.warn(
      `[IMAGE PROMPT BUDGET ENFORCED] ${label}: body truncated ${body.length} → ${safeBody.length} ` +
      `chars (head=${head.length}, tail=${tail.length}, max=${max}). Guards preserved at front.`,
    );
  }

  const final = [head, safeBody, tail].filter(Boolean).join(" ").trim();
  console.log(`[IMAGE PROMPT BUDGET OK] ${label}: ${final.length}/${max} chars (guard-first)`);
  return final;
}

export function safeTrimPrompt(value: string, max: number, label: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const sliced = collapsed.slice(0, max);
  const boundary = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("; "),
    sliced.lastIndexOf(", "),
  );
  const trimmed = (boundary > max * 0.55 ? sliced.slice(0, boundary + 1) : sliced).trim();
  console.warn(`[PROMPT TRIM] ${label}: ${collapsed.length} → ${trimmed.length}/${max}`);
  return trimmed;
}

/**
 * RIGID_PRODUCT_GUARD — for product-only image-to-video shots.
 *
 * Why: i2v models receive a single 2D frame and have no 3D understanding of
 * the product. When asked to "drift / push-in / orbit / dolly" they fake
 * parallax by warping the 2D silhouette → rubber-band edges, swelling
 * thickness, curve-shift. This is the "ring got fat / earbuds got huge /
 * perfume cap got chubby" failure mode that survives PHYSICAL_SCALE_GUARD
 * and MOTION_REALISM_GUARD because the prompt itself ASKED for camera move.
 *
 * Solution: lock the camera off, let LIFE come from the environment
 * (light shifting, reflections traveling across facets, fabric/dust/steam/
 * smoke drifting, background bokeh breathing). This is how real high-end
 * product cinematography (Tiffany, Apple, Chanel, Hermès) actually works.
 *
 * Compact ~620 chars. Inject at the FRONT of head for product-only video
 * prompts, alongside MOTION_REALISM_GUARD + PHYSICAL_REALISM_GUARD.
 */
export const RIGID_PRODUCT_GUARD = `
RIGID PRODUCT I2V: product silhouette, thickness, logo and details stay identical every frame. NO morph, warp, swelling, shrinking, breathing volume, melting edges. Camera near-locked: max 2–3% micro push or 1° micro-orbit; no pan/dolly/handheld/parallax. Life comes from light, reflections, dust, fabric, mist or background motion — never product deformation.
`.trim();

/**
 * MOTION_REALISM_GUARD — compact ban-list for the most common AI-video
 * motion artifacts (rubber-band warping, sliding feet, melted hands,
 * morphing product silhouette, perpetual subtle drift, "fake slow-mo"
 * glide). Append to every video prompt where the engine would otherwise
 * "perform cinematic motion" instead of just letting the scene exist.
 *
 * Compact ~470 chars. Phrased as physical-world rules, not cinematic
 * directives — this is what actually steers Seedance/Kling motion away
 * from the AI-video uncanny valley.
 */
export const MOTION_REALISM_GUARD = `
MOTION REALISM: limbs keep length, joints bend naturally. Feet contact ground; no sliding, floating, or perpetual idle drift. Product stays rigid — no rubber-band warp or shape-shift. If nothing should move, it stays still. No breathing zoom, fake slow-mo, or morph.
`.trim();

/**
 * HUMAN_FACE_GUARD — pure physical/optical/anatomical rules only.
 *
 * SCOPE (intentionally narrow): only what is physically/optically true of
 * every real human face on every real camera. NO aesthetic prescriptions
 * about WHERE to look, WHAT emotion to perform, or WHETHER the pose is
 * "held" — those are creative choices that must come from data-driven
 * few-shot via fetchSimilarCases (1,036 real shot breakdowns), not from
 * a hardcoded global rule. Hardcoding "must converge on a focal point" or
 * "no held pose" would just replace one AI cliché with another, violating
 * ANTI_BIAS_SYSTEM_PROMPT.
 *
 * Three rules only:
 *   1. Eye optics — single natural catch-light, real lower-lid wet meniscus,
 *      layered iris (no starburst, no painted highlight).
 *   2. Anatomical asymmetry — left/right face never perfectly mirrored
 *      (real humans aren't symmetric).
 *   3. Real skin — pores and minor unevenness preserved (no beauty-filter
 *      airbrush plastic). This overlaps PHYSICAL_REALISM_GUARD on purpose
 *      because the face is where the airbrush bias is strongest.
 *
 * Always-on for any frame/clip with a human (block.hasHuman === true).
 * Compact ~360 chars.
 */
export const HUMAN_FACE_GUARD = `
HUMAN ANATOMY: no disembodied hands/limbs, no body parts emerging from clothing/products/walls. Hands need visible attached wrist/arm/shoulder when in frame; exactly 5 fingers, natural joints. Face/eyes are asymmetric and real; no plastic skin, mirrored features, painted catchlights, uncanny stare, or forced push-in to reveal facial detail.
`.trim();

/**
 * 5-DIM ARCHITECTURE — Dimension 2 (Secondary props).
 *
 * Gemini/Kling/Seedance tend to "animate everything in frame" once given a
 * scene: cups steam, lamps flicker, plants sway, books page-flip, fabrics
 * billow, distant figures pace. Each one is a 1-pixel hallucination engine.
 * The named subject (and at most the camera) should be the only source of
 * motion — every other prop must read INERT.
 *
 * Compact ~220 chars. Inject for every people-bearing or single-subject
 * clip. Skip on `atmosphere_wide` (the environment IS the subject).
 */
export const SECONDARY_PROPS_INERT_GUARD = `
SECONDARY PROPS INERT: background and side props (cups, books, lamps, plants, fabrics, dishes, devices not held by subject) stay completely still — no steam, flicker, drift, page-flip, sway, or liquid motion. Only the named subject and the camera move.
`.trim();

/**
 * KLING NEGATIVE PROMPT BUILDER
 * ---
 * Kling exposes a dedicated `negative_prompt` field that the model treats as
 * a hard ban-list — far more reliable than burying "no XXX / NO XXX" sentences
 * inside the main prompt where they compete with positive creative direction.
 *
 * Strategy: aggregate every ban-style clause that currently lives inside our
 * main-prompt guards (PHYSICAL_REALISM, MOTION_REALISM, RIGID_PRODUCT,
 * HUMAN_FACE, LIFELIKE_PRESENCE) into a single comma-separated string sent
 * via `negative_prompt`. The guards themselves stay unchanged for now (so
 * Seedance and image-gen pipelines are unaffected).
 *
 * Categories enforced regardless of mode (always-on artifacts):
 *   - PHYSICAL_REALISM bans: starburst, lens flare, bloom, god rays, HDR
 *     neon, soap-bubble bokeh, mirror-wet floor, fake speed-blur on static
 *     objects, plastic airbrush skin.
 *   - MOTION_REALISM bans: rubber-band warp, sliding feet, floating, idle
 *     drift, breathing zoom, fake slow-mo, morph.
 *   - SCALE bans: oversized product, enlarged toward lens, shrunken product,
 *     inverse scale, body parts emerging from products.
 *   - QUALITY bans: blurry, distorted, deformed, low quality, watermark,
 *     text overlay, label glitch, duplicated logo.
 *
 * Conditional categories:
 *   - productOnly=true → also ban any human/body anatomy AND product
 *     deformation/morph (RIGID_PRODUCT bans).
 *   - hasHuman=true   → also ban LIFELIKE breath/sigh artifacts and
 *     HUMAN_FACE anatomy artifacts.
 *
 * Length: ~600-900 chars depending on mode. Kling has no published
 * negative_prompt char limit but practical limit is ~2500.
 */
export function buildKlingNegativePrompt(opts: {
  productOnly?: boolean;
  hasHuman?: boolean;
  extra?: string;
} = {}): string {
  const { productOnly = false, hasHuman = !productOnly, extra = "" } = opts;

  const QUALITY = [
    "blurry", "distorted", "deformed", "low quality", "watermark",
    "text overlay", "label glitch", "duplicated logo",
  ];

  // PHYSICAL_REALISM ban-list — fake light/optics AI keeps inventing.
  const PHYSICAL_REALISM = [
    "starburst flare", "sparkle VFX", "lens flare", "bloom glow",
    "god rays", "halo bloom", "chromatic aberration", "HDR neon",
    "oversaturated highlights", "soap-bubble bokeh",
    "mirror-wet floor", "wet reflective ground when surface is dry",
    "speed blur on static object", "motion blur on still subject",
    "floating product without contact shadow", "CGI plastic polish",
  ];

  // MOTION_REALISM ban-list — AI-video uncanny motion.
  const MOTION_REALISM = [
    "rubber-band warp", "shape-shifting limbs", "morphing silhouette",
    "sliding feet", "floating feet", "perpetual idle drift",
    "breathing zoom", "fake slow-mo", "limb morph",
  ];

  // SCALE ban-list — inverse-scale failures.
  const SCALE = [
    "oversized product", "enlarged product toward lens",
    "product as large as face", "product comparable to hand size when it should be smaller",
    "shrunken product", "miniaturized product", "inverse scale",
    "body parts emerging from products", "hand bigger than car door",
  ];

  let parts = [...QUALITY, ...PHYSICAL_REALISM, ...MOTION_REALISM, ...SCALE];

  if (productOnly) {
    // Anti-human + RIGID_PRODUCT bans.
    parts = parts.concat([
      "people", "person", "human", "model", "face", "body",
      "hand", "hands", "fingers", "arm", "silhouette",
      // RIGID_PRODUCT bans:
      "product morph", "warped product", "swelling volume", "shrinking volume",
      "breathing volume", "melting edges", "logo distortion",
      "camera pan on locked shot", "dolly on locked shot", "handheld shake on locked shot",
    ]);
  }

  if (hasHuman) {
    // LIFELIKE bans (anti-sigh) + HUMAN_FACE anatomy bans.
    parts = parts.concat([
      // LIFELIKE — never want these on humans:
      "visible deep breath", "shoulder rise and fall", "chest heave", "sigh",
      "nostril flare", "frozen face", "locked stare",
      // HUMAN_FACE anatomy:
      "extra fingers", "missing fingers", "fused fingers", "deformed hand",
      "disembodied hand", "limb emerging from clothing",
      "plastic skin", "airbrushed skin", "uncanny face",
      "mirrored facial features", "painted catchlight",
    ]);
  }

  // `extra` may itself be a comma-separated negative-prompt fragment
  // (e.g. from withContinuityNegativePrompt). Split it so each clause
  // participates in dedup individually instead of being treated as one
  // opaque blob — otherwise "blurry" inside extra and "blurry" in QUALITY
  // both survive.
  if (extra && extra.trim()) {
    for (const piece of extra.split(",")) {
      const t = piece.trim();
      if (t) parts.push(t);
    }
  }

  // Normalize each clause for dedup key:
  //   - lowercase
  //   - collapse internal whitespace
  //   - strip surrounding punctuation
  //   - drop trailing period
  // Display value keeps original casing/spacing of FIRST occurrence.
  const normalizeKey = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s\u00A0]+/g, " ")
      .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "")
      .trim();

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of parts) {
    const display = raw.replace(/[\s\u00A0]+/g, " ").trim();
    if (!display) continue;
    const key = normalizeKey(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(display);
  }

  // Kling enforces negativePrompt ≤ 2500 chars. Truncate by dropping
  // lowest-priority (last) terms until we fit.
  let result = deduped.join(", ");
  while (result.length > 2500 && deduped.length > 1) {
    deduped.pop();
    result = deduped.join(", ");
  }
  return result;
}

/**
 * KLING-SPECIFIC SLIM GUARDS — positive-instruction-only.
 *
 * WHY: Kling has a dedicated `negative_prompt` field where ALL ban-list items
 * already live (via buildKlingNegativePrompt). Repeating "NO X, NO Y" inside
 * the main prompt wastes ~500-800 chars of the 2500-char budget on redundant
 * bans, causing the creative body to be truncated by 60%+.
 *
 * These slim guards keep ONLY the positive physical-world rules that tell
 * Kling WHAT to do (not what to avoid). The bans are handled by negative_prompt.
 *
 * Product-only: ~200 chars (replaces RIGID_PRODUCT + PHYSICAL_REALISM + MOTION_REALISM = ~800)
 * Human: ~220 chars (replaces PHYSICAL_REALISM + MOTION_REALISM + PHYSICAL_SCALE + HUMAN_FACE = ~1100)
 */
export const KLING_SLIM_GUARD_PRODUCT = `
PRODUCT I2V: silhouette, thickness, logo identical every frame. Camera near-locked: ≤3% micro-push or 1° micro-orbit. Life from light shifts, reflections, dust, mist, background motion. Raw camera optics, real contact shadows.
`.trim();

export const KLING_SLIM_GUARD_HUMAN = `
HUMAN VIDEO: limbs keep length, joints bend naturally, feet contact ground. Real skin with pores, asymmetric face, 5 fingers per hand with visible wrist. Product at true physical scale relative to body. Raw camera optics, real contact shadows.
`.trim();

/**
 * KLING DYNAMIC CFG SCALE
 * ---
 * Kling's `cfg_scale` (0.0–1.0) controls prompt-adherence vs. creative
 * freedom. Higher = stricter to prompt (good for product fidelity, but
 * artifacts on humans), lower = more natural motion (good for humans /
 * lifestyle, but product can drift).
 *
 * Empirical sweet spots:
 *   - product-only / rigid object i2v: 0.7  (lock silhouette + logo)
 *   - human / lifestyle / model_interaction: 0.5  (Kling default-ish, natural motion)
 *   - ambient / cutaway / texture / mood-only: 0.4  (loosest, most cinematic)
 *
 * Default fallback is 0.5 — matches Kling's documented default and
 * preserves prior behavior for any call site that doesn't pass hints.
 */
/**
 * REPEATING_UNIT_GUARD — for products built from N discrete repeating units:
 * beaded bracelets (mala, shungite, pearl strands), beaded necklaces, link
 * chains, charm bracelets, watch bands with repeating links, beaded curtains.
 *
 * Failure mode this fixes:
 *   - Image gen: bead count drifts (8 beads → 11 beads), bead diameter
 *     oscillates, pattern (color/material rhythm) reshuffles, clasp invented
 *     or removed, cord/elastic morphs.
 *   - Video gen: each frame "re-rolls" the bead arrangement so the bracelet
 *     visibly breathes / shifts pattern between frames.
 *
 * Works alongside REFERENCE FIDELITY (which says "match the attached image")
 * — this guard adds the explicit count + symmetry rules the model otherwise
 * ignores when filling pixels.
 *
 * Returns "" when the product is not a repeating-unit item, so it composes
 * cleanly with existing guard-first assembly.
 *
 * Compact ~430 chars when active.
 */
const REPEATING_UNIT_REGEX = /\b(bracelet|mala|prayer\s*beads?|rosary|wristband|beaded\s+(?:necklace|strand|chain|cuff|choker)|pearl\s+(?:strand|necklace|bracelet)|charm\s+bracelet|link\s+chain|curb\s+chain|cuban\s+(?:link|chain)|figaro\s+chain|watch\s+(?:band|bracelet|strap)|tennis\s+(?:bracelet|necklace)|bangle\s+stack|bead(?:s|ed)?)\b/i;

export function isRepeatingUnitProduct(haystack?: string | null): boolean {
  if (!haystack) return false;
  return REPEATING_UNIT_REGEX.test(haystack);
}

export function buildRepeatingUnitGuard(haystack?: string | null): string {
  if (!isRepeatingUnitProduct(haystack)) return "";
  return `
REPEATING-UNIT FIDELITY: this product is built from N identical repeating units (beads / links / charms). Match the EXACT count, diameter, spacing, material and color rhythm shown in the reference image — do not invent, drop, duplicate, resize or recolor any unit. Clasp / cord / elastic stays identical (same type, same position, same finish). Across every frame the unit count and pattern must remain pixel-stable; no breathing, no reshuffle, no morph between units.
`.trim();
}

export function pickKlingCfgScale(opts: {
  productOnly?: boolean;
  hasHuman?: boolean;
  ambient?: boolean;
} = {}): number {
  const { productOnly = false, hasHuman = false, ambient = false } = opts;
  if (productOnly) return 0.7;
  if (ambient && !hasHuman) return 0.4;
  return 0.5;
}

