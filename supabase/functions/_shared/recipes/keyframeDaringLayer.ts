// Phase B — Keyframe Daring Layer
//
// CORE INSIGHT: AI video models (Kling/Seedance i2v) inherit composition,
// lighting, and color palette from the FIRST FRAME. Telling a clip prompt
// "extreme low angle, single hard source, monochrome palette" is mostly
// noise — those words can't reframe a locked first frame and tend to seed
// AI artifacts (lens flare, soap-bubble bokeh).
//
// Therefore, the ONLY layer where composition / lighting / palette are
// genuinely controllable is the keyframe (Gemini / gpt-image). This module
// produces the structured "daring" prompt section that injects those
// decisions into the keyframe generator.
//
// SAFETY: Daring is gated by culturalRegister — luxury / editorial registers
// can take strong aesthetic moves; casual / irreverent registers must stay
// readable, otherwise an indie founder's first ad looks like an AI mistake.

type FilmMode =
  | "PRODUCT_FILM"
  | "EDITORIAL"
  | "CLINICAL_LUXURY"
  | "NARRATIVE_SHORT"
  | "ENSEMBLE"
  | "EXPERIMENTAL";

type Mood =
  | "REVERENCE"
  | "INTIMATE"
  | "WONDER"
  | "DEFIANCE"
  | "MELANCHOLY"
  | "LEVITY"
  | "TENSION";

type CulturalRegister =
  | "en-luxury"
  | "en-casual"
  | "en-irreverent"
  | "eu-editorial"
  | "jp-minimalist"
  | "fr-couture"
  | "it-craft";

// Registers that can absorb strong aesthetic moves without looking broken.
const DARING_OK_REGISTERS = new Set<CulturalRegister>([
  "en-luxury",
  "eu-editorial",
  "jp-minimalist",
  "fr-couture",
  "it-craft",
]);

interface DaringRecipe {
  composition: string;   // angle + framing + negative space (physical, no jargon)
  lighting: string;      // light setup as a physical description
  palette: string;       // color treatment, single sentence
}

