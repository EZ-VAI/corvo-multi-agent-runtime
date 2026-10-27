/**
 * STYLE_DNA — single source of truth for color-grade visual identity.
 *
 * Used by every layer that touches generation so the look the user picked on
 * the Style page actually survives all the way to the final clip:
 *   - generate-direction-preview  (the still preview the user sees first)
 *   - generate-editorial-keyframes (the 3 review stills)
 *   - generate-editorial-clips     (Kling text/image-to-video prompts)
 *   - generate-keyframe / generate-content-* (brand_film equivalents)
 *
 * Design choices
 * ──────────────
 * Each grade defines:
 *   - `prefix`  — a short, ALWAYS-FIRST descriptor that opens every prompt for
 *                  that grade ("VHS-era dreamcore palette, …"). This is the
 *                  Claude-style "same X style with" trick: by repeating the
 *                  identity at the front of every shot, the diffusion / video
 *                  model is forced to keep the same visual register across
 *                  multiple independent generations.
 *   - `positive` — the longer, descriptive instruction that goes at the end of
 *                  the prompt. Phrased as POSITIVE descriptions only — Kling
 *                  ignores "no X / avoid Y" the way SD does, so we tell it
 *                  what to put in instead of what to keep out.
 *   - `palette`  — 3-5 word color signature, used as a second anchor late in
 *                  the prompt to keep the colorist intent intact.
 *   - `cssFilter` — best-effort browser preview filter for the Style page
 *                   hover demo (NOT sent to the model — purely UI hint).
 */

export type GradeId =
  | "editorial_warm"
  | "editorial_cool"
  | "noir"
  | "natural"
  | "vintage_film"
  | "bw"
  | "dreamcore";

export interface StyleDna {
  id: GradeId;
  /** Human-facing short title (matches Style page card label). */
  title: string;
  /** Short positive prefix that opens EVERY prompt of this grade. */
  prefix: string;
  /** Long positive descriptor appended at the end. */
  positive: string;
  /** 3-5 word color signature. Anchored a second time inside the prompt. */
  palette: string;
  /** UI-only CSS filter approximation. */
  cssFilter: string;
}

export const STYLE_DNA: Record<GradeId, StyleDna> = {
  editorial_warm: {
    id: "editorial_warm",
    title: "Editorial Warm",
    prefix:
      "Editorial warm grade — golden tones, soft window light, lifted shadows, magazine-clean.",
    positive:
      "Refined editorial warmth: golden hour bias, creamy highlight rolloff, gently lifted shadows, soft north-window key, true skin tones with a subtle amber undertone, restrained contrast.",
    palette: "champagne, honey, warm bone, soft amber",
    cssFilter:
      "sepia(0.25) saturate(1.15) hue-rotate(-8deg) brightness(1.05) contrast(1.05)",
  },
  editorial_cool: {
    id: "editorial_cool",
    title: "Editorial Cool",
    prefix:
      "Editorial cool grade — crisp daylight, clean cyan-leaning shadows, controlled highlights.",
    positive:
      "Crisp magazine-clean palette: slight cyan in the shadows, neutral mid-tones, controlled specular highlights, true material color, calm controlled contrast.",
    palette: "cool ivory, slate cyan, glacier blue",
    cssFilter:
      "saturate(0.9) hue-rotate(180deg) brightness(1.02) contrast(1.08)",
  },
  noir: {
    id: "noir",
    title: "Noir",
    prefix:
      "Noir grade — high-contrast desaturated, deep blacks, sculpted side light, smoky atmosphere.",
    positive:
      "Sculpted hard side key, deep crushed blacks, controlled highlights, low color saturation pulled toward warm grey, dramatic chiaroscuro, smoky air, single-source feel.",
    palette: "ink black, smoke grey, warm bone highlight",
    cssFilter: "saturate(0.35) contrast(1.35) brightness(0.92)",
  },
  natural: {
    id: "natural",
    title: "Natural",
    prefix:
      "Natural grade — minimal stylization, true-to-life color, ungraded daylight feel.",
    positive:
      "Honest documentary look: true skin and material color, neutral white balance, gentle daylight contrast, no creative grade, no film emulation, looks like raw camera footage straight off the sensor.",
    palette: "true neutral, accurate skin, daylight balance",
    cssFilter: "saturate(1) contrast(1.02)",
  },
  vintage_film: {
    id: "vintage_film",
    title: "Vintage Film",
    prefix:
      "Expired Kodak Gold 200 grade — warm yellow-orange cast, lifted blacks, visible analog grain, halation around highlights, 1970s nostalgia.",
    positive:
      "Authentic 35mm film photograph, expired Kodak Gold 200 emulation: warm yellow-orange cast, lifted milky blacks, fine organic film grain throughout, gentle halation around highlights, slight color shift in shadows, faded sun-bleached nostalgia, looks scanned not digital.",
    palette: "faded amber, milky black, sun-bleached cream",
    cssFilter:
      "sepia(0.5) saturate(0.85) hue-rotate(-15deg) brightness(1.08) contrast(0.92)",
  },
  bw: {
    id: "bw",
    title: "Black & White",
    prefix:
      "Pure black-and-white silver-gelatin grade — fully greyscale, deep blacks, clean whites, fine grain.",
    positive:
      "True monochrome silver-gelatin photograph: fully greyscale (zero color), high-contrast tonal scale, deep crushed blacks, clean whites, fine even film grain, classic darkroom feel. NO color cast of any kind.",
    palette: "ink black, paper white, full greyscale",
    cssFilter: "grayscale(1) contrast(1.25) brightness(1.02)",
  },
  dreamcore: {
    id: "dreamcore",
    title: "Dreamcore",
    prefix:
      "VHS-era dreamcore grade — washed yellow-green cast, hazy bloom, faint chromatic aberration, 1990s camcorder feel.",
    positive:
      "Liminal dreamcore aesthetic: washed-out yellow-green color cast, slight overexposure with hazy bloom around highlights, faint chromatic aberration on edges, soft analog VHS texture, melancholic uncanny mood, 1990s home camcorder quality, slight horizontal scan-line feel.",
    palette: "washed yellow-green, hazy white, dim magenta fringe",
    cssFilter:
      "saturate(1.3) hue-rotate(40deg) brightness(1.1) contrast(0.9) blur(0.3px)",
  },
};

/** Safe lookup with editorial_warm as the fallback. */
export function getStyleDna(g?: string | null): StyleDna {
  if (g && (g as GradeId) in STYLE_DNA) return STYLE_DNA[g as GradeId];
  return STYLE_DNA.editorial_warm;
}

/**
 * Build the "same-style anchor" clause repeated at the FRONT of every prompt
 * in a multi-shot batch. This is the Claude-recommended technique: identical
 * leading sentence forces the model into the same visual register on every
 * independent generation.
 */
export function styleAnchorPrefix(g?: string | null): string {
  const dna = getStyleDna(g);
  return `[STYLE LOCK — every shot in this set shares this exact look] ${dna.prefix}`;
}

/**
 * The longer descriptive clause to append near the end of a prompt, after the
 * scene-specific instructions. Repeats the palette so the colorist intent
 * survives long prompts that get truncated by the model's context window.
 */
export function styleAnchorClause(g?: string | null): string {
  const dna = getStyleDna(g);
  return `LOOK: ${dna.positive} Color signature: ${dna.palette}.`;
}
