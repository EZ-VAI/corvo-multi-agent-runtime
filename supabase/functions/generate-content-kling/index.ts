import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decodePrompt } from "../_shared/promptObfuscation.ts";
import {
  sanitizeProductOnlyVideoPrompt,
  withContinuityGuard,
  withContinuityNegativePrompt,
} from "../_shared/videoPromptGuards.ts";
import { retryFetch } from "../_shared/retryFetch.ts";
import { styleAnchorPrefix, styleAnchorClause } from "../_shared/styleDna.ts";
import { enforceVideoPromptBudget, VIDEO_PROMPT_BUDGETS, KLING_SLIM_GUARD_PRODUCT, KLING_SLIM_GUARD_HUMAN, SECONDARY_PROPS_INERT_GUARD, buildKlingNegativePrompt, pickKlingCfgScale, buildRepeatingUnitGuard } from "../_shared/realismGuards.ts";
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

// Wall-clock guard: edge functions time out at ~150s.
// We poll for up to ~120s, then return the taskId so the client can continue polling.
const EDGE_FN_WALL_CLOCK_MS = 25_000;

async function pollKlingTask(
  endpoint: string, taskId: string, token: string, startTime: number,
  progressCallback?: (percent: number, status: string) => void,
): Promise<{ data: any; timedOut?: boolean; endpoint?: string; taskId?: string }> {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    // Check wall-clock before sleeping
    if (Date.now() - startTime > EDGE_FN_WALL_CLOCK_MS) {
      console.log(`Wall-clock guard: returning taskId ${taskId} for client-side polling after ${Math.round((Date.now() - startTime) / 1000)}s`);
      return { data: null, timedOut: true, endpoint, taskId };
    }
    await new Promise((r) => setTimeout(r, 5000));
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
    const percent = Math.min(5 + Math.round((i / maxAttempts) * 90), 95);
    if (progressCallback) progressCallback(percent, status || "processing");
    if (status === "succeed") return { data };
    if (status === "failed") throw new Error(`Kling failed: ${data.data?.task_status_msg || "Unknown"}`);
    console.log(`Kling poll ${i + 1}: status=${status}, progress=${percent}%`);
  }
  throw new Error("Kling video generation timed out after 10 minutes");
}

