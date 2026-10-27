// ============================================================================
// Corvo — Creative Blueprint  (REFACTOR PHASE 1 SCAFFOLDING)
// ============================================================================
//
// STATUS: scaffolding only. Nothing imports this yet. It is SAFE to ship — it
// has zero runtime side effects and does not touch any existing pipeline.
//
// PURPOSE: the single shared creative-state object that the refactor converges
// all three engines onto (Brandfilm Core / Agent Director / Editorial). Today
// each engine carries its own private decision blob; this is the target they
// will all read & write instead.
//
// What is REAL in this file (use it now):
//   - The CreativeBlueprint / Decision / Derived type system.
//   - DECISION_DEPENDENCY_GRAPH — the dependency edges from the refactor doc.
//   - markDirtyDownstream() — the pure, fully-testable incremental
//     re-derivation core. Override one decision → only its downstream
//     (and unlocked) nodes get marked dirty. This is the mechanism that lets
//     the Interaction Agent "only change the lighting" without nuking the
//     narrative.
//
// What is a STUB (Phase 2 — wire to real LLM / render calls):
//   - deriveNarrative / deriveShotPlan / deriveLightColor / deriveCharacterLock
//   - derivePrompts / deriveKeyframes / deriveClips / deriveEdit / deriveFilm
//   Each TODO names the existing function it should wrap.
// ============================================================================

// ─── Decision / Derived wrappers ───────────────────────────────────────────

/** A decided creative dimension. Addressable, lockable, overridable. */
export interface Decision<T> {
  value: T;
  /** User locked this → downstream re-derivation must NOT change it. */
  locked: boolean;
  /** An upstream change invalidated this → needs re-derivation. */
  dirty: boolean;
  /** Who set the current value. */
  source: "llm" | "user_override" | "preference_learned";
  /** Bumped on every value change (cheap cache key for renderers). */
  rev: number;
}

/** A rendered/derived artifact produced from upstream Decisions. */
export interface Derived<T> {
  value: T | null;
  dirty: boolean;
  rev: number;
}

export function decision<T>(
  value: T,
  source: Decision<T>["source"] = "llm",
): Decision<T> {
  return { value, locked: false, dirty: false, source, rev: 1 };
}

export function derived<T>(value: T | null = null): Derived<T> {
  return { value, dirty: value == null, rev: value == null ? 0 : 1 };
}

// ─── Decision payloads (what each "specialist" produces) ────────────────────
// NOTE: these intentionally mirror the fields ONE generate-blocks LLM call
// already emits today. The refactor does NOT split them into 4 LLM endpoints
// (that would N× latency/cost). It keeps one call but exposes each field as a
// separately addressable + re-derivable Decision node.

export interface CampaignFrame {
  arcType: string;          // e.g. "transformation" | "reveal" | "ritual"
  beatCount: number;
  peakMoment?: string;
}

export interface NarrativeBeat {
  beat: number;
  role: string;             // hook / atmosphere / interaction / reveal / resolve
  intent: string;
}

export interface ShotSpec {
  beat: number;
  shotScale: string;        // ECU/CU/MCU/MS/MLS/LS/ELS
  cameraMotion: string;
  subject: string;
  composition?: string;
}

export interface LightColor {
  colorGrade: string;
  lighting: string;
  filmStock?: string;
}

export interface CharacterLock {
  characterSheet: string | null;   // null when no humans appear
  refImageUrl?: string;
}

// ─── The Blueprint ──────────────────────────────────────────────────────────

export interface CreativeBlueprint {
  id: string;
  version: number;
  mode: "brandfilm" | "presenter" | "cluster";

  brief: {
    productName: string;
    brandName?: string;
    goal?: string;
    platform?: string;
    aspectRatio?: string;
    userConcept?: string;
  };

  // Decision nodes — figure-of-the-diagram "specialists", now addressable.
  campaignFrame: Decision<CampaignFrame>;
  narrative: Decision<NarrativeBeat[]>;
  shotPlan: Decision<ShotSpec[]>;
  lightColor: Decision<LightColor>;
  characterLock: Decision<CharacterLock>;

