const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * UNIFIED REALISM GUARD v3 — comprehensive version
 * Consolidates ALL learned pillars from:
 * - Original 4 pillars: CONTINUITY, CAUSAL_APPEARANCE, MOTION_RESISTANCE, LIGHT_OCCLUSION
 * - LV ad analysis: cross-scene continuity, breathing room, fabric physics
 * - Seedance 2.0: layered prompt structure, optical surface precision
 * - EVA tutorial: volumetric atmosphere, depth layering, particle dynamics, high contrast
 *
 * Target: ~900-1100 chars collapsed to stay within prompt budget.
 */
export const REALISM_GUARD = collapseWhitespace(`
  REALISM: Single-take, no edge intrusion, no zoom/focal change. Motion fights gravity/friction/inertia.
  Neutral start pose — feet flat, weight balanced, fabric at drape. 3-plane depth (FG/MG/BG parallax).
  Atmospheric haze reveals light paths. Shadows shift with camera/subject. Material boundaries sharp.
`);

/**
 * PHYSICAL CAMERA GUARD — enforces real-world camera rig physics.
 * Real cameras: weigh 5-15kg on a dolly/Steadicam, have inertia, acceleration curves,
 * and cannot teleport. AI models default to weightless virtual cameras that move
 * unnaturally fast and change direction instantly.
 */
export const PHYSICAL_CAMERA_GUARD = collapseWhitespace(`
  Weighted camera movement like a real rig on dolly or Steadicam — physical inertia, not weightless virtual camera.
  One continuous arc through 3D space — never teleport or reverse direction.
  Gentle organic drift. Smooth acceleration and deceleration. Speed varies naturally.
`);

/**
 * COMPACT CAMERA PHYSICS — ~220 chars. Used in anchored prompts where budget is tight.
 * Speed limits and ramp details are already in CAMERA_SPEED_CONSTRAINT, so this
 * focuses on the behavioral rules that CAMERA_SPEED_CONSTRAINT doesn't cover.
 */
export const PHYSICAL_CAMERA_GUARD_COMPACT = collapseWhitespace(`
  Weighted camera movement with physical inertia. One continuous arc — never teleport or reverse.
  Camera body is gimbal/tripod-stabilized — smooth acceleration and deceleration, NO handheld feel, NO sway, NO float.
`);

/**
 * CINEMATIC ATMOSPHERE INJECTION — appended to prompts for atmosphere-rich blocks.
 * Contains particle dynamics and high-contrast lighting techniques from EVA/LV analysis.
 */
export const CINEMATIC_ATMOSPHERE_LAYER = collapseWhitespace(`
  [PARTICLES] Dust motes drift through light beams at air-resistance speed. Faint steam rises from warm surfaces.
  Single fibers float through DOF. Particles catch light, proving volumetric depth. Movement SLOW — air drag governs.
  [QUALITY] Shot on a real camera. No post-processing, no color filters, no glow effects, no lens flare.
  Natural daylight or practical light sources only. Real material textures with visible wear and imperfections.
  Looks like raw ungraded camera footage — not a movie poster, not a music video, not CGI.
`);

// Keep individual named exports for external consumers that may still import them
export const CONTINUITY_GUARD = REALISM_GUARD;
export const CAUSAL_APPEARANCE_GUARD = REALISM_GUARD;
export const MOTION_RESISTANCE_GUARD = REALISM_GUARD;
export const LIGHT_OCCLUSION_GUARD = REALISM_GUARD;

/**
 * SHOT SCALE SYSTEM (景别系统) — from Corvo Shot Bible.
 * Maps scale codes to standardized AI prompt vocabulary and psychological effects.
 * Scale controls intimacy, desire, and aspiration in luxury advertising.
 */
export const SHOT_SCALE_MAP: Record<string, { prompt: string; coverage: string; emotion: string }> = {
  "ECU": { prompt: "extreme close-up, single detail fills frame", coverage: "single detail: eye, lip, gem facet, texture grain", emotion: "obsession, desire, hyper-intimacy" },
  "CU":  { prompt: "close-up, subject fills frame", coverage: "face fills frame, or single product fills frame", emotion: "connection, emotional pull, product focus" },
  "MCU": { prompt: "medium close-up, head and shoulders", coverage: "head + shoulders, or product with immediate context", emotion: "personality, approachable luxury" },
  "MS":  { prompt: "medium shot, waist up", coverage: "waist up, or product in styled setting", emotion: "context + detail balance, editorial" },
  "MLS": { prompt: "medium long shot, knees up, full outfit visible", coverage: "knees up, full outfit visible", emotion: "fashion editorial, silhouette read" },
  "LS":  { prompt: "long shot, full body with environment", coverage: "full body with environment", emotion: "aspiration, world-building" },
  "ELS": { prompt: "extreme long shot, subject small in vast environment", coverage: "subject small in vast environment", emotion: "scale, prestige, grandeur" },
};

/**
 * SCALE PAIRING RULES — Shot Bible mandate:
 * Never jump more than 2 scales in a single cut. Exception: ONE intentional "shock cut" ELS→ECU per ad.
 */
export const SCALE_ORDER = ["ECU", "CU", "MCU", "MS", "MLS", "LS", "ELS"];