// Per (mode, mood) recipe table. Values are physical descriptions an image
// model can act on directly — no abstract "atmospheric tension" words.
// Keep each field under ~120 chars; this layer will be truncated by the
// keyframe budget if it grows.
const RECIPES: Partial<Record<`${FilmMode}|${Mood}`, DaringRecipe>> = {
  "PRODUCT_FILM|REVERENCE": {
    composition:
      "Shot from slightly below the product, looking up. Product occupies the lower-left third. Roughly 60% of the frame is empty, settled space above.",
    lighting:
      "One soft window-style source from upper-left at about 30° down. Long, soft falloff to deep shadow on the opposite side. No fill light. No rim.",
    palette:
      "Restrained near-monochrome built around the product's own dominant hue, with a single muted neutral surrounding it.",
  },
  "PRODUCT_FILM|INTIMATE": {
    composition:
      "Camera close to the product, eye-level with its top edge. Tight framing — product fills two-thirds of the frame, surrounding context only suggested at the edges.",
    lighting:
      "One small directional source skimming across the surface from one side, revealing micro-texture. The opposite side falls into low shadow.",
    palette:
      "Warm low-saturation palette built from skin-adjacent tones — beige, taupe, dusk warm, with the product's color reading as the only accent.",
  },
  "PRODUCT_FILM|WONDER": {
    composition:
      "Wide framing with the product small in the lower portion of the frame. The space above is filled with environmental scale — architecture, sky, or material expanse.",
    lighting:
      "Single elevated source casting one long, defined shadow across an empty surface. Dramatic ratio — the bright side reads cleanly, the shadow side is deep.",
    palette:
      "Cool restrained palette with one saturated color anchor (often the product). Backgrounds desaturated; the product is the chromatic event.",
  },
  "PRODUCT_FILM|DEFIANCE": {
    composition:
      "Off-center, low-angle. Product placed against the bottom edge of the frame. Negative space fills the upper two-thirds, slightly tilted.",
    lighting:
      "One hard top-down source casting a sharp foreground shadow that crosses the composition. No fill. The product half-rim-lit by spill bouncing off a nearby surface.",
    palette:
      "High-contrast monochromatic — deep saturated single color (red, oxblood, ink-blue) bath against near-black, with the product as the only object that catches light.",
  },
  "EDITORIAL|MELANCHOLY": {
    composition:
      "Centered on a flat plane. Product or subject placed against a single dominant horizontal — wall, horizon, table edge — with empty space above and below.",
    lighting:
      "Diffuse overcast-style top light. No directional shadows. Even illumination but cool, slightly underexposed mid-tones.",
    palette:
      "Desaturated cool palette — fog gray, washed sage, paper white. Almost no chromatic accent; product reads in muted form.",
  },
  "EDITORIAL|TENSION": {
    composition:
      "Asymmetric framing. Subject pressed to one edge. The opposite half of the frame holds a single contrasting element (shadow block, hard architectural line, color field).",
    lighting:
      "Two opposing sources at uneven intensity — strong from one side, weak from the other. Visible shadow boundary across the subject.",
    palette:
      "Two-color contrast — one dominant cool, one accent warm. Rest of frame is near-black or near-white.",
  },
  "CLINICAL_LUXURY|REVERENCE": {
    composition:
      "Centered, symmetrical. Product on the optical axis of the lens. Clean horizon line dividing background and foreground in a precise ratio.",
    lighting:
      "Two equal soft sources symmetric to camera axis, eliminating shadow asymmetry. Background slightly brighter than product so silhouette reads cleanly.",
    palette:
      "Cool clean neutrals — porcelain white, glass-clear, brushed steel — with the product carrying the only color information.",
  },
  "CLINICAL_LUXURY|INTIMATE": {
    composition:
      "Macro-close, eye-level with the product's most crafted detail (clasp, stitch, dial, edge). Product fills 70% of the frame; surrounding space is uniform tone.",
    lighting:
      "One narrow soft source skimming the surface from one side at low angle, revealing micro-texture. The opposite side reads as a soft graduated shadow.",
    palette:
      "Pristine neutral — porcelain, paper-white, brushed metal — with the product's intrinsic color as the sole chromatic event.",
  },
  "CLINICAL_LUXURY|WONDER": {
    composition:
      "Wide symmetrical framing. Product occupies the center on a clean horizon. Empty graded background extends 60-70% of the frame above.",
    lighting:
      "One large soft source from above-front, evenly wrapping the product. Background carries a subtle gradient (lighter at the optical axis, darker at the corners).",
    palette:
      "Cool restrained gradient — pearl white into pale gray-blue — product is the only chromatic anchor.",
  },
  "CLINICAL_LUXURY|MELANCHOLY": {
    composition:
      "Centered, slightly elevated camera looking down at a slight angle. Product sits on a clean flat plane with a long shallow shadow trailing toward the bottom of the frame.",
    lighting:
      "Single soft overhead source. Light is even but cool, slightly underexposed. Background reads as cool dim white.",
    palette:
      "Cold near-monochrome — bone, ash, dim porcelain — with no warm tones anywhere.",
  },
  "PRODUCT_FILM|MELANCHOLY": {
    composition:
      "Wide framing, product placed low and small in the lower third. A single dominant horizontal (window edge, table line, distant horizon) cuts the upper portion.",
    lighting:
      "Diffuse overcast-style light from a large window or sky. No hard shadows. Mid-tones slightly underexposed; highlights stay restrained.",
    palette:
      "Cool desaturated palette — fog gray, washed slate, dim warm beige — chromatic information minimal.",
  },
  "PRODUCT_FILM|LEVITY": {
    composition:
      "Slightly off-center framing with the product floating in the middle-upper portion of the frame. Lots of clean negative space below; subject feels weightless.",
    lighting:
      "Bright soft top-and-front wraparound, almost shadowless. A faint warm bounce fills the underside of the product so it reads buoyant, not heavy.",
    palette:
      "Bright pastel field — soft cream, pale sky, warm peach — with the product's color popping as a single saturated note.",
  },
  "PRODUCT_FILM|TENSION": {
    composition:
      "Tight framing pressed to one side of the frame. Product partially cropped at one edge. The opposite edge holds a single hard architectural line or shadow block.",
    lighting:
      "Two opposing sources at very uneven intensity — strong from one side, weak from the other. A visible diagonal shadow boundary cuts across the product.",
    palette:
      "Two-color contrast — dominant cool against a single warm accent slash. Rest of the frame near-black or near-white.",
  },
  "NARRATIVE_SHORT|REVERENCE": {
    composition:
      "Medium-wide. Subject (or product in subject's hand) placed at a rule-of-thirds intersection, looking out of the frame. Quiet environmental context fills the rest.",
    lighting:
      "Soft directional key from a single window-style source. Long, gentle falloff. Background reads dim and contextual, not lit for its own sake.",
    palette:
      "Restrained warm palette — late-afternoon gold, soft amber, dim shadow — with one quiet color anchor.",
  },
  "NARRATIVE_SHORT|INTIMATE": {
    composition:
      "Close framing on the subject (or hand-with-product), eye-level. Camera sits within personal-distance range. Background is intentionally indistinct.",
    lighting:
      "One small soft source close to the subject (window, lamp, candle-style), wrapping warmly. Far side of the subject falls into low shadow.",
    palette:
      "Warm low-saturation tones — skin, dim amber, dusk — with the product reading as a single deeper accent.",
  },
  "NARRATIVE_SHORT|WONDER": {
    composition:
      "Wide framing — subject small in the lower portion of the frame, environment expansive above. Subject looks up or outward; product visible but not hero of frame.",
    lighting:
      "Single elevated source (sun, window, sky). One long defined shadow across an open surface. The light feels like it belongs to a place, not a studio.",
    palette:
      "Cool environmental palette with one saturated anchor — sky-blue against ochre, dawn pink against slate.",
  },
  "NARRATIVE_SHORT|DEFIANCE": {
    composition:
      "Low-angle on the subject from below. Subject occupies vertical center; their head is near the top edge. The product reads as part of their stance, not a held-up hero.",
    lighting:
      "One hard top-down source casting sharp downward shadows on the subject. No fill. Half-rim spill from a nearby surface separates the subject from the background.",
    palette:
      "High-contrast — saturated single color (oxblood, ink, deep emerald) bath against near-black, with skin and product catching the only light.",
  },
  "EDITORIAL|INTIMATE": {
    composition:
      "Tight framing, eye-level, intimate proximity. Subject pressed close to the lens; background is one continuous tone or a soft architectural plane.",
    lighting:
      "One large soft source close to the subject (window-style), wrapping. The opposite side of the subject reads as a soft, even shadow — no hard contour.",
    palette:
      "Muted warm — bone, paper, dim umber, soft amber — almost no saturated color except the product or one small wardrobe note.",
  },
  "EDITORIAL|DEFIANCE": {
    composition:
      "Subject framed dead-center, looking directly at the lens. Symmetrical horizontal architecture or wall behind. Product visible as part of the subject's stance, not held up.",
    lighting:
      "One hard front-on source casting a sharp foot-shadow directly behind the subject. Background slightly underexposed so the subject's silhouette reads cleanly.",
    palette:
      "Restrained two-color — dominant cool architectural neutral against one strong wardrobe / product saturation. Nothing else competes.",
  },
  "EDITORIAL|LEVITY": {
    composition:
      "Wider framing with subject loose in the frame, off-axis, mid-motion. Open negative space around them. Composition feels caught-not-staged.",
    lighting:
      "Bright even daylight or large soft source from above-front. Highlights can clip slightly on white surfaces. Almost no hard shadow.",
    palette:
      "Light bright field — cream, soft sky, pale stone — with one bright pop of saturation (wardrobe / product).",
  },
  "ENSEMBLE|REVERENCE": {
    composition:
      "Wide formal framing — group arranged across the horizontal mid-line of the frame. Symmetric or near-symmetric spacing. Heads aligned along a single height.",
    lighting:
      "Single large soft source from above-front, wrapping the whole group evenly. No member of the group lit more than another.",
    palette:
      "Restrained tonal palette — group wardrobe sits in a narrow value range; environment quiet behind them; product the chromatic anchor.",
  },
  "ENSEMBLE|INTIMATE": {
    composition:
      "Tighter framing — group clustered close, overlapping, eye-level. Edges of the group feather into negative space at the frame edge. One subject closest to lens reads as the anchor.",
    lighting:
      "One warm soft source close to the group (window, lamp). Falls off naturally so the group reads as inside one shared pocket of light.",
    palette:
      "Warm dim palette — skin, dusk amber, soft shadow. Product visible on one subject as the only accent.",
  },
  "ENSEMBLE|WONDER": {
    composition:
      "Wide framing — group small within an expansive environment. Group reads as a single shape against scale (architecture, sky, landscape) rather than as individuals.",
    lighting:
      "Environmental natural light from one direction. Group lit by the place, not by separate sources. Long shared shadow cast by the group as one mass.",
    palette:
      "Cool environmental palette with one warm anchor (group skin / wardrobe). Product reads as a small chromatic event within the group.",
  },
  "EXPERIMENTAL|DEFIANCE": {
    composition:
      "Dutch tilt at roughly 8-12°. Product occupies a small, deliberate corner of the frame. Vast negative space dominates.",
    lighting:
      "Single colored gel source from below, casting upward shadows on a backdrop. The product itself caught in the boundary between gel-color and uncolored spill.",
    palette:
      "Saturated monochromatic bath in one unexpected color (acid green, sodium orange, deep magenta) with no neutral relief.",
  },
  "EXPERIMENTAL|WONDER": {
    composition:
      "Extreme wide. Product placed off-center within an unexpected scale relationship (tiny against vast surface, or floating inside negative space without ground).",
    lighting:
      "One unexpectedly-placed source (from below, from behind, from off-screen), creating a non-natural shadow direction. Background reads as graduated color rather than a real place.",
    palette:
      "One saturated dominant color filling 80% of the frame, with the product's true color as the only contrasting note.",
  },
  "EXPERIMENTAL|TENSION": {
    composition:
      "Frame split sharply into two unequal zones by a single hard line (architectural, light boundary, color block). Product sits ON the boundary, half in each zone.",
    lighting:
      "Two sources of opposing color and intensity — one cold from one side, one warm from the other. Boundary visibly cuts across the product surface.",
    palette:
      "Two-color split — saturated cold (cyan, ink) against saturated warm (amber, oxblood) — no neutral relief anywhere.",
  },
  "EDITORIAL|REVERENCE": {
    composition:
      "Symmetric centered framing on a single horizontal plane. Subject at the optical axis. Wide unbroken negative space above the subject; floor or surface unbroken below.",
    lighting:
      "One large soft source from directly above-front, even wrap. No directional shadow on the face. Background a uniform graduated tone.",
    palette:
      "Restrained tonal palette — bone, paper, dim warm. Product is the only chromatic event; nothing else competes.",
  },
  "EDITORIAL|WONDER": {
    composition:
      "Wide framing — subject small inside a vast environmental field (architecture, sky, water plane). Subject placed off-center on a strong horizontal line.",
    lighting:
      "Single environmental source (sun, sky, large window). One long defined shadow across an open surface. Light feels like it belongs to a place.",
    palette:
      "Cool environmental palette with one saturated anchor — dawn pink against slate, or sky-blue against ochre. Product reads as the chromatic anchor.",
  },
  "CLINICAL_LUXURY|DEFIANCE": {
    composition:
      "Symmetric centered framing pushed slightly closer than comfortable. Product on the optical axis, occupying more of the frame than convention allows.",
    lighting:
      "One hard top-down source casting a sharp foot-shadow directly behind the product. No fill. Background slightly underexposed so the product's silhouette reads as a clean cutout.",
    palette:
      "Restrained — porcelain or graphite background — with the product carrying a single deeply saturated hue (oxblood, ink, deep emerald) as the only chromatic statement.",
  },
  "CLINICAL_LUXURY|LEVITY": {
    composition:
      "Centered, slightly elevated framing with the product floating above the lower third on a clean reflective plane. Generous symmetric negative space all around.",
    lighting:
      "Two equal soft sources from above-front, near-shadowless. A faint cool fill from below lifts the product so it reads buoyant rather than grounded.",
    palette:
      "Cool clean pastels — pearl, pale sky, soft mint — with the product's color as a single calm accent.",
  },
  "CLINICAL_LUXURY|TENSION": {
    composition:
      "Symmetric framing broken by ONE deliberate asymmetry — a single hard line, color block, or shadow boundary cutting across the frame at an unexpected angle.",
    lighting:
      "Two opposing soft sources at very uneven intensity. A clean visible boundary divides the product surface into a brighter and a dimmer half.",
    palette:
      "Two-color split — clinical cool (porcelain, ice) against one saturated warm (amber, oxblood). No third color anywhere.",
  },
  "NARRATIVE_SHORT|MELANCHOLY": {
    composition:
      "Wide framing — subject small in the lower portion of the frame, looking out of frame. A single dominant horizontal (window, horizon, table line) cuts the upper portion. Empty negative space above.",
    lighting:
      "Diffuse overcast-style light from a large window or sky. No hard shadow. Mid-tones slightly underexposed; subject's face barely modeled.",
    palette:
      "Cool desaturated palette — fog gray, dim slate, washed warm beige. Almost no chromatic accent.",
  },
  "NARRATIVE_SHORT|LEVITY": {
    composition:
      "Loose framing — subject mid-motion, off-axis, caught-not-staged. Wide negative space around the subject leaves room for the gesture to land.",
    lighting:
      "Bright soft daylight or a large soft top-front source. Highlights can clip slightly on white surfaces. Almost no hard shadow.",
    palette:
      "Light warm field — cream, pale stone, soft peach — with one bright pop of saturation on wardrobe or product.",
  },
  "NARRATIVE_SHORT|TENSION": {
    composition:
      "Tight framing pressed to one side. Subject partially cropped at one edge. The opposite edge holds a single hard architectural line, shadow block, or contrasting figure.",
    lighting:
      "Two opposing sources at very uneven intensity — strong from one side, weak from the other. A visible diagonal shadow boundary cuts across the subject's face.",
    palette:
      "Two-color contrast — dominant cool against one warm accent slash. Rest of the frame near-black or near-white.",
  },
  "ENSEMBLE|DEFIANCE": {
    composition:
      "Group framed dead-on, looking directly into the lens, arranged across the horizontal mid-line. Symmetric or near-symmetric architecture behind them. Tight spacing — group reads as a wall.",
    lighting:
      "One hard front-on source casting a sharp shared shadow behind the entire group. Background slightly underexposed so the group's collective silhouette reads cleanly.",
    palette:
      "Restrained two-color — cool architectural neutral against one strong saturated wardrobe / product anchor shared across the group.",
  },
  "ENSEMBLE|MELANCHOLY": {
    composition:
      "Wide framing with the group small and spread across the lower portion of the frame. Members positioned at unequal distances, gazes not aligned. Empty negative space dominates above.",
    lighting:
      "Diffuse overcast-style light from above. No directional shadow. Cool mid-tones, slightly underexposed.",
    palette:
      "Desaturated cool palette — fog gray, washed sage, paper white. Wardrobe sits in a narrow muted range; product the only minor accent.",
  },
  "ENSEMBLE|LEVITY": {
    composition:
      "Loose grouping — members caught mid-motion at different positions, gazes scattered, postures relaxed. Off-axis framing with generous negative space.",
    lighting:
      "Bright soft daylight or a large soft top source. Near-shadowless. Highlights can clip slightly on light surfaces.",
    palette:
      "Light bright field — cream, pale sky, soft peach — with one or two saturated wardrobe pops shared across the group.",
  },
  "ENSEMBLE|TENSION": {
    composition:
      "Group split into two unequal subgroups by a single hard architectural line, shadow boundary, or color block cutting through the frame. One subgroup pressed to one side; one isolated figure on the other.",
    lighting:
      "Two opposing sources at uneven intensity. The boundary visibly cuts the group — one subgroup brighter, the other in deeper shadow.",
    palette:
      "Two-color contrast — dominant cool against one warm accent. Wardrobe split echoes the lighting split.",
  },
  "EXPERIMENTAL|REVERENCE": {
    composition:
      "Symmetric centered framing on an unusual axis — overhead top-down, or directly underneath looking up. Product on the optical center; background reads as an abstract field.",
    lighting:
      "One large soft source from the unusual axis itself (top-down lit from straight above, or underlit through a translucent plane). Even wrap, no directional shadow.",
    palette:
      "Single-hue tonal field — entire frame bathed in one restrained color (deep blue, bone, oxblood) with the product as a slightly brighter or darker form within it.",
  },
  "EXPERIMENTAL|INTIMATE": {
    composition:
      "Macro-close on an unexpected fragment of the product (interior surface, underside, edge boundary). The fragment fills 80% of the frame; orientation is ambiguous.",
    lighting:
      "One narrow source skimming across the surface from off-screen at low angle. The opposite half of the frame falls into deep shadow.",
    palette:
      "Single saturated dominant color filling the frame, with the product's true material color as the only contrasting note.",
  },
  "EXPERIMENTAL|MELANCHOLY": {
    composition:
      "Product placed small inside a vast empty graduated color field. No ground line, no horizon, no real-place context — the product floats inside a pure tonal void.",
    lighting:
      "Soft even illumination from no clear direction. The product casts almost no shadow; it reads as suspended.",
    palette:
      "Single desaturated cool color filling the entire frame — fog, slate, washed indigo — with the product as the only non-tonal element.",
  },
  "EXPERIMENTAL|LEVITY": {
    composition:
      "Product placed off-center inside an unexpectedly cheerful color field. Scale relationship is playful — product reads slightly smaller than convention would set it.",
    lighting:
      "Bright even soft light from above-front. Near-shadowless. The product reads as buoyant, almost weightless.",
    palette:
      "Single saturated cheerful color (acid yellow, electric pink, mint) filling 80% of the frame, with the product's true color as the only contrasting note.",
  },
};

