// agent-runtime/room/shot_schema.js
//
// THE locked shot contract. One shot object flows: Cinematographer emits it ->
// finalize_shots (Lovable) does deterministic prep + _ep -> generate-keyframe
// renders it -> generate-content-seedance|kling animates it -> Editor reads its
// pacing fields to cut. Every field below names WHO produces it and WHO consumes
// it, so nothing is ambiguous downstream.
//
// Provenance key: [C]=Cinematographer decides · [K]=fed by shot_knowledge ·
// [F]=finalize_shots consumes · [KF]=generate-keyframe consumes ·
// [CLIP]=clip engine consumes (via _ep) · [E]=Editor reads
//
//   id                 int      [all]  stable shot index, 1-based
//   intent             str      [C]    what this shot does for the SELL (kept from v1)
//   shotScale          enum     [C,KF,F]  ECU|CU|MCU|MS|MLS|WS|ELS  (F flags adjacent collisions)
//   cameraAngle        str      [C,KF]
//   focusTechnique     str      [C,KF]
//   compositionRule    str      [C,KF]
//   subject            str      [C,KF]
//   hasHuman           bool     [C,KF,CLIP]
//   visualDescription  str      [C,KF]  rich human-readable shot description
//   frame1Description  str      [C,KF]  start frame
//   frameNDescription  str      [C,KF]  end frame (for anchored-both / motion targets)
//   generationPrompt   str      [C,F,KF]  full craft-applied image prompt; C produces it
//                                          APPLYING shot_knowledge; F encodes _ep from it
//   cameraMotion       str      [C,CLIP]  MOTION ONLY (two-mode discipline)
//   subjectMotion      str      [C,CLIP]  MOTION ONLY
//   generationMode     enum     [C,F]   free|anchored|hybrid  (F flags product+!anchored)
//   anchorEnd          enum     [C,KF]  start|end|both|none
//   narrativePhase     enum     [C,E]   tension|reveal|desire|brand
//   pacingRole         enum     [C,E]   buildup|peak|rest|transition|punctuation
//   emotionalIntensity int 1-10 [C,E]
//   isPeakShot         bool     [C,E]   the emotional peak (C decides; not finalize)
//   duration           int sec  [C,F,CLIP]  initial clip length; F clamps to engine min
//   engine             enum     [C,CLIP]  seedance|kling-pro|kling-std|veo|minimax (per-shot)

const SHOT_SCALES = ["ECU", "CU", "MCU", "MS", "MLS", "WS", "ELS"];
const GEN_MODES = ["free", "anchored", "hybrid"];
const ANCHOR_ENDS = ["start", "end", "both", "none"];
const NARRATIVE_PHASES = ["tension", "reveal", "desire", "brand"];
const PACING_ROLES = ["buildup", "peak", "rest", "transition", "punctuation"];
const ENGINES = ["seedance", "kling-pro", "kling-std", "veo", "minimax"];

function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function pick(v, allowed, fallback) {
  const s = str(v).toLowerCase();
  return allowed.indexOf(s) !== -1 ? s : fallback;
}
function pickUpper(v, allowed, fallback) {
  const s = str(v).toUpperCase();
  return allowed.indexOf(s) !== -1 ? s : fallback;
}
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function bool(v) {
  return v === true || v === "true" || v === 1;
}

// Coerce a raw LLM shot into the canonical schema. Lenient on input
// (accepts snake_case or camelCase), strict on output. Never throws — a
// malformed field falls back to a safe default so the pipeline never dies on
// one bad shot; the Critic catches creative problems, this only guards shape.
function normalizeShot(raw, index, defaults) {
  raw = raw || {};
  const d = defaults || {};
  const g = (a, b) => (raw[a] !== undefined ? raw[a] : raw[b]);
  return {
    id: raw.id != null ? raw.id : index + 1,
    intent: str(raw.intent),
    shotScale: pickUpper(g("shotScale", "shot_scale"), SHOT_SCALES, "MS"),
    cameraAngle: str(g("cameraAngle", "camera_angle")),
    focusTechnique: str(g("focusTechnique", "focus_technique")),
    compositionRule: str(g("compositionRule", "composition_rule")),
    subject: str(raw.subject),
    hasHuman: bool(g("hasHuman", "has_human")),
    visualDescription: str(g("visualDescription", "visual_description")),
    frame1Description: str(g("frame1Description", "frame1_description")),
    frameNDescription: str(g("frameNDescription", "frameN_description")),
    generationPrompt: str(g("generationPrompt", "generation_prompt")),
    cameraMotion: str(g("cameraMotion", "camera_motion")),
    subjectMotion: str(g("subjectMotion", "subject_motion")),
    generationMode: pick(g("generationMode", "generation_mode"), GEN_MODES, "hybrid"),
    anchorEnd: pick(g("anchorEnd", "anchor_end"), ANCHOR_ENDS, "start"),
    narrativePhase: pick(g("narrativePhase", "narrative_phase"), NARRATIVE_PHASES, "reveal"),
    pacingRole: pick(g("pacingRole", "pacing_role"), PACING_ROLES, "buildup"),
    emotionalIntensity: clampInt(g("emotionalIntensity", "emotional_intensity"), 1, 10, 5),
    isPeakShot: bool(g("isPeakShot", "is_peak_shot")),
    duration: clampInt(raw.duration, 5, 10, d.duration || 5), // engine floor: clips < 5s fail to render; cap 10
    engine: pick(raw.engine, ENGINES, d.engine || "seedance"),
  };
}

// Shape problems the Cinematographer's OUTPUT must not have (vs creative
// problems, which are the Critic's job). Returns a list of issues for the
// Director to route — empty list = structurally clean.
function shotShapeIssues(shots) {
  const issues = [];
  if (!Array.isArray(shots) || shots.length === 0) {
    issues.push("no shots produced");
    return issues;
  }
  let peaks = 0;
  shots.forEach((s, i) => {
    if (!s.generationPrompt) issues.push(`shot ${i + 1}: empty generationPrompt`);
    if (s.isPeakShot) peaks++;
  });
  if (peaks === 0) issues.push("no shot flagged isPeakShot");
  if (peaks > 1) issues.push("more than one isPeakShot");
  return issues;
}

module.exports = {
  SHOT_SCALES, GEN_MODES, ANCHOR_ENDS, NARRATIVE_PHASES, PACING_ROLES, ENGINES,
  normalizeShot, shotShapeIssues,
};
