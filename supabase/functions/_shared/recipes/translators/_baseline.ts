// Mood-neutral baseline translator — fallback when (mode, mood) pair has no
// dedicated file. Output discipline (Phase A v2):
//   - ≤80 chars total
//   - Physical facts only: seconds, % values, eye/hand state, light direction
//   - NO adjectives (slow/fast/sacred/intimate). Comparatives use numbers.
//   - NO sanitizer-blacklisted words (cinematic, volumetric, etc.)

import type { ModeTranslator, AtomicEnums } from "../_types.ts";
import { degradeCameraMode } from "../creativeEnums.ts";

function gaze(g: AtomicEnums["gazeMode"]): string {
  switch (g) {
    case "to_camera": return "Eyes to lens.";
    case "off_camera": return "Eyes off-frame.";
    case "averted": return "Eyes lowered.";
    case "closed_eyes": return "Eyes closed.";
    case "no_subject": return "";
  }
}

function cam(c: AtomicEnums["cameraMode"], dur: number): string {
  switch (c) {
    case "locked": return `Camera locked, hold ${dur}s.`;
    case "micro_push": return `Push in 2% over ${dur}s.`;
    case "micro_orbit": return `Orbit 1° over ${dur}s.`;
    case "soft_to_lens": return `Drift toward lens over ${dur}s.`;
    case "arc_to_lens": return `Arc 2° to lens over ${dur}s.`;
    case "handheld_drift": return `Stabilized micro-drift on gimbal, ±0.5° over ${dur}s.`;
    case "rack_focus": return `Rack focus to subject over ${dur}s.`;
  }
}

function pace(p: AtomicEnums["pacingMode"]): string {
  switch (p) {
    case "still": return "0 motion events.";
    case "breath": return "1 motion event.";
    case "deliberate": return "3 motion events.";
    case "kinetic": return "5 motion events.";
  }
}

export const baselineTranslator: ModeTranslator = {
  modeKey: "_baseline",
  filmMode: "PRODUCT_FILM",
  mood: null,
  fallback: null,
  translate(enums, motion, durationSec) {
    const { cameraMode } = degradeCameraMode(enums.cameraMode, durationSec);
    return [gaze(enums.gazeMode), cam(cameraMode, durationSec), pace(enums.pacingMode)]
      .filter(Boolean).join(" ");
  },
};
