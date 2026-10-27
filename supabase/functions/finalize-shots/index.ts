// finalize-shots — no-LLM, deterministic single-pass post-processing on an
// agent-converged shot list. Returns render-ready blocks[] with generationPrompt + _ep.

import { finalizeShots } from "../_shared/finalizeShots.ts";

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

  const shots = payload?.shots;
  if (!Array.isArray(shots)) {
    return json({ error: "missing_shots", detail: "expected { shots: [...], globalStyle?: {...} }" }, 400);
  }

  try {
    const out = finalizeShots({ shots, globalStyle: payload?.globalStyle ?? null });
    return json(out);
  } catch (e: any) {
    console.error("finalize-shots error:", e);
    return json({ error: e?.message ?? "internal_error" }, 500);
  }
});