export const isScaleJumpValid = (fromScale: string, toScale: string): boolean => {
  const fromIdx = SCALE_ORDER.indexOf(fromScale);
  const toIdx = SCALE_ORDER.indexOf(toScale);
  if (fromIdx === -1 || toIdx === -1) return true; // unknown scales pass
  return Math.abs(fromIdx - toIdx) <= 2;
};

/**
 * CAMERA ANGLE SYSTEM (拍摄角度) — from Corvo Shot Bible.
 * Angle is psychological manipulation. Choose with intent, never by default.
 */
export const CAMERA_ANGLE_MAP: Record<string, { prompt: string; psychology: string; bestFor: string }> = {
  "eye-level":  { prompt: "eye level shot, camera at subject eye height", psychology: "neutral, honest, editorial", bestFor: "beauty close-ups, editorial fashion" },
  "low-angle":  { prompt: "low angle shot looking up at subject, dramatic perspective", psychology: "power, dominance, aspiration", bestFor: "model power walks, heel shots, architecture" },
  "high-angle": { prompt: "high angle shot looking down", psychology: "vulnerability, elegance, overview", bestFor: "flat-lay jewelry, table-top beauty" },
  "dutch":      { prompt: "dutch angle, camera tilted on roll axis", psychology: "tension, edginess, avant-garde", bestFor: "streetwear, editorial drama (sparingly)" },
  "birds-eye":  { prompt: "bird's eye view, directly overhead 90 degrees down", psychology: "graphic, controlled, curated", bestFor: "flat-lay, unboxing, ingredient layouts" },
  "worms-eye":  { prompt: "worm's eye view, camera on ground looking up", psychology: "towering, monumental", bestFor: "heel reveals, dramatic entrances" },
  "three-quarter": { prompt: "three-quarter angle, offset 45 degrees from front", psychology: "depth, dimension, sculptural", bestFor: "handbag structure, watch profile" },
};

/**
 * FOCUS & DEPTH SYSTEM (聚焦与景深) — from Corvo Shot Bible.
 * Focus is attention control. Where you focus is what the viewer values.
 */
export const FOCUS_TECHNIQUE_MAP: Record<string, { prompt: string; description: string }> = {
  "shallow-dof":   { prompt: "shallow depth of field, f/1.4, creamy circular bokeh background", description: "subject sharp, bg creamy bokeh" },
  "deep-focus":    { prompt: "deep focus, everything sharp foreground to background, f/8", description: "everything sharp fg to bg" },
  "rack-focus":    { prompt: "smooth rack focus shift from foreground to background subject", description: "focus shifts from A to B within same shot" },
  "pull-focus":    { prompt: "pull focus tracking moving subject, maintaining sharp focus", description: "focus follows moving subject" },
  "soft-focus":    { prompt: "soft focus, intentionally slightly dreamy and ethereal", description: "dreamy, vintage luxury feel" },
  "macro":         { prompt: "extreme macro close-up, every surface detail visible, side-lit", description: "extreme close focus on tiny details" },
  "split-diopter": { prompt: "split diopter, two planes sharp with blurred middle", description: "foreground and background both sharp, tension" },
  "tilt-shift":    { prompt: "tilt-shift selective focus plane", description: "selective focus, miniature effect" },
};

/**
 * MOVEMENT SPEED GUIDE — maps style to camera movement speed vocabulary.
 */
/**
 * BELIEVABILITY BIBLE — SCENE CAUSALITY GUARD (场景因果)
 * Encodes the cognitive prediction engine that makes scenes "make sense."
 * Based on Corvo Believability Bible Layer 1 (C-01 through C-10).
 * Injected into the system prompt for block generation.
 */
export const SCENE_CAUSALITY_RULES = "";

/**
 * BELIEVABILITY BIBLE — LIFELIKE PRESENCE GUARD (活人感)
 * Converts AI "state machines" into continuous emotional flows.
 * Based on Corvo Believability Bible Layer 2 (L-01 through L-10).
 * Compact version for injection into per-block generation prompts.
 */
export const LIFELIKE_PRESENCE_COMPACT = "";

export const LIFELIKE_PRESENCE_ESSENTIAL = "";

/**
 * KEYFRAME ANCHORING — Frame 1 / Frame N specs by block type.
 * "Frame 1 is a Promise, Frame N is Proof."
 * Used to inject first/last frame descriptions into keyframe generation prompts.
 */
