// NARRATIVE_SHORT mode — story-led, character beats, product earned.

import {
  registerRecipe,
  registerRecipeClass,
  RECIPE_CLASSES,
  commonInvariants,
} from "./_common.ts";
import type { ModeInvariants, RecipeShot } from "./_types.ts";

registerRecipe({
  name: "ESTABLISH",
  version: "1.0.0",
  filmModes: ["NARRATIVE_SHORT", "ENSEMBLE"],
  description: "Wide opening — place the world, locked frame, breathing.",
  defaults: { gazeMode: "no_subject", cameraMode: "locked", pacingMode: "breath" },
  constraints: { minDurationSec: 3, maxDurationSec: 6 },
});
registerRecipeClass("ESTABLISH", RECIPE_CLASSES.ENVIRONMENT);

registerRecipe({
  name: "CHARACTER_BEAT",
  version: "1.0.0",
  filmModes: ["NARRATIVE_SHORT"],
  description: "Subject in moment — micro-expression, decision, hesitation.",
  defaults: { gazeMode: "averted", cameraMode: "micro_push", pacingMode: "still" },
  constraints: { minDurationSec: 3, maxDurationSec: 6, requiresSubject: true },
});
registerRecipeClass("CHARACTER_BEAT", RECIPE_CLASSES.PORTRAIT);

registerRecipe({
  name: "EARNED_PRODUCT",
  version: "1.0.0",
  filmModes: ["NARRATIVE_SHORT"],
  description: "Product enters story — character reaches for, picks up, deploys.",
  defaults: { gazeMode: "no_subject", cameraMode: "soft_to_lens", pacingMode: "deliberate" },
  constraints: { minDurationSec: 4, maxDurationSec: 7, requiresSubject: true },
});
registerRecipeClass("EARNED_PRODUCT", RECIPE_CLASSES.REVEAL);

registerRecipe({
  name: "RESOLUTION_BEAT",
  version: "1.0.0",
  filmModes: ["NARRATIVE_SHORT"],
  description: "Closing emotion — character resolves, product present but not hero.",
  defaults: { gazeMode: "to_camera", cameraMode: "locked", pacingMode: "still" },
  constraints: { minDurationSec: 3, maxDurationSec: 5, requiresSubject: true },
});
registerRecipeClass("RESOLUTION_BEAT", RECIPE_CLASSES.PORTRAIT);

export const narrativeShortInvariants: ModeInvariants = {
  filmMode: "NARRATIVE_SHORT",
  run: (shots: RecipeShot[]) => commonInvariants(shots),
};
