/**
 * Volcengine Ark — Seedance 2.0 (official source).
 *
 * Replaces the previous Segmind-via-VPS hop. Ark is async (task-based),
 * which fits Edge Function timeouts perfectly: submit returns a task id in
 * <2s, poll until succeeded/failed.
 *
 * Endpoints:
 *   POST  /api/v3/contents/generations/tasks
 *   GET   /api/v3/contents/generations/tasks/{id}
 *
 * Model id: doubao-seedance-2-0-260128
 *
 * Aspect ratios accepted: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"
 * Durations: 3..15s integer.
 */

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_MODEL = "doubao-seedance-2-0-260128";

export interface ArkSubmitInput {
  prompt: string;
  /** First-frame image URL (must be public HTTPS, no data: URIs). */
  firstFrameUrl?: string | null;
  /** Optional last-frame image URL. */
  lastFrameUrl?: string | null;
  /** Optional extra reference images (style/character/etc). */
  referenceImageUrls?: string[];
  ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  durationSec?: number;
  generateAudio?: boolean;
  watermark?: boolean;
}

export interface ArkTaskStatus {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  videoUrl?: string;
  error?: string;
  raw?: unknown;
}

function arkKey(): string {
  const k = Deno.env.get("ARK_API_KEY");
  if (!k) throw new Error("ARK_API_KEY is not configured");
  return k;
}

export async function submitArkSeedanceTask(input: ArkSubmitInput): Promise<string> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: input.prompt },
  ];

  if (input.firstFrameUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.firstFrameUrl },
      role: "first_frame",
    });
  }
  if (input.lastFrameUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.lastFrameUrl },
      role: "last_frame",
    });
  }
  for (const ref of input.referenceImageUrls || []) {
    if (!ref) continue;
    content.push({
      type: "image_url",
      image_url: { url: ref },
      role: "reference_image",
    });
  }

  const body: Record<string, unknown> = {
    model: ARK_MODEL,
    content,
    ratio: input.ratio || "9:16",
    duration: Math.max(3, Math.min(15, Math.round(input.durationSec || 5))),
    watermark: input.watermark ?? false,
  };
  if (input.generateAudio) body.generate_audio = true;

  const res = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${arkKey()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ark submit failed [${res.status}]: ${text.substring(0, 400)}`);
  }
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  const id = data?.id || data?.task_id || data?.data?.id;
  if (!id) throw new Error(`Ark submit: no task id in response: ${text.substring(0, 300)}`);
  return id as string;
}

export async function getArkSeedanceTask(taskId: string): Promise<ArkTaskStatus> {
  const res = await fetch(`${ARK_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${arkKey()}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return { id: taskId, status: "failed", error: `Ark status [${res.status}]: ${text.substring(0, 300)}` };
  }
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  const status = (data?.status || data?.data?.status || "").toString().toLowerCase();
  const videoUrl =
    data?.content?.video_url ||
    data?.data?.content?.video_url ||
    data?.video_url ||
    data?.result?.video_url ||
    null;
  const errMsg = data?.error?.message || data?.data?.error?.message || null;
  return {
    id: taskId,
    status: status || "queued",
    videoUrl: videoUrl || undefined,
    error: errMsg || undefined,
    raw: data,
  };
}

/** Mirror Ark's temp video URL into our public product-images bucket so the
 *  URL never expires and survives across sessions. Returns the public URL. */
export async function persistArkVideoToStorage(
  videoUrl: string,
  supabaseUrl: string,
  serviceKey: string,
  pathHint?: string,
): Promise<string> {
  const r = await fetch(videoUrl);
  if (!r.ok) throw new Error(`Fetch Ark video failed [${r.status}]`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const fname = `seedance-${Date.now()}-${(pathHint || "ark").replace(/[^a-z0-9]/gi, "").slice(0, 12)}.mp4`;
  const objectPath = `_seedance/${fname}`;
  const up = await fetch(
    `${supabaseUrl}/storage/v1/object/product-images/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body: buf,
    },
  );
  if (!up.ok) {
    const t = await up.text();
    throw new Error(`Storage upload failed [${up.status}]: ${t.substring(0, 200)}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/product-images/${objectPath}`;
}
