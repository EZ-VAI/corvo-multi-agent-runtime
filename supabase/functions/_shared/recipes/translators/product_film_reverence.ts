// PRODUCT_FILM × REVERENCE
// Mood = LONG holds, slow params, weighted timing. Numbers, not adjectives.

import type { ModeTranslator } from "../_types.ts";
import { degradeCameraMode } from "../creativeEnums.ts";
import { baselineTranslator } from "./_baseline.ts";

export const productFilmReverence: ModeTranslator = {
  modeKey: "product_film_reverence",
  filmMode: "PRODUCT_FILM",
  mood: "REVERENCE",
  fallback: baselineTranslator,
  translate(enums, _motion, durationSec) {
    const { cameraMode } = degradeCameraMode(enums.cameraMode, durationSec);
    const gaze = (() => {
      switch (enums.gazeMode) {
        case "to_camera": return `Eyes to lens, hold ${durationSec}s.`;
        case "off_camera": return `Eyes off-frame ${Math.max(2, durationSec - 2)}s, then to lens.`;
        case "averted": return "Eyes lowered, no blink.";
        case "closed_eyes": return `Eyes closed, hold ${durationSec}s.`;
        case "no_subject": return "";
      }
    })();
    const cam = (() => {
      switch (cameraMode) {
        case "locked": return `Camera locked, hold ${durationSec}s.`;
        case "micro_push": return `Push in 2% over ${durationSec}s.`;
        case "micro_orbit": return `Orbit 1° over ${durationSec}s.`;
        case "soft_to_lens": return `Drift to lens over ${durationSec}s.`;
        case "arc_to_lens": return `Arc 1° to lens over ${durationSec}s.`;
        case "handheld_drift": return `Stabilized micro-drift on gimbal, ±0.3° over ${durationSec}s.`;
        case "rack_focus": return `Rack focus over ${Math.max(3, durationSec - 1)}s.`;
      }
    })();
    const pace = (() => {
      switch (enums.pacingMode) {
        case "still": return "0 motion events.";
        case "breath": return "1 motion event at 60% mark.";
        case "deliberate": return "2 motion events.";
        case "kinetic": return "3 motion events max.";
      }
    })();
    return [gaze, cam, pace].filter(Boolean).join(" ");
  },
};
