/**
 * 5-DIM ARCHITECTURE — Dimension 3 (Camera scheduling).
 *
 * AI video models stack camera verbs ("smooth gimbal track + slow push +
 * rack focus") into one shot, producing the floaty hyperactive AI-cam look.
 * Real cinematography binds ONE camera intent to ONE shot, and the choice
 * is dictated by shot scale, not by directorial fancy.
 *
 *   ECU / MCU  → LOCKED              (no camera move at all)
 *   CU         → MICRO_PUSH 2%       (just enough to feel alive)
 *   MS / COWBOY→ SLOW_PUSH 4% OR SLOW_ORBIT 1°
 *   WIDE / EWS → SLOW_ORBIT 2° OR RACK_FOCUS  (let the world breathe)
 *
 * Returns ONE clause to inject into the body. Single intent, no overlap.
 */

export type ShotScale = "ECU" | "MCU" | "CU" | "MS" | "COWBOY" | "WIDE" | "EWS";
export type CameraIntent = "LOCKED" | "MICRO_PUSH" | "SLOW_PUSH" | "SLOW_ORBIT" | "RACK_FOCUS";

export interface CameraIntentInput {
  shotScale?: ShotScale | null;
  /** Coarse fallback when shotScale not yet inferred. */
  shotKind?: "product_macro" | "product_close" | "product_scene" | "model_interaction" | "lifestyle" | "opening_hook" | "atmosphere_wide" | null;
  durationSec: number;
  /** Variant index lets us pick between the two allowed intents at MS/WIDE
   *  so a 6-clip cut isn't all-push or all-orbit. */
  variantIndex?: number;
}

const ALLOWED: Record<ShotScale, CameraIntent[]> = {
  ECU: ["LOCKED"],
  MCU: ["LOCKED"],
  CU: ["MICRO_PUSH"],
  MS: ["SLOW_PUSH", "SLOW_ORBIT"],
  COWBOY: ["SLOW_PUSH", "SLOW_ORBIT"],
  WIDE: ["SLOW_ORBIT", "RACK_FOCUS"],
  EWS: ["SLOW_ORBIT", "RACK_FOCUS"],
};

function inferScale(kind: CameraIntentInput["shotKind"]): ShotScale {
  switch (kind) {
    case "product_macro": return "ECU";
    case "product_close": return "MCU";
    case "model_interaction": return "MCU";
    case "product_scene": return "MS";
    case "lifestyle": return "MS";
    case "opening_hook": return "WIDE";
    case "atmosphere_wide": return "WIDE";
    default: return "MS";
  }
}

export function pickCameraIntent(input: CameraIntentInput): { intent: CameraIntent; scale: ShotScale } {
  const scale = input.shotScale || inferScale(input.shotKind);
  const allowed = ALLOWED[scale];
  const idx = (input.variantIndex ?? 0) % allowed.length;
  return { intent: allowed[idx], scale };
}

export function cameraIntentClause(input: CameraIntentInput): string {
  const { intent, scale } = pickCameraIntent(input);
  const dur = Math.max(3, Math.min(10, Math.round(input.durationSec || 5)));
  switch (intent) {
    case "LOCKED":
      return `CAMERA (${scale}, ONE intent): LOCKED — tripod-still for the entire ${dur}s. No push, pan, orbit, or drift.`;
    case "MICRO_PUSH":
      return `CAMERA (${scale}, ONE intent): MICRO_PUSH — slow push-in roughly 2% across ${dur}s. No pan, no orbit, no rack.`;
    case "SLOW_PUSH":
      return `CAMERA (${scale}, ONE intent): SLOW_PUSH — push-in roughly 4% across ${dur}s. No pan, no orbit, no rack.`;
    case "SLOW_ORBIT":
      return `CAMERA (${scale}, ONE intent): SLOW_ORBIT — orbit ~1–2° across ${dur}s. No push, no rack, no handheld feel.`;
    case "RACK_FOCUS":
      return `CAMERA (${scale}, ONE intent): RACK_FOCUS — body locked, focus shifts once from foreground to subject across ${dur}s. No push, no orbit.`;
  }
}
