// Camera Tree — ViMax-inspired parent-child shot anchoring.
//
// Why this exists:
// Corvo's keyframes are generated in parallel via Promise.allSettled. Within a
// shared "scene" (cluster), this produces inconsistent wardrobe/lighting/
// background between sibling shots — the classic "8 disconnected stills"
// problem the user flagged. ViMax solves this with a camera tree: pick the
// widest shot per cluster as the parent, generate it first, then derive
// children using parent's first frame as an additional reference.
//
// Design constraints (negotiated with user):
// - Trees are SCOPED PER CLUSTER (sceneClusterId), NOT global. Editorial's
//   5-act narrative wave depends on inter-cluster diversity — a global tree
//   would homogenize the whole film.
// - sceneClusterId is OPTIONAL from upstream LLM. When absent, we derive
//   clusters by grouping shots that share the same `scene` string. Old
//   drafts still work — they just degrade to one cluster per scene.
// - Parent selection is framing-based: widest template wins. Explicit
//   `camIdx: 0` from upstream overrides.
// - Single-shot clusters have no parent (they ARE the root, no anchoring
//   needed). Two-shot clusters → first is parent, second is child.

export interface ShotForTree {
  shotId: string;
  /** Template name — drives framing-width heuristic. */
  template: string;
  /** Optional upstream cluster id. When absent, derived from `scene`. */
  sceneClusterId?: string;
  /** Optional explicit cam index — 0 = root, >0 = child. Wins over heuristic. */
  camIdx?: number;
  /** Scene string — used as fallback cluster key. */
  scene?: string;
}

export interface CameraNode<T extends ShotForTree> {
  shot: T;
  /** null for cluster roots. */
  parent: T | null;
  clusterId: string;
}

/** Lower index = wider framing. Brand_film + editorial templates merged. */
const FRAMING_WIDTH_ORDER: Record<string, number> = {
  // editorial templates
  atmosphere_wide: 0,
  opening_hook: 1,
  lifestyle: 2,
  model_interaction: 3,
  product_scene: 4,
  product_details: 5,
  product_macro: 6,
  product_texture: 7,
  // brand_film block types (mirrors KEYFRAME_ANCHORING in generate-blocks)
  wide_contextual: 0,
  portrait_study: 2,
  product_hero_rotation: 4,
  product_hero: 4,
  detail_macro: 6,
};

function framingOrder(template: string): number {
  return FRAMING_WIDTH_ORDER[template] ?? 5;
}

/** Group shots into clusters. Honors explicit sceneClusterId first, then
 *  groups by `scene` string, then dumps the leftovers into one cluster. */
export function clusterShots<T extends ShotForTree>(shots: T[]): Map<string, T[]> {
  const clusters = new Map<string, T[]>();
  for (const s of shots) {
    const key = s.sceneClusterId ?? (s.scene ? `scene::${s.scene.slice(0, 80)}` : "default");
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(s);
  }
  return clusters;
}

/** Pick the cluster's parent: explicit camIdx:0 wins, else widest framing,
 *  ties broken by original order. */
function pickParent<T extends ShotForTree>(cluster: T[]): T {
  const explicitRoot = cluster.find((s) => s.camIdx === 0);
  if (explicitRoot) return explicitRoot;
  let best = cluster[0];
  let bestOrder = framingOrder(best.template);
  for (let i = 1; i < cluster.length; i++) {
    const o = framingOrder(cluster[i].template);
    if (o < bestOrder) {
      best = cluster[i];
      bestOrder = o;
    }
  }
  return best;
}

/** Build the full plan. Returns ordered roots + children-by-parent-shotId. */
export function buildCameraTree<T extends ShotForTree>(shots: T[]): {
  roots: T[];
  childrenByParent: Map<string, T[]>;
  nodeByShotId: Map<string, CameraNode<T>>;
} {
  const clusters = clusterShots(shots);
  const roots: T[] = [];
  const childrenByParent = new Map<string, T[]>();
  const nodeByShotId = new Map<string, CameraNode<T>>();

  for (const [clusterId, cluster] of clusters) {
    if (cluster.length === 0) continue;
    const parent = pickParent(cluster);
    roots.push(parent);
    nodeByShotId.set(parent.shotId, { shot: parent, parent: null, clusterId });

    const children = cluster.filter((s) => s.shotId !== parent.shotId);
    if (children.length > 0) {
      childrenByParent.set(parent.shotId, children);
      for (const child of children) {
        nodeByShotId.set(child.shotId, { shot: child, parent, clusterId });
      }
    }
  }
  return { roots, childrenByParent, nodeByShotId };
}

/** Diagnostic helper — one-line log per cluster. */
export function summarizeTree<T extends ShotForTree>(
  plan: ReturnType<typeof buildCameraTree<T>>,
): string {
  const lines: string[] = [];
  for (const root of plan.roots) {
    const children = plan.childrenByParent.get(root.shotId) ?? [];
    lines.push(
      `[cluster] root=${root.shotId}(${root.template}) children=[${children
        .map((c) => `${c.shotId}(${c.template})`)
        .join(",")}]`,
    );
  }
  return lines.join(" | ");
}