const DEFAULT_NEUTRAL: DaringRecipe = {
  composition:
    "Balanced eye-level framing. Product in the rule-of-thirds intersection. Comfortable negative space around it for the eye to settle.",
  lighting:
    "Soft directional key from one side at about 45°, mild fill from the opposite side, no rim. Natural-feeling ratio.",
  palette:
    "Neutral palette honoring the product's real colors. Background tones support but never compete with the product's hue.",
};

export interface KeyframeDaringInput {
  filmMode?: string | null;
  filmMood?: string | null;
  culturalRegister?: string | null;
  /**
   * Optional visualBible reference. Used for axis-level arbitration:
   *   - COMPOSITION axis: Daring always owns (visualBible rarely speaks per-shot).
   *   - LIGHTING axis: Daring writes light *geometry* (source count, angle, fill).
   *     visualBible.lighting (if present) keeps color-temperature / quality words.
   *   - PALETTE axis: visualBible.colorGrade (STYLE_DNA — user-picked) wins.
   *     Daring's palette is only emitted as fallback when colorGrade is absent.
   */
  visualBible?: {
    colorGrade?: string | null;
    lighting?: string | null;
  } | null;
}

/**
 * Build the keyframe daring section to inject into the keyframe prompt body.
 *
 * Returns "" in two cases:
 *   1. No creative-intent fields are present (preserves legacy behaviour).
 *   2. The cultural register cannot absorb daring (en-casual / en-irreverent) —
 *      in those registers, injecting a generic "neutral recipe" actually
 *      DEGRADES quality vs. letting Gemini choose organically. So we stay out.
 */
