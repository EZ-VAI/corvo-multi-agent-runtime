// ENSEMBLE mode — multi-subject, social context, group dynamics.

import {
  registerRecipe,
  registerRecipeClass,
  RECIPE_CLASSES,
  commonInvariants,
} from "./_common.ts";
import type { ModeInvariants, RecipeShot } from "./_types.ts";

registerRecipe({
  name: "GROUP_TABLEAU",
  version: "1.0.0",
  filmModes: ["ENSEMBLE"],
  description: "Multiple subjects arranged — held composition, social geometry.",
  defaults: { gazeMode: "averted", cameraMode: "locked", pacingMode: "still" },
  constraints: { minDurationSec: 3, maxDurationSec: 6, requiresSubject: true },
});
registerRecipeClass("GROUP_TABLEAU", RECIPE_CLASSES.PORTRAIT);

registerRecipe({
  name: "EXCHANGE",
  version: "1.0.0",
  filmModes: ["ENSEMBLE", "NARRATIVE_SHORT"],
  description: "Two subjects connect — gesture, hand-off, glance, product passes.",
  defaults: { gazeMode: "off_camera", cameraMode: "micro_push", pacingMode: "deliberate" },
  constraints: { minDurationSec: 3, maxDurationSec: 6, requiresSubject: true },
});
registerRecipeClass("EXCHANGE", RECIPE_CLASSES.INTERACTION);

registerRecipe({
  name: "AMBIENT_GROUP",
  version: "1.0.0",
  filmModes: ["ENSEMBLE"],
  description: "Group breathing in space — no central action, atmosphere-led.",
  defaults: { gazeMode: "averted", cameraMode: "locked", pacingMode: "breath" },
  constraints: { minDurationSec: 3, maxDurationSec: 6, requiresSubject: true },
});
registerRecipeClass("AMBIENT_GROUP", RECIPE_CLASSES.ENVIRONMENT);

export const ensembleInvariants: ModeInvariants = {
  filmMode: "ENSEMBLE",
  run: (shots: RecipeShot[]) => commonInvariants(shots),
};
