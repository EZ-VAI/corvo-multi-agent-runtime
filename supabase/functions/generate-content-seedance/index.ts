import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodePrompt } from "../_shared/promptObfuscation.ts";
import { styleAnchorPrefix, styleAnchorClause } from "../_shared/styleDna.ts";
import { ensurePublicImageUrl } from "../_shared/ensurePublicImageUrl.ts";
import { enforceVideoPromptBudget, MOTION_REALISM_GUARD, PHYSICAL_SCALE_GUARD, PHYSICAL_REALISM_GUARD, RIGID_PRODUCT_GUARD, HUMAN_FACE_GUARD, SECONDARY_PROPS_INERT_GUARD, buildRepeatingUnitGuard } from "../_shared/realismGuards.ts";
import { submitArkSeedanceTask } from "../_shared/arkSeedance.ts";
import { requireVpsOrUser } from "../_shared/vpsAuthGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

/**
 * Seedance 2.0 via Segmind — VPS Proxy Pattern
 *
 * Segmind's Seedance API is synchronous (~174s avg), exceeding Edge Function limits (~150s).
 * This function submits the request to VPS (which has no timeout) and returns a polling token.
 * Frontend polls via poll-seedance-status edge function → VPS /seedance-status/:jobId.
 *
 * PROMPT STRATEGY: Seedance 2.0 needs comprehensive coverage of all visual dimensions
 * (camera, lighting, movement, subject, mood, composition, texture) but each dimension
 * should be expressed in ONE concise phrase — not granular multi-sentence rules.
 * Unlike Kling, it does NOT benefit from meta-instruction tags ([MOVEMENT], [SCALE], etc.)
 * or abstract enforcement rules (REALISM:, LIFELIKE:, CAUSALITY LOCK). We strip those
 * and condense the remaining visual description to a well-rounded but concise prompt.
 */

/**
 * Transform a Kling-optimized prompt into a Seedance-friendly one.
 * Strategy: "Cover every dimension, but one phrase each."
 * 1. Strip all bracketed tags, guard blocks, and abstract rules
 * 2. Keep the descriptive visual content
 * 3. Deduplicate and condense to ~500 chars
 */
