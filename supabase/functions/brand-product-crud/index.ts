// brand-product-crud — server-authoritative CRUD for the brand_product table.
//
// Contract (agent-handoff.json):
//   - server_derives_user_identity_from_bearer_jwt
//   - client_supplied_user_id_never_controls_server_authority
//   - brand_product_rls_restricts_select_insert_update_delete_to_auth_uid
//   - bypassing user-scoped CRUD with elevated keys → PROHIBITED
//   - legacy_garment_insert_payload_remains_accepted
//   - invoke_kling_seedance_openai_heygen_vps_render_or_credit_reservation → PROHIBITED
//
// Design:
//   1. Validate the Bearer JWT via sb.auth.getClaims(token).
//   2. Derive authUserId from claims.sub — this is the ONLY user identity.
//   3. Create a user-scoped Supabase client carrying the user's Bearer token.
//      RLS policies (auth.uid() = user_id) enforce own-row SELECT/INSERT/UPDATE/DELETE.
//      The service-role key is NEVER used for CRUD.
//   4. Strip any client-supplied user_id from every action's payload.
//   5. For `create`, accept the legacy Garment insert payload shape verbatim
//      (minus user_id which is replaced by the JWT subject).
//   6. No paid API calls, no credit reservation, no VPS proxy.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Pure helpers (exported for Deno tests) ──────────────────────────────

/**
 * The set of CRUD actions this edge function accepts.
 * Any other value is rejected with 400 before touching the database.
 */
export const ALLOWED_ACTIONS = new Set(["list", "get", "create", "rename", "delete"]);

/**
 * Strip any client-supplied user_id from a payload object.
 * The server NEVER trusts a client-supplied user_id for authorization.
 * Returns a shallow copy with `user_id` removed.
 */
export function stripClientId(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const { user_id: _dropped, ...rest } = payload;
  return rest;
}

/**
 * Normalise a legacy Garment insert payload into a brand_product row.
 *
 * The legacy shape (from src/studio/functions/Garment/index.tsx saveToLibrary):
 *   { user_id, name, category, main_image, source, sizechart_json, selected_dims }
 *
 * This function:
 *   - drops user_id (server replaces with JWT subject)
 *   - keeps all other fields as-is
 *   - defaults `source` to "manual" if absent (matching the table default)
 *
 * It does NOT add or rename columns — the existing schema already supports
 * every field, so no migration is required.
 */
export function normaliseLegacyInsert(
  payload: Record<string, unknown>,
  authUserId: string,
): Record<string, unknown> {
  const cleaned = stripClientId(payload);
  return {
    ...cleaned,
    user_id: authUserId,               // server-authoritative
    source: cleaned.source ?? "manual", // table default
  };
}

/**
 * Validate that a rename payload has a non-empty name string.
 * Returns the trimmed name or null if invalid.
 */
export function validateRenameName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

// ── Edge function ───────────────────────────────────────────────────────

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── 1. Require user Bearer; derive user_id server-side ──
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonRes({ error: "unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonRes({ error: "server_misconfigured" }, 500);
    }

    // User-scoped client — carries the caller's Bearer token so RLS applies.
    // The service-role key is intentionally NOT used for any CRUD operation.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT and extract the subject.
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return jsonRes({ error: "unauthorized" }, 401);
    }
    const authUserId = claimsData.claims.sub as string;

    // ── 2. Parse and route ──
    const reqBody = await req.json().catch(() => ({}));
    const { action } = reqBody;
    let payload = reqBody.payload;

    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonRes({ error: "unknown_action", action }, 400);
    }

    // Server-authoritative user_id — ignore any client-supplied value.
    payload = stripClientId(payload);

    // ── 3. Execute CRUD via user-scoped client (RLS-enforced) ──

    if (action === "list") {
      const { data, error } = await userClient
        .from("brand_product")
        .select("id,name,category,main_image,sizechart_json,selected_dims,source,created_at,updated_at")
        .order("created_at", { ascending: false });
      if (error) return jsonRes({ error: "list_failed", detail: error.message }, 500);
      return jsonRes({ products: data ?? [] });
    }

    if (action === "get") {
      const productId = payload?.id;
      if (typeof productId !== "string" || productId.length === 0) {
        return jsonRes({ error: "missing_id" }, 400);
      }
      // RLS ensures only the owner's row is returned; cross-user → empty → 404.
      const { data, error } = await userClient
        .from("brand_product")
        .select("id,name,category,main_image,sizechart_json,selected_dims,source,created_at,updated_at")
        .eq("id", productId)
        .maybeSingle();
      if (error) return jsonRes({ error: "get_failed", detail: error.message }, 500);
      if (!data) return jsonRes({ error: "not_found" }, 404);
      return jsonRes({ product: data });
    }

    if (action === "create") {
      // Accept legacy Garment insert payload (user_id stripped, replaced by JWT sub).
      const row = normaliseLegacyInsert(payload ?? {}, authUserId);
      const { data, error } = await userClient
        .from("brand_product")
        .insert(row)
        .select("id,name,category,main_image,sizechart_json,selected_dims,source,created_at,updated_at")
        .single();
      if (error) return jsonRes({ error: "create_failed", detail: error.message }, 500);
      return jsonRes({ product: data }, 201);
    }

    if (action === "rename") {
      const productId = payload?.id;
      const newName = validateRenameName(payload?.name);
      if (typeof productId !== "string" || productId.length === 0) {
        return jsonRes({ error: "missing_id" }, 400);
      }
      if (newName === null) {
        return jsonRes({ error: "invalid_name" }, 400);
      }
      // RLS UPDATE policy: only own rows can be updated.
      // Cross-user → 0 rows affected → 404 (fail closed, no information leak).
      const { data, error } = await userClient
        .from("brand_product")
        .update({ name: newName })
        .eq("id", productId)
        .select("id,name,category,main_image,sizechart_json,selected_dims,source,created_at,updated_at")
        .maybeSingle();
      if (error) return jsonRes({ error: "rename_failed", detail: error.message }, 500);
      if (!data) return jsonRes({ error: "not_found" }, 404);
      return jsonRes({ product: data });
    }

    if (action === "delete") {
      const productId = payload?.id;
      if (typeof productId !== "string" || productId.length === 0) {
        return jsonRes({ error: "missing_id" }, 400);
      }
      // RLS DELETE policy: only own rows can be deleted.
      // Cross-user → 0 rows deleted → 404 (fail closed).
      const { count, error } = await userClient
        .from("brand_product")
        .delete({ count: "exact" })
        .eq("id", productId);
      if (error) return jsonRes({ error: "delete_failed", detail: error.message }, 500);
      if (count === 0) return jsonRes({ error: "not_found" }, 404);
      return jsonRes({ deleted: true, id: productId });
    }

    // Should never reach here (ALLOWED_ACTIONS gate above).
    return jsonRes({ error: "unreachable" }, 500);
  } catch (e) {
    return jsonRes({ error: String((e as Error).message || e) }, 500);
  }
});
