// Studio 计费收尾：VPS 生成结束（ready/failed）时回调，扣款或退款一次搞定。
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
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { billing_job_id, outcome } = body ?? {};
  if (!billing_job_id || !["ready", "failed"].includes(outcome)) {
    return new Response(JSON.stringify({ error: "bad_input" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await svc.rpc("finalize_studio_job", { _job_id: billing_job_id, _outcome: outcome });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
