/**
 * generate-storyboard — Storyboard Mode (replaces Free Mode prompt step).
 *
 * Generates ONE horizontal 4×2 (8-panel) storyboard image via OpenAI gpt-image-1.
 * Each panel = one keyframe + a one-line caption under it with timestamp range
 * (e.g. "0–2s: model unscrews cap, slow push-in").
 *
 * That single image is later fed to Seedance 2.0 as i2v reference with a
 * minimal "follow the storyboard panels in order" prompt — Seedance handles
 * all motion / pacing decisions.
 *
 * Cost: 3 cr (deducted server-side, refunded on failure).
 *
 * REQUIRES: OPENAI_API_KEY secret (user must add via Lovable Cloud secrets).
 * If missing, returns 503 with a clear message — UI surfaces this to the user.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

interface Body {
  product?: {
    productName?: string;
    brandName?: string;
    category?: string;
    description?: string;
    summary?: string;
    keyFeatures?: string[];
  };
  mood?: { vibe?: string; texture?: string; goal?: string; narrative?: string };
  visualSignature?: string;
  colorGrade?: string;
  includePeople?: boolean;
  heroImageUrl?: string;
  durationSec?: 5 | 10 | 15;
  draftId?: string | null;
  /** Pass true when re-generating to nudge the LLM toward a different angle. */
  regenerate?: boolean;
  /** Optional user-authored captions per panel (length 8). When provided, gpt-image-1
   *  must use these verbatim under each panel instead of writing its own. */
  panels?: string[];
  /** 30s Storyboard Mode: when set, this is the URL of the PRIOR storyboard
   *  (storyboard A). gpt-image-1 must produce a new 8-panel storyboard where
   *  panel 1 is visually identical to panel 8 (bottom-right) of the reference,
   *  giving the two stitched Seedance clips seamless continuity. */
  continuationOfImageUrl?: string;
  /** Marker for storage path / tx description when generating segment B. */
  segmentLabel?: "A" | "B";
}

const STORYBOARD_COST = 3;

function buildPanelSchedule(durationSec: number): { idx: number; start: number; end: number; label: string }[] {
  // Always 8 panels. Distribute evenly across requested duration.
  const step = durationSec / 8;
  return Array.from({ length: 8 }, (_, i) => {
    const start = +(i * step).toFixed(1);
    const end = +((i + 1) * step).toFixed(1);
    return { idx: i + 1, start, end, label: `${start}s–${end}s` };
  });
}

