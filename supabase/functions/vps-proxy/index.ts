// VPS Proxy Edge Function
// Single entrypoint for the Node service on the user's VPS to read/write
// the database, call Lovable AI, and invoke whitelisted edge functions.
// Auth: shared secret in `x-vps-secret` header (VPS_SHARED_SECRET).

import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchSimilarCases } from "../_shared/creativeCasesContext.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-vps-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const VPS_SHARED_SECRET = Deno.env.get("VPS_SHARED_SECRET") ?? "";

const READ_TABLES = new Set(["brand_brain", "product_brain", "understanding_session", "deliberation_session", "creative_cases", "films", "film_client_inbox"]);
const WRITE_TABLES = new Set(["understanding_session", "brand_brain", "product_brain", "deliberation_session", "films", "film_client_inbox"]);
const TOOL_WHITELIST = new Set([
  "analyze-product", "analyze_product",
  "scrape-product", "scrape_product",
  "analyze-video-style", "analyze_video_style",
  "infer-anti-identity", "infer_anti_identity",
  // Agent runtime generation pipeline:
  "shot-knowledge", "shot_knowledge",
  "finalize-shots", "finalize_shots",
  "generate-keyframe", "generate_keyframe",
  "generate-storyboard", "generate_storyboard",
  "room-storyboard", "room_storyboard",
  "generate-content-seedance", "generate_content_seedance",
  "poll-seedance-status", "poll_seedance_status",
  "generate-content-kling", "generate_content_kling",
  "poll-kling-status", "poll_kling_status",
  "vision-critique", "vision_critique",
]);
// Tools whose response should be wrapped into { ok, data } / { ok, error }
// for VPS agent-runtime consumption (never 404/throws bubble through).
const OK_DATA_WRAPPED_TOOLS = new Set([
  "analyze-product",
  "scrape-product",
  "analyze-video-style",
  "infer-anti-identity",
  "shot-knowledge",
  "finalize-shots",
  "generate-keyframe",
  "generate-storyboard",
  "room-storyboard",
  "generate-content-seedance",
  "poll-seedance-status",
  "generate-content-kling",
  "poll-kling-status",
  "vision-critique",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Shared-secret auth
  if (!VPS_SHARED_SECRET) return json({ error: "VPS_SHARED_SECRET not configured" }, 500);
  const provided = req.headers.get("x-vps-secret") ?? "";
  if (provided !== VPS_SHARED_SECRET) return json({ error: "unauthorized" }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { action, params } = payload ?? {};
  if (!action || typeof action !== "string") return json({ error: "missing_action" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    switch (action) {
      // ────────────────────────────────────────────────────────────
      case "db.read": {
        const { table, filters, order, limit, single } = params ?? {};
        if (!READ_TABLES.has(table)) return json({ error: "table_not_allowed" }, 403);

        let q: any = admin.from(table).select("*");
        if (filters && typeof filters === "object") {
          for (const [col, val] of Object.entries(filters)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) continue;
            q = q.eq(col, val);
          }
        }
        if (order?.column && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(order.column)) {
          q = q.order(order.column, { ascending: order.ascending !== false });
        }
        if (typeof limit === "number" && limit > 0 && limit <= 1000) {
          q = q.limit(limit);
        } else {
          q = q.limit(100);
        }
        if (single) q = q.maybeSingle();

        const { data, error } = await q;
        if (error) return json({ error: error.message }, 400);
        return json({ data });
      }

      // ────────────────────────────────────────────────────────────
      case "db.write": {
        const { table, op, row, rows, filters, onConflict } = params ?? {};
        if (!WRITE_TABLES.has(table)) return json({ error: "table_not_allowed" }, 403);

        let res;
        if (op === "insert") {
          res = await admin.from(table).insert(rows ?? row).select();
        } else if (op === "upsert") {
          res = await admin
            .from(table)
            .upsert(rows ?? row, onConflict ? { onConflict } : undefined)
            .select();
        } else if (op === "update") {
          if (!filters || typeof filters !== "object") {
            return json({ error: "update_requires_filters" }, 400);
          }
          let q: any = admin.from(table).update(row ?? {});
          for (const [col, val] of Object.entries(filters)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) continue;
            q = q.eq(col, val);
          }
          res = await q.select();
        } else {
          return json({ error: "invalid_op (insert|upsert|update)" }, 400);
        }

        if (res.error) return json({ error: res.error.message }, 400);
        return json({ data: res.data });
      }

      // ────────────────────────────────────────────────────────────
      case "ai.complete": {
        const { system, user, temperature, model, context, userId, caller, images, maxTokens } = params ?? {};
        if (!user || typeof user !== "string") return json({ error: "missing_user_prompt" }, 400);

        // Optional multimodal: images = [{url} | {base64, mimeType}]
        let userContent: any = user;
        if (Array.isArray(images) && images.length > 0) {
          const parts: any[] = [{ type: "text", text: user }];
          for (const img of images) {
            try {
              if (img?.base64 && img?.mimeType) {
                parts.push({
                  type: "image_url",
                  image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
                });
              } else if (img?.url && typeof img.url === "string") {
                if (img.url.startsWith("data:")) {
                  parts.push({ type: "image_url", image_url: { url: img.url } });
                } else {
                  const ir = await fetch(img.url);
                  if (!ir.ok) continue;
                  const mime = ir.headers.get("content-type") || "image/jpeg";
                  const buf = new Uint8Array(await ir.arrayBuffer());
                  let bin = "";
                  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                  const b64 = btoa(bin);
                  parts.push({
                    type: "image_url",
                    image_url: { url: `data:${mime};base64,${b64}` },
                  });
                }
              }
            } catch (e) {
              console.warn("[vps-proxy ai.complete] image fetch failed:", (e as any)?.message);
            }
          }
          if (parts.length > 1) userContent = parts;
        }

        const messages: any[] = [];
        if (system) messages.push({ role: "system", content: String(system) });
        messages.push({ role: "user", content: userContent });

        const finalModel = model || "google/gemini-3-flash-preview";
        const body: any = { model: finalModel, messages, stream: true, stream_options: { include_usage: true } };
        if (typeof temperature === "number") body.temperature = temperature;
        if (typeof maxTokens === "number" && maxTokens > 0) body.max_completion_tokens = maxTokens;

        const startedAt = Date.now();
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          admin.from("ai_call_log").insert({
            user_id: userId ?? null,
            caller: caller ?? "vps-proxy",
            model: finalModel,
            latency_ms: Date.now() - startedAt,
            context: context ?? null,
            status: r.status,
            error: t.slice(0, 500),
          }).then(() => {}, () => {});
          return json({ error: `ai_gateway_${r.status}`, detail: t.slice(0, 500) }, r.status);
        }

        // ── Stream-collect SSE so the gateway connection stays active ──
        let text = "";
        let usage: any = {};
        let finishReason: string | null = null;
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let sse = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sse += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = sse.indexOf("\n")) >= 0) {
              const line = sse.slice(0, nl).trim();
              sse = sse.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              let chunk: any;
              try { chunk = JSON.parse(payload); } catch { continue; }
              const d = chunk?.choices?.[0]?.delta?.content;
              if (typeof d === "string") text += d;
              const fr = chunk?.choices?.[0]?.finish_reason;
              if (fr) finishReason = fr;
              if (chunk?.usage) usage = chunk.usage;
            }
          }
        } catch (e) {
          console.error("[vps-proxy ai.complete] stream broke:", (e as any)?.message);
          // Don't throw — return whatever we have; finishReason reveals completeness.
        }
        const latencyMs = Date.now() - startedAt;

        const promptTokens = usage.prompt_tokens ?? null;
        const completionTokens = usage.completion_tokens ?? null;
        const reasoningTokens =
          usage.completion_tokens_details?.reasoning_tokens ??
          usage.reasoning_tokens ??
          null;
        const totalTokens = usage.total_tokens ?? null;

        admin.from("ai_call_log").insert({
          user_id: userId ?? null,
          caller: caller ?? "vps-proxy",
          model: finalModel,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          reasoning_tokens: reasoningTokens,
          total_tokens: totalTokens,
          latency_ms: latencyMs,
          context: context ?? null,
          status: 200,
          raw_usage: usage,
        }).then(() => {}, () => {});

        return json({ text, raw: { choices: [{ message: { role: "assistant", content: text }, finish_reason: finishReason }], usage, streamed: true } });
      }

      // ────────────────────────────────────────────────────────────
      case "tool.invoke": {
        const { name, body } = params ?? {};
        if (!name || typeof name !== "string") return json({ error: "missing_tool_name" }, 400);
        if (!TOOL_WHITELIST.has(name)) return json({ error: "tool_not_allowed", name }, 403);

        // Normalize underscore → hyphen so VPS-side tool names
        // (analyze_product) resolve to real edge functions (analyze-product).
        const targetName = name.replace(/_/g, "-");
        const wrap = OK_DATA_WRAPPED_TOOLS.has(targetName);

        // For analyze-product, the VPS sends `{ url, imageUrl? }` but the
        // edge function expects `url` + optional `uploadedImages`. Adapt.
        let forwardBody: any = body ?? {};
        if (targetName === "analyze-product" && forwardBody && typeof forwardBody === "object") {
          const imgUrl = forwardBody.imageUrl ?? forwardBody.productImageUrl;
          if (imgUrl && !forwardBody.uploadedImages) {
            forwardBody = { ...forwardBody, uploadedImages: [imgUrl] };
          }
        }

        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/${targetName}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_ROLE}`,
              apikey: SERVICE_ROLE,
              "Content-Type": "application/json",
              "x-caller": "vps-proxy",
            },
            body: JSON.stringify(forwardBody),
          });

          const text = await r.text();
          let parsed: any;
          try { parsed = JSON.parse(text); } catch { parsed = text; }

          if (wrap) {
            // VPS contract: always HTTP 200, always { ok, data } | { ok, error }
            if (!r.ok) {
              const errMsg =
                (parsed && typeof parsed === "object" && (parsed.error || parsed.message)) ||
                (typeof parsed === "string" ? parsed.slice(0, 500) : `status_${r.status}`);
              return json({ ok: false, error: String(errMsg), status: r.status });
            }
            if (parsed && typeof parsed === "object" && parsed.error && !parsed.title) {
              return json({ ok: false, error: String(parsed.error) });
            }
            return json({ ok: true, data: parsed });
          }

          return json({ status: r.status, result: parsed }, r.ok ? 200 : 502);
        } catch (e: any) {
          if (wrap) {
            return json({ ok: false, error: e?.message ?? "fetch_failed" });
          }
          return json({ error: e?.message ?? "fetch_failed" }, 502);
        }
      }


      // ────────────────────────────────────────────────────────────
      case "cases.search": {
        const { query, topN, vertical, productType } = params ?? {};
        if (!query || typeof query !== "string") {
          return json({ error: "missing_query" }, 400);
        }
        const limit = Math.max(3, Math.min(8, Number(topN) || 4));
        const cases = await fetchSimilarCases(admin, {
          vertical: vertical ?? null,
          productType: productType ?? null,
          extraKeywords: [query],
          limit,
        });
        return json({ data: cases, count: cases.length });
      }

      default:
        return json({ error: `unknown_action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("vps-proxy error:", e);
    return json({ error: e?.message ?? "internal_error" }, 500);
  }
});
