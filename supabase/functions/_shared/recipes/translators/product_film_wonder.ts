// PRODUCT_FILM × WONDER
// Mood = OPEN framing, eyes lift, light brightens, slow reveal.

import type { ModeTranslator } from "../_types.ts";
import { degradeCameraMode } from "../creativeEnums.ts";
import { baselineTranslator } from "./_baseline.ts";

export const productFilmWonder: ModeTranslator = {
  modeKey: "product_film_wonder",
  filmMode: "PRODUCT_FILM",
  mood: "WONDER",
  fallback: baselineTranslator,
  translate(enums, _motion, durationSec) {
    const { cameraMode } = degradeCameraMode(enums.cameraMode, durationSec);
    const gaze = (() => {
      switch (enums.gazeMode) {
        case "to_camera": return `Eyes lift to lens at ${Math.floor(durationSec/2)}s.`;
        case "off_camera": return `Eyes lifted off-frame ${durationSec}s.`;
        case "averted": return "Eyes lift upward, brow softens.";
        case "closed_eyes": return `Eyes closed ${Math.floor(durationSec/2)}s, then open.`;
        case "no_subject": return "";
      }
    })();
    const cam = (() => {
      switch (cameraMode) {
        case "locked": return `Camera locked, light brightens 10% over ${durationSec}s.`;
        case "micro_push": return `Push in 3% over ${durationSec}s.`;
        case "micro_orbit": return `Orbit 2° over ${durationSec}s.`;
        case "soft_to_lens": return `Drift to lens over ${durationSec}s.`;
        case "arc_to_lens": return `Arc 2° to lens over ${durationSec}s.`;
        case "handheld_drift": return `Stabilized micro-drift on gimbal, ±0.5° over ${durationSec}s.`;
        case "rack_focus": return `Rack focus from BG to subject over ${durationSec}s.`;
      }
    })();
    const pace = (() => {
      switch (enums.pacingMode) {
        case "still": return "0 motion, light shifts only.";
        case "breath": return "1 reveal event (mist lift, light bloom).";
        case "deliberate": return "3 reveal events.";
        case "kinetic": return "5 reveal events.";
      }
    })();
    return [gaze, cam, pace].filter(Boolean).join(" ");
  },
};
