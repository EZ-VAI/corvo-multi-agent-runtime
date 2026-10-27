// Critic — runs all mode invariants + common invariants on a shot list.
// Generation-time only; no version tracking needed (per CONTRIBUTING.md).

import type { FilmMode, RecipeShot, InvariantViolation, ModeInvariants } from "../_types.ts";
import { productFilmInvariants } from "../product_film.ts";
import { editorialInvariants } from "../editorial.ts";
import { clinicalLuxuryInvariants } from "../clinical_luxury.ts";
import { narrativeShortInvariants } from "../narrative_short.ts";
import { ensembleInvariants } from "../ensemble.ts";
import { experimentalInvariants } from "../experimental.ts";

const INVARIANT_MAP: Record<FilmMode, ModeInvariants> = {
  PRODUCT_FILM: productFilmInvariants,
  EDITORIAL: editorialInvariants,
  CLINICAL_LUXURY: clinicalLuxuryInvariants,
  NARRATIVE_SHORT: narrativeShortInvariants,
  ENSEMBLE: ensembleInvariants,
  EXPERIMENTAL: experimentalInvariants,
};

export function runInvariants(
  filmMode: FilmMode,
  shots: RecipeShot[],
): InvariantViolation[] {
  const inv = INVARIANT_MAP[filmMode];
  if (!inv) {
    return [{ type: "unknown_film_mode", detail: `No invariants registered for ${filmMode}` }];
  }
  return inv.run(shots);
}
