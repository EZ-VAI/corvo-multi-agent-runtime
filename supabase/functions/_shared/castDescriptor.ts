// Shared helper: convert the editorial CAST SPECS picked on `editorial-cast`
// into a short, model-friendly descriptor we can paste into Gemini /
// Kling / Seedance prompts. Empty fields = "AI's choice" (skipped).
//
// We intentionally keep this terse — Kling and Seedance both have hard
// prompt budgets and the cast is one ingredient among many. The descriptor
// is appended at the END of the body section so guards stay at the front.

export interface EditorialCastSpecs {
  includeModel: boolean;
  gender: "" | "female" | "male" | "non-binary";
  ageRange: "" | "teens" | "20s" | "30s" | "40s" | "50s" | "60plus";
  ethnicity: "" | "east-asian" | "south-asian" | "southeast-asian" | "black" | "white" | "hispanic" | "middle-eastern" | "mixed";
  bodyType: "" | "slim" | "average" | "athletic" | "curvy" | "plus-size";
  notes: string;
}

const ETHNICITY_LABEL: Record<string, string> = {
  "east-asian": "East Asian",
  "south-asian": "South Asian",
  "southeast-asian": "Southeast Asian",
  "black": "Black",
  "white": "white",
  "hispanic": "Hispanic / Latinx",
  "middle-eastern": "Middle Eastern",
  "mixed": "mixed-race",
};

const AGE_LABEL: Record<string, string> = {
  "teens": "late teens",
  "20s": "in their 20s",
  "30s": "in their 30s",
  "40s": "in their 40s",
  "50s": "in their 50s",
  "60plus": "60+ years old",
};

/**
 * Build a one-line CAST DESCRIPTOR. Returns "" when no model is in the shot
 * or when every field is left on AI's choice (so we don't bloat the prompt
 * with empty noise).
 */
export function buildCastDescriptor(cast: EditorialCastSpecs | undefined | null): string {
  if (!cast || !cast.includeModel) return "";
  const bits: string[] = [];
  if (cast.gender) bits.push(cast.gender === "non-binary" ? "non-binary person" : `${cast.gender} model`);
  if (cast.ageRange) bits.push(AGE_LABEL[cast.ageRange] ?? cast.ageRange);
  if (cast.ethnicity) bits.push(ETHNICITY_LABEL[cast.ethnicity] ?? cast.ethnicity);
  if (cast.bodyType) bits.push(`${cast.bodyType} build`);
  const head = bits.length > 0 ? bits.join(", ") : "";
  const notes = (cast.notes ?? "").trim().slice(0, 200);
  if (!head && !notes) return "";
  return `CAST: ${[head, notes].filter(Boolean).join(" — ")}.`;
}

/**
 * Build a SUBJECT PHRASE that can REPLACE the default "a young woman" /
 * "a woman in her late twenties …" descriptors baked into editorial body
 * templates. Returns "" when no model is shown or no cast field is set
 * (caller falls back to the case-derived default).
 *
 * Why: appending `CAST: male model.` at the END of the body cannot win
 * against an earlier, more detailed "a woman in her late twenties with
 * strong features…" inside the body. Gemini/Kling follow the more
 * specific, earlier description. We must rewrite the subject in-place.
 */
export function castSubjectPhrase(cast: EditorialCastSpecs | undefined | null): string {
  if (!cast || !cast.includeModel) return "";

  const gender = cast.gender;
  const age = cast.ageRange;
  const ethnicity = cast.ethnicity ? (ETHNICITY_LABEL[cast.ethnicity] ?? cast.ethnicity) : "";
  const body = cast.bodyType;

  // Need at least ONE field set — otherwise leave the body's default alone.
  if (!gender && !age && !ethnicity && !body) return "";

  // Noun ("man" / "woman" / "person") — falls back to "person" when gender unset.
  const noun =
    gender === "male" ? "man" :
    gender === "female" ? "woman" :
    gender === "non-binary" ? "non-binary person" :
    "person";

  // Age phrase ("in their 30s") — fallback to "" when unset (no "young X" guess).
  const agePhrase = age ? AGE_LABEL[age] : "";

  // Build "a [ethnicity] [body] [noun] [age phrase]"
  const adjBits: string[] = [];
  if (ethnicity) adjBits.push(ethnicity);
  if (body) adjBits.push(body);
  const adj = adjBits.join(" ");

  const article = /^[aeiou]/i.test(adj || noun) ? "an" : "a";
  const head = `${article} ${[adj, noun].filter(Boolean).join(" ")}`.trim();
  return agePhrase ? `${head} ${agePhrase}` : head;
}