async function fetchVideoAsDataUrl(url: string, mimeType: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function stripDataUriPrefix(dataUrl: string): string {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : dataUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const edgeFnStart = Date.now();

  try {
    const { prompt: rawPrompt, _ep, keyframeImage, endKeyframeImage, duration, aspectRatio: requestedAR, mode: requestedMode, hasHuman, taskMeta, motionControl, colorGrade } = await req.json();
    const prompt = _ep ? decodePrompt(_ep) : rawPrompt;
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const KLING_AK = Deno.env.get("KLING_ACCESS_KEY");
    const KLING_SK = Deno.env.get("KLING_SECRET_KEY");
    if (!KLING_AK || !KLING_SK) {
      return new Response(JSON.stringify({ error: "Kling API keys are not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await createKlingToken(KLING_AK, KLING_SK);
    const aspectRatio = requestedAR || (prompt.toLowerCase().includes("16:9") ? "16:9" : "9:16");
    const useOmni = requestedMode !== "std"; // pro = omni, std = standard
    // Kling API only accepts 5 or 10 as valid duration values
    const rawDuration = typeof duration === "string" ? parseInt(duration, 10) : (duration || 5);
    const klingDuration = rawDuration <= 7 ? "5" : "10";

    // Kling effective prompt budget = 2200 chars (matches VIDEO_PROMPT_BUDGETS.kling).
    // Truncate gracefully at sentence boundary to preserve creative content tail.
    const KLING_MAX = VIDEO_PROMPT_BUDGETS.kling;
    const truncatePrompt = (p: string, max = KLING_MAX): string => {
      if (p.length <= max) return p;
      const truncated = p.substring(0, max);
      const lastPeriod = truncated.lastIndexOf('.');
      return lastPeriod > max * 0.7 ? truncated.substring(0, lastPeriod + 1) : truncated + '...';
    };

    // Anti-human — compact. generate-blocks already embeds detailed no-human constraints,
    // so we only add a SHORT reinforcement here to avoid eating prompt budget.
    const isProductOnly = hasHuman === false;
    const antiHumanSuffix = isProductOnly ? ". No humans, no hands, no body." : "";
    // Kling negative_prompt: aggregate every ban-style clause (physical-realism,
    // motion-realism, scale, anatomy, lifelike) into the dedicated field where
    // Kling treats them as hard bans — far more reliable than burying "no XXX"
    // sentences inside the main prompt body.
    // Continuity negatives include "hand/hands/finger/fingers/body part/touch
    // interaction/handling product" which we ONLY want banned on product-only
    // shots. On human shots these would tell Kling not to render hands at all
    // → fingerless / handless people. Strip them when productOnly=false.
    const rawContinuityNeg = withContinuityNegativePrompt("");
    const HUMAN_BODY_TERMS = new Set([
      "hand", "hands", "finger", "fingers", "body part",
      "touch interaction", "handling product", "wearer point of view",
      "pickup motion",
    ]);
    const continuityNeg = isProductOnly
      ? rawContinuityNeg
      : rawContinuityNeg
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p && !HUMAN_BODY_TERMS.has(p.toLowerCase()))
          .join(", ");
    const antiHumanNegative = buildKlingNegativePrompt({
      productOnly: isProductOnly,
      hasHuman: !isProductOnly,
      extra: continuityNeg,
    });
    // Dynamic CFG: product-only locks tighter (0.7), human/lifestyle stays
    // natural (0.5). Brand_film has no ambient signal, so we only branch on
    // productOnly here.
    const klingCfg = pickKlingCfgScale({ productOnly: isProductOnly, hasHuman: !isProductOnly });
    console.log(`Kling cfg_scale=${klingCfg} (productOnly=${isProductOnly})`);

    // The prompt from generate-blocks already contains all creative content.
    // Minimal wrapping — don't bloat the 2500-char budget with redundant guards.
    const normalizedPrompt = `${prompt}${antiHumanSuffix}`;
    // STYLE_DNA — same prefix on every clip in the batch
    const hasStyleLock = normalizedPrompt.includes("STYLE LOCK");
    const dnaPrefix = (colorGrade && !hasStyleLock) ? `${styleAnchorPrefix(colorGrade)}\n\n` : "";
    const dnaSuffix = (colorGrade && !hasStyleLock) ? `\n\n${styleAnchorClause(colorGrade)}` : "";
    const assembledPrompt = `${dnaPrefix}${normalizedPrompt}${dnaSuffix}`;
    // Kling slim guards: positive-only (~200 chars). Bans are in negative_prompt.
    // Append REPEATING_UNIT_GUARD when the product is a beaded/segmented item
    // (bracelet, mala, link chain, …) — Kling otherwise reshuffles bead count
    // and pattern between frames. Detected from the prompt itself.
    const repeatingUnitGuard = buildRepeatingUnitGuard(prompt);
    const guardHead = [isProductOnly ? KLING_SLIM_GUARD_PRODUCT : KLING_SLIM_GUARD_HUMAN, SECONDARY_PROPS_INERT_GUARD, repeatingUnitGuard].filter(Boolean).join(" ");
    const safePrompt = enforceVideoPromptBudget("kling", {
      head: guardHead,
      body: assembledPrompt,
      tail: isProductOnly ? "No humans, no hands. Product only." : "",
    });
    console.log(`Kling prompt: ${safePrompt.length} chars (max ${KLING_MAX}), guard-first enforced`);

    // ── Motion Control Mode ──
    // When motionControl is provided with a valid videoUrl, use the motion control endpoint
    if (motionControl?.enabled && motionControl?.videoUrl && keyframeImage) {
      const motionEndpoint = "/v1/videos/motion-control";
      const rawBase64 = stripDataUriPrefix(keyframeImage);
      const motionMode = useOmni ? "pro" : "std";

      const motionBody: any = {
        model_name: "kling-v3",
        image_url: rawBase64,
        video_url: motionControl.videoUrl,
        prompt: truncatePrompt(`${prompt}. Maintain exact character appearance from the reference image. Natural, physically realistic motion.`),
        keep_original_sound: "no",
        character_orientation: "image", // match the keyframe's character orientation
        mode: motionMode,
      };

      console.log(`Kling Motion Control: Starting generation, mode=${motionMode}, template=${motionControl.templateId || "custom"}`);

      const createRes = await retryFetch(`${KLING_BASE}${motionEndpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(motionBody),
      }, { wallClockStartMs: edgeFnStart, wallClockBudgetMs: EDGE_FN_WALL_CLOCK_MS });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error("Kling Motion Control create error:", createRes.status, errText);
        if (createRes.status === 429) {
          return new Response(JSON.stringify({ error: "Kling API rate limited — retries exhausted, please wait and try again." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // If motion control fails, log and fall through to standard generation
        console.warn("Motion Control failed, falling back to standard generation:", errText);
      } else {
        const createData = await createRes.json();
        if (createData.code !== 0) {
          console.warn(`Motion Control error: ${createData.message} (code ${createData.code}), falling back`);
        } else {
          const taskId = createData.data?.task_id;
          if (!taskId) throw new Error("No task_id returned from Kling Motion Control API");

          // Build progress callback
          let progressCallback: ((percent: number, status: string) => void) | undefined;
          if (taskMeta?.sessionId && taskMeta?.blockId) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (supabaseUrl && serviceKey) {
              let lastReported = 0;
              progressCallback = (percent: number, _status: string) => {
                if (percent - lastReported < 10) return;
                lastReported = percent;
                fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(taskMeta.sessionId)}&block_id=eq.${encodeURIComponent(taskMeta.blockId)}`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    Prefer: "return=minimal",
                  },
                  body: JSON.stringify({ external_task_id: taskId, error_message: `progress:${percent}`, updated_at: new Date().toISOString() }),
                }).catch(() => {});
              };
            }
          }

          console.log(`Kling Motion Control: Polling task ${taskId}`);
          const result = await pollKlingTask(motionEndpoint, taskId, token, edgeFnStart, progressCallback);

          if (result.timedOut) {
            console.log("Motion Control: Edge function wall-clock reached, returning taskId for client polling");
            return new Response(JSON.stringify({
              status: "polling",
              taskId: result.taskId,
              pollEndpoint: result.endpoint,
              motionControlUsed: true,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const videos = result.data?.task_result?.videos;
          if (!videos?.length) throw new Error("No video generated in Kling Motion Control response");

          const videoUrl = videos[0].url;
          console.log("Kling Motion Control: Success, returning CDN URL");

          // Server-side, idempotent credit charge
          if (taskMeta?.sessionId && taskMeta?.blockId) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (supabaseUrl && serviceKey) {
              fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(taskMeta.sessionId)}&block_id=eq.${encodeURIComponent(taskMeta.blockId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "return=minimal" },
                body: JSON.stringify({ status: "completed", clip_url: videoUrl, error_message: "progress:100", updated_at: new Date().toISOString() }),
              }).catch(() => {});
              await chargeClipCreditsServerSide({
                supabaseUrl, serviceKey,
                sessionId: taskMeta.sessionId, blockId: taskMeta.blockId,
                description: `Clip ${taskMeta.blockId} (kling-motion-control)`,
                metadata: { source: "generate-content-kling", motionControl: true },
              });
            }
          }

          return new Response(JSON.stringify({
            type: "video",
            dataUrl: null,
            uri: videoUrl || null,
            mimeType: "video/mp4",
            motionControlUsed: true,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      // If we reach here, motion control failed — fall through to standard generation
      console.log("Motion Control fallback: proceeding with standard generation");
    }

    let endpoint: string;
    let requestBody: any;

    if (useOmni) {
      // ── Kling 3.0 Omni via /v1/videos/omni-video ──
      // NOTE: per Kling Omni docs (apiReference/model/OmniVideo) the supported
      // request fields are: model_name, prompt, image_list, element_list,
      // video_list, sound, mode, aspect_ratio, duration, watermark_info,
      // callback_url, external_task_id. There is NO documented `cfg_scale`,
      // so we OMIT it here (Kling currently silently ignores unknown fields,
      // but we don't want a future tightening to 400 us). `negative_prompt`
      // is also undocumented for Omni but has been in production for months
      // without issue — kept as-is to avoid behavior change.
      endpoint = "/v1/videos/omni-video";
      requestBody = {
        model_name: "kling-v3-omni",
        prompt: safePrompt,
        negative_prompt: antiHumanNegative,
        duration: klingDuration,
        mode: "pro",
        sound: "off",
        aspect_ratio: aspectRatio,
      };

      if (keyframeImage) {
        const isUrl = keyframeImage.startsWith("http");
        const isDataUri = keyframeImage.startsWith("data:");
        const rawBase64 = isUrl ? keyframeImage : stripDataUriPrefix(keyframeImage);
        console.log(`Kling Omni keyframe: isUrl=${isUrl}, isDataUri=${isDataUri}, length=${keyframeImage.length}, first50=${keyframeImage.substring(0, 50)}`);
        requestBody.image_list = [{
          image_url: rawBase64,
          type: "first_frame",
        }];
        // Note: Kling Omni API only supports first_frame in image_list.
        // End keyframe anchoring is handled via prompt description instead.
        console.log("Kling Omni: Using keyframe as first_frame reference");
        const anchoredPrompt = endKeyframeImage
          ? `Generate a video that begins exactly with the provided reference image and smoothly transitions toward the described end state. ${prompt}${antiHumanSuffix}`
          : `Generate a video that begins exactly with the provided reference image. ${prompt}${antiHumanSuffix}`;
        requestBody.prompt = enforceVideoPromptBudget("kling", {
          head: guardHead,
          body: withContinuityGuard(isProductOnly ? sanitizeProductOnlyVideoPrompt(anchoredPrompt) : anchoredPrompt),
          tail: isProductOnly ? "No humans, no hands. Product only." : "",
        });
      }

      console.log(`Kling Omni: Starting generation, duration=${klingDuration}, AR=${aspectRatio}, hasHuman=${hasHuman}`);
      if (hasHuman === false) console.log("Kling: Anti-human-flash guardrail ACTIVE");
    } else {
      // ── Kling 3.0 Standard via text2video / image2video ──
      if (keyframeImage) {
        endpoint = "/v1/videos/image2video";
        const rawBase64 = stripDataUriPrefix(keyframeImage);
        requestBody = {
          model_name: "kling-v3",
          image: rawBase64,
          prompt: safePrompt,
          negative_prompt: antiHumanNegative,
          cfg_scale: klingCfg,
          duration: klingDuration,
          mode: "std",
          sound: "off",
          aspect_ratio: aspectRatio,
        };
        // Add end keyframe for long blocks (std mode via image_tail)
        if (endKeyframeImage) {
          requestBody.image_tail = stripDataUriPrefix(endKeyframeImage);
          console.log("Kling Std: Using image-to-video with start + end keyframes");
        } else {
          console.log("Kling Std: Using image-to-video with keyframe");
        }
      } else {
        endpoint = "/v1/videos/text2video";
        requestBody = {
          model_name: "kling-v3",
          prompt: safePrompt,
          negative_prompt: antiHumanNegative,
          cfg_scale: klingCfg,
          duration: klingDuration,
          mode: "std",
          sound: "off",
          aspect_ratio: aspectRatio,
        };
        console.log("Kling Std: Using text-to-video");
      }
    }

    const createRes = await retryFetch(`${KLING_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }, { wallClockStartMs: edgeFnStart, wallClockBudgetMs: EDGE_FN_WALL_CLOCK_MS });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("Kling create error:", createRes.status, errText);
      if (createRes.status === 429) {
        return new Response(JSON.stringify({ error: "Kling API rate limited — retries exhausted, please wait and try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Kling API error [${createRes.status}]: ${errText}`);
    }

    const createData = await createRes.json();
    if (createData.code !== 0) {
      throw new Error(`Kling error: ${createData.message} (code ${createData.code})`);
    }

    const taskId = createData.data?.task_id;
    if (!taskId) throw new Error("No task_id returned from Kling API");

    // Build progress callback to update generation_tasks in DB
    let progressCallback: ((percent: number, status: string) => void) | undefined;
    if (taskMeta?.sessionId && taskMeta?.blockId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        let lastReported = 0;
        progressCallback = (percent: number, _status: string) => {
          // Only report every 10% to reduce DB writes
          if (percent - lastReported < 10) return;
          lastReported = percent;
          fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(taskMeta.sessionId)}&block_id=eq.${encodeURIComponent(taskMeta.blockId)}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ external_task_id: taskId, error_message: `progress:${percent}`, updated_at: new Date().toISOString() }),
          }).catch(() => {});
        };
      }
    }

    // For omni-video, the query endpoint is the same path
    const pollEndpoint = useOmni ? "/v1/videos/omni-video" : endpoint;
    console.log(`Kling: Polling task ${taskId} on ${pollEndpoint}`);
    const result = await pollKlingTask(pollEndpoint, taskId, token, edgeFnStart, progressCallback);

    if (result.timedOut) {
      console.log("Edge function wall-clock reached, returning taskId for client polling");
      return new Response(JSON.stringify({
        status: "polling",
        taskId: result.taskId,
        pollEndpoint: result.endpoint,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const videos = result.data?.task_result?.videos;
    if (!videos?.length) throw new Error("No video generated in Kling response");

    const videoUrl = videos[0].url;
    console.log("Kling: Returning CDN URL directly (no in-memory download)");

    // Server-side, idempotent credit charge — fixes the leak where
    // tab-close between completion and client-side deduct dropped the bill.
    if (taskMeta?.sessionId && taskMeta?.blockId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(taskMeta.sessionId)}&block_id=eq.${encodeURIComponent(taskMeta.blockId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "completed", clip_url: videoUrl, error_message: "progress:100", updated_at: new Date().toISOString() }),
        }).catch(() => {});
        await chargeClipCreditsServerSide({
          supabaseUrl, serviceKey,
          sessionId: taskMeta.sessionId, blockId: taskMeta.blockId,
          description: `Clip ${taskMeta.blockId} (kling)`,
          metadata: { source: "generate-content-kling" },
        });
      }
    }

    return new Response(JSON.stringify({
      type: "video",
      dataUrl: null,
      uri: videoUrl || null,
      mimeType: "video/mp4",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-content-kling error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
