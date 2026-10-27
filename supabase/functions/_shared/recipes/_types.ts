// Phase A — Creative Decision Enum Layer
// Type definitions shared across recipes, translators, critics.

// ─────────── Top-level dimensions ───────────
export type FilmMode =
  | "PRODUCT_FILM"      // Object-led, product as protagonist
  | "EDITORIAL"         // Magazine/lookbook rhythm, mood-led
  | "CLINICAL_LUXURY"   // Cold precision, scientific reverence
  | "NARRATIVE_SHORT"   // Story-led, character beats
  | "ENSEMBLE"          // Multi-subject, social context
  | "EXPERIMENTAL";     // Rule-breaking, art-house

export type Mood =
  | "REVERENCE"
  | "INTIMATE"
  | "WONDER"
  | "JOY"
  | "TENSION"
  | "MELANCHOLY"
  | "DEFIANCE";

export type CulturalRegister =
  | "en-luxury"
  | "en-casual"
  | "en-irreverent"
  | "jp-minimalist"
  | "eu-editorial";

// ─────────── Atomic per-shot enums ───────────
// Each enum is ONE creative decision. Translators map (enum, mood, mode)
// → physical English description.

export type GazeMode =
  | "to_camera"
  | "off_camera"
  | "averted"
  | "closed_eyes"
  | "no_subject";

export type CameraMode =
  | "locked"
  | "micro_push"
  | "micro_orbit"
  | "soft_to_lens"
  | "arc_to_lens"  // auto-degrades to soft_to_lens when durationSec < 5
  | "handheld_drift"
  | "rack_focus";

export type PacingMode =
  | "still"        // <1 motion event
  | "breath"       // 1-2 motion events
  | "deliberate"   // 3-4 motion events
  | "kinetic";     // 5+ motion events

// ─────────── Shot record (what LLM emits) ───────────
export interface AtomicEnums {
  gazeMode: GazeMode;
  cameraMode: CameraMode;
  pacingMode: PacingMode;
}

export interface RecipeShot {
  recipe: string;            // Recipe name OR "CUSTOM"
  recipeVersion: string;     // SemVer snapshot at generation time
  gazeMode: GazeMode;
  cameraMode: CameraMode;
  pacingMode: PacingMode;
  motion: string;            // Free-form motion description (sanitized)
  durationSec: number;
  // Optional free-form override when recipe = "CUSTOM"
  customNotes?: string;
}

// ─────────── Recipe definition ───────────
export interface RecipeDefinition {
  name: string;
  version: string;           // SemVer — see CONTRIBUTING.md
  filmModes: FilmMode[];     // Which modes this recipe is valid in
  description: string;       // Human-readable, NOT sent to LLM
  defaults: Partial<AtomicEnums>;
  // Hard rules — sanitizer will fail loud if violated
  constraints?: {
    minDurationSec?: number;
    maxDurationSec?: number;
    requiresSubject?: boolean;
    bannedCameraModes?: CameraMode[];
  };
}

// ─────────── Critic invariants ───────────
// Generation-time only — not re-run on old drafts, so no versioning needed.
export interface InvariantViolation {
  type: string;       // Stable identifier, e.g. "missing_reveal_class"
  detail: string;     // Human-readable reason
  shotIndex?: number; // null = whole-timeline violation
}

export interface ModeInvariants {
  filmMode: FilmMode;
  run(shots: RecipeShot[]): InvariantViolation[];
}

// ─────────── Translator interface ───────────
export interface ModeTranslator {
  modeKey: string;            // e.g. "product_film_reverence"
  filmMode: FilmMode;
  mood: Mood | null;          // null = baseline (mood-neutral)
  translate(
    enums: AtomicEnums,
    motion: string,
    durationSec: number,
  ): string;
  fallback: ModeTranslator | null;  // baseline.fallback = null
}

// ─────────── Top-level film spec (state_json shape) ───────────
export interface FilmSpec {
  filmMode: FilmMode;
  mood: Mood;
  culturalRegister: CulturalRegister;
  shots: RecipeShot[];
}
