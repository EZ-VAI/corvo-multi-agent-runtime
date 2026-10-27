// CLINICAL_LUXURY mode — cold precision, scientific reverence, surgical light.

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
  name: "SURGICAL_REVEAL",
  version: "1.0.0",
  filmModes: ["CLINICAL_LUXURY"],
  description:
    "Product revealed against pure background — measured, slow, instrument-like.",
  defaults: { gazeMode: "no_subject", cameraMode: "micro_push", pacingMode: "still" },
  constraints: { minDurationSec: 4, maxDurationSec: 7, requiresSubject: false, bannedCameraModes: ["handheld_drift"] },
});
registerRecipeClass("SURGICAL_REVEAL", RECIPE_CLASSES.REVEAL);

registerRecipe({
  name: "INSTRUMENT_DETAIL",
  version: "1.0.0",
  filmModes: ["CLINICAL_LUXURY", "PRODUCT_FILM"],
  description: "Macro on engineered detail — seam, dial, joint, cap.",
  defaults: { gazeMode: "no_subject", cameraMode: "locked", pacingMode: "still" },
  constraints: { minDurationSec: 2, maxDurationSec: 4, bannedCameraModes: ["arc_to_lens", "handheld_drift"] },
});
registerRecipeClass("INSTRUMENT_DETAIL", RECIPE_CLASSES.HOLD);

registerRecipe({
  name: "AXIS_ROTATION",
  version: "1.0.0",
  filmModes: ["CLINICAL_LUXURY"],
  description: "Slow controlled rotation revealing geometry — no human, no environment.",
  defaults: { gazeMode: "no_subject", cameraMode: "micro_orbit", pacingMode: "breath" },
  constraints: { minDurationSec: 4, maxDurationSec: 6, bannedCameraModes: ["handheld_drift"] },
});
registerRecipeClass("AXIS_ROTATION", RECIPE_CLASSES.HOLD);

registerRecipe({
  name: "CLINICAL_HANDS",
  version: "1.0.0",
  filmModes: ["CLINICAL_LUXURY"],
  description: "Gloved or precise hands operating product — measured, no flourish.",
  defaults: { gazeMode: "no_subject", cameraMode: "locked", pacingMode: "deliberate" },
  constraints: { minDurationSec: 3, maxDurationSec: 5, requiresSubject: true },
});
registerRecipeClass("CLINICAL_HANDS", RECIPE_CLASSES.INTERACTION);

export const clinicalLuxuryInvariants: ModeInvariants = {
  filmMode: "CLINICAL_LUXURY",
  run(shots: RecipeShot[]) {
    const v = commonInvariants(shots);

    // No kinetic pacing — clinical = controlled.
    shots.forEach((s, i) => {
      if (s.pacingMode === "kinetic") {
        v.push(
          violation(
            "kinetic_in_clinical",
            "CLINICAL_LUXURY shots cannot use kinetic pacing — use deliberate at most",
            i,
          ),
        );
      }
      if (s.cameraMode === "handheld_drift") {
        v.push(
          violation(
            "handheld_in_clinical",
            "CLINICAL_LUXURY shots cannot use handheld_drift camera",
            i,
          ),
        );
      }
    });

    // Must contain at least 1 reveal-class recipe.
    if (shotsByClass(shots, RECIPE_CLASSES.REVEAL).length === 0) {
      v.push(
        violation(
          "missing_reveal_class",
          "CLINICAL_LUXURY requires at least 1 REVEAL-class recipe (e.g. SURGICAL_REVEAL)",
        ),
      );
    }

    return v;
  },
};
