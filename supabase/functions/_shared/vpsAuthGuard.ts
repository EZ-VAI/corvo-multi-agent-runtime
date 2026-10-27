// Shared auth guard for paid VPS-backed edge functions.
// Accepts EITHER:
//   1. Server-to-server: x-vps-secret header matching VPS_SHARED_SECRET, OR
//   2. Browser: valid Supabase user Bearer token (verified via getClaims)
//
// Returns { ok: true, userId, isVps } on success, or a Response to return on failure.

import { createClient } from "npm:@supabase/supabase-js@2";

export interface VpsAuthOk {
  ok: true;
  userId: string | null; // null when authenticated via x-vps-secret only
  isVps: boolean;
}

export async function requireVpsOrUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<VpsAuthOk | Response> {
  const secret = Deno.env.get("VPS_SHARED_SECRET") ?? "";
  const provided = req.headers.get("x-vps-secret") ?? "";
  if (secret && provided && provided === secret) {
    return { ok: true, userId: null, isVps: true };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace("Bearer ", "");
      const { data, error } = await supabase.auth.getClaims(token);
      if (!error && data?.claims?.sub) {
        return { ok: true, userId: data.claims.sub as string, isVps: false };
      }
    } catch (_e) { /* fall through */ }
  }

  return new Response(
    JSON.stringify({ error: "unauthorized" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
