// PRODUCT_FILM mode — object-led, product as protagonist.
// Recipes here describe atomic shot archetypes for product films.
// version SemVer per recipe (see CONTRIBUTING.md).

import {
  registerRecipe,
  registerRecipeClass,
  RECIPE_CLASSES,
  shotsByClass,
  commonInvariants,
  violation,
} from "./_common.ts";
import type { ModeInvariants, RecipeShot } from "./_types.ts";

// ─────────── Recipes ───────────
registerRecipe({
  name: "FOUND_OBJECT",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM", "EDITORIAL"],
  description:
    "Camera discovers product mid-environment, no human, locked or micro-push frame.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "locked",
    pacingMode: "still",
  },
  constraints: {
    minDurationSec: 3,
    maxDurationSec: 6,
    requiresSubject: false,
  },
});
registerRecipeClass("FOUND_OBJECT", RECIPE_CLASSES.HOLD);

registerRecipe({
  name: "MATERIAL_TRANSLATION",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM", "CLINICAL_LUXURY"],
  description:
    "Macro/near-macro on product surface — texture, weight, weave, grain.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "micro_push",
    pacingMode: "breath",
  },
  constraints: {
    minDurationSec: 3,
    maxDurationSec: 5,
    requiresSubject: false,
    bannedCameraModes: ["arc_to_lens", "handheld_drift"],
  },
});
registerRecipeClass("MATERIAL_TRANSLATION", RECIPE_CLASSES.HOLD);

registerRecipe({
  name: "PRODUCT_REVEAL",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM", "EDITORIAL", "CLINICAL_LUXURY"],
  description:
    "Product enters frame — pulled, lowered, rotated, or revealed by light shift.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "soft_to_lens",
    pacingMode: "deliberate",
  },
  constraints: {
    minDurationSec: 4,
    maxDurationSec: 7,
    requiresSubject: false,
  },
});
registerRecipeClass("PRODUCT_REVEAL", RECIPE_CLASSES.REVEAL);

registerRecipe({
  name: "HANDS_TO_PRODUCT",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM", "NARRATIVE_SHORT"],
  description:
    "Hands enter to interact with product — picking up, opening, fastening, applying.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "micro_push",
    pacingMode: "deliberate",
  },
  constraints: {
    minDurationSec: 3,
    maxDurationSec: 6,
    requiresSubject: true,
  },
});
registerRecipeClass("HANDS_TO_PRODUCT", RECIPE_CLASSES.INTERACTION);

registerRecipe({
  name: "ENV_BREATHE",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM", "EDITORIAL"],
  description:
    "Environmental atmosphere shot — light shift, mist, fabric drift, no product hero.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "locked",
    pacingMode: "breath",
  },
  constraints: {
    minDurationSec: 2,
    maxDurationSec: 5,
    requiresSubject: false,
  },
});
registerRecipeClass("ENV_BREATHE", RECIPE_CLASSES.ENVIRONMENT);

registerRecipe({
  name: "FINAL_HERO",
  version: "1.0.0",
  filmModes: ["PRODUCT_FILM"],
  description:
    "Closing product hero — clean composition, locked frame, breathing space.",
  defaults: {
    gazeMode: "no_subject",
    cameraMode: "locked",
    pacingMode: "still",
  },
  constraints: {
    minDurationSec: 2,
    maxDurationSec: 4,
    requiresSubject: false,
  },
});
registerRecipeClass("FINAL_HERO", RECIPE_CLASSES.HOLD);

// ─────────── Invariants ───────────
export const productFilmInvariants: ModeInvariants = {
  filmMode: "PRODUCT_FILM",
  run(shots: RecipeShot[]) {
    const v = commonInvariants(shots);

    // Must contain at least 1 reveal-class recipe.
    if (shotsByClass(shots, RECIPE_CLASSES.REVEAL).length === 0) {
      v.push(
        violation(
          "missing_reveal_class",
          "PRODUCT_FILM requires at least 1 REVEAL-class recipe (e.g. PRODUCT_REVEAL)",
        ),
      );
    }

    // Should not be all-INTERACTION (overcrowded with hands).
    const interactionShots = shotsByClass(shots, RECIPE_CLASSES.INTERACTION);
    if (shots.length >= 3 && interactionShots.length === shots.length) {
      v.push(
        violation(
          "all_interaction",
          "PRODUCT_FILM cannot be 100% INTERACTION shots — needs at least 1 HOLD or REVEAL",
        ),
      );
    }

    return v;
  },
};