function cleanPromptForSeedance(rawPrompt: string, isProductOnly: boolean): string {
  let p = rawPrompt;

  // 1. Strip bracketed tag labels but KEEP content after them
  p = p.replace(/\[(MOVEMENT|SCALE|SUBJECT|FOCUS|MOOD|COMPOSITION|FRAME\s*\d*[N]?|SENSORY(?:\s+WORLD)?[^\]]*|HUMAN\s+STATE|QUALITY|PARTICLES|SCENE)\]\s*/gi, "");

  // 2. Remove enforcement guard blocks (multi-sentence rule blocks)
  p = p.replace(/REALISM:\s*[^.]*(?:\.[^.]*){0,4}\.\s*/gi, "");
  p = p.replace(/LIFELIKE:\s*[^.]*(?:\.[^.]*){0,4}\.\s*/gi, "");
  p = p.replace(/PRODUCT-ONLY CAUSALITY LOCK:[^.]*(?:\.[^.]*){0,10}\.\s*/gi, "");
  p = p.replace(/SCENE CAUSALITY[^.]*(?:\.[^.]*){0,6}\.\s*/gi, "");
  p = p.replace(/PHYSICAL_CAMERA_GUARD[^.]*(?:\.[^.]*){0,6}\.\s*/gi, "");
  p = p.replace(/LOCOMOTION_GUARD[^.]*(?:\.[^.]*){0,4}\.\s*/gi, "");
  p = p.replace(/LIFELIKE_PRESENCE[^.]*(?:\.[^.]*){0,4}\.\s*/gi, "");
  p = p.replace(/REACTION BEAT[^.]*\.\s*/gi, "");
  p = p.replace(/GAIT:\s*[^.]*\.\s*/gi, "");
  p = p.replace(/ABSOLUTE RULE:[^.]*\.\s*/gi, "");

  // 3. Remove abstract directives (rules the model can't interpret)
  const abstractPatterns = [
    /Real camera footage[^.]*\.\s*/gi,
    /Continuous take[^.]*\.\s*/gi,
    /real physics[^.]*\.\s*/gi,
    /No post-processing[^.]*\.\s*/gi,
    /no filters[^.]*\.\s*/gi,
    /Natural imperfections[^.]*\.\s*/gi,
    /Feet\s+(?:step\s+)?(?:FORWARD|forward)\s+only[^.]*\.\s*/gi,
    
    /Weighted camera movement[^.]*\.\s*/gi,
    /Single-take[^.]*\.\s*/gi,
    /Material boundaries sharp[^.]*\.\s*/gi,
    /3-plane depth[^.]*\.\s*/gi,
  ];
  for (const pat of abstractPatterns) {
    p = p.replace(pat, "");
  }

  // 4. Remove Kling-specific negative prompt phrases baked into positive prompt
  p = p.replace(/(?:No|no)\s+(?:edge intrusion|frame-edge fragment|phantom limb|extra finger|duplicate object)[^.]*\.\s*/gi, "");

  // 5. Remove redundant quality keywords (Seedance has its own quality pipeline)
  p = p.replace(/\b(?:Photorealistic|hyper-?realistic|ultra-?realistic|8[kK]|4[kK]\s+quality)\b[,.]?\s*/gi, "");

  // 6. Collapse whitespace and duplicate periods
  p = p.replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();

  // 7. For product-only: add concise constraint
  if (isProductOnly && !p.toLowerCase().includes("no human")) {
    p += ". No humans, no hands. Product only.";
  }

  // 8. Smart trim to ~800 chars — enough to cover all dimensions concisely
  //    Seedance handles up to ~1000 chars well; only trim if truly bloated
  // Prepend audio directive — Seedance 2.0 can generate sound effects
  p = "[no background music, only natural sound effects] " + p;

  if (p.length > 850) {
    const cut = p.substring(0, 830);
    const lastDot = cut.lastIndexOf(".");
    p = lastDot > 300 ? cut.substring(0, lastDot + 1) : cut;
  }

  return p || "[no background music, only natural sound effects] Cinematic product shot, soft natural lighting, slow elegant camera movement.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _auth = await requireVpsOrUser(req, corsHeaders);
  if (_auth instanceof Response) return _auth;

  try {
    const {
      prompt: rawPrompt,
      _ep,
      keyframeImage,
      endKeyframeImage,
      duration,
      aspectRatio: requestedAR,
      hasHuman,
      taskMeta,
      colorGrade,
    } = await req.json();

    const prompt = _ep ? decodePrompt(_ep) : rawPrompt;
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Deno.env.get("ARK_API_KEY")) {
      return new Response(JSON.stringify({ error: "ARK_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve any data: URI keyframes to public HTTPS URLs ──
    // Segmind/Seedance rejects `data:` URIs with `InvalidParameter.URL`,
    // which surfaces in the UI as "data parsing error". This affects every
    // upstream path that may pass a freshly-generated Gemini/Flux frame:
    // Brand Film, cluster angle clips, and presenter B-roll redo.
    let resolvedKeyframe: string | null = keyframeImage || null;
    let resolvedEndKeyframe: string | null = endKeyframeImage || null;
    if (resolvedKeyframe || resolvedEndKeyframe) {
      try {
        const authHeader = req.headers.get("Authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: authHeader } } },
          );
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const [start, end] = await Promise.all([
              ensurePublicImageUrl(supabase, user.id, resolvedKeyframe),
              ensurePublicImageUrl(supabase, user.id, resolvedEndKeyframe),
            ]);
            // If the helper returns null for a non-empty input, it was an
            // unsupported scheme (blob:, file:) — drop it rather than ship junk.
            resolvedKeyframe = resolvedKeyframe ? start : null;
            resolvedEndKeyframe = resolvedEndKeyframe ? end : null;
          }
        }
      } catch (e) {
        console.warn("[generate-seedance] keyframe resolution failed:", e);
      }
    }

    // Clean prompt for Seedance — strip meta-instructions, keep visual description
    const isProductOnly = hasHuman === false;
    let cleanPrompt = cleanPromptForSeedance(prompt, isProductOnly);

    // STYLE_DNA — inject the same lock prefix used by keyframes/Kling so
    // Seedance clips share the user-picked color grade. Only inject when not
    // already present (avoid double-wrapping when source prompt embedded it).
    if (colorGrade && !cleanPrompt.includes("STYLE LOCK")) {
      const dnaPrefix = styleAnchorPrefix(colorGrade);
      const dnaSuffix = styleAnchorClause(colorGrade);
      // Keep the audio directive at the front, then DNA prefix, then prompt, then DNA suffix.
      const audioMatch = cleanPrompt.match(/^\[no background music[^\]]*\]\s*/);
      const audio = audioMatch ? audioMatch[0] : "";
      const body = audio ? cleanPrompt.slice(audio.length) : cleanPrompt;
      cleanPrompt = `${audio}${dnaPrefix} ${body} ${dnaSuffix}`;
    }

    // GUARD-FIRST assembly — guards must live at the FRONT of the prompt
    // so Seedance's tail-truncation (past 3200 chars) cannot strip them.
    // Strip any audio-cue from the cleaned body so we can re-attach it
    // alongside the guards in the head.
    const audioMatch2 = cleanPrompt.match(/^\[no background music[^\]]*\]\s*/);
    const audioCue = audioMatch2 ? audioMatch2[0].trim() : "[no background music, only natural sound effects]";
    const bodyOnly = audioMatch2 ? cleanPrompt.slice(audioMatch2[0].length) : cleanPrompt;
    // Detect beaded / repeating-unit products from the prompt body itself —
    // Seedance has no separate product/category field at this layer.
    const repeatingUnitGuard = buildRepeatingUnitGuard(prompt);
    const guards = [
      isProductOnly ? RIGID_PRODUCT_GUARD : "",
      PHYSICAL_REALISM_GUARD,
      MOTION_REALISM_GUARD,
      isProductOnly ? "" : PHYSICAL_SCALE_GUARD,
      isProductOnly ? "" : HUMAN_FACE_GUARD,
      SECONDARY_PROPS_INERT_GUARD,
      repeatingUnitGuard,
    ].filter(Boolean).join(" ");
    const head = `${audioCue} ${guards}`;
    cleanPrompt = enforceVideoPromptBudget("seedance", { head, body: bodyOnly });

    const rawDuration = typeof duration === "string" ? parseInt(duration, 10) : (duration || 5);

    console.log(`Seedance: prompt cleaned ${prompt.length} → ${cleanPrompt.length} chars, duration=${rawDuration}s, grade=${colorGrade || "default"}`);
    console.log(`Seedance: clean prompt = "${cleanPrompt.substring(0, 200)}..."`);

    // Submit to Volcengine Ark (official Seedance 2.0)
    console.log(`[ark·seedance] submit: dur=${rawDuration}s ar=${requestedAR || "9:16"} firstFrame=${!!resolvedKeyframe} lastFrame=${!!resolvedEndKeyframe}`);
    const jobId = await submitArkSeedanceTask({
      prompt: cleanPrompt,
      firstFrameUrl: resolvedKeyframe,
      lastFrameUrl: resolvedEndKeyframe,
      ratio: (requestedAR || "9:16") as any,
      durationSec: rawDuration,
      generateAudio: false,
      watermark: false,
    });
    console.log(`[ark·seedance] task accepted: ${jobId}`);

    // Update progress in DB if task metadata provided
    if (taskMeta?.sessionId && taskMeta?.blockId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(taskMeta.sessionId)}&block_id=eq.${encodeURIComponent(taskMeta.blockId)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ error_message: "progress:10", external_task_id: jobId, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    // Return polling token — frontend will poll via poll-seedance-status
    return new Response(JSON.stringify({
      status: "polling",
      taskId: jobId,
      pollEndpoint: "poll-seedance-status",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-content-seedance error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
