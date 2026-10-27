import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chargeClipCreditsServerSide } from "../_shared/chargeClipCredits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

const KLING_BASE = "https://api-singapore.klingai.com";

async function createKlingToken(accessKey: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };

  function base64url(data: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { taskId, endpoint, sessionId, blockId } = await req.json();
    if (!taskId || !endpoint) {
      return new Response(JSON.stringify({ error: "taskId and endpoint are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const KLING_AK = Deno.env.get("KLING_ACCESS_KEY");
    const KLING_SK = Deno.env.get("KLING_SECRET_KEY");
    if (!KLING_AK || !KLING_SK) {
      return new Response(JSON.stringify({ error: "Kling API keys not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await createKlingToken(KLING_AK, KLING_SK);

    const res = await fetch(`${KLING_BASE}${endpoint}/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Kling poll failed [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    if (data.code !== 0) throw new Error(`Kling error: ${data.message} (code ${data.code})`);

    const status = data.data?.task_status;

    // Update progress in DB
    if (sessionId && blockId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const progressPct = status === "succeed" ? 95 : 50;
        fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(sessionId)}&block_id=eq.${encodeURIComponent(blockId)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ error_message: `progress:${progressPct}`, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    if (status === "succeed") {
      const videos = data.data?.task_result?.videos;
      if (!videos?.length) throw new Error("No video in Kling response");
      const videoUrl = videos[0].url;

      // Server-side, idempotent credit charge — fixes the leak where
      // tab-close between completion and client-side deduct dropped the bill.
      if (sessionId && blockId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          // Also persist the final clip_url so resume / recovery can reuse it.
          fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(sessionId)}&block_id=eq.${encodeURIComponent(blockId)}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ status: "completed", clip_url: videoUrl, error_message: "progress:100", updated_at: new Date().toISOString() }),
          }).catch(() => {});

          await chargeClipCreditsServerSide({
            supabaseUrl,
            serviceKey,
            sessionId,
            blockId,
            description: `Clip ${blockId} (kling)`,
            metadata: { source: "poll-kling-status", taskId },
          });
        }
      }

      return new Response(JSON.stringify({
        status: "completed",
        type: "video",
        dataUrl: null,
        uri: videoUrl,
        mimeType: "video/mp4",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (status === "failed") {
      return new Response(JSON.stringify({
        status: "failed",
        error: data.data?.task_status_msg || "Kling generation failed",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Still processing
    return new Response(JSON.stringify({
      status: "processing",
      taskStatus: status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("poll-kling-status error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
