/**
 * 5-DIM ARCHITECTURE — Dimension 5 (Time / Pacing).
 *
 * i2v video models (Kling, Seedance) treat 5s of video as "static + a bit of
 * motion." Without explicit time scheduling, prompts like "she walks, turns,
 * smiles, picks it up" get rendered as ALL events overlapping in 5 seconds —
 * the source of the AI-video "fast hyperactive uncanny" feel.
 *
 * The fix is a 3-beat structure that gives the model a clock:
 *   Beat 1 (0 → 1.5s): SETUP — held pose, micro-tell, environment breathes.
 *   Beat 2 (1.5 → 3.5s): ACTION — the ONE main verb happens here.
 *   Beat 3 (3.5 → end): SETTLE — the result sits, energy decays, hold.
 *
 * For 5s clips the boundaries are exact; for 8/10s clips beat 2 expands.
 *
 * Output is short (≤180 chars) — meant to live INSIDE the body, not as a
 * separate guard.
 */

export interface ThreeBeatInput {
  durationSec: number;
  /** The single physical action the subject performs. Optional — for
   *  product-only shots we use environment motion instead. */
  mainAction?: string | null;
  /** Holding/setup state at beat 1 (e.g. "stands at window in soft light"). */
  setup?: string | null;
  /** Settle state at beat 3 (e.g. "lowers hand, gaze drifts off-camera"). */
  settle?: string | null;
}

export function buildThreeBeatStructure(input: ThreeBeatInput): string {
  const dur = Math.max(3, Math.min(10, Math.round(input.durationSec || 5)));
  const b1End = dur >= 8 ? 2.0 : 1.5;
  const b2End = dur >= 8 ? dur - 2 : 3.5;
  const b3End = dur;
  const setup = (input.setup && input.setup.trim()) || "subject holds the opening pose; environment breathes (light shifts, fabric or air drifts)";
  const action = (input.mainAction && input.mainAction.trim()) || "the single intended micro-action plays out (one verb, not three)";
  const settle = (input.settle && input.settle.trim()) || "energy decays, hold the final frame, no new motion";
  return `TIME (3 beats, do NOT overlap): ${b1End.toFixed(1)}s setup — ${setup}. ${b2End.toFixed(1)}s action — ${action}. ${b3End.toFixed(1)}s settle — ${settle}.`;
}
