// Character Reference Selector — picks the best portrait view (front/side/back)
// for a given shot description and supplies the identity + wardrobe contract
// to keyframe generation.
//
// Used by: brand_film (generate-keyframe orchestration), agent pipeline,
// presenter pipeline. Editorial pipeline intentionally does NOT call this —
// wardrobe diversity is a feature there.
//
// Design (Phase C, integrated plan):
// - Three views = identity anchor (immutable: skin, hair, build, age, ethnicity).
// - Per-shot wardrobe = dynamic overrides (caller may supply, else defaults from
//   `dynamic_features` are used).
// - View selection is heuristic on the shot text — no LLM call (fast + free).

export interface CharacterPortrait {
  id: string;
  character_slug: string;
  display_name: string;
  archetype?: string | null;
  front_url?: string | null;
  side_url?: string | null;
  back_url?: string | null;
  static_features?: Record<string, unknown>;
  dynamic_features?: Record<string, unknown>;
  status?: string;
}

export type PortraitView = "front" | "side" | "back";

/** Heuristic: pick the most appropriate view for the shot text.
 *  - Back-facing cues: "walking away", "from behind", "back of", "rear", "exits"
 *  - Side cues: "profile", "side view", "from the side", "walking past", "in motion"
 *  - Default: front. */
export function selectViewForShot(shotText: string | undefined | null): PortraitView {
  const t = (shotText || "").toLowerCase();
  if (/\b(from behind|walking away|back of|rear|exits frame|away from camera)\b/.test(t)) return "back";
  if (/\b(profile|side view|from the side|walking past|in motion|three[-\s]?quarter)\b/.test(t)) return "side";
  return "front";
}

/** Get the actual URL for the selected view, with graceful fallback to front. */
export function pickViewUrl(c: CharacterPortrait, view: PortraitView): string | null {
  if (view === "back" && c.back_url) return c.back_url;
  if (view === "side" && c.side_url) return c.side_url;
  return c.front_url ?? c.side_url ?? c.back_url ?? null;
}

/** Build the identity contract string that gets concatenated into the keyframe
 *  prompt. Mirrors visualBible.characterSheet shape so existing call sites in
 *  generate-keyframe can consume it. */
export function buildIdentityContract(c: CharacterPortrait): string {
  const s = c.static_features || {};
  const parts: string[] = [];
  if (s.ethnicity) parts.push(`ethnicity: ${s.ethnicity}`);
  if (s.ageRange) parts.push(`age: ${s.ageRange}`);
  if (s.skinTone) parts.push(`skin: ${s.skinTone}`);
  if (s.hairColor || s.hairStyle) parts.push(`hair: ${[s.hairColor, s.hairStyle].filter(Boolean).join(", ")}`);
  if (s.build) parts.push(`build: ${s.build}`);
  if (s.distinctiveFeatures) parts.push(`distinctive: ${s.distinctiveFeatures}`);
  return parts.length > 0
    ? `${c.display_name}${c.archetype ? ` (${c.archetype})` : ""} — ${parts.join("; ")}.`
    : c.display_name;
}

/** Build the wardrobe / dynamic-features line for THIS shot. Caller-provided
 *  overrides win over the character's `dynamic_features` defaults. */
export function buildWardrobeLine(
  c: CharacterPortrait,
  overrides?: { wardrobe?: string; accessories?: string; makeup?: string; expression?: string },
): string {
  const d = c.dynamic_features || {};
  const wardrobe = overrides?.wardrobe ?? (d.wardrobe as string | undefined);
  const accessories = overrides?.accessories ?? (d.accessories as string | undefined);
  const makeup = overrides?.makeup ?? (d.makeup as string | undefined);
  const expression = overrides?.expression ?? (d.expressionDefault as string | undefined);
  const parts: string[] = [];
  if (wardrobe) parts.push(`wardrobe: ${wardrobe}`);
  if (accessories) parts.push(`accessories: ${accessories}`);
  if (makeup) parts.push(`makeup: ${makeup}`);
  if (expression) parts.push(`expression: ${expression}`);
  return parts.join(" • ");
}

/** One-shot helper for callers. Returns the full bundle to inject into
 *  generate-keyframe: an image URL (the picked view), an identity contract,
 *  and the wardrobe/dynamic line. */
export function resolveCharacterForShot(
  c: CharacterPortrait,
  shotText: string,
  overrides?: Parameters<typeof buildWardrobeLine>[1],
): {
  view: PortraitView;
  imageUrl: string | null;
  identityContract: string;
  wardrobeLine: string;
} {
  const view = selectViewForShot(shotText);
  return {
    view,
    imageUrl: pickViewUrl(c, view),
    identityContract: buildIdentityContract(c),
    wardrobeLine: buildWardrobeLine(c, overrides),
  };
}
