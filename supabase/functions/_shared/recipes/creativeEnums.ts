// Phase A — Enum value constants + validators.
// Single source of truth for runtime checks (zod-free to keep edge bundle small).

import type {
  FilmMode,
  Mood,
  CulturalRegister,
  GazeMode,
  CameraMode,
  PacingMode,
} from "./_types.ts";

export const FILM_MODES: readonly FilmMode[] = [
  "PRODUCT_FILM",
  "EDITORIAL",
  "CLINICAL_LUXURY",
  "NARRATIVE_SHORT",
  "ENSEMBLE",
  "EXPERIMENTAL",
] as const;

export const MOODS: readonly Mood[] = [
  "REVERENCE",
  "INTIMATE",
  "WONDER",
  "JOY",
  "TENSION",
  "MELANCHOLY",
  "DEFIANCE",
] as const;

export const CULTURAL_REGISTERS: readonly CulturalRegister[] = [
  "en-luxury",
  "en-casual",
  "en-irreverent",
  "jp-minimalist",
  "eu-editorial",
] as const;

export const GAZE_MODES: readonly GazeMode[] = [
  "to_camera",
  "off_camera",
  "averted",
  "closed_eyes",
  "no_subject",
] as const;

export const CAMERA_MODES: readonly CameraMode[] = [
  "locked",
  "micro_push",
  "micro_orbit",
  "soft_to_lens",
  "arc_to_lens",
  "handheld_drift",
  "rack_focus",
] as const;

export const PACING_MODES: readonly PacingMode[] = [
  "still",
  "breath",
  "deliberate",
  "kinetic",
] as const;

// ─────────── Defaults (used when brand-research agent absent) ───────────
export const DEFAULT_FILM_MODE: FilmMode = "PRODUCT_FILM";
export const DEFAULT_MOOD: Mood = "REVERENCE";
export const DEFAULT_REGISTER: CulturalRegister = "en-luxury";

// ─────────── Validators ───────────
export function isFilmMode(v: unknown): v is FilmMode {
  return typeof v === "string" && (FILM_MODES as readonly string[]).includes(v);
}
export function isMood(v: unknown): v is Mood {
  return typeof v === "string" && (MOODS as readonly string[]).includes(v);
}
export function isRegister(v: unknown): v is CulturalRegister {
  return typeof v === "string" && (CULTURAL_REGISTERS as readonly string[]).includes(v);
}
export function isGazeMode(v: unknown): v is GazeMode {
  return typeof v === "string" && (GAZE_MODES as readonly string[]).includes(v);
}
export function isCameraMode(v: unknown): v is CameraMode {
  return typeof v === "string" && (CAMERA_MODES as readonly string[]).includes(v);
}
export function isPacingMode(v: unknown): v is PacingMode {
  return typeof v === "string" && (PACING_MODES as readonly string[]).includes(v);
}

// ─────────── Production-grade per-recipe rules baked into schema ───────────
// arc_to_lens at <5s reads as "swooping AI camera." Auto-degrade.
export function degradeCameraMode(
  cameraMode: CameraMode,
  durationSec: number,
): { cameraMode: CameraMode; degraded: boolean; reason?: string } {
  if (cameraMode === "arc_to_lens" && durationSec < 5) {
    return {
      cameraMode: "soft_to_lens",
      degraded: true,
      reason: "arc_to_lens requires >=5s; degraded to soft_to_lens",
    };
  }
  return { cameraMode, degraded: false };
}
