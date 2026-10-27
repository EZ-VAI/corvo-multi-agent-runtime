// EDITORIAL mode — magazine/lookbook rhythm, mood-led, human-product interplay.

import {
  registerRecipe,
  registerRecipeClass,
  RECIPE_CLASSES,
  shotsByClass,
  commonInvariants,
  violation,
} from "./_common.ts";
import type { ModeInvariants, RecipeShot } from "./_types.ts";

registerRecipe({
  name: "EDITORIAL_PORTRAIT",
  version: "1.0.0",
  filmModes: ["EDITORIAL", "NARRATIVE_SHORT"],
  description: "Locked magazine portrait — subject, gaze choice, controlled light.",
  defaults: { gazeMode: "to_camera", cameraMode: "locked", pacingMode: "still" },
  constraints: { minDurationSec: 3, maxDurationSec: 6, requiresSubject: true },
});
registerRecipeClass("EDITORIAL_PORTRAIT", RECIPE_CLASSES.PORTRAIT);

registerRecipe({
  name: "FABRIC_IN_MOTION",
  version: "1.0.0",
  filmModes: ["EDITORIAL"],
  description: "Garment, hair, or scarf drifting — motion lives in the cloth.",
  defaults: { gazeMode: "averted", cameraMode: "locked", pacingMode: "breath" },
  constraints: { minDurationSec: 3, maxDurationSec: 6 },
});
registerRecipeClass("FABRIC_IN_MOTION", RECIPE_CLASSES.ENVIRONMENT);

registerRecipe({
  name: "WALK_THROUGH",
  version: "1.0.0",
  filmModes: ["EDITORIAL", "ENSEMBLE"],
  description: "Subject moves through frame — full or three-quarter framing.",
  defaults: { gazeMode: "off_camera", cameraMode: "soft_to_lens", pacingMode: "deliberate" },
  constraints: { minDurationSec: 4, maxDurationSec: 7, requiresSubject: true },
});
registerRecipeClass("WALK_THROUGH", RECIPE_CLASSES.INTERACTION);

registerRecipe({
  name: "MOOD_DETAIL",
  version: "1.0.0",
  filmModes: ["EDITORIAL", "CLINICAL_LUXURY"],
  description: "Tight detail — texture of fabric, surface, accessory edge.",
  defaults: { gazeMode: "no_subject", cameraMode: "micro_push", pacingMode: "still" },
  constraints: { minDurationSec: 2, maxDurationSec: 4 },
});
registerRecipeClass("MOOD_DETAIL", RECIPE_CLASSES.HOLD);

registerRecipe({
  name: "HOLD_AND_BREATHE",
  version: "1.0.0",
  filmModes: ["EDITORIAL", "PRODUCT_FILM"],
  description: "Subject holds, room holds — pure presence, near-static.",
  defaults: { gazeMode: "to_camera", cameraMode: "locked", pacingMode: "still" },
  constraints: { minDurationSec: 3, maxDurationSec: 6 },
});
registerRecipeClass("HOLD_AND_BREATHE", RECIPE_CLASSES.HOLD);

export const editorialInvariants: ModeInvariants = {
  filmMode: "EDITORIAL",
  run(shots: RecipeShot[]) {
    const v = commonInvariants(shots);

    // Editorial should have at least 1 portrait-class shot.
    if (shotsByClass(shots, RECIPE_CLASSES.PORTRAIT).length === 0) {
      v.push(
        violation(
          "missing_portrait",
          "EDITORIAL requires at least 1 PORTRAIT-class recipe",
        ),
      );
    }

    // Pace diversity: should not be all-still.
    const allStill = shots.every((s) => s.pacingMode === "still");
    if (shots.length >= 4 && allStill) {
      v.push(
        violation(
          "all_still_pacing",
          "EDITORIAL ≥4 shots cannot all be still — add at least 1 breath/deliberate",
        ),
      );
    }

    return v;
  },
};