export function buildKeyframeDaringLayer({
  filmMode,
  filmMood,
  culturalRegister,
  visualBible,
}: KeyframeDaringInput): string {
  if (!filmMode && !filmMood && !culturalRegister) return "";

  const register = (culturalRegister || "en-luxury") as CulturalRegister;
  if (!DARING_OK_REGISTERS.has(register)) {
    // Casual / irreverent registers — let Gemini make organic choices.
    return "";
  }

  const mode = (filmMode || "PRODUCT_FILM") as FilmMode;
  const mood = (filmMood || "REVERENCE") as Mood;
  const recipe = RECIPES[`${mode}|${mood}` as const] || DEFAULT_NEUTRAL;

  // Axis-level arbitration with visualBible (STYLE_DNA).
  const hasColorGrade = Boolean(visualBible?.colorGrade && String(visualBible.colorGrade).trim());

  const lines: string[] = [
    `KEYFRAME CREATIVE DECISION (composition + light geometry decided HERE — the i2v video clip will inherit these from this frame; do not soften to a generic ad look):`,
    `- COMPOSITION: ${recipe.composition}`,
    `- LIGHT GEOMETRY: ${recipe.lighting} (Color temperature & quality continue to follow the visual bible / STYLE_DNA grade — do not override that.)`,
  ];
  if (!hasColorGrade) {
    // Only emit palette guidance when STYLE_DNA isn't already speaking.
    lines.push(`- PALETTE (fallback — no STYLE_DNA grade set): ${recipe.palette}`);
  }
  lines.push(
    `These decisions are mandatory for this frame. They must be visibly present, not just implied.`,
    "",
  );
  return lines.join("\n");
}
