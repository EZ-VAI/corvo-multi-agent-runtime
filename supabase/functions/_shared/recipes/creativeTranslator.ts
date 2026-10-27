// Creative translator entry point — picks the right (mode, mood) translator,
// falls back to baseline if (mode, mood) pair has no dedicated file.

import type { FilmMode, Mood, AtomicEnums, ModeTranslator } from "./_types.ts";
import { baselineTranslator } from "./translators/_baseline.ts";
import { productFilmReverence } from "./translators/product_film_reverence.ts";
import { productFilmIntimate } from "./translators/product_film_intimate.ts";
import { productFilmWonder } from "./translators/product_film_wonder.ts";

const TRANSLATORS: ModeTranslator[] = [
  productFilmReverence,
  productFilmIntimate,
  productFilmWonder,
];

function pickTranslator(filmMode: FilmMode, mood: Mood): ModeTranslator {
  return (
    TRANSLATORS.find((t) => t.filmMode === filmMode && t.mood === mood) ||
    baselineTranslator
  );
}

export function translate(
  filmMode: FilmMode,
  mood: Mood,
  enums: AtomicEnums,
  motion: string,
  durationSec: number,
): { text: string; translatorKey: string; usedFallback: boolean } {
  const t = pickTranslator(filmMode, mood);
  const text = t.translate(enums, motion, durationSec);
  return {
    text,
    translatorKey: t.modeKey,
    usedFallback: t.modeKey === "_baseline",
  };
}