export const KEYFRAME_ANCHORING: Record<string, { frame1: string; frameN: string }> = {
  "product-reveal": {
    frame1: "Product not visible or only partially visible (edge of frame, shadow, silhouette). Model expression: anticipation or curiosity, gaze toward where product will appear, lips slightly parted. Lighting: darker, key light hasn't fully reached product position yet.",
    frameN: "Product fully revealed, lit, in focus, primary subject. Model expression: satisfaction or admiration, settled (not peak), onset delay already passed. Full key light on product, sparkle points active.",
  },
  "model-pose": {
    frame1: "Mid-stride, weight on front foot, rear foot pushing off. Expression: neutral-to-composed, jaw relaxed. Gaze: focused ahead with slight downward angle. Hair and fabric in motion-start position.",
    frameN: "Weight shifted, stride has progressed. Expression: distinctly different from Frame 1 (subtle confidence emerged). At least one blink has occurred. Hair shows motion delay. Posture adjusted.",
  },
  "hero-shot": {
    frame1: "Product positioned but not yet in hero lighting. Anticipation beat — camera approaching. Environmental context visible.",
    frameN: "Product in full hero lighting, maximum clarity, all defining features visible. Camera at closest/best angle. Sparkle/reflection points active.",
  },
  "texture-macro": {
    frame1: "Macro view of surface/material, camera beginning approach. Lighting reveals initial texture detail.",
    frameN: "Camera has traveled along surface revealing new detail. Light has shifted slightly from camera movement parallax. Same material, deeper intimacy.",
  },
  "atmosphere": {
    frame1: "Full scene visible, establishes location/time/mood. No product yet. Highest-contrast element is the emotional anchor (architecture, light, not random object).",
    frameN: "Same environment, camera has moved to tighter framing. All elements from Frame 1 remain consistent. Mood has been confirmed — viewer understands the story type.",
  },
  "statement-close": {
    frame1: "Product in brand context, lighting established. Expression (if human): composed confidence.",
    frameN: "Same scene, light may have subtly intensified on product. Expression settled to quiet satisfaction. Brand presence confirmed.",
  },
  "beauty-application": {
    frame1: "Product in hand approaching face. Pre-application skin state visible. Expression: concentration, slight brow furrow. Gaze on application point.",
    frameN: "Product applied, visible on skin/lips. Expression: relaxed from concentration, micro-smile onset after 0.5s delay. Hand withdrawn or in final position. Distinctly different from Frame 1.",
  },
};

/**
 * AER (Anticipation–Event–Reaction) chain timing ratios.
 * Every meaningful moment follows this three-beat sequence.
 */
export const AER_TIMING = {
  anticipation: { min: 0.2, max: 0.4 },  // 20-40% of sequence
  event:        { min: 0.2, max: 0.3 },  // 20-30% of sequence
  reaction:     { min: 0.3, max: 0.5 },  // 30-50% of sequence
};

export const MOVEMENT_SPEED_MAP: Record<string, string> = {
  "luxury":    "barely perceptible movement, viewer feels pulled not pushed, ultra-slow",
  "editorial": "noticeable but controlled movement, deliberate pace",
  "energy":    "dynamic movement, used for transitions only not sustained shots",
};

/**
 * COMPOSITION RULES — from Shot Bible Chapter 6.
 * Maps composition types to prompt vocabulary and spatial instructions.
 */
export const COMPOSITION_RULE_MAP: Record<string, { prompt: string; description: string }> = {
  "rule-of-thirds":       { prompt: "subject positioned at rule-of-thirds intersection point", description: "subject at 1/3 intersection, not centered" },
  "center-dominant":      { prompt: "subject centered in frame, symmetrical composition", description: "centered, symmetrical, authoritative" },
  "negative-space-left":  { prompt: "subject in right third of frame, generous negative space on left", description: "subject right, breathing room left" },
  "negative-space-right": { prompt: "subject in left third of frame, generous negative space on right", description: "subject left, breathing room right" },
  "diagonal":             { prompt: "subject placed along diagonal line from corner to corner, dynamic tension", description: "diagonal placement, dynamic energy" },
  "frame-within-frame":   { prompt: "subject framed within an architectural or environmental frame (doorway, mirror, window)", description: "nested framing, depth layers" },
  "leading-lines":        { prompt: "environmental lines (road, rail, edge, shadow) lead eye toward subject", description: "converging lines guide attention" },
  "golden-ratio":         { prompt: "subject at golden ratio point, slightly off-center with organic balance", description: "golden section placement, natural balance" },
};

/**
 * TERMINOLOGY CONSISTENCY RULES — prevents contradictions like "static focus + dolly".
 * Each rule: if focusTechnique is X, then certain camera/movement terms are incompatible.
 */
export const TERMINOLOGY_CONFLICTS: Array<{ field: string; value: string; bannedIn: string; bannedPatterns: RegExp[]; exactMatch?: boolean }> = [
  // "locked focus" or "deep-focus" conflicts with rack/pull focus language
  { field: "focusTechnique", value: "deep-focus", bannedIn: "prompt", bannedPatterns: [/rack\s*focus/gi, /pull\s*focus/gi, /focus\s*shift/gi, /focus\s*transition/gi] },
  // "shallow-dof" conflicts with "deep focus" or "everything sharp"
  { field: "focusTechnique", value: "shallow-dof", bannedIn: "prompt", bannedPatterns: [/deep\s*focus/gi, /everything\s*sharp/gi, /f\/8/gi, /f\/11/gi] },
  // "macro" conflicts with wide/long/medium shot scale
  { field: "focusTechnique", value: "macro", bannedIn: "shotScale", bannedPatterns: [/\b(LS|ELS|MLS|MS)\b/g] },
  // Static/locked camera conflicts with dolly/orbit/crane language IN FREE TEXT ONLY
  // exactMatch: true means field must be EXACTLY "static"/"locked", not just contain it as substring
  // The post-validator uses a section-aware cleaner that protects [MOVEMENT], AVOID, and CAMERA_SPEED lines
  { field: "cameraMotion", value: "static", bannedIn: "prompt", exactMatch: true, bannedPatterns: [/\bdolly\b/gi, /\borbit\b/gi, /\bcrane\b/gi, /\btracking\b/gi, /\bpush\s*in\b/gi] },
  { field: "cameraMotion", value: "locked", bannedIn: "prompt", exactMatch: true, bannedPatterns: [/\bdolly\b/gi, /\borbit\b/gi, /\bcrane\b/gi, /\btracking\b/gi] },
];