  // Derived artifacts — produced from the decisions above.
  prompts: Derived<string[]>;
  keyframes: Derived<{ blockIndex: number; url: string; rev: number }[]>;
  clips: Derived<{ blockIndex: number; url: string }[]>;
  edit: Derived<{ timeline: unknown; bgmUrl?: string }>;
  film: Derived<{ url: string }>;

  // Closed-loop creative data flywheel — the real data spine for the moat story.
  provenance: Array<{
    node: BlueprintNode;
    decidedBy: "creative_agent" | "director_llm" | "interaction_agent" | "user";
    rationale?: string;
    userOverridden: boolean;
    at: string; // ISO
  }>;
}

// ─── Dependency graph + incremental re-derivation (REAL, pure, testable) ─────

export type BlueprintNode =
  | "campaignFrame"
  | "narrative"
  | "shotPlan"
  | "lightColor"
  | "characterLock"
  | "prompts"
  | "keyframes"
  | "clips"
  | "edit"
  | "film";

/**
 * Direct downstream edges. Reading: when KEY changes, the listed nodes are
 * (potentially) invalidated. Matches the graph in the refactor doc:
 *
 *   campaignFrame ──> narrative, shotPlan, lightColor, characterLock
 *   narrative ─┐
 *   shotPlan ──┤
 *   lightColor ┼──> prompts ──> keyframes ──> clips ──> edit ──> film
 *   characterLock┘
 */
export const DECISION_DEPENDENCY_GRAPH: Record<BlueprintNode, BlueprintNode[]> = {
  campaignFrame: ["narrative", "shotPlan", "lightColor", "characterLock"],
  narrative: ["prompts"],
  shotPlan: ["prompts"],
  lightColor: ["prompts"],
  characterLock: ["prompts"],
  prompts: ["keyframes"],
  keyframes: ["clips"],
  clips: ["edit"],
  edit: ["film"],
  film: [],
};

const ALL_NODES = Object.keys(DECISION_DEPENDENCY_GRAPH) as BlueprintNode[];

function isDecisionNode(n: BlueprintNode): boolean {
  return ["campaignFrame", "narrative", "shotPlan", "lightColor", "characterLock"].includes(n);
}

/**
 * Compute the set of nodes that must be re-derived after `changed` is edited.
 * Honors `locked`: a locked DECISION node is never marked dirty (the user
 * pinned it), and — critically — its OWN downstream is NOT propagated through
 * the locked node. Derived nodes are always re-derivable.
 *
 * This is the core that makes "only change the lighting" cheap: overriding
 * lightColor returns { prompts, keyframes, clips, edit, film } — and NOT
 * narrative / shotPlan / characterLock.
 *
 * Pure function. No I/O. Unit-test this directly.
 */
export function markDirtyDownstream(
  bp: CreativeBlueprint,
  changed: BlueprintNode,
): Set<BlueprintNode> {
  const dirty = new Set<BlueprintNode>();
  const visit = (node: BlueprintNode) => {
    for (const next of DECISION_DEPENDENCY_GRAPH[node]) {
      if (dirty.has(next)) continue;
      // A locked decision blocks propagation THROUGH itself.
      if (isDecisionNode(next) && isLocked(bp, next)) continue;
      dirty.add(next);
      visit(next);
    }
  };
  visit(changed);
  return dirty;
}

function isLocked(bp: CreativeBlueprint, node: BlueprintNode): boolean {
  const d = (bp as unknown as Record<string, { locked?: boolean }>)[node];
  return !!d?.locked;
}

/**
 * Apply an override to a single decision node and flag its downstream dirty.
 * Returns the nodes that the caller must re-derive (Phase 2 wires the derive*
 * functions to these). Does not mutate locked nodes.
 */
