// film-control — authenticated bridge from frontend to the VPS agent runtime.
// JWT verified. IDOR hardened: every filmId action asserts films.user_id === auth.uid()
// via a service-role query before forwarding.
// Body: { action, filmId?, payload? }.
// Actions: start | resume | resume_from_stall | status

import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_URL = Deno.env.get("AGENT_URL") ?? "";
const SECRET = Deno.env.get("VPS_SHARED_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  if (!AGENT_URL) return json({ error: "AGENT_URL not configured" }, 500);
  if (!SECRET) return json({ error: "VPS_SHARED_SECRET not configured" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { action, filmId, payload } = body ?? {};

  // Ownership guard for any action touching an existing filmId.
  if (filmId && (action === "resume" || action === "resume_from_stall" || action === "status")) {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: film, error: filmErr } = await admin
      .from("films").select("film_id, user_id").eq("film_id", filmId).maybeSingle();
    if (filmErr) return json({ error: "lookup_failed", detail: filmErr.message }, 500);
    if (!film) return json({ error: "not_found" }, 404);
    if (film.user_id !== userId) return json({ error: "forbidden" }, 403);
  }

  let path = "";
  let method: "GET" | "POST" = "POST";
  if (action === "start") path = "/films";
  else if (action === "resume" && filmId) path = `/films/${filmId}/resume`;
  else if (action === "resume_from_stall" && filmId) path = `/films/${filmId}/resume`;
  else if (action === "status" && filmId) { path = `/films/${filmId}`; method = "GET"; }
  else return json({ error: "unknown_action" }, 400);

  const base = AGENT_URL.replace(/\/+$/, "");
  const r = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", "x-vps-secret": SECRET },
    body: method === "POST" ? JSON.stringify({ ...(payload ?? {}), user_id: userId, userId }) : undefined,
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