/**
 * BELIEVABILITY POST-VALIDATOR — checks block prompts for C-01 through C-10 violations.
 * Returns an array of warnings and auto-corrections.
 */
export interface BelievabilityCheck {
  rule: string;
  violation: string;
  correction: string;
}

export function validateBelievability(
  prompt: string,
  duration: number,
  hasHuman: boolean,
  entryMotion: string,
  exitMotion: string,
): BelievabilityCheck[] {
  const issues: BelievabilityCheck[] = [];

  // [C-01] No Event Without Anticipation — check for spontaneous object appearances
  const spontaneousPatterns = [
    /\ba\s+hand\b(?!.*(?:already|entering|edge|peripheral|approaching))/gi,
    /\ban?\s+(?:arm|figure|silhouette)\s+(?:appears|sweeps|enters|crosses)/gi,
  ];
  for (const pattern of spontaneousPatterns) {
    if (pattern.test(prompt) && !prompt.includes("setupCue") && !prompt.includes("peripheral") && !prompt.includes("edge of frame")) {
      issues.push({
        rule: "C-01",
        violation: "Object appears without anticipation signal",
        correction: "Added peripheral motion cue before object entry",
      });
    }
  }

  // [C-02] Reaction ≥ Event — check if prompt ends with an event (no reaction beat)
  const endsWithEvent = /(?:clears|passes|crosses|sweeps|exits|departs|finishes|completes)[^.]*\.?\s*$/i.test(prompt);
  if (endsWithEvent && !exitMotion && duration >= 3) {
    issues.push({
      rule: "C-02",
      violation: "Shot ends with event — no reaction/dwelling beat after",
      correction: "Append reaction beat: light settles, reflections stabilize, composition breathes",
    });
  }

  // [C-07] No Spontaneous Objects — new elements mid-shot
  if (/(?:suddenly|appears?|materializ|pops? (?:in|up)|emerges? from nowhere)/i.test(prompt)) {
    issues.push({
      rule: "C-07",
      violation: "Spontaneous object appearance mid-shot",
      correction: "Object must be already in frame, carried by person, or enter from off-frame with cause",
    });
  }

  // [L-01] 2-Second Rule — frozen expression warning for human blocks
  if (hasHuman && duration >= 4 && !/(?:blink|micro|shift|relax|adjust|drift)/i.test(prompt)) {
    issues.push({
      rule: "L-01",
      violation: "No micro-expression changes specified for 4s+ human block",
      correction: "Insert micro-shift cues: blink, jaw relax, gaze drift",
    });
  }

  return issues;
}

/**
 * AUTO-FIX believability issues in a prompt.
 */
export function fixBelievabilityIssues(
  prompt: string,
  issues: BelievabilityCheck[],
  duration: number,
): string {
  let fixed = prompt;

  for (const issue of issues) {
    switch (issue.rule) {
      case "C-01":
        // Add anticipation cue before spontaneous entries
        fixed = fixed.replace(
          /\b(a\s+hand|an?\s+(?:arm|figure|silhouette))\s+(appears|sweeps|enters|crosses)/gi,
          "a faint motion signal at frame edge precedes — $1 $2"
        );
        break;
      case "C-02":
        // Append reaction beat
        fixed = `${fixed} REACTION BEAT (final 0.5s): Light settles on surfaces, reflections stabilize to new camera position, composition breathes — the moment LANDS before the cut.`;
        break;
      case "C-07":
        // Replace spontaneous language
        fixed = fixed.replace(/suddenly\s+appears?/gi, "enters from frame edge");
        fixed = fixed.replace(/materializ\w*/gi, "becomes visible as camera reveals it");
        fixed = fixed.replace(/pops?\s+(in|up)/gi, "is discovered by the camera");
        break;
      case "L-01":
        // Add micro-expression cues
        fixed = `${fixed} LIFELIKE: At least one micro-expression shift (blink, jaw relax, gaze drift) every 2s.`;
        break;
    }
  }

  return fixed;
}

export const PRODUCT_ONLY_CAUSALITY_LOCK = collapseWhitespace(`
  PRODUCT-ONLY: No humans, hands, fingers, body parts. Product stays static on surface. Motion from camera movement and environment only.
`);

