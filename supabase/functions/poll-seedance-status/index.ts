import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chargeClipCreditsServerSide } from "../_shared/chargeClipCredits.ts";
import { getArkSeedanceTask, persistArkVideoToStorage } from "../_shared/arkSeedance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { taskId, sessionId, blockId } = await req.json();
    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = await getArkSeedanceTask(taskId);
    console.log(`[poll-seedance-status] taskId=${taskId} ark_status=${status.status} hasUrl=${!!status.videoUrl}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (status.status === "succeeded" && status.videoUrl) {
      // Mirror Ark's temp URL into product-images so it survives.
      let finalUrl = status.videoUrl;
      try {
        finalUrl = await persistArkVideoToStorage(status.videoUrl, supabaseUrl, serviceKey, taskId);
      } catch (e) {
        console.warn(`[poll-seedance-status] persist failed, serving Ark URL directly:`, e);
      }

      if (sessionId && blockId && supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(sessionId)}&block_id=eq.${encodeURIComponent(blockId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "completed", clip_url: finalUrl, error_message: "progress:100", updated_at: new Date().toISOString() }),
        }).catch(() => {});
        await chargeClipCreditsServerSide({
          supabaseUrl, serviceKey,
          sessionId, blockId,
          description: `Clip ${blockId} (seedance)`,
          metadata: { source: "poll-seedance-status", taskId, engine: "ark" },
        });
      }

      return new Response(JSON.stringify({
        status: "completed",
        type: "video",
        uri: finalUrl,
        dataUrl: null,
        mimeType: "video/mp4",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (status.status === "failed") {
      return new Response(JSON.stringify({
        status: "failed",
        error: status.error || "Seedance generation failed",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // queued | running | anything else → still processing
    return new Response(JSON.stringify({
      status: "processing",
      progress: status.status,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("poll-seedance-status error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
