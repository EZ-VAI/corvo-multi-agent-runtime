import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const VPS_BASE = Deno.env.get("AGENT_URL") ?? "";

// 服务端权威价目（对齐 VPS COST；garment 分三 stage，各扣一次；用户不吃亏）。
const STUDIO_COST: Record<string, number> = {
  ecommerce: 24,
  "model-shot": 16,
  "model-poster": 16,
  jewelry: 12,
  "model-profile": 40,
  "garment-base": 20,
  "garment-scene": 8,
  "garment-poster": 8,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jsonRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const secret = Deno.env.get("VPS_SHARED_SECRET");
    if (!secret) throw new Error("VPS_SHARED_SECRET not set");
    if (!VPS_BASE) throw new Error("AGENT_URL not set");

    // ── Require user Bearer; derive user_id server-side (never trust body.user_id) ──
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "unauthorized" }, 401);
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return jsonRes({ error: "unauthorized" }, 401);
    const authUserId = claims.claims.sub as string;

    const reqBody = await req.json();
    const { action, jobId, conversationId } = reqBody;
    let payload = reqBody.payload;
    // Server-authoritative user_id — ignore any client-supplied value.
    const user_id = authUserId;
    payload = payload && typeof payload === "object" ? { ...payload, user_id: authUserId } : payload;

    // ── Reserve credits atomically for billable studio actions ──
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let billingJobId: string | null = null;
    if (STUDIO_COST[action] !== undefined) {
      const amount = STUDIO_COST[action];
      const draftId = crypto.randomUUID();
      const { data: rv, error: rvErr } = await svc.rpc("reserve_generation_credits", {
        _user_id: authUserId,
        _draft_id: draftId,
        _amount: amount,
        _pipeline_mode: "studio",
        _engine: action,
        _cost_breakdown: { [action]: amount },
        _mode_state: {},
      });
      if (rvErr) return jsonRes({ error: "reserve_failed", detail: rvErr.message }, 500);
      if (!rv?.ok) return jsonRes({ error: rv?.reason, balance: rv?.balance, required: rv?.required },
        rv?.reason === "insufficient_credits" ? 402 : 400);
      billingJobId = rv.job_id as string;
      payload = { ...(payload ?? {}), billing_job_id: billingJobId };
    }

    let url = "", method = "POST", body: string | undefined;
    if (action === "ecommerce")        { url = `${VPS_BASE}/studio/ecommerce`; body = JSON.stringify(payload); }
    else if (action === "poll")        { url = `${VPS_BASE}/studio/ecommerce/${jobId}`; method = "GET"; }
    else if (action === "analyze")     { url = `${VPS_BASE}/studio/analyze`; body = JSON.stringify(payload); }
    else if (action === "model-profile") { url = `${VPS_BASE}/studio/model-profile`; body = JSON.stringify(payload); }
    else if (action === "job-poll")    { url = `${VPS_BASE}/studio/job/${jobId}`; method = "GET"; }
    else if (action === "model-shot")   { url = `${VPS_BASE}/studio/model-shot`; body = JSON.stringify(payload); }
    else if (action === "model-poster") { url = `${VPS_BASE}/studio/model-poster`; body = JSON.stringify(payload); }
    else if (action === "jewelry")      { url = `${VPS_BASE}/studio/jewelry`; body = JSON.stringify(payload); }
    else if (action === "garment-base")   { url = `${VPS_BASE}/studio/garment-base`; body = JSON.stringify(payload); }
    else if (action === "garment-scene")  { url = `${VPS_BASE}/studio/garment-scene`; body = JSON.stringify(payload); }
    else if (action === "garment-poster") { url = `${VPS_BASE}/studio/garment-poster`; body = JSON.stringify(payload); }
    else if (action === "read-sizechart") { url = `${VPS_BASE}/studio/read-sizechart`; body = JSON.stringify(payload); }
    else if (action === "suggest-size")   { url = `${VPS_BASE}/studio/suggest-size`; body = JSON.stringify(payload); }
    else if (action === "agent-send")     { url = `${VPS_BASE}/studio/agent`; body = JSON.stringify({ ...payload, user_id }); }
    else if (action === "agent-poll")     { url = `${VPS_BASE}/studio/agent/job/${jobId}`; method = "GET"; }
    else if (action === "agent-history")  { url = `${VPS_BASE}/studio/agent/history/${conversationId}?user_id=${encodeURIComponent(user_id)}`; method = "GET"; }
    else if (action === "agent-conversations") { url = `${VPS_BASE}/studio/agent/conversations?user_id=${encodeURIComponent(user_id)}`; method = "GET"; }
    else {
      // Unknown action — refund any reservation before failing.
      if (billingJobId) await svc.rpc("finalize_studio_job", { _job_id: billingJobId, _outcome: "failed" });
      throw new Error("unknown action: " + action);
    }

    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "x-vps-secret": secret },
      body,
    });
    const text = await r.text();
    // If VPS failed to accept the job, refund immediately so credits aren't stranded.
    if (billingJobId && !r.ok) {
      await svc.rpc("finalize_studio_job", { _job_id: billingJobId, _outcome: "failed" });
    }
    return new Response(text, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return jsonRes({ error: String((e as Error).message || e) }, 500);
  }
});