const PRODUCT_ONLY_UNSAFE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bvisible action\b/gi, "camera-relative parallax"],
  [/\bobservable action\b/gi, "camera-relative parallax"],
  [/\btactile interaction\b/gi, "camera-relative surface parallax and environmental micro-events only"],
  [/\btactile detail\b/gi, "surface detail"],
  [/\bbelievable support\b/gi, "stable visible grounding already established in the scene"],
  [/\bwearer POV\b/gi, "camera-observed product framing"],
  [/\bhandling\b|\bheld\b|\bholding\b|\bpick ?up\b|\badjustment\b|\badjust\b|\bmanipulate\b|\bmanipulation\b|\btouch(?:ing)?\b|\bgrasp\b/gi, "camera-relative parallax only"],
  [/\bif the object changes orientation\b/gi, "if perspective appears to shift around the object"],
  [/\bif the product changes orientation\b/gi, "if perspective appears to shift around the product"],
  [/\bchanges orientation\b/gi, "appears to shift in perspective"],
  [/\bobject angle changes\b/gi, "apparent viewing angle shifts due to camera movement"],
  [/\bproduct angle changes\b/gi, "apparent viewing angle shifts due to camera movement"],
  [/\bcontact with the surface stays convincing\b/gi, "surface grounding and contact remain optically convincing"],
];

const CONTINUITY_NEGATIVE_TERMS = [
  "edge intrusion",
  "duplicate object",
  "floating reflection",
  "melting object",
  "warped geometry",
  "growing object",
  "shrinking object",
  "hand",
  "hands",
  "finger",
  "fingers",
  "body part",
  "touch interaction",
  "handling product",
  "weightless motion",
];

export const sanitizeProductOnlyVideoPrompt = (prompt: string) => {
  let next = collapseWhitespace(prompt);
  if (!next) return PRODUCT_ONLY_CAUSALITY_LOCK;

  for (const [pattern, replacement] of PRODUCT_ONLY_UNSAFE_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }

  if (!next.includes("PRODUCT-ONLY CAUSALITY LOCK")) {
    next = `${next} ${PRODUCT_ONLY_CAUSALITY_LOCK}`;
  }

  return collapseWhitespace(next);
};

export const withContinuityGuard = (prompt: string) => {
  const cleanPrompt = collapseWhitespace(prompt);
  if (!cleanPrompt) return REALISM_GUARD;
  if (
    cleanPrompt.includes(REALISM_GUARD) ||
    cleanPrompt.includes("ABSOLUTE REALISM RULES") ||
    cleanPrompt.includes("CRITICAL REALISM AND CONTINUITY RULES")
  ) return cleanPrompt;
  return `${REALISM_GUARD} ${cleanPrompt}`;
};

/**
 * ASSOCIATION BIBLE — SENSORY ATTRIBUTE MAP
 * The master translation layer: Product Attribute → Sensory Quality → Metaphor Universe → Materials → Environments.
 * This is the 4-link chain: product attribute → sensory translation → natural metaphor → filmable scene.
 */
