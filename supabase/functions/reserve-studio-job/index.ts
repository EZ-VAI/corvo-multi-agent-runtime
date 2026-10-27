// VPS studioAgent 对话内 run_* 执行前调用，做原子预留。价目由 VPS 传入（它持权威 COST）。
// 认证：x-vps-secret 头 == VPS_SHARED_SECRET。verify_jwt=false（在 config.toml 里配置）。
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
  const { user_id, engine, amount } = body ?? {};
  if (!user_id || !engine || typeof amount !== "number" || amount < 0) {
    return new Response(JSON.stringify({ ok: false, reason: "bad_input" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await svc.rpc("reserve_generation_credits", {
    _user_id: user_id,
    _draft_id: crypto.randomUUID(),
    _amount: amount,
    _pipeline_mode: "studio",
    _engine: engine,
    _cost_breakdown: { [engine]: amount },
    _mode_state: {},
  });
  if (error) {
    return new Response(JSON.stringify({ ok: false, reason: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  // returns {ok,job_id,reserved} or {ok:false,reason,balance,required}
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
