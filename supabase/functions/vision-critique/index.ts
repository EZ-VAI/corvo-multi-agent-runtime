// vision-critique: final fail-closed QA gate over a generated keyframe.
// Human-eye-first: the model decides the verdict holistically. No weighted
// scoring, no numeric gates. Fail-closed: any internal failure → "retry".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-caller",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function fetchAsInline(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return null;
    const mt = r.headers.get("content-type") || "image/jpeg";
    return { mimeType: mt, data: uint8ToBase64(new Uint8Array(buf)) };
  } catch {
    return null;
  }
}

// Fail-closed retry payload — used whenever we cannot trust a pass verdict.
function retryEnvelope(reason: string, extras: Record<string, any> = {}) {
  return {
    verdict: "retry" as const,
    score: 0,
    dimension: "unknown",
    issues: [reason],
    feedback: `Vision critique could not complete (${reason}). Re-render and re-evaluate.`,
    ...extras,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!GOOGLE_AI_API_KEY) {
    return json(retryEnvelope("missing_google_ai_api_key"));
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(retryEnvelope("invalid_json_body"));
  }

  const {
    keyframeUrl,
    shot,
    productImages,
    antiIdentity,
    brand,
    model: modelOverride,
  } = payload ?? {};

  if (!keyframeUrl || typeof keyframeUrl !== "string") {
    return json(retryEnvelope("missing_keyframeUrl"));
  }

  const productRefs: string[] = Array.isArray(productImages)
    ? productImages.filter((u) => typeof u === "string" && u).slice(0, 3)
    : [];

  // ---- Fetch keyframe (MANDATORY — fail closed if missing) ----
  const keyframeInline = await fetchAsInline(keyframeUrl);
  if (!keyframeInline) {
    return json(retryEnvelope("keyframe_fetch_failed", { keyframeUrl }));
  }

  // ---- Fetch product references (best-effort but track failures) ----
  const productInline: { mimeType: string; data: string }[] = [];
  const productFetchFailures: string[] = [];
  for (const url of productRefs) {
    const inl = await fetchAsInline(url);
    if (inl) productInline.push(inl);
    else productFetchFailures.push(url);
  }

  // If user supplied product refs but ALL of them failed, we cannot judge
  // product fidelity honestly → fail closed.
  if (productRefs.length > 0 && productInline.length === 0) {
    return json(retryEnvelope("all_product_refs_unreachable", { productFetchFailures }));
  }

  // ---- Resolve context strings for prompt ----
  const intentText = (() => {
    if (!shot || typeof shot !== "object") return "(none provided)";
    const parts = [
      shot.intent ? String(shot.intent) : null,
      shot.subject ? `subject: ${String(shot.subject)}` : null,
      shot.shotScale ? `shotScale: ${shot.shotScale}` : null,
      shot.narrativePhase ? `narrativePhase: ${shot.narrativePhase}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" — ").slice(0, 800) : "(none provided)";
  })();

  const antiIdentityText = !antiIdentity
    ? "(none provided)"
    : typeof antiIdentity === "string"
      ? antiIdentity.slice(0, 1200)
      : JSON.stringify(antiIdentity).slice(0, 1200);

  // brand is accepted in the input contract but not injected as its own block —
  // anti-identity already carries what the brand must NOT look like, and the
  // prompt deliberately stays checklist-free.
  void brand;

  const prompt = `You are looking at a single frame from a brand film — as a sharp-eyed, fashion-literate person who has scrolled past thousands of beauty and luxury campaigns. You are NOT a QA checker. You are a real human eye.

PRIORITY 1 — React first, as a human. This frame just appeared in your feed. Instantly, honestly:
- Would you stop, or scroll past? Why?
- Does anything feel fake, off, awkward, or like "no real person / no real brand would do this"?
- Does it hold up against what you've actually seen in the real world — real people, real skin, real product photography, real premium campaigns?
Trust your gut. Do NOT run a checklist. Do NOT hunt for problems — say what actually jumps out in a half-second glance. Every frame has different problems; let the image tell you what's wrong or right. (The KIND of instinct meant here: e.g. "nobody applies lipstick leaving half the lip pale," or "that's a whole face cropped to just a mouth — it reads uncanny." Do not limit yourself to these; react to whatever strikes YOU.)

PRIORITY 2 — Then, loosely, does it broadly do what this shot was going for? (intent given below, as context only.) Coarse level only — did it land the rough idea? Do NOT nitpick small details or minor deviations. Tiny imperfections a real viewer wouldn't notice or care about DO NOT MATTER.

CONFLICT RULE — Your human eye wins. If it departs from what was asked but looks great to a real person, pass it. If it matches the description perfectly but looks wrong/fake/unappealing to a real person, your eye overrides — do not pass it. The description is context, never the law.

THE ONE HARD FACT — the product must read as the REAL product in the reference images: recognizable shape, color, finish, label. Text on the product is fine and expected if it matches the real label; only garbled or wrong text is a problem. Judge at the level a real consumer would notice, not pixel-by-pixel.

Then decide:
- "pass" — a real premium brand could publish this; your eye is satisfied.
- "retry" — the idea is right but THIS render is flawed in a way a re-render could fix; give the single most important fix.
- "reject" — the idea itself doesn't work; a real consumer wouldn't respond no matter how well rendered. Goes back to the creative team, not the renderer.
When unsure, choose "retry."

When verdict is "retry", also decide FIX SCOPE:
- "local" — the frame is fundamentally right; the defect is a contained touch-up (a scale, a color, a stray/floating object, a finish). Edit the existing frame, preserving everything already correct. This is the usual case.
- "regenerate" — the frame's FOUNDATION is wrong (broken composition, bad staging, the frame is not worth preserving). Re-render fresh.
Bias strongly to "local"; reserve "regenerate" for genuinely broken frames.

shot intent (context only): ${intentText}
brand / what it must NOT look like (context only): ${antiIdentityText}

Return JSON only:
{
  "reaction": "<honest first-person human reaction, 1-3 sentences>",
  "verdict": "pass" | "retry" | "reject",
  "score": <0-100, overall gut sense of how good this frame is>,
  "dimension": "<the kind of thing that drove your call, your own words>",
  "issues": ["<what struck you as wrong — leave empty if nothing real; no trivia>"],
  "feedback": "<the single most important change, phrased so a render tool can act on it>",
  "fix": "local" | "regenerate"
}
"fix" is required ONLY when verdict is "retry". Bias strongly to "local".`;

  const parts: any[] = [
    { text: prompt },
    { text: "FIRST IMAGE = the GENERATED KEYFRAME you are judging." },
    { inlineData: keyframeInline },
  ];
  if (productInline.length) {
    parts.push({
      text: `NEXT ${productInline.length} IMAGE(S) = GROUND-TRUTH PRODUCT REFERENCE PHOTOS. The product in the generated keyframe must read as the same real product.`,
    });
    for (const inl of productInline) parts.push({ inlineData: inl });
  }

  const model = (typeof modelOverride === "string" && modelOverride.trim())
    ? modelOverride.trim()
    : "gemini-3.1-pro-preview";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GOOGLE_AI_API_KEY}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 3072 },
      }),
    });
  } catch (e) {
    console.warn("[vision-critique] fetch failed", e);
    return json(retryEnvelope("gemini_fetch_failed"));
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[vision-critique] gemini non-ok", res.status, txt.slice(0, 300));
    return json(retryEnvelope(`gemini_${res.status}`, { detail: txt.slice(0, 300) }));
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return json(retryEnvelope("gemini_invalid_json"));
  }

  const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!rawText) return json(retryEnvelope("gemini_empty_response"));

  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return json(retryEnvelope("parse_no_json_object", { rawText: rawText.slice(0, 400) }));
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return json(retryEnvelope("parse_json_failed", { rawText: rawText.slice(0, 400) }));
  }

  // Trust the model's holistic verdict. Only sanitize, never override.
  const verdictRaw = String(parsed?.verdict || "").toLowerCase().trim();
  const verdict: "pass" | "retry" | "reject" =
    verdictRaw === "pass" || verdictRaw === "reject" ? (verdictRaw as any) : "retry";

  let score = Number(parsed?.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const dimension: string =
    typeof parsed?.dimension === "string" && parsed.dimension.trim()
      ? parsed.dimension.trim().slice(0, 120)
      : "human eye";

  const issues: string[] = Array.isArray(parsed?.issues)
    ? parsed.issues
        .map((x: any) => String(x).trim())
        .filter((x: string) => x.length > 0)
        .map((x: string) => x.slice(0, 240))
        .slice(0, 8)
    : [];

  const feedback: string = String(parsed?.feedback || "").slice(0, 600) ||
    (verdict === "pass"
      ? "Looks publish-ready."
      : "Re-render with a stronger, more believable take.");

  const reaction: string = String(parsed?.reaction || "").slice(0, 800);

  const fixRaw = String(parsed?.fix || "").toLowerCase().trim();
  const fix: "local" | "regenerate" = fixRaw === "regenerate" ? "regenerate" : "local";

  return json({
    verdict,
    score,
    dimension,
    issues,
    feedback,
    reaction,
    fix,
    meta: {
      model,
      productRefsUsed: productInline.length,
      productFetchFailures,
    },
  });
});
