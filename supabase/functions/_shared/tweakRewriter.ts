// Deep tweak integration via LLM rewrite.
//
// Why this exists: simply prepending "USER TWEAK: switch to a male model"
// to the prompt body is often ignored by image models because the rest of
// the prompt still describes the previous subject ("a Chinese woman holding…",
// case-derived archetype, reference-image identity, etc.). Image models lock
// onto the *concrete* descriptors more than the *meta* override clause.
//
// This helper takes the original creative body and the user's tweak, and
// asks an LLM to REWRITE the body so the tweak is structurally baked in:
// every subject mention is changed, conflicting descriptors are replaced,
// and the scene/lighting/composition/product fidelity are preserved.
//
// Guards (head + tail) are NEVER sent to the LLM — they are physical-realism
// rules and must remain byte-identical. Only the creative body is rewritten.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM_PROMPT = `You are a prompt-rewriting engine for an image-generation pipeline.

You will receive:
1. ORIGINAL_BODY — a creative scene description for a single image.
2. USER_TWEAK — a free-text instruction from the end user (e.g. "switch to a male model", "make the lighting warmer", "place it on marble instead").

Your job: REWRITE the ORIGINAL_BODY so the USER_TWEAK is structurally baked in — not appended, not prefixed, but integrated everywhere it conflicts.

HARD RULES:
- Every concrete descriptor that conflicts with the tweak MUST be replaced (subject gender/age/ethnicity, scene, lighting, palette, prop — whichever the tweak targets). Do not leave a single conflicting noun phrase.
- Preserve the product description EXACTLY (name, brand, "EXACT product from the reference image", "pixel-faithful 1:1", count of stones, materials, logo, colour). Product fidelity is sacred.
- Preserve scene type (still-life vs lifestyle vs macro), aspect ratio mention ("vertical 9:16"), framing ("chest-height", "extreme macro"), and any explicit composition rules ("Negative space dominates", "No people").
- Do NOT add new guards, do NOT add "PHYSICAL_REALISM" or "MANDATORY CASTING" tags — those live outside this body.
- Do NOT add meta-commentary, do NOT explain. Output ONLY the rewritten body, same single-paragraph format, similar length (±20%).
- If the tweak does not conflict with anything (e.g. it asks for a stylistic nudge), still weave it naturally into the relevant clause.

OUTPUT: the rewritten body as plain text, nothing else.`;

interface RewriteOptions {
  apiKey: string;
  body: string;
  tweak: string;
  /** Optional context label for logs, e.g. "keyframe:lifestyle". */
  label?: string;
  /** Hard timeout in ms. Falls back to original body on timeout. */
  timeoutMs?: number;
}

/**
 * Rewrites a creative body so the user's tweak is structurally integrated.
 * Falls back to the original body on any error / empty tweak / timeout —
 * the caller is always safe to use the returned string.
 */
export async function rewriteBodyWithTweak(opts: RewriteOptions): Promise<string> {
  const { apiKey, body, tweak, label = "rewrite", timeoutMs = 12000 } = opts;
  const trimmedTweak = (tweak || "").trim();
  if (!trimmedTweak) return body;
  if (!apiKey) {
    console.warn(`[tweakRewriter:${label}] no API key — falling back to original body`);
    return body;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `ORIGINAL_BODY:\n${body}\n\nUSER_TWEAK:\n${trimmedTweak}\n\nRewrite the body now. Output the rewritten body only.`,
          },
        ],
        reasoning: { effort: "low" },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.warn(`[tweakRewriter:${label}] gateway ${resp.status}: ${txt.slice(0, 200)} — falling back`);
      return body;
    }

    const data = await resp.json();
    const rewritten: string | undefined = data?.choices?.[0]?.message?.content;
    if (!rewritten || typeof rewritten !== "string" || rewritten.trim().length < 20) {
      console.warn(`[tweakRewriter:${label}] empty/short rewrite — falling back`);
      return body;
    }

    const cleaned = rewritten.trim().replace(/^"|"$/g, "");
    console.log(`[tweakRewriter:${label}] rewrote body (${body.length} → ${cleaned.length} chars) for tweak: ${trimmedTweak.slice(0, 80)}`);
    return cleaned;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tweakRewriter:${label}] failed: ${msg} — falling back to original body`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
