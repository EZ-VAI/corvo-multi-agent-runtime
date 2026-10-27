// EXPERIMENTAL mode — rule-breaking, art-house, abstract logic.
// Phase A keeps invariants relaxed; CUSTOM ratio allowed up to 50%.

import {
  registerRecipe,
  registerRecipeClass,
  RECIPE_CLASSES,
  commonInvariants,
} from "./_common.ts";
import type { ModeInvariants, RecipeShot } from "./_types.ts";

registerRecipe({
  name: "ABSTRACT_TEXTURE",
  version: "1.0.0",
  filmModes: ["EXPERIMENTAL"],
  description: "Pure texture/material/light study — no narrative, no product hero.",
  defaults: { gazeMode: "no_subject", cameraMode: "locked", pacingMode: "breath" },
  constraints: { minDurationSec: 2, maxDurationSec: 5 },
});
registerRecipeClass("ABSTRACT_TEXTURE", RECIPE_CLASSES.ENVIRONMENT);

registerRecipe({
  name: "GESTURAL_FRAGMENT",
  version: "1.0.0",
  filmModes: ["EXPERIMENTAL", "EDITORIAL"],
  description: "Body fragment in motion — hand, hair, foot. Composition over story.",
  defaults: { gazeMode: "no_subject", cameraMode: "rack_focus", pacingMode: "breath" },
  constraints: { minDurationSec: 2, maxDurationSec: 4 },
});
registerRecipeClass("GESTURAL_FRAGMENT", RECIPE_CLASSES.PORTRAIT);

registerRecipe({
  name: "SYMBOLIC_INSERT",
  version: "1.0.0",
  filmModes: ["EXPERIMENTAL"],
  description: "Object metaphor — secondary item evokes product without showing it.",
  defaults: { gazeMode: "no_subject", cameraMode: "micro_push", pacingMode: "still" },
  constraints: { minDurationSec: 2, maxDurationSec: 4 },
});
registerRecipeClass("SYMBOLIC_INSERT", RECIPE_CLASSES.ENVIRONMENT);

export const experimentalInvariants: ModeInvariants = {
  filmMode: "EXPERIMENTAL",
  // Relaxed in Phase A — only common invariants apply.
  run: (shots: RecipeShot[]) => commonInvariants(shots),
};
