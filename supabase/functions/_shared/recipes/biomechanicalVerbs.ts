/**
 * 5-DIM ARCHITECTURE — Dimension 1 (Subject motion).
 *
 * AI video models, given vague verbs ("uses it naturally", "interacts with
 * the product", "moves elegantly"), invent random micro-motion: head bobble,
 * blinking spasms, lip flicker, perpetual idle drift, shoulder twitch.
 *
 * The fix is forcing prompts to name ONE biomechanical verb (with the body
 * part it lives in) plus AT MOST one micro-tell. Subjects with one explicit
 * action stop hallucinating supporting motion.
 *
 * Output is short (≤140 chars). Lives inside the clip body, not as a guard.
 */

export type SubjectRole =
  | "model_interaction"   // hands-on with product
  | "lifestyle"           // ambient, product visible but not held
  | "opening_hook"        // pre-product moment
  | "atmosphere_wide";    // wide environment, subject incidental

export interface BiomechanicalInput {
  role: SubjectRole;
  /** Optional product/category name — lets us pick verbs that the product
   *  can actually receive (e.g. you don't "tilt" a perfume bottle). */
  productName?: string | null;
  category?: string | null;
}

/**
 * Pick a single biomechanical primary verb + one micro-tell for the role.
 * Deterministic-ish: rotates by role to avoid repetition across a 6-clip cut.
 */
export function pickBiomechanicalVerb(input: BiomechanicalInput, variantIndex: number = 0): string {
  const role = input.role;

  const ROLE_VERBS: Record<SubjectRole, string[]> = {
    model_interaction: [
      "her index finger traces the product's edge once, slow",
      "she shifts weight from front foot to back foot, then stills",
      "her thumb settles into the product's curve, no other motion",
      "she tilts her head 8° toward the product, then holds",
    ],
    lifestyle: [
      "her shoulder lowers a few centimetres as she exhales through the nose",
      "her gaze drifts off-camera and stops at one fixed point",
      "her weight shifts to her back hip, hand resting on the product",
      "she tucks one strand of hair behind the ear in one motion, then stills",
    ],
    opening_hook: [
      "no subject yet — only the world: light ramps, fabric or steam drifts",
      "a single hand reaches into frame from one side, fingers relaxed",
      "a silhouette steps once into soft light, then stops",
    ],
    atmosphere_wide: [
      "the world breathes — wind in fabric, light shifting, distant figure passes",
      "leaves or curtains drift across the back third of the frame",
      "ambient figure walks past in the distance, never reaches the product",
    ],
  };

  const pool = ROLE_VERBS[role] || ROLE_VERBS.model_interaction;
  const verb = pool[variantIndex % pool.length];
  return `SUBJECT (one verb only, no extra micro-motion): ${verb}.`;
}