function buildImagePrompt(b: Body, schedule: ReturnType<typeof buildPanelSchedule>): string {
  const p = b.product || {};
  const m = b.mood || {};
  const subject = [
    p.productName || "the product",
    p.brandName ? `by ${p.brandName}` : null,
    p.category ? `(${p.category})` : null,
  ].filter(Boolean).join(" ");

  const tone = [m.vibe, m.texture, m.narrative, b.visualSignature, b.colorGrade].filter(Boolean).join(", ");
  const people = b.includePeople === false
    ? "Product-only — NO people, NO hands, NO models in any panel."
    : "Include human presence (hands, partial figure, model) where it serves the story.";

  const userPanels = (b.panels && b.panels.length === 8) ? b.panels.map((s) => (s || "").trim().slice(0, 140)) : null;
  const isSegmentB = !!b.continuationOfImageUrl;

  const panelList = schedule
    .map((s, i) => {
      const note = userPanels?.[i];
      const continuityTag = (isSegmentB && i === 0)
        ? " — CONTINUITY BRIDGE: this panel MUST be a near-pixel-accurate reproduction of the BOTTOM-RIGHT panel (Panel 8) of the supplied reference storyboard image. Same subject pose, same wardrobe, same framing, same lighting, same color grade. Do NOT redraw — match it."
        : "";
      if (note) {
        return `   Panel ${s.idx} (${s.label}): "${note}" — render this exact beat.${continuityTag} The caption printed below the panel MUST read: "${s.label}: ${note}".`;
      }
      return `   Panel ${s.idx} (${s.label}): one key beat from a ${b.durationSec ?? 15}s product film, chronologically continuous from the previous panel.${continuityTag}`;
    })
    .join("\n");

  const continuityHeader = isSegmentB
    ? `\n\nCRITICAL — THIS IS SEGMENT B OF A TWO-PART 30s FILM:
- A reference storyboard image (segment A, 4×2 panels) has been supplied as the input image.
- Panel 1 of THIS new storyboard MUST visually match Panel 8 (bottom-right) of the reference EXACTLY — same subject, same pose, same wardrobe, same framing, same lighting, same color grade. Treat it as the same frozen frame that bridges the two 15s clips.
- Then the remaining 7 panels continue the action naturally from that bridge into a new second-act arc.
- KEEP THE SAME IDENTITY: same model, same wardrobe, same set, same color palette as the reference storyboard.\n`
    : "";

  return `Create a single, high-resolution HORIZONTAL STORYBOARD layout in the style of a professional film production storyboard.${continuityHeader}

LAYOUT (strict):
- Pure white background, no decorative borders.
- 4 columns × 2 rows = exactly 8 panels arranged in reading order (top-left → top-right → bottom-left → bottom-right).
- Each panel is a clean rectangular frame with a thin black border.
- BELOW each panel (inside its column, not overlapping the image) print ONE line of black sans-serif caption text with: the timestamp range, a colon, and a SHORT action note (max ~7 words). Example: "0s–1.9s: model unscrews cap, slow push-in".
- Generous white gutters between panels (~3% of panel width). NO panel numbers inside the image — only the timestamp captions below.

SUBJECT: ${subject}
${p.description || p.summary ? `CONTEXT: ${(p.description || p.summary)!.slice(0, 300)}` : ""}
${p.keyFeatures?.length ? `KEY FEATURES: ${p.keyFeatures.slice(0, 5).join(" · ")}` : ""}
${tone ? `TONE / VISUAL DIRECTION: ${tone}` : ""}
${people}

PANELS — render these 8 sequential beats covering a ${b.durationSec ?? 15}s product film:
${panelList}

PER-PANEL ART DIRECTION:
- Photorealistic, editorial commercial photography (think: print campaign for a luxury magazine).
- Consistent lighting, color grade and identity ACROSS ALL 8 panels (same model, same wardrobe, same set, same color palette).
- Each panel = ONE clear shot (vary shot scale: wide, medium, close-up, extreme close-up — but keep the same world).
- The product MUST be visible and recognizable in at least 6 of the 8 panels.
- Each panel internally tells a clear single action that Seedance can animate over ~${((b.durationSec ?? 15) / 8).toFixed(1)}s.

CAPTION TEXT RULES (critical for legibility):
- Black text on the white gutter directly below each panel.
- Clean sans-serif (Helvetica / Inter style), ~14pt look, single line, no wrapping.
- Format exactly: "<start>s–<end>s: <short action>". Use the timestamps I provided.

NO overall title, NO logos, NO watermarks, NO extra explanatory text outside the panel captions.${b.regenerate ? "\n\nPRIOR ATTEMPT was already shown — take a noticeably DIFFERENT creative angle (different opening shot scale, different pacing of reveals)." : ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Auth ──
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Auth required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid auth" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  // ── OpenAI key check (clear error for the UI) ──
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({
      error: "OPENAI_API_KEY not configured. Storyboard mode requires the OpenAI image API — please add the key in Lovable Cloud → Secrets.",
      code: "missing_openai_key",
    }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  const durationSec = (body.durationSec ?? 15) as 5 | 10 | 15;

  // ── Check admin (admin bypasses credit deduct) ──
  const { data: isAdminData } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  const isAdmin = !!isAdminData;

  // ── Deduct credits upfront ──
  const segLabel = body.segmentLabel || (body.continuationOfImageUrl ? "B" : "A");
  if (!isAdmin) {
    const { error: deductErr } = await sb.rpc("deduct_credits", {
      _user_id: userId,
      _amount: STORYBOARD_COST,
      _description: `Editorial Storyboard Mode · 8-panel storyboard${segLabel === "B" ? " (segment B / continuity)" : ""}`,
      _metadata: { type: "editorial-storyboard", draft_id: body.draftId ?? null, pipeline: "editorial", segment: segLabel },
    });
    if (deductErr) {
      return new Response(JSON.stringify({ error: deductErr.message || "Insufficient credits", code: "insufficient_credits" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  async function refund(reason: string) {
    if (isAdmin) return;
    try {
      await sb.rpc("add_credits_atomic", { _user_id: userId, _amount: STORYBOARD_COST });
      await sb.from("credit_transactions").insert({
        user_id: userId,
        amount: STORYBOARD_COST,
        type: "refund",
        description: "Editorial Storyboard Mode · storyboard refund",
        metadata: { reason, type: "editorial-storyboard", draft_id: body.draftId ?? null, pipeline: "editorial" },
      } as any);
    } catch (e) {
      console.warn("[generate-storyboard] refund failed:", e);
    }
  }

  // ── Async pattern: gpt-image-1 takes 30-90s, which is longer than the Shopify
  // embedded iframe (especially mobile Safari) will hold the connection open.
  // We return 202 immediately and run generation + draft write-back in the
  // background via EdgeRuntime.waitUntil. The client polls ad_drafts for
  // state_json.final_storyboard_url / state_json.storyboard_error.
  const schedule = buildPanelSchedule(durationSec);
  const prompt = buildImagePrompt(body, schedule);

  async function writeDraftError(message: string, code: string) {
    if (!body.draftId) return;
    try {
      const { data: cur } = await sb.from("ad_drafts").select("state_json").eq("id", body.draftId).maybeSingle();
      const next = { ...(cur?.state_json as any ?? {}), storyboard_error: message, storyboard_error_code: code, storyboard_status: "failed" };
      await sb.from("ad_drafts").update({ state_json: next, step: "failed" }).eq("id", body.draftId);
    } catch (e) { console.warn("[generate-storyboard] writeDraftError failed:", e); }
  }
  async function writeDraftSuccess(imageUrl: string) {
    if (!body.draftId) return;
    try {
      const { data: cur } = await sb.from("ad_drafts").select("state_json").eq("id", body.draftId).maybeSingle();
      const isB = (body.segmentLabel || (body.continuationOfImageUrl ? "B" : "A")) === "B";
      const next = {
        ...(cur?.state_json as any ?? {}),
        ...(isB
          ? { final_storyboard_url_b: imageUrl }
          : { final_storyboard_url: imageUrl }),
        storyboard_status: "done",
        storyboard_error: null,
      };
      await sb.from("ad_drafts").update({ state_json: next, step: "ready", thumbnail_url: imageUrl }).eq("id", body.draftId);
    } catch (e) { console.warn("[generate-storyboard] writeDraftSuccess failed:", e); }
  }

  const work = (async () => {
    try {
      let oaiRes: Response;
      if (body.continuationOfImageUrl) {
        const refRes = await fetch(body.continuationOfImageUrl);
        if (!refRes.ok) {
          await refund("ref_download_failed");
          await writeDraftError(`Failed to download segment-A storyboard (${refRes.status})`, "ref_download_failed");
          return;
        }
        const refBlob = await refRes.blob();
        const form = new FormData();
        form.append("model", "gpt-image-1");
        form.append("prompt", prompt.slice(0, 32000));
        form.append("size", "1536x1024");
        form.append("quality", "high");
        form.append("n", "1");
        form.append("image", new File([refBlob], "segment-a.png", { type: refBlob.type || "image/png" }));
        oaiRes = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: form,
        });
      } else {
        oaiRes = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-image-1",
            prompt: prompt.slice(0, 32000),
            size: "1536x1024",
            quality: "high",
            n: 1,
          }),
        });
      }

      if (!oaiRes.ok) {
        const txt = await oaiRes.text();
        console.error("[generate-storyboard] OpenAI error:", oaiRes.status, txt.slice(0, 500));
        await refund(`openai_${oaiRes.status}`);
        await writeDraftError(`OpenAI image API error (${oaiRes.status}): ${txt.slice(0, 200)}`, "openai_error");
        return;
      }

      const oaiJson = await oaiRes.json();
      const b64: string | undefined = oaiJson?.data?.[0]?.b64_json;
      if (!b64) {
        await refund("openai_empty");
        await writeDraftError("OpenAI returned no image data", "openai_empty");
        return;
      }

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `storyboards/${userId}/${crypto.randomUUID()}.png`;
      const { error: upErr } = await sb.storage.from("product-images").upload(path, bytes, {
        contentType: "image/png", upsert: false,
      });
      if (upErr) {
        await refund(`upload_${upErr.message}`);
        await writeDraftError(`Storage upload failed: ${upErr.message}`, "upload_failed");
        return;
      }
      const { data: pub } = sb.storage.from("product-images").getPublicUrl(path);
      await writeDraftSuccess(pub.publicUrl);
    } catch (e: any) {
      console.error("[generate-storyboard] fatal:", e);
      await refund(e?.message || "unknown");
      await writeDraftError(e?.message || "Storyboard generation failed", "fatal");
    }
  })();

  // Mark draft as processing so client poller knows to wait.
  if (body.draftId) {
    try {
      const { data: cur } = await sb.from("ad_drafts").select("state_json").eq("id", body.draftId).maybeSingle();
      const next = { ...(cur?.state_json as any ?? {}), storyboard_status: "processing", storyboard_error: null };
      await sb.from("ad_drafts").update({ state_json: next }).eq("id", body.draftId);
    } catch { /* best-effort */ }
  }

  // @ts-ignore EdgeRuntime is provided by Supabase Edge Runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    // Local-dev fallback: still fire-and-forget
    work.catch((e) => console.error("[generate-storyboard] bg error:", e));
  }

  return new Response(JSON.stringify({
    status: "processing",
    draftId: body.draftId ?? null,
    durationSec,
    panelCount: 8,
    schedule,
  }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
