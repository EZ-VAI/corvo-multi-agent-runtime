/**
 * Native Google AI Studio Gemini image-generation client.
 *
 * Bypasses Lovable AI Gateway and calls Google directly to save cost on the
 * highest-volume image-gen endpoints (generate-keyframe, generate-grid-keyframes).
 *
 * Why exist:
 *   - Gateway bills credits per image (workspace-level).
 *   - Direct Google AI Studio bills the underlying $/image (typically cheaper at scale).
 *   - For the 2 highest-volume image fns, going direct is ~80% of total savings.
 *
 * Other image-gen edge fns continue to use the Lovable Gateway for resilience
 * + multi-provider failover (see memory: tech/dependency-management-standard).
 *
 * Required env: GOOGLE_AI_API_KEY (already configured in project secrets).
 */

const GOOGLE_AI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Lovable Gateway model ID → native Google model ID. */
function resolveNativeModel(gatewayModel: string): string {
  // Strip "google/" prefix; native API uses bare model names.
  // gemini-3-pro-image-preview → gemini-3-pro-image-preview (same)
  // gemini-3.1-flash-image-preview → gemini-3.1-flash-image-preview (same)
  return gatewayModel.replace(/^google\//, "");
}

export type NativeGeminiContent =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface NativeGeminiImageRequest {
  /** Lovable-style model id e.g. "google/gemini-3-pro-image-preview". */
  model: string;
  /** Ordered conversation parts: text + base64 inline images. */
  parts: NativeGeminiContent[];
  /** Optional: Google AI Studio API key (defaults to env GOOGLE_AI_API_KEY). */
  apiKey?: string;
  /** Retry attempts for transient errors (default 3). */
  retries?: number;
  /** Output aspect ratio (e.g. "16:9", "9:16", "1:1", "4:3", "3:4"). Passed via
   *  generationConfig.imageConfig.aspectRatio — text hints alone don't reliably
   *  control output shape on gemini-3-*-image-preview. */
  aspectRatio?: string;
}

export interface NativeGeminiImageResult {
  /** First image returned, formatted as a data URL ready to use directly. */
  imageDataUrl: string;
  /** Any text the model returned alongside the image (rare, mostly empty). */
  text: string;
  /** Raw response (for debugging). */
  raw: any;
}

/**
 * Convert an OpenAI-compatible "messages" array (used by Lovable Gateway) into
 * native Gemini "parts". Only the LAST user message is converted — system /
 * assistant messages are flattened into a single text prefix. This matches how
 * generate-keyframe / generate-grid-keyframes already structure their requests
 * (single user message with text + image_url parts).
 */
export function messagesToNativeParts(messages: any[]): NativeGeminiContent[] {
  const parts: NativeGeminiContent[] = [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return parts;

  const content = lastUser.content;
  if (typeof content === "string") {
    parts.push({ text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;

  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url as string;
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
      // Non-data URLs are skipped — the caller is responsible for converting
      // remote URLs to base64 data URIs before invoking this helper. Both
      // generate-keyframe and generate-grid-keyframes already do this.
    }
  }
  return parts;
}

/**
 * Call native Google AI Studio image-generation endpoint with retry on 429/5xx.
 * Returns a data URL ready to drop into existing pipelines (matches the shape
 * that the Lovable Gateway path returns).
 */
export async function callNativeGeminiImage(
  req: NativeGeminiImageRequest,
): Promise<NativeGeminiImageResult> {
  const apiKey = req.apiKey || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");

  const model = resolveNativeModel(req.model);
  const url = `${GOOGLE_AI_BASE}/${model}:generateContent?key=${apiKey}`;
  const allowedAR = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"]);
  const ar = req.aspectRatio && allowedAR.has(req.aspectRatio) ? req.aspectRatio : undefined;
  const body: any = {
    contents: [{ role: "user", parts: req.parts }],
    generationConfig: {
      // Both image + text so we can salvage either if one is missing.
      responseModalities: ["IMAGE", "TEXT"],
      // Avoid provider-side text/metadata truncation around image generation.
      maxOutputTokens: 8192,
      ...(ar ? { imageConfig: { aspectRatio: ar } } : {}),
    },
  };

  const retries = req.retries ?? 3;
  let res: Response | null = null;
  let lastErrText = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    lastErrText = await res.text();
    const retryable = [429, 500, 502, 503, 504].includes(res.status);
    if (!retryable || attempt === retries - 1) break;
    const backoff = res.status === 429 ? 5000 * (attempt + 1) : 2000 * (attempt + 1);
    console.warn(`[NativeGemini] attempt ${attempt + 1} → ${res.status}, retry in ${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
  }

  if (!res || !res.ok) {
    const status = res?.status || 500;
    // Surface upstream errors with the same status codes our callers expect.
    throw Object.assign(new Error(`Google AI Studio ${status}: ${lastErrText.slice(0, 300)}`), {
      status,
      upstreamBody: lastErrText,
    });
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let imageDataUrl = "";
  let text = "";
  for (const p of parts) {
    if (p.inlineData?.data && !imageDataUrl) {
      const mime = p.inlineData.mimeType || "image/png";
      imageDataUrl = `data:${mime};base64,${p.inlineData.data}`;
    } else if (typeof p.text === "string") {
      text += p.text;
    }
  }

  if (!imageDataUrl) {
    // Some responses include the image as a markdown ![](data:...) inside text.
    const m = text.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
    if (m) imageDataUrl = m[1];
  }

  if (!imageDataUrl) {
    throw new Error(`Google AI Studio returned no image. finish=${data?.candidates?.[0]?.finishReason || "?"}`);
  }

  return { imageDataUrl, text, raw: data };
}
