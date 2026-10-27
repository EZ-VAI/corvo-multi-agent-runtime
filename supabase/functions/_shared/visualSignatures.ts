/**
 * Visual Signatures — Editorial Aesthetic Universes
 * ──────────────────────────────────────────────────
 * Replaces the per-shot "soft window light" hardcoded default with 6
 * self-contained, named visual universes. Each project locks ONE signature
 * (chosen by analyze-product-editorial or overridden by the user) and every
 * keyframe + clip in that project reads from the SAME signature's pools, so
 * the 5 shots feel like one editorial story rather than 5 unrelated stock
 * images. Across projects, signatures differ → the catalog stops looking
 * homogeneous.
 *
 * Why this exists (workflow-level):
 *   The user already picks vibe/texture/mood enums in Editorial Setup, but
 *   prior to this module those choices were silently overwritten by template
 *   constants like "soft daylight from a window". That's a UX-engineering
 *   contract violation: don't ask users to choose a thing that the prompt
 *   throws away. This module guarantees user choice → final prompt.
 *
 *   See `mem://features/editorial-pipeline/visual-signatures-system` for the
 *   full design doctrine.
 */

import type { CategoryLock } from "./categoryPhysics.ts";
import type { EmotionalTone, LightingMood } from "./editorialMood.ts";

export const VISUAL_SIGNATURES = [
  "editorial_soft",
  "editorial_bold",
  "editorial_nocturnal",
  "editorial_raw",
  "editorial_golden",
  "editorial_chiaroscuro",
  "editorial_business_mag",
] as const;
export type VisualSignature = (typeof VISUAL_SIGNATURES)[number];

/** Defensive coercion — anything we don't recognise (old drafts, model
 *  hallucinations) snaps back to `editorial_soft` to preserve the legacy
 *  default look. NEVER throws. */
export function coerceVisualSignature(v: unknown): VisualSignature {
  if (typeof v === "string" && (VISUAL_SIGNATURES as readonly string[]).includes(v)) {
    return v as VisualSignature;
  }
  return "editorial_soft";
}

/** Human-readable label + 1-line pitch — surfaced in the UI picker.
 *  Kept in this file so frontend + backend stay in sync. */
export const SIGNATURE_LABELS: Record<VisualSignature, { label: string; subtitle: string }> = {
  editorial_soft:        { label: "Soft Editorial",   subtitle: "Window light · marble · linen · calm Sunday" },
  editorial_bold:        { label: "Bold Graphic",     subtitle: "Hard sidelight · concrete · monochrome · brutalist" },
  editorial_nocturnal:   { label: "Nocturnal",        subtitle: "Tungsten lamp · hotel suite · jewel tones · intimate" },
  editorial_raw:         { label: "Raw Document",     subtitle: "Overcast · earthy · handheld · Magnum essay" },
  editorial_golden:      { label: "Golden Hour",      subtitle: "Late sun · terrace · warm · Mediterranean" },
  editorial_chiaroscuro: { label: "Chiaroscuro",      subtitle: "Single source · deep shadow · near-bw · gallery" },
  editorial_business_mag:{ label: "Business Magazine", subtitle: "White seamless · soft top light · Monocle / WSJ Magazine" },
};

// ─────────────────────────────────────────────────────────────────────────
// Lighting clauses — what gets injected into image/video prompts INSTEAD of
// the old hardcoded "soft daylight from a window". One per signature.
// ─────────────────────────────────────────────────────────────────────────

export const SIGNATURE_LIGHTING: Record<VisualSignature, string> = {
  editorial_soft:
    "soft broad window daylight, gentle wrap, neutral white balance, low contrast, natural skin tone",
  editorial_bold:
    "hard directional sidelight from a single source, sharp angular shadow line cutting across the frame, cool slate white balance, high contrast",
  editorial_nocturnal:
    "low warm tungsten lamp glow ~2700K, contained pool of light, deep velvet shadows around the subject, jewel-tone ambient bounce",
  editorial_raw:
    "overcast diffused available light, soft and shadowless, neutral cool white balance, slightly underexposed for honest tonal range",
  editorial_golden:
    "low golden-hour sun raking from one side, long warm shadows, amber rim along edges, no orange filter — natural late-day temperature",
  editorial_chiaroscuro:
    "one decisive light source from the side carving subject out of darkness, deep falloff into pure black, gallery-grade single-source dramatic lighting",
  editorial_business_mag:
    "soft broad overhead daylight from a large diffusion source, clean crisp shadow directly under the subject, neutral 5500K white balance, paper-white background, controlled medium-low contrast",
};