export function overrideDecision<K extends "campaignFrame" | "narrative" | "shotPlan" | "lightColor" | "characterLock">(
  bp: CreativeBlueprint,
  node: K,
  value: CreativeBlueprint[K]["value"],
  rationale?: string,
): { blueprint: CreativeBlueprint; toRederive: Set<BlueprintNode> } {
  const d = bp[node] as Decision<unknown>;
  if (d.locked) {
    return { blueprint: bp, toRederive: new Set() };
  }
  d.value = value as never;
  d.source = "user_override";
  d.dirty = false;
  d.rev += 1;
  const toRederive = markDirtyDownstream(bp, node);
  for (const n of toRederive) {
    const target = (bp as unknown as Record<string, { dirty?: boolean }>)[n];
    if (target) target.dirty = true;
  }
  bp.provenance.push({
    node,
    decidedBy: "user",
    rationale,
    userOverridden: true,
    at: new Date().toISOString(),
  });
  bp.version += 1;
  return { blueprint: bp, toRederive };
}

export function lockDecision(bp: CreativeBlueprint, node: BlueprintNode): CreativeBlueprint {
  const d = (bp as unknown as Record<string, { locked?: boolean }>)[node];
  if (d) d.locked = true;
  return bp;
}

// ─── Derive functions (STUBS — Phase 2) ──────────────────────────────────────
// Each should be pure-ish: (blueprint) -> updated node value. Wire to existing
// code rather than rewriting it.

/* TODO(phase2): wrap generate-blocks `callDirectorLLM`. Today it emits all four
 * decision payloads in ONE JSON call — keep that, but split its output into the
 * four Decision nodes below + write provenance. This is the ONE place the
 * "single brain, four addressable hats" pattern is realized. */
export async function deriveDecisions(
  _bp: CreativeBlueprint,
): Promise<{ campaignFrame: CampaignFrame; narrative: NarrativeBeat[]; shotPlan: ShotSpec[]; lightColor: LightColor; characterLock: CharacterLock }> {
  throw new Error("deriveDecisions: not implemented (Phase 2 — wrap generate-blocks/callDirectorLLM)");
}

/* TODO(phase2): build the per-block keyframe prompt. Wrap the prompt-assembly
 * already inside generate-keyframe (the keyframeBody section). */
export async function derivePrompts(_bp: CreativeBlueprint): Promise<string[]> {
  throw new Error("derivePrompts: not implemented (Phase 2 — wrap generate-keyframe prompt assembly)");
}

/* TODO(phase2): wrap generate-keyframe edge fn via buildKeyframeRequest.
 * REMINDER: siblingAnchorUrl is cluster-only — never default it to the prior
 * frame here (that was the homogenization bug fixed in Phase 0). */
export async function deriveKeyframes(_bp: CreativeBlueprint): Promise<{ blockIndex: number; url: string; rev: number }[]> {
  throw new Error("deriveKeyframes: not implemented (Phase 2 — wrap generate-keyframe via buildKeyframeRequest)");
}

/* TODO(phase2): wrap generate-content-{kling,seedance,minimax}. */
export async function deriveClips(_bp: CreativeBlueprint): Promise<{ blockIndex: number; url: string }[]> {
  throw new Error("deriveClips: not implemented (Phase 2 — wrap generate-content-*)");
}

/* TODO(phase2): wrap assemble-video + generate-bgm/music + editor_* / ai-edit-v2. */
export async function deriveEdit(_bp: CreativeBlueprint): Promise<{ timeline: unknown; bgmUrl?: string }> {
  throw new Error("deriveEdit: not implemented (Phase 2 — wrap assemble-video + bgm/music + editor_*)");
}

// ─── Constructor ──────────────────────────────────────────────────────────

export function emptyBlueprint(
  id: string,
  brief: CreativeBlueprint["brief"],
  mode: CreativeBlueprint["mode"] = "brandfilm",
): CreativeBlueprint {
  return {
    id,
    version: 1,
    mode,
    brief,
    campaignFrame: decision<CampaignFrame>({ arcType: "auto", beatCount: 0 }),
    narrative: decision<NarrativeBeat[]>([]),
    shotPlan: decision<ShotSpec[]>([]),
    lightColor: decision<LightColor>({ colorGrade: "auto", lighting: "auto" }),
    characterLock: decision<CharacterLock>({ characterSheet: null }),
    prompts: derived<string[]>(),
    keyframes: derived(),
    clips: derived(),
    edit: derived(),
    film: derived(),
    provenance: [],
  };
}