export const SENSORY_ATTRIBUTE_MAP: Record<string, {
  sensory: string;
  metaphors: string;
  materials: string;
  environments: string;
}> = {
  // Temperature & Sensation
  "cooling":      { sensory: "cold on skin", metaphors: "ice, frost, winter, morning dew", materials: "frosted glass, ice crystals, condensation, mist", environments: "frozen lake at dawn, glacier surface, cold marble, winter forest" },
  "warming":      { sensory: "warmth spreading", metaphors: "ember, honey, golden hour, heated stone", materials: "amber resin, warm oil, candle wax, heated silk", environments: "fireside, sunset desert, thermal springs, sunlit linen" },
  "soothing":     { sensory: "tension releasing", metaphors: "water settling, wind dying, ripple fading", materials: "still water surface, settling sand, slow pour of thick liquid", environments: "silent lake, empty cathedral, fog clearing, dawn stillness" },
  "energizing":   { sensory: "electric awakening", metaphors: "spark, first light, spring burst, cracking ice", materials: "effervescence, dew drops catching light, unfurling leaf", environments: "sunrise break, waterfall mist, first spring bloom, rain on hot stone" },
  "tightening":   { sensory: "compression, structure", metaphors: "architecture, tension, pull", materials: "taut fabric, stretched silk, compressed stone, pulled thread", environments: "suspension bridge cables, ballet en pointe, drawn bowstring" },
  "smoothing":    { sensory: "friction dissolving", metaphors: "silk, water over stone, mercury", materials: "liquid silk pour, river-polished pebble, melted glass", environments: "river delta, sand dune curves, silk unfurling in wind" },
  // Light & Luminosity
  "radiance":     { sensory: "inner light emitting", metaphors: "bioluminescence, dawn, molten gold", materials: "backlit honey, light through amber, candle in fog", environments: "deep ocean glow, lantern in mist, sun behind clouds" },
  "matte":        { sensory: "light absorbed", metaphors: "midnight, velvet, deep forest floor", materials: "brushed suede, powdered stone, unglazed clay", environments: "shadow under canopy, moonless night, darkroom" },
  "shimmer":      { sensory: "light dancing", metaphors: "stars, water sparkle, firefly", materials: "crushed crystal, wet stone in sun, sequin scatter", environments: "night sky, sunlight on ocean, chandelier refraction" },
  "translucency": { sensory: "light passing through", metaphors: "stained glass, shallow water, jellyfish", materials: "thin ice, backlit leaf vein, sheer fabric", environments: "cathedral window, tide pool, paper lantern" },
  "high-shine":   { sensory: "perfect reflection", metaphors: "mercury, still water, polished obsidian", materials: "chrome surface, oil slick, lacquered wood", environments: "mirror lake, polished marble hall, rain-wet street" },
  // Weight & Movement
  "lightweight":  { sensory: "near-weightlessness", metaphors: "feather, breath, cloud, pollen", materials: "gauze floating, dandelion seed, soap bubble", environments: "open sky, cliff edge, balloon release, wind across wheat" },
  "luxurious-weight": { sensory: "satisfying density", metaphors: "gold bar, aged wood, velvet drape", materials: "heavy pour of thick liquid, weighty chain links, settled fabric", environments: "library with leather chairs, vault, marble staircase" },
  "fluid":        { sensory: "continuous motion", metaphors: "river, poured oil, wind current", materials: "liquid metal, honey drip, ribbon in wind", environments: "waterfall, silk factory, ink in water" },
  "structured":   { sensory: "geometric precision", metaphors: "building, bridge, crystal lattice", materials: "folded origami, stacked stone, woven steel", environments: "brutalist architecture, scaffolding, geometric garden" },
  // Scent & Atmosphere
  "floral":       { sensory: "living, organic, fertile", metaphors: "garden, pollen, petal unfurling", materials: "wet petal, crushed herb, dewy leaf surface", environments: "greenhouse, wild meadow, rain garden, Kyoto moss" },
  "woody":        { sensory: "grounded, ancient, deep", metaphors: "forest floor, aged wood, root system", materials: "bark texture, dark soil, dried tobacco, leather", environments: "old-growth forest, wine cellar, cedar sauna" },
  "citrus":       { sensory: "bright, sharp, awake", metaphors: "morning, zest, first rain", materials: "citrus peel oil spray, dew on fruit, sparkling water", environments: "Mediterranean terrace, morning kitchen, orchard" },
  "musky":        { sensory: "skin-close, intimate, warm", metaphors: "body heat, whisper, bedsheets", materials: "warm skin, crumpled silk, breath on glass", environments: "candlelit bedroom, after-rain humidity, twilight balcony" },
  // Emotion & Identity
  "confidence":   { sensory: "upward, expanding, claiming space", metaphors: "lion, skyscraper, crown, stride", materials: "polished marble, sharp edge, pressed suit", environments: "rooftop, runway, throne room, wide boulevard" },
  "intimacy":     { sensory: "closing distance, softening", metaphors: "whisper, touch, held gaze", materials: "brushed cotton, fingertip on glass, folded letter", environments: "window seat, candlelight, empty room for two" },
  "mystery":      { sensory: "hidden, partially revealed", metaphors: "smoke, veil, eclipse, keyhole", materials: "sheer fabric, fog, half-shadow, reflective surface", environments: "dark corridor, masked ball, moonlit garden, backstage" },
  "freedom":      { sensory: "boundary dissolving", metaphors: "bird, open road, horizon, untied", materials: "flowing hair, untethered fabric, splashing water", environments: "cliff edge, convertible, open field, wind-blown rooftop" },
  "heritage":     { sensory: "depth of time", metaphors: "aging wood, vintage, heirloom", materials: "patina, worn leather, old photograph, aged gold", environments: "European old town, grandfather's study, museum hall, atelier" },
};

/**
 * ASSOCIATION BIBLE — VERTICAL-SPECIFIC ASSOCIATION CHAINS
 * Complete metaphor chains for common product claims per vertical.
 */
export const VERTICAL_ASSOCIATION_CHAINS: Record<string, Array<{
  claim: string;
  metaphor: string;
  scene: string;
  bridge: string;
}>> = {
  "beauty": [
    { claim: "hydrating", metaphor: "thirst, desert rain", scene: "dry earth drinking water, first rain drop hits and spreads", bridge: "cream spreading on skin echoes water spreading on earth, same macro scale, same lighting" },
    { claim: "anti-aging", metaphor: "time unwinding", scene: "flower blooming in reverse, rust dissolving", bridge: "wilted flower rehydrates — same reversal energy in skin transformation" },
    { claim: "brightening", metaphor: "inner light turning on", scene: "sunrise behind clouds, lantern in fog", bridge: "light breaks through cloud — same glow appears on skin" },
    { claim: "long-lasting", metaphor: "time passing without decay", scene: "flower preserved in resin, sundial shadow moving", bridge: "shadows sweep, everything ages, one element stays perfect" },
    { claim: "natural", metaphor: "growing, alive, rooted", scene: "seed in soil, stem pushes up, leaf unfurls", bridge: "organic growth energy matches natural ingredient story" },
  ],
  "fashion": [
    { claim: "lightweight", metaphor: "air passing through", scene: "wind through canyon, sheer fabric suspended in air", bridge: "same fabric on model, same air current, light passing through weave" },
    { claim: "structured", metaphor: "precision, architecture", scene: "drafting pencil drawing a perfect line, measured angle", bridge: "garment seam matches same precision, same angle, same tension" },
    { claim: "luxurious-texture", metaphor: "touch desire", scene: "slow-mo pour of thick golden liquid catching light", bridge: "hand touching fabric, same slow stroking motion, same light" },
    { claim: "heritage", metaphor: "accumulated time", scene: "artisan hands working leather, decades of skill", bridge: "same hands, same light, now working on the product" },
    { claim: "bold", metaphor: "commanding attention", scene: "velvet theater curtain parts, light floods in", bridge: "model steps into that light, wearing the piece" },
  ],
  "jewelry": [
    { claim: "brilliance", metaphor: "light splitting", scene: "white light enters prism, splits into spectrum", bridge: "same prismatic light plays across diamond facets" },
    { claim: "timeless", metaphor: "time not touching", scene: "stone temple unchanged for millennia, moss around but never on", bridge: "ring on marble, same untouchable permanence" },
    { claim: "delicate", metaphor: "almost invisible", scene: "spider silk catching morning light, dew drops along thread", bridge: "necklace chain in same macro, same light, same tension" },
    { claim: "bold-statement", metaphor: "gravitational pull", scene: "iron filings drawn to magnet in radial pattern", bridge: "same radial composition with piece at center" },
    { claim: "handcrafted", metaphor: "individual touch", scene: "brush tip meets paper, ink flows in organic pattern", bridge: "jeweler's tool meets metal, same organic precision" },
  ],
};

