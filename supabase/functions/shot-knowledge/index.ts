// shot-knowledge — no-LLM tool endpoint.
// Returns the SAME assembled+filtered creative knowledge context that the
// retired generate-blocks director LLM call used to build (all 8 layers,
// recipe filtered by filmMode, iconic by vertical, narrative template by
// subcategory, plus SENSORY_ATTRIBUTE_MAP / VERTICAL_ASSOCIATION_CHAINS).
//
// Auth: the proxy (vps-proxy) calls this with the service role; this fn
// has verify_jwt = false by default so it can be invoked as a tool.

import { buildShotKnowledge } from "../_shared/skills/shotKnowledge.generated.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-caller",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  // Tolerant defaults — the VPS agent runtime may send nulls / omit fields,
  // and we must return broad reference data instead of throwing.
  const vertical = (payload?.vertical && String(payload.vertical)) || "general";
  const filmMode = (payload?.filmMode && String(payload.filmMode)) || "PRODUCT_FILM";
  const subcategory = (payload?.subcategory && String(payload.subcategory)) || "auto";
  const duration = typeof payload?.duration === "number" && payload.duration > 0
    ? Number(payload.duration)
    : 15;

  try {
    const out = buildShotKnowledge({
      vertical: String(vertical),
      filmMode: String(filmMode),
      subcategory: String(subcategory),
      duration: Number(duration),
      // optional knobs passthrough — let the agent control these if it wants
      filmMood: payload.filmMood,
      culturalRegister: payload.culturalRegister,
      platform: payload.platform,
      goal: payload.goal,
      style: payload.style,
      aesthetic: payload.aesthetic,
      displayMode: payload.displayMode,
      engine: payload.engine,
      blockCount: payload.blockCount,
      enableOverlays: payload.enableOverlays,
      brandSlogan: payload.brandSlogan,
      brandNameOverride: payload.brandNameOverride,
      environmentPreset: payload.environmentPreset ?? null,
      filmStockPreset: payload.filmStockPreset ?? null,
      understanding: payload.understanding,
    });
    // Strip legacy generate-blocks LLM scaffolding (systemPrompt / userPromptShell).
    // The agent runtime only needs clean reference knowledge.
    const {
      systemPrompt: _sp,
      userPromptShell: _ups,
      ...clean
    } = out as any;
    return json(clean);
  } catch (e: any) {
    console.error("shot-knowledge error:", e);
    return json({ error: e?.message ?? "internal_error" }, 500);
  }
});
