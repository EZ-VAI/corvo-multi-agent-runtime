// Editorial scenePool + shotAssignments persistence contract.
//
// Why this exists (Batch 3 lock):
// Editorial's client-side `editorialOrchestrator.ts` derives the
// scene-for-shot mapping in-memory each render. That's fine on the client
// where the same component holds the same scenePool reference for the whole
// flow. The moment we move this server-side (cron-driven, where each tick is
// a fresh process), in-memory derivation will DRIFT across ticks/retries
// and a re-submitted Kling shot can land on a different scene than the
// approved keyframe was rendered against.
//
// Lock: `freezeShotAssignments` is called ONCE per generation_job, at the
// `analyzing → blocking` transition. The output is stored verbatim into
// `generation_jobs.mode_state_json.shotAssignments` and is the source of
// truth for keyframing, clip submission, and re-submission/retry. NEVER
// recompute.

export interface FrozenAssignment {
  shotId: string;
  template: string;
  variantIndex: number;
  durationSec: number;
  targetSec?: number;
  /** The exact scene string handed to keyframe + Kling. */
  scene: string;
  /** "people" vs "product" pool the scene was drawn from. */
  scenePoolBucket: "people" | "product";
  /** Stable index into the bucket — preserved across retries for audit. */
  scenePoolIndex: number;
}

export interface ScenePool {
  people?: string[];
  product?: string[];
}

/** Deterministic 32-bit hash. Mirrors the client-side `sceneForShot`
 *  hash so a job that started client-side and resumed server-side picks
 *  the same scene. */
function hashShotId(shotId: string): number {
  let h = 2166136261;
  for (let i = 0; i < shotId.length; i++) {
    h ^= shotId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const PEOPLE_TEMPLATES = new Set(["model_interaction", "lifestyle", "opening_hook"]);

function bucketFor(template: string, includePeople: boolean): "people" | "product" {
  if (!includePeople) return "product";
  return PEOPLE_TEMPLATES.has(template) ? "people" : "product";
}

export function freezeShotAssignments(
  shots: Array<{ shotId: string; template: string; variantIndex: number; durationSec: number; targetSec?: number }>,
  scenePool: ScenePool | null,
  includePeople: boolean,
): FrozenAssignment[] {
  const people = scenePool?.people ?? [];
  const product = scenePool?.product ?? [];
  return shots.map((s) => {
    const bucket = bucketFor(s.template, includePeople);
    const pool = bucket === "people" ? people : product;
    const idx = pool.length === 0 ? 0 : hashShotId(s.shotId) % pool.length;
    const scene = pool[idx] ?? "";
    return {
      shotId: s.shotId,
      template: s.template,
      variantIndex: s.variantIndex,
      durationSec: s.durationSec,
      targetSec: s.targetSec,
      scene,
      scenePoolBucket: bucket,
      scenePoolIndex: idx,
    };
  });
}
