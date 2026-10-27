// generate-bgm — VPS-called edge function that generates a Corvo film BGM master
// via ElevenLabs Music API and uploads the resulting MP3 to the public
// `film-assets` storage bucket at `bgm/<film_id>_bgm.mp3`.
//
// Auth: shared secret via `x-vps-secret` header (same convention as vps-proxy).
// This function is called by the VPS, not the browser.
//
// Request (POST JSON):
//   {
//     "film_id": string,                // required
//     "music_length_ms": number,        // required, 3000–600000
//     "composition_plan"?: object,      // ElevenLabs native, passed through as-is
//     "prompt"?: string                 // used if composition_plan is absent
//   }
//   composition_plan takes precedence when both are present.
//
// Response: { "url": "<public url to bgm/<film_id>_bgm.mp3>" }
//
// On ElevenLabs non-2xx: returns the upstream status and body verbatim.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-vps-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VPS_SHARED_SECRET = Deno.env.get("VPS_SHARED_SECRET") ?? "";
const ELEVENLABS_API_KEY =
  Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("ELEVENLABS_API_KEY_1") || "";

const BUCKET = "film-assets";
const ELEVEN_URL = "https://api.elevenlabs.io/v1/music";
const PREFERRED_FORMAT = "mp3_44100_192";
const FALLBACK_FORMAT = "mp3_44100_128"; // safe default for lower tiers

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callEleven(body: Record<string, unknown>, outputFormat: string) {
  const url = `${ELEVEN_URL}?output_format=${encodeURIComponent(outputFormat)}`;
  return await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Shared-secret auth (same convention as vps-proxy)
  if (!VPS_SHARED_SECRET) return json({ error: "VPS_SHARED_SECRET not configured" }, 500);
  const provided = req.headers.get("x-vps-secret") ?? "";
  if (provided !== VPS_SHARED_SECRET) return json({ error: "unauthorized" }, 401);

  if (!ELEVENLABS_API_KEY) return json({ error: "ELEVENLABS_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "Supabase env not configured" }, 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const film_id = typeof payload?.film_id === "string" ? payload.film_id.trim() : "";
  const music_length_ms = Number(payload?.music_length_ms);
  const composition_plan =
    payload?.composition_plan && typeof payload.composition_plan === "object"
      ? payload.composition_plan
      : null;
  const prompt = typeof payload?.prompt === "string" ? payload.prompt : "";

  if (!film_id) return json({ error: "film_id is required" }, 400);
  if (!isFinite(music_length_ms) || music_length_ms < 3000 || music_length_ms > 600000) {
    return json({ error: "music_length_ms must be a number in [3000, 600000]" }, 400);
  }
  if (!composition_plan && !prompt) {
    return json({ error: "either composition_plan or prompt is required" }, 400);
  }

  // Build ElevenLabs body. composition_plan wins when both are present.
  const elevenBody: Record<string, unknown> = { music_length_ms };
  if (composition_plan) {
    elevenBody.composition_plan = composition_plan;
    // Instrumental is guaranteed by the plan itself (no lyrics inside).
  } else {
    elevenBody.prompt = prompt;
    elevenBody.force_instrumental = true;
  }

  console.log(
    `[generate-bgm] film=${film_id} ms=${music_length_ms} mode=${
      composition_plan ? "composition_plan" : "prompt"
    }`,
  );

  // Try preferred output_format, fall back to a lower tier on format-not-supported.
  let elevenResp = await callEleven(elevenBody, PREFERRED_FORMAT);
  if (!elevenResp.ok && (elevenResp.status === 400 || elevenResp.status === 403)) {
    const errText = await elevenResp.clone().text().catch(() => "");
    if (/output_format|tier|subscription|not.*support/i.test(errText)) {
      console.log(`[generate-bgm] falling back to ${FALLBACK_FORMAT}: ${errText.slice(0, 200)}`);
      elevenResp = await callEleven(elevenBody, FALLBACK_FORMAT);
    }
  }

  if (!elevenResp.ok) {
    const errText = await elevenResp.text().catch(() => "");
    console.error(`[generate-bgm] ElevenLabs ${elevenResp.status}: ${errText.slice(0, 400)}`);
    // Pass upstream status + body through verbatim; don't swallow.
    return new Response(errText || JSON.stringify({ error: "elevenlabs_error" }), {
      status: elevenResp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": elevenResp.headers.get("content-type") ?? "application/json",
      },
    });
  }

  const audio = await elevenResp.arrayBuffer();
  if (audio.byteLength < 1000) {
    return json({ error: "elevenlabs_empty_audio", bytes: audio.byteLength }, 502);
  }
  console.log(`[generate-bgm] received ${audio.byteLength} bytes`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const storagePath = `bgm/${film_id}_bgm.mp3`;
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, audio, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadErr) {
    console.error(`[generate-bgm] upload failed:`, uploadErr);
    return json({ error: `upload_failed: ${uploadErr.message}` }, 500);
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  return json({ url: pub.publicUrl });
});