// ─────────────────────────────────────────────────────────────────────────
// 2-D Lighting Matrix — (signature × lightingMood). Phase B Editorial Gap 1.
//
// Why: prior 1-D `SIGNATURE_LIGHTING` produced ONE lighting line per signature,
// which silently overwrote the user's `lightingMood` enum from the editorial-
// setup step. Result: a user picking "single-source-dramatic" inside an
// `editorial_soft` project still got broad window daylight. The keyframe owns
// composition/lighting (i2v can't reframe locked first frames), so this is the
// place to honor that choice.
//
// Strategy: only override cells where the mood meaningfully MODULATES the
// signature without breaking it. Cells left undefined fall through to the
// 1-D base above. NEVER returns the wrong universe — e.g. picking
// "golden-hour" inside `editorial_chiaroscuro` doesn't bathe the chiaroscuro
// frame in warm sun (it just warms the single-source key). Safety floor.
// ─────────────────────────────────────────────────────────────────────────

export const SIGNATURE_LIGHTING_2D: Record<VisualSignature, Partial<Record<LightingMood, string>>> = {
  editorial_soft: {
    "low-warm-lamp":
      "soft window daylight balanced down with one warm tungsten lamp ~3000K filling the shadow side, neutral wrap, low contrast",
    "hard-north-light":
      "crisp cool north-window light, broad but more directional than usual, slightly raised contrast, neutral white balance",
    "golden-hour":
      "broad late-afternoon daylight raking warm through the window, gentle wrap, warm but not orange",
    "overcast-diffuse":
      "soft overcast daylight through the window, even wrap, near-shadowless, slightly cooler white balance",
    "single-source-dramatic":
      "soft window daylight pulled to one decisive side, gentle but directional, mid contrast — readable softness with intent",
  },
  editorial_bold: {
    "soft-daylight":
      "broad daylight angled hard from one side, sharper than diffuse — softness only on the fill, hard shadow line preserved",
    "low-warm-lamp":
      "single hard warm tungsten ~2700K from one side, sharp angular shadow line, deep shadow on the opposite half",
    "golden-hour":
      "low golden-hour sun raking hard from one side as the single key, long warm shadows, no fill",
    "overcast-diffuse":
      "even overcast key from one side only, no second source — softness with directional intent, mid-high contrast",
    "single-source-dramatic":
      "one hard sidelight as the only source, sharp angular shadow line cutting across the frame, deep shadow side, high contrast",
  },
  editorial_nocturnal: {
    "soft-daylight":
      "blue-hour ambient through a window mixed with one warm tungsten lamp ~2700K, contained pool of light, jewel-tone shadows",
    "hard-north-light":
      "cool moonlit-north-window light from one side balanced by a single warm interior lamp ~2700K, dual-temperature scene",
    "golden-hour":
      "last warm sun fading at the edge, one warm tungsten lamp ~2700K taking over as the key, deep velvet shadows",
    "single-source-dramatic":
      "one decisive warm tungsten lamp ~2700K as the only source, contained pool of light on the subject, deep velvet shadows everywhere else",
  },
  editorial_raw: {
    "low-warm-lamp":
      "available warm interior lamp light ~3000K, no fill, slightly underexposed honest tonal range",
    "hard-north-light":
      "available cool north-window light, slightly underexposed, no styling, neutral cool white balance",
    "golden-hour":
      "available late sun raking through the window, no styling, slightly underexposed, warm but not orange",
    "single-source-dramatic":
      "one available light source from the side, slightly underexposed, deep honest shadow on the opposite half",
  },
  editorial_golden: {
    "soft-daylight":
      "warm late-afternoon daylight, broad and gentle through a sheer, amber wrap on skin, no rim",
    "low-warm-lamp":
      "warm late-day ambient bounce mixed with one tungsten lamp ~2700K — Mediterranean evening interior, warm everywhere",
    "hard-north-light":
      "low warm sun as the key opposite a cool north-window fill — split warm/cool exposure across the subject",
    "overcast-diffuse":
      "soft warm late-day sky after the sun has dropped behind cloud, even amber wrap, no hard rim",
    "single-source-dramatic":
      "low golden-hour sun as the only source raking hard from one side, long warm shadow opposite, high contrast",
  },
  editorial_chiaroscuro: {
    "soft-daylight":
      "one north-window-soft key carving subject out of darkness, deep falloff into pure black on the opposite side",
    "low-warm-lamp":
      "one warm tungsten lamp ~2700K as the only source, deep falloff into black, single warm specular highlight on the subject",
    "hard-north-light":
      "one hard cool north-window source carving subject out of pure black, sharp shadow boundary",
    "golden-hour":
      "one low warm sun as the only source raking hard, deep black shadow on the opposite half, single warm specular highlight",
    "overcast-diffuse":
      "one large overcast source from the side, soft but unilateral, deep falloff to near-black on the opposite half",
  },
  editorial_business_mag: {
    "low-warm-lamp":
      "soft broad overhead daylight from a large diffusion source warmed slightly with a single tungsten accent lamp ~3000K, paper-white background, controlled medium-low contrast",
    "hard-north-light":
      "broad overhead daylight pulled cooler and slightly more directional, crisp shadow under the subject, paper-white background",
    "golden-hour":
      "broad overhead daylight warmed to late-day ~4500K, gentle warm shadow under the subject, paper-white background",
    "overcast-diffuse":
      "broad overcast diffusion overhead, near-shadowless, paper-white background, very low contrast",
    "single-source-dramatic":
      "one decisive overhead diffusion source pulled to one side, sharper crisp shadow under the subject, paper-white background",
  },
};