/**
 * ASSOCIATION BIBLE — SCENE TRANSLATION RULES
 * The 6 rules that govern how metaphor becomes filmable scene.
 */
export const ASSOCIATION_SCENE_RULES = collapseWhitespace(`
  ASSOCIATION BIBLE — SCENE TRANSLATION RULES (MANDATORY for metaphorical/awareness ads):
  [A-01] METAPHOR OPENS, PRODUCT CLOSES: The metaphorical scene plays FIRST. The product appears SECOND. Never reverse. Metaphor creates emotional state → product arrives as answer/embodiment.
  [A-02] BRIDGE FRAME: Between metaphor scene and product scene, ONE frame where both worlds coexist. Example: frost on glass → cream jar on frosted surface → application scene. Without the bridge, metaphor and product are two separate ads.
  [A-03] SHARED PHYSICS: Metaphor scene and product scene MUST share at least one physical quality: movement speed, light direction, color temperature, or texture rhythm. Mismatched physics breaks the spell.
  [A-04] ONE METAPHOR PER AD: Never mix metaphors. Cooling = ice/frost/winter ONLY, not also water/ocean/rain. Multiple metaphor universes = cognitive noise. Pick one and stay in it.
  [A-05] SENSORY SPECIFICITY: "Ice" is not specific enough. What KIND of ice? Frost crystals (intimate) vs glacier (powerful). Match metaphor specificity to product scale.
  [A-06] METAPHOR MUST BE PRETTIER THAN REALITY: The metaphorical scene is the most visually stunning moment. It's why people stop scrolling. Generic metaphor = generic product.
`);

/**
 * ASSOCIATION BIBLE — FORBIDDEN METAPHOR COMBINATIONS
 * Pairs that create cognitive dissonance and must never coexist in one ad.
 */
export const FORBIDDEN_METAPHOR_PAIRS: Array<[string, string, string]> = [
  ["ice/frost", "fire/ember", "opposite temperatures — sensory system cannot hold both"],
  ["water/ocean", "architecture/geometry", "organic vs rigid — one dissolves form, the other asserts it"],
  ["feather/air", "gold bar/marble", "weightless vs heavy — physical contradiction"],
  ["dawn/morning", "night/darkness", "opposite time of day — lighting and mood clash"],
  ["wildflower/meadow", "laboratory/chrome", "organic vs clinical — trust framework conflicts"],
];

/**
 * ASSOCIATION BIBLE — ANTI-PATTERNS
 * The 7 ways metaphorical advertising goes wrong.
 */
export const ASSOCIATION_ANTI_PATTERNS = collapseWhitespace(`
  ASSOCIATION ANTI-PATTERNS (AVOID):
  - VISUAL PUN: Too literal (ice cube next to cream jar). Fix: use NATURAL metaphor (frost forming on glass).
  - DISCONNECTED ART FILM: Beautiful footage unrelated to product. Fix: ensure bridge frame exists.
  - METAPHOR SOUP: Multiple metaphors (water + fire + earth). Fix: one metaphor universe per ad.
  - THE OBVIOUS ANALOGY: Too on-the-nose (strong perfume → roaring lion). Fix: add distance (the stillness after a door opens and everyone turns).
  - THE CLICHÉ: Overused (diamonds → stars). Fix: go one level deeper (diamonds → light splitting through prism).
  - THE FORCE MAJEURE: Scale mismatch (face cream → supernova). Fix: match metaphor scale to product scale.
  - BORROWED INTEREST: Metaphor unrelated to real attribute. Fix: must trace through 4-link chain.
`);

/**
 * ASSOCIATION BIBLE — DOMINANT ATTRIBUTE RULE
 * How to handle products with multiple attributes.
 */
