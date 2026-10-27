/**
 * Seedance (Segmind) — and several other external image-conditioning APIs —
 * require a publicly reachable HTTPS URL for the conditioning image. Many
 * upstream paths in this codebase produce `data:image/...;base64,...` URIs
 * (Gemini keyframes, Flux composites, client-side canvas crops). Passing
 * those straight through gives `InvalidParameter.URL` and the entire job
 * fails with the opaque "data parsing error" the user sees.
 *
 * This helper persists a data URI to the `product-images` bucket and returns
 * the public URL. HTTP(S) URLs are passed through unchanged. Anything else
 * (blob:, file:, null) returns null — callers should treat that as "no
 * conditioning image" and fall back to text2video.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function ensurePublicImageUrl(
  client: SupabaseClient,
  userId: string,
  url: string | null | undefined,
  opts: { folder?: string } = {},
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (!url.startsWith("data:")) return null;

  try {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1] || "image/jpeg";
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const b64 = match[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const folder = opts.folder || "seedance-keyframes";
    const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await client.storage
      .from("product-images")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      console.warn("[ensurePublicImageUrl] upload failed:", upErr.message);
      return null;
    }
    const { data } = client.storage.from("product-images").getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    console.warn("[ensurePublicImageUrl] error:", e);
    return null;
  }
}