/** Resolve the lighting clause for a (signature × lightingMood) pair.
 *  Falls back to the 1-D `SIGNATURE_LIGHTING[signature]` when the user hasn't
 *  picked a lightingMood OR when the chosen mood has no override for that
 *  signature (we keep the base universe instead of forcing a wrong cell). */
export function resolveSignatureLighting(
  signature: VisualSignature,
  lightingMood?: LightingMood,
): string {
  if (lightingMood) {
    const cell = SIGNATURE_LIGHTING_2D[signature]?.[lightingMood];
    if (cell) return cell;
  }
  return SIGNATURE_LIGHTING[signature];
}

// ─────────────────────────────────────────────────────────────────────────
// Scene environment pools — per signature × per template family.
// "people-template" pools are used for model_interaction / lifestyle /
// opening_hook / atmosphere_wide. "product-template" pools are used for
// product_macro / product_texture / product_scene / product_details.
// We pick from the pool deterministically via shotId hash so the 5 shots in
// one project don't repeat AND the same shot in two different projects can
// still differ (different shotId → different hash).
// ─────────────────────────────────────────────────────────────────────────

interface ScenePools {
  people: string[];
  product: string[];
}

export const SIGNATURE_SCENES: Record<VisualSignature, ScenePools> = {
  editorial_soft: {
    people: [
      "sunlit atelier interior with linen draped over a chair",
      "wide bay window in a quiet apartment, sheer curtains, late morning",
      "marble bathroom edge with neutral towels and a soft mirror reflection",
      "minimal dressing room corner with pale wood and a single ceramic vase",
      "soft-light studio backdrop, off-white seamless paper",
    ],
    product: [
      "marble counter with a folded linen cloth nearby",
      "pale oak shelf with a single ceramic dish for scale",
      "off-white plinth in a sunlit corner",
      "smoothed limestone slab with soft daylight raking across",
      "matte cream backdrop with a hint of paper texture",
    ],
  },
  editorial_bold: {
    people: [
      "raw concrete interior with a single shaft of hard light",
      "brutalist stairwell with sharp angular shadow lines",
      "industrial loft with an exposed steel column and bare floor",
      "monochrome studio with deep grey seamless and one hard key",
      "underground parking deck at night with hard cool overhead spot",
    ],
    product: [
      "raw concrete plinth with a single hard sidelight",
      "matte black metal slab on a dark grey floor",
      "polished steel surface with a sharp shadow line cutting across",
      "broken concrete fragment used as a base, deep shadow behind",
      "monochrome studio sweep, hard key from camera-left",
    ],
  },
  editorial_nocturnal: {
    people: [
      "luxury hotel suite at night, single warm bedside lamp on",
      "velvet-draped private booth in a dim bar, low warm glow",
      "candle-lit dining nook with a wine bottle softly out of focus",
      "private library at night, single brass desk lamp pool",
      "back of a town-car at night, city lights bokeh through the window",
    ],
    product: [
      "dark walnut tabletop with a single warm lamp pool",
      "velvet-draped surface in deep emerald or garnet, lamp light",
      "polished black lacquer surface with one warm specular streak",
      "marble side table at night, single tungsten reflection",
      "rich bronze tray on a dim console, ambient lamp glow",
    ],
  },
  editorial_raw: {
    people: [
      "working artisan studio with tools on a worn wood bench",
      "lived-in apartment kitchen with everyday clutter at the edges",
      "small workshop with overcast light through industrial windows",
      "studio backroom with concrete floor and exposed pipes",
      "outdoor courtyard on an overcast afternoon, real ground texture",
    ],
    product: [
      "weathered wood plank on a workshop bench",
      "raw clay slab with hand-pressed texture, overcast light",
      "natural stone with moss at the edge, ground-level perspective",
      "linen drop on a chipped concrete floor, available light",
      "rusted metal tray on a scratched workbench, honest wear visible",
    ],
  },
  editorial_golden: {
    people: [
      "stone terrace edge facing the late-afternoon sun",
      "rooftop with whitewashed walls catching warm raking light",
      "Mediterranean balcony at golden hour, sheer fabric drifting",
      "garden path with long warm shadows from low sun",
      "quiet seaside walkway at the end of the day, warm amber air",
    ],
    product: [
      "warm stone ledge with golden raking light across the surface",
      "sun-bleached wood plank on a terrace, long shadow behind",
      "pale travertine slab catching the last warm sunbeam",
      "linen-draped surface on a balcony, golden rim from one side",
      "weathered concrete edge with amber hour glow",
    ],
  },
  editorial_chiaroscuro: {
    people: [
      "near-black studio with one hard sidelight, subject half in shadow",
      "dark velvet-draped corner with a single carved beam of light",
      "matte black backdrop with subject lit from one decisive source",
      "deep shadow theatre wing, single warm spotlight pool",
      "gallery interior at night, single artwork-grade spot on subject",
    ],
    product: [
      "dark wood surface with one decisive sidelight, deep negative space",
      "matte black plinth with a single warm or cool key, falloff into pure black",
      "polished obsidian slab, single light carving the silhouette",
      "deep velvet drape behind, single overhead pin-spot, no fill",
      "gallery-grade pedestal in a darkened room, museum spot only",
    ],
  },
  editorial_business_mag: {
    // Fallback pool only — the AI-generated, DB-grounded `scenePool` from
    // analyze-product-editorial overrides this when present. Kept short and
    // generic so it doesn't bias the LLM-driven path.
    people: [
      "white seamless studio cyclorama with soft overhead daylight",
      "minimalist gallery-white room with pale travertine floor",
      "clean white-walled office with one oak desk and floor-to-ceiling diffused light",
      "Monocle-style café banquette in pale leather, marble bistro table, morning window light",
      "white loft kitchen island in pale Carrara, sheer curtain at the window",
    ],
    product: [
      "paper-white seamless backdrop with a clean crisp shadow directly under the product",
      "pale travertine plinth on a white sweep, soft overhead daylight",
      "off-white matte plaster surface against a paper-white wall",
      "bone-coloured ribbed paper backdrop with restrained editorial framing",
      "white sweep with a single folded linen square as a tonal accent",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Palette clauses — a one-liner injected into the prompt so the colour world
// matches the lighting & scene. Kept short so it doesn't blow the budget.
// ─────────────────────────────────────────────────────────────────────────

export const SIGNATURE_PALETTE: Record<VisualSignature, string> = {
  editorial_soft:        "warm neutral palette — bone, sand, warm grey, muted ochre",
  editorial_bold:        "cool monochrome palette — slate, fog, charcoal, hard contrast",
  editorial_nocturnal:   "deep jewel-tone palette — emerald, garnet, amber, against pools of warm tungsten",
  editorial_raw:         "earthy muted palette — clay, moss, terracotta, weathered wood",
  editorial_golden:      "warm late-day palette — amber, sand, sun-bleached white, soft umber shadow",
  editorial_chiaroscuro: "near black-and-white with a single restrained accent (warm gold or cool steel)",
  editorial_business_mag: "paper-white palette — bone, off-white, warm grey, pale travertine, with one restrained tonal accent",
};

// ─────────────────────────────────────────────────────────────────────────
// Realism guard exemptions — most signatures keep the strict realism guard
// (no starbursts, mirror floors, halo bloom, plastic skin, hover, etc).
// A few signatures EARN limited exemptions because their visual language
// genuinely needs them. The exemption is added as a positive permission
// AFTER the guard, so the guard's bans are mostly preserved.
// ─────────────────────────────────────────────────────────────────────────

export const SIGNATURE_REALISM_EXEMPTION: Record<VisualSignature, string> = {
  editorial_soft: "",
  editorial_bold:
    "RIM-LIGHT EXEMPTION: a single hard rim-light from one decisive source IS allowed (it is core to this aesthetic) — but no sparkle VFX, no starburst flares, no halo bloom.",
  editorial_nocturnal:
    "DEPTH-OF-FIELD EXEMPTION: shallow optical depth-of-field with creamy out-of-focus warm bokeh from real light sources IS allowed — but no AI soap-bubble bokeh, no synthetic lens flare, no mirror-wet floors.",
  editorial_raw: "",
  editorial_golden:
    "LENS-WARMTH EXEMPTION: warm amber rim along edges from the actual sun IS allowed — but no orange filter look, no synthetic flare, no anamorphic streak.",
  editorial_chiaroscuro:
    "SINGLE-SOURCE EXEMPTION: deep shadows reaching pure black AND a single specular highlight on the subject ARE allowed (this aesthetic depends on extreme falloff) — but still no sparkle VFX, no mirror floors, no halo bloom.",
  editorial_business_mag: "",
};

// ─────────────────────────────────────────────────────────────────────────
// Camera-language nudges — VERY light touch, so we don't reintroduce the
// "everything is the same micro-push-in" problem from the other side. The
// rigid product guard still wins for product-only shots.
// ─────────────────────────────────────────────────────────────────────────

export const SIGNATURE_CAMERA_HINT: Record<VisualSignature, string> = {
  editorial_soft:        "calm, deliberate framing; small natural breathing room around the subject",
  editorial_bold:        "decisive geometric framing; subject placed against a strong shadow line or edge",
  editorial_nocturnal:   "intimate framing close to the subject, leaving negative space in the dark areas",
  editorial_raw:         "honest documentary framing — slight imperfection, room for context at the edges",
  editorial_golden:      "framing that lets the warm raking light read across surfaces and skin",
  editorial_chiaroscuro: "centred or rule-of-thirds framing with deep negative space in the shadow side",
  editorial_business_mag: "clean centred or rule-of-thirds framing, generous white negative space, restrained editorial composition",
};

// ─────────────────────────────────────────────────────────────────────────
// 15-entry ANGLE pool — replaces the per-template 3-entry list in keyframes
// + clips. Hash by shotId so within ONE project no two shots collide, and
// across projects the same template lands on different angles.
// Generic enough to fit any template (people OR product); specific enough
// to actually change the composition.
// ─────────────────────────────────────────────────────────────────────────

const ANGLE_POOL_15: string[] = [
  "chest-height medium shot, subject centred, generous headroom",
  "low 3/4 angle from the waist, looking slightly up",
  "high 3/4 angle from above the shoulder, looking slightly down",
  "tight over-the-shoulder framing, subject in the foreground edge",
  "wide environmental frame, subject offset to one third",
  "extreme close-up on hands or detail, rest of subject implied",
  "side profile in clean negative space, subject facing camera-left",
  "side profile in clean negative space, subject facing camera-right",
  "low ground-level angle, subject anchored against the horizon line",
  "centred symmetrical full-frontal composition, subject locked to centre",
  "asymmetric off-centre composition, subject in a quarter of the frame",
  "framing through a doorway / window edge / partial silhouette in foreground",
  "top-down flat-lay angle, subject parallel to the lens plane",
  "slight Dutch tilt — frame rotated 4-6° for tension",
  "shallow-stage three-quarter angle with depth into the background",
];

/** Deterministic hash → 0..N-1. Identical shotId → identical angle within
 *  one project. Stable across renders so retries don't change composition. */
function pickFromPool<T>(pool: T[], shotId: string, salt = 0): T {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < shotId.length; i++) {
    h = (h ^ shotId.charCodeAt(i)) * 16777619;
    h >>>= 0;
  }
  return pool[h % pool.length];
}

/** Public helper — pick the angle for a shot. Salt lets the keyframe and
 *  clip picker land on the SAME angle for consistency between still and
 *  motion. We pass salt=0 from both call sites. */
export function angleHintForShot(shotId: string): string {
  return pickFromPool(ANGLE_POOL_15, shotId, 0);
}

/** Pick a scene from the signature's pool for this shot. People vs product
 *  pool selected by `kind`. Hash by shotId + extraSalt so 5 shots in the
 *  same project don't all land on the same scene AND two drafts with the
 *  same product+signature don't collide either. Pass `draftId` as
 *  extraSalt for cross-draft variation.
 *
 *  `overridePool` — if the project produced its own AI-generated, DB-grounded
 *  scene pool during analyze-product-editorial (see `scenePool` on the
 *  understanding object), pass it in here and it wins over the static pool.
 *  Hash logic stays identical so the SAME shot in keyframes and clips lands
 *  on the SAME scene. */
export function sceneForShot(
  signature: VisualSignature,
  shotId: string,
  kind: "people" | "product",
  extraSalt?: string,
  overridePool?: { people?: string[]; product?: string[] } | null,
): string {
  const override = overridePool?.[kind];
  const pool = (override && override.length >= 2) ? override : SIGNATURE_SCENES[signature][kind];
  const key = extraSalt ? `${extraSalt}::${shotId}` : shotId;
  return pickFromPool(pool, key, 1);
}

// ─────────────────────────────────────────────────────────────────────────
// Master prompt clause — what every keyframe + clip prepends.
// Compact (~250 chars) so it survives video-prompt budget enforcement.
// ─────────────────────────────────────────────────────────────────────────

/** Build the signature prompt clause that locks every shot in a project to
 *  the same visual world. Returns a string ready to be concatenated into
 *  either an image-gen prompt or a video-gen prompt body. */
export function signatureClause(
  signature: VisualSignature,
  lightingMood?: LightingMood,
): string {
  const lighting = resolveSignatureLighting(signature, lightingMood);
  const palette  = SIGNATURE_PALETTE[signature];
  const camera   = SIGNATURE_CAMERA_HINT[signature];
  return ` SIGNATURE LOCK [${signature}] — light: ${lighting}; palette: ${palette}; framing: ${camera}.`;
}

/** Realism exemption — appended AFTER the standard PHYSICAL_REALISM_GUARD
 *  so the guard's bans stay default but specific signatures get the
 *  permissions their aesthetic genuinely requires. */
export function signatureRealismExemption(signature: VisualSignature): string {
  const exempt = SIGNATURE_REALISM_EXEMPTION[signature];
  return exempt ? ` ${exempt}` : "";
}

// ─────────────────────────────────────────────────────────────────────────
// Default suggestion — if analyze-product-editorial fails to pick one (or
// for old drafts being migrated), this maps category lock + emotional tone
// to a sensible signature. NOT a substitute for AI selection; just a floor.
// ─────────────────────────────────────────────────────────────────────────

export function suggestSignature(
  categoryLock: CategoryLock | undefined,
  emotionalTone: EmotionalTone | undefined,
  category?: string,
): VisualSignature {
  const c = (category || "").toLowerCase();
  // Strong category overrides — these almost always read better in their
  // signature regardless of tone.
  if (/(jewel|ring|earring|necklace|bracelet|watch|chain|pendant|gem|diamond)/.test(c)) {
    return "editorial_chiaroscuro";
  }
  if (/(perfume|fragrance|cologne|eau de|scent)/.test(c)) {
    return "editorial_nocturnal";
  }
  if (/(electronic|phone|earbud|headphone|laptop|speaker|charger|device|tech|gadget)/.test(c)) {
    return "editorial_bold";
  }
  // Tone-driven fallback for everything else.
  switch (emotionalTone) {
    case "bold-graphic":     return "editorial_bold";
    case "austere-luxe":     return "editorial_chiaroscuro";
    case "dreamlike-soft":   return "editorial_soft";
    case "raw-honest":       return "editorial_raw";
    case "playful-warm":     return "editorial_golden";
    case "quiet-confident":  return "editorial_soft";
    default:                 return "editorial_soft";
  }
}
