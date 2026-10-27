// Deterministic, single-pass post-processing for an agent-converged shot list.
// NO LLM calls. Mirrors the deterministic tails of generate-blocks (the LLM
// decision layer has been retired in favour of the external shot agent).
//
// What this DOES:
//   1. globalStyle → ≤200-char prefix prepended to every shot's generationPrompt
//   2. camera-speed-floor: clamp <3 cm/s → 5 cm/s, >15 cm/s → 12 cm/s, neutralise "barely moving" phrasings
//   3. degradeCameraMode when duration < engine minimum (e.g. arc_to_lens < 5s → soft_to_lens)
//   4. motion-enum sanitize via sanitizeClipPrompt → NEUTRAL_MOTION_FALLBACK + violation log
//   5. _ep encode: base64(xor(generationPrompt, "crvx2026"))
//
// What this DOES NOT:
//   - peak-shot selection
//   - FREE / ANCHORED / HYBRID generationMode override
//   - block-count derivation
//   - shot-scale rewriting (only FLAGGED)
//
// FLAGS (returned, NOT rewritten):
//   - mode_mismatch: block has product content but generationMode !== "anchored"
//   - scale_collision: adjacent blocks share shotScale (one-step or zero jump)

import { encodePrompt } from "./promptObfuscation.ts";
import { sanitizeClipPrompt, NEUTRAL_MOTION_FALLBACK } from "./recipes/promptSanitizer.ts";
import { degradeCameraMode } from "./recipes/creativeEnums.ts";

export interface AgentShotInput {
  id?: string;
  title?: string;
  generationPrompt?: string;
  generationMode?: string;       // "anchored" | "free" | "hybrid" | "time-lapse" | ...
  cameraMode?: string;
  duration?: number;             // seconds
  motion?: string;
  subjectMotion?: string;
  cameraMotion?: string;
  shotScale?: string;            // "ECU" | "CU" | "MCU" | "MS" | "MLS" | "LS" | "ELS"
  hasHuman?: boolean;
  blockType?: string;
  isPeakShot?: boolean;
  // any other agent-set fields are passed through untouched.
  [k: string]: unknown;
}

export interface GlobalStyleInput {
  colorGrade?: string;
  lightingApproach?: string;
  masterMood?: string;
}

export interface FinalizeShotsInput {
  shots: AgentShotInput[];
  globalStyle?: GlobalStyleInput | null;
}

export interface FinalizeFlag {
  blockIndex: number;
  blockId?: string;
  type: "mode_mismatch" | "scale_collision" | "camera_mode_degraded" | "motion_sanitized" | "camera_speed_clamped";
  detail: string;
}

export interface FinalizeShotsOutput {
  shots: Array<AgentShotInput & { generationPrompt: string; _ep: string }>;
  globalPrefix: string;
  flags: FinalizeFlag[];
}

const SPEED_NUMBER_RE = /(\d+(?:\.\d+)?)\s*cm\s*\/\s*s/gi;
const FROZEN_PHRASES = [
  /\bbarely moving\b/gi,
  /\balmost imperceptible(?:\s+drift)?\b/gi,
  /\bnearly still\b/gi,
  /\binfinitesimal motion\b/gi,
];

