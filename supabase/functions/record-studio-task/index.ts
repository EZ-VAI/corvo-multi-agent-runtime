// VPS 每渲完一板回调，幂等记账。verify_jwt=false（config.toml）。x-vps-secret 认证。
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-vps-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if ((req.headers.get("x-vps-secret") ?? "") !== (Deno.env.get("VPS_SHARED_SECRET") ?? "")) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { billing_job_id, draft_id, task_key, amount, clip_url } = body ?? {};
  if (!billing_job_id || !draft_id || !task_key || typeof amount !== "number") {
    return new Response(JSON.stringify({ ok: false, reason: "bad_input" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: job, error: jobErr } = await svc.from("generation_jobs").select("user_id").eq("id", billing_job_id).maybeSingle();
  if (jobErr || !job) {
    return new Response(JSON.stringify({ ok: false, reason: "job_not_found" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const { data, error } = await svc.rpc("record_brandfilm_task", {
    _user_id: job.user_id,
    _session_id: draft_id,
    _board_id: task_key,
    _amount: amount,
    _clip_url: clip_url ?? null,
  });
  if (error) {
    return new Response(JSON.stringify({ ok: false, reason: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
