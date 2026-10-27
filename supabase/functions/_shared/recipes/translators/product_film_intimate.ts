// PRODUCT_FILM × INTIMATE
// Mood = CLOSE framing, soft micro-gestures, near-tactile distance.

import type { ModeTranslator } from "../_types.ts";
import { degradeCameraMode } from "../creativeEnums.ts";
import { baselineTranslator } from "./_baseline.ts";

export const productFilmIntimate: ModeTranslator = {
  modeKey: "product_film_intimate",
  filmMode: "PRODUCT_FILM",
  mood: "INTIMATE",
  fallback: baselineTranslator,
  translate(enums, _motion, durationSec) {
    const { cameraMode } = degradeCameraMode(enums.cameraMode, durationSec);
    const gaze = (() => {
      switch (enums.gazeMode) {
        case "to_camera": return `Eyes to lens, half-blink at ${Math.floor(durationSec/2)}s.`;
        case "off_camera": return "Eyes off-frame, soft half-smile.";
        case "averted": return "Eyes lowered, lips part 2mm.";
        case "closed_eyes": return `Eyes closed, hold ${durationSec}s.`;
        case "no_subject": return "";
      }
    })();
    const cam = (() => {
      switch (cameraMode) {
        case "locked": return `Camera locked, close framing, hold ${durationSec}s.`;
        case "micro_push": return `Push in 3% over ${Math.max(2, durationSec - 2)}s.`;
        case "micro_orbit": return `Orbit 1° over ${durationSec}s, close.`;
        case "soft_to_lens": return `Drift to lens over ${Math.max(2, durationSec - 2)}s.`;
        case "arc_to_lens": return `Arc 1° to lens over ${Math.max(2, durationSec - 2)}s.`;
        case "handheld_drift": return `Stabilized micro-drift on gimbal, ±0.5° over ${durationSec}s.`;
        case "rack_focus": return `Rack focus over ${Math.max(2, durationSec - 1)}s, close.`;
      }
    })();
    const pace = (() => {
      switch (enums.pacingMode) {
        case "still": return "0 motion events, fabric still.";
        case "breath": return "1 micro-gesture (finger, fabric).";
        case "deliberate": return "2 micro-gestures.";
        case "kinetic": return "3 micro-gestures max.";
      }
    })();
    return [gaze, cam, pace].filter(Boolean).join(" ");
  },
};