function clipToLength(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function buildGlobalPrefix(gs: GlobalStyleInput | null | undefined): string {
  if (!gs) return "";
  const parts = [
    gs.colorGrade ? `Grade: ${clipToLength(gs.colorGrade, 50)}.` : "",
    gs.lightingApproach ? `Light: ${clipToLength(gs.lightingApproach, 50)}.` : "",
    gs.masterMood ? `Mood: ${clipToLength(gs.masterMood, 40)}.` : "",
  ].filter(Boolean).join(" ");
  return clipToLength(collapseWhitespace(parts), 200);
}

// Best-effort detection of "this block depicts the actual product". Mirrors the
// product-detection heuristic used previously inside generate-blocks (purely
// signal-based — never silently rewrites the agent's decision; only flags).
function looksLikeProductBlock(b: AgentShotInput): boolean {
  if (b.blockType && /product|reveal|hero|macro/i.test(String(b.blockType))) return true;
  const text = `${b.title ?? ""} ${b.generationPrompt ?? ""}`.toLowerCase();
  return /\bproduct\b|\bbottle\b|\bjar\b|\btube\b|\bpackage\b|\blabel\b|\blogo\b/i.test(text);
}

export function finalizeShots(input: FinalizeShotsInput): FinalizeShotsOutput {
  const flags: FinalizeFlag[] = [];
  const globalPrefix = buildGlobalPrefix(input.globalStyle);

  const out: Array<AgentShotInput & { generationPrompt: string; _ep: string }> = [];

  for (let i = 0; i < input.shots.length; i++) {
    const b: AgentShotInput = { ...input.shots[i] };
    const durationSec = typeof b.duration === "number" && b.duration > 0 ? b.duration : 5;

    // 3. degradeCameraMode when duration < engine minimum
    if (b.cameraMode) {
      const { cameraMode, degraded, reason } = degradeCameraMode(b.cameraMode as any, durationSec);
      if (degraded) {
        flags.push({
          blockIndex: i,
          blockId: b.id,
          type: "camera_mode_degraded",
          detail: `cameraMode "${b.cameraMode}" → "${cameraMode}" (${reason ?? "duration too short"})`,
        });
        b.cameraMode = cameraMode;
      }
    }

    // 4. motion-enum sanitize → NEUTRAL_MOTION_FALLBACK + log
    const rawMotion: string =
      (typeof b.motion === "string" && b.motion) ||
      (typeof b.subjectMotion === "string" && b.subjectMotion) ||
      (typeof b.cameraMotion === "string" && b.cameraMotion) ||
      "";
    if (rawMotion) {
      const san = sanitizeClipPrompt(rawMotion);
      if (!san.ok) {
        flags.push({
          blockIndex: i,
          blockId: b.id,
          type: "motion_sanitized",
          detail: `motion blocked: ${san.violations.map(v => `${v.type}:${v.match}`).join(", ")} → NEUTRAL_MOTION_FALLBACK`,
        });
        b.motion = NEUTRAL_MOTION_FALLBACK;
      } else {
        b.motion = san.sanitized;
      }
    }

    // 2. camera-speed-floor clamp + frozen-phrase neutralisation
    let prompt = typeof b.generationPrompt === "string" ? b.generationPrompt : "";
    let speedClamped = false;
    prompt = prompt.replace(SPEED_NUMBER_RE, (m, num) => {
      const v = parseFloat(num);
      if (!Number.isFinite(v)) return m;
      if (v < 3) { speedClamped = true; return "5cm/s"; }
      if (v > 15) { speedClamped = true; return "12cm/s"; }
      return m;
    });
    for (const re of FROZEN_PHRASES) {
      if (re.test(prompt)) { speedClamped = true; prompt = prompt.replace(re, "with steady visible motion"); }
    }
    if (speedClamped) {
      flags.push({
        blockIndex: i, blockId: b.id, type: "camera_speed_clamped",
        detail: "clamped camera speed to [3..15] cm/s / neutralised frozen phrasing",
      });
    }

    // 1. globalStyle prefix prepend
    if (globalPrefix) {
      prompt = `${globalPrefix} ${prompt}`.trim();
    }

    // FLAG (do not rewrite): product content but mode ≠ "anchored"
    if (looksLikeProductBlock(b) && b.generationMode && b.generationMode !== "anchored") {
      flags.push({
        blockIndex: i, blockId: b.id, type: "mode_mismatch",
        detail: `block reads as product content but generationMode="${b.generationMode}" (expected "anchored")`,
      });
    }

    // FLAG (do not rewrite): adjacent shotScale collision (one-step or zero jump)
    if (i > 0) {
      const prevScale = (input.shots[i - 1].shotScale ?? "").toString().toUpperCase();
      const currScale = (b.shotScale ?? "").toString().toUpperCase();
      if (prevScale && currScale && prevScale === currScale) {
        flags.push({
          blockIndex: i, blockId: b.id, type: "scale_collision",
          detail: `adjacent block ${i - 1} and ${i} share shotScale="${currScale}"`,
        });
      }
    }

    // 5. _ep encode
    const finalPrompt = prompt;
    const ep = encodePrompt(finalPrompt);
    out.push({ ...b, generationPrompt: finalPrompt, _ep: ep });
  }

  return { shots: out, globalPrefix, flags };
}