export const ATTRIBUTE_HIERARCHY_RULE = collapseWhitespace(`
  ATTRIBUTE HIERARCHY (for products with multiple claims):
  - PRIMARY attribute: full metaphorical scene (4-link chain from attribute to filmable scene)
  - SECONDARY attribute: camera movement/composition (Shot Bible controls HOW to shoot)
  - TERTIARY attribute: lighting and color (color grade communicates the quality)
  - QUATERNARY attribute: typography/copy overlay only
  ONE metaphor, supported by cinematography choices. Never two metaphor scenes.
`);

/**
 * PRODUCT PROPORTION GUARD — injected into prompts for product-visible blocks.
 * Prevents AI models from exaggerating, enlarging, or distorting product dimensions.
 * Especially critical for small/delicate items like jewelry, cosmetics, accessories.
 */
export const PRODUCT_PROPORTION_GUARD = collapseWhitespace(`
  Product at REAL-WORLD SIZE — match reference photos exactly. Do NOT enlarge, exaggerate, or inflate dimensions.
  Small/delicate items stay small/delicate. On-model: product occupies same body proportion as in real life.
`);

/**
 * Auto-detect sensory attributes from product description keywords.
 * Returns the top 1-3 matching attribute keys from SENSORY_ATTRIBUTE_MAP.
 */
export function detectSensoryAttributes(
  productTitle: string,
  productDescription: string,
  category: string,
): string[] {
  const corpus = `${productTitle} ${productDescription} ${category}`.toLowerCase();
  const matches: Array<{ key: string; score: number }> = [];

  const ATTRIBUTE_KEYWORDS: Record<string, RegExp[]> = {
    "cooling":      [/cool(?:ing)?/i, /refresh(?:ing)?/i, /crisp/i, /frost/i, /icy/i, /mint/i],
    "warming":      [/warm(?:ing)?/i, /nourish/i, /cozy/i, /heat/i, /amber/i],
    "soothing":     [/sooth(?:ing|e)?/i, /calm(?:ing)?/i, /gentle/i, /relax/i, /peaceful/i],
    "energizing":   [/energiz/i, /revitaliz/i, /boost/i, /awaken/i, /vivid/i, /vibrant/i],
    "smoothing":    [/smooth(?:ing)?/i, /soft(?:en)?/i, /silk(?:y|en)?/i, /polish/i],
    "radiance":     [/radian(?:ce|t)/i, /glow(?:ing)?/i, /lumin/i, /bright(?:en)?/i, /illuminat/i],
    "shimmer":      [/shimmer/i, /sparkl/i, /glitter/i, /sequin/i, /metallic/i],
    "high-shine":   [/shine|shiny|gloss(?:y)?|mirror|polish(?:ed)?|lacquer/i],
    "translucency": [/translucen|sheer|see-?through|transparent|diaphanous/i],
    "lightweight":  [/light(?:weight)?/i, /airy/i, /feather/i, /breath(?:able)?/i, /float/i, /effortless/i],
    "luxurious-weight": [/luxur(?:y|ious)/i, /rich(?:ness)?/i, /opulen/i, /heavy|weighty|substantial/i, /velvet/i],
    "fluid":        [/fluid/i, /flow(?:ing)?/i, /drape/i, /cascade/i, /pour/i, /liquid/i],
    "structured":   [/structur/i, /architect/i, /tailor/i, /geometr/i, /precision/i, /sharp/i],
    "floral":       [/floral/i, /flower/i, /botan/i, /petal/i, /rose/i, /jasmine/i, /bloom/i],
    "woody":        [/wood(?:y|en)?/i, /earth(?:y)?/i, /cedar/i, /sandalwood/i, /oud/i, /tobacco/i, /leather/i],
    "citrus":       [/citrus/i, /lemon/i, /orange/i, /bergamot/i, /fresh/i, /zest/i, /grapefruit/i],
    "musky":        [/musk(?:y)?/i, /sensual/i, /intimate/i, /skin/i, /amber/i, /vanilla/i],
    "confidence":   [/confiden/i, /power(?:ful)?/i, /bold/i, /strong/i, /empow/i, /fierce/i],
    "intimacy":     [/intima/i, /tender/i, /close/i, /personal/i, /gentle/i, /delicate/i],
    "mystery":      [/myster/i, /allur/i, /enigma/i, /secre/i, /hidden/i, /dark/i, /noir/i],
    "freedom":      [/free(?:dom)?/i, /liberat/i, /open/i, /wild/i, /untamed/i, /escape/i],
    "heritage":     [/heritage/i, /timeless/i, /classic/i, /vintage/i, /legacy/i, /tradition/i, /artisan/i, /craft/i],
  };

  for (const [key, patterns] of Object.entries(ATTRIBUTE_KEYWORDS)) {
    let score = 0;
    for (const p of patterns) {
      if (p.test(corpus)) score++;
    }
    if (score > 0) matches.push({ key, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map(m => m.key);
}

export const withContinuityNegativePrompt = (negativePrompt: string) => {
  const pieces = negativePrompt
    .split(",")
    .map((piece) => collapseWhitespace(piece))
    .filter(Boolean);

  for (const term of CONTINUITY_NEGATIVE_TERMS) {
    if (!pieces.includes(term)) pieces.push(term);
  }

  return pieces.join(", ");
};
