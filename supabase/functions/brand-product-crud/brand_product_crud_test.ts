// Deno tests for the brand-product-crud edge function's pure helpers.
//
// Run from project root:
//   deno test supabase/functions/brand-product-crud/brand_product_crud_test.ts --allow-net
//
// These tests guard the contract invariants from agent-handoff.json:
//   - server_derives_user_identity_from_bearer_jwt
//   - client_supplied_user_id_never_controls_server_authority
//   - legacy_garment_insert_payload_remains_accepted
//   - use_service_role_to_bypass_user_scoped_crud → PROHIBITED
//   - invoke_kling_seedance_openai_heygen_vps_render_or_credit_reservation → PROHIBITED

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_ACTIONS,
  stripClientId,
  normaliseLegacyInsert,
  validateRenameName,
} from "./index.ts";

// ── stripClientId: client-supplied user_id is always removed ────────────

Deno.test("stripClientId removes user_id from payload", () => {
  const payload = { user_id: "attacker-uid", name: "shirt", category: "top" };
  const cleaned = stripClientId(payload);
  assertEquals(cleaned.user_id, undefined);
  assertEquals(cleaned.name, "shirt");
  assertEquals(cleaned.category, "top");
});

Deno.test("stripClientId handles null/undefined payload gracefully", () => {
  assertEquals(stripClientId(null), {});
  assertEquals(stripClientId(undefined), {});
  assertEquals(stripClientId({}), {});
});

Deno.test("stripClientId preserves all non-user_id fields", () => {
  const payload = {
    user_id: "spoofed",
    name: "test product",
    category: "bottom",
    main_image: null,
    source: "manual",
    sizechart_json: { rows: [{ size: "M" }] },
    selected_dims: { size: "M", dims: { waist_cm: 70 } },
  };
  const cleaned = stripClientId(payload);
  assertEquals(cleaned.user_id, undefined);
  assertEquals(cleaned.name, "test product");
  assertEquals(cleaned.sizechart_json, { rows: [{ size: "M" }] });
  assertEquals(cleaned.selected_dims, { size: "M", dims: { waist_cm: 70 } });
});

// ── normaliseLegacyInsert: legacy Garment payload accepted ──────────────

Deno.test("normaliseLegacyInsert accepts the exact legacy Garment saveToLibrary payload", () => {
  // This is the exact shape that src/studio/functions/Garment/index.tsx
  // saveToLibrary sends (minus user_id which is replaced).
  const legacyPayload = {
    user_id: "client-supplied-uid",
    name: "未命名商品",
    category: "top",
    main_image: null,
    source: "manual",
    sizechart_json: { unit: "cm", rows: [{ size: "M", chest_cm: 96 }] },
    selected_dims: { size: "M", dims: { chest_cm: 96 } },
  };
  const authUserId = "jwt-subject-uid";
  const row = normaliseLegacyInsert(legacyPayload, authUserId);

  // user_id is replaced with JWT subject, not the client-supplied value
  assertEquals(row.user_id, authUserId);
  assertNotEquals(row.user_id, "client-supplied-uid");

  // All other fields are preserved
  assertEquals(row.name, "未命名商品");
  assertEquals(row.category, "top");
  assertEquals(row.main_image, null);
  assertEquals(row.source, "manual");
  assertEquals(row.sizechart_json, { unit: "cm", rows: [{ size: "M", chest_cm: 96 }] });
  assertEquals(row.selected_dims, { size: "M", dims: { chest_cm: 96 } });
});

Deno.test("normaliseLegacyInsert defaults source to 'manual' when absent", () => {
  const row = normaliseLegacyInsert({ name: "no source" }, "jwt-uid");
  assertEquals(row.source, "manual");
  assertEquals(row.user_id, "jwt-uid");
});

Deno.test("normaliseLegacyInsert strips client-supplied user_id even when it differs from JWT sub", () => {
  const row = normaliseLegacyInsert(
    { user_id: "attacker", name: "spoof attempt" },
    "real-jwt-subject",
  );
  assertEquals(row.user_id, "real-jwt-subject");
  assertNotEquals(row.user_id, "attacker");
});

Deno.test("normaliseLegacyInsert does not add or rename existing columns", () => {
  const row = normaliseLegacyInsert({}, "uid");
  // Only user_id and source are set; no new columns introduced
  const keys = Object.keys(row).sort();
  assertEquals(keys, ["source", "user_id"]);
});

// ── validateRenameName ──────────────────────────────────────────────────

Deno.test("validateRenameName accepts valid non-empty names", () => {
  assertEquals(validateRenameName("New Name"), "New Name");
  assertEquals(validateRenameName("  trimmed  "), "trimmed");
  assertEquals(validateRenameName("a"), "a");
});

Deno.test("validateRenameName rejects empty or whitespace-only names", () => {
  assertEquals(validateRenameName(""), null);
  assertEquals(validateRenameName("   "), null);
  assertEquals(validateRenameName(null), null);
  assertEquals(validateRenameName(undefined), null);
  assertEquals(validateRenameName(123), null);
});

Deno.test("validateRenameName rejects names over 200 characters", () => {
  assertEquals(validateRenameName("x".repeat(201)), null);
  assertEquals(validateRenameName("x".repeat(200)), "x".repeat(200));
});

// ── ALLOWED_ACTIONS: only CRUD, no paid actions ─────────────────────────

Deno.test("ALLOWED_ACTIONS contains exactly list/get/create/rename/delete", () => {
  assertEquals(ALLOWED_ACTIONS.size, 5);
  assertEquals(ALLOWED_ACTIONS.has("list"), true);
  assertEquals(ALLOWED_ACTIONS.has("get"), true);
  assertEquals(ALLOWED_ACTIONS.has("create"), true);
  assertEquals(ALLOWED_ACTIONS.has("rename"), true);
  assertEquals(ALLOWED_ACTIONS.has("delete"), true);
});

Deno.test("ALLOWED_ACTIONS does not include any paid or render actions", () => {
  // These would invoke paid APIs — must never be accepted by this function.
  const prohibited = [
    "ecommerce", "model-shot", "model-poster", "jewelry", "model-profile",
    "garment-base", "garment-scene", "garment-poster",
    "read-sizechart", "suggest-size",
    "agent-send", "agent-poll", "agent-history", "agent-conversations",
    "kling", "seedance", "openai", "heygen", "vps-render", "reserve-credits",
  ];
  for (const action of prohibited) {
    assertEquals(ALLOWED_ACTIONS.has(action), false);
  }
});

// ── Structural: the edge function source enforces JWT + no service-role ──

Deno.test("edge function source validates Bearer JWT before any DB access", async () => {
  const src = await Deno.readTextFile("./supabase/functions/brand-product-crud/index.ts");
  // Must check for Bearer prefix
  assert(src.includes('startsWith("Bearer ")'), "must require Bearer prefix");
  // Must call getClaims to validate the JWT
  assert(src.includes("auth.getClaims(token)"), "must validate JWT via getClaims");
  // Must return 401 if unauthorized
  assert(src.includes('"unauthorized"'), "must return unauthorized on missing/invalid JWT");
});

Deno.test("edge function source does NOT use service-role for CRUD", async () => {
  const src = await Deno.readTextFile("./supabase/functions/brand-product-crud/index.ts");
  // Must NOT use SERVICE_ROLE_KEY for any database operation
  assert(!src.includes("SUPABASE_SERVICE_ROLE_KEY"), "must not use service-role key");
  assert(!src.includes("service_role"), "must not use service_role");
  // Must use the user-scoped client (with user's Bearer) for CRUD
  assert(src.includes("Authorization: authHeader"), "must create user-scoped client");
});

Deno.test("edge function source strips client user_id before CRUD", async () => {
  const src = await Deno.readTextFile("./supabase/functions/brand-product-crud/index.ts");
  assert(src.includes("stripClientId"), "must call stripClientId on payload");
  assert(src.includes("Server-authoritative user_id"), "must document server-authoritative user_id");
});

Deno.test("edge function source has no paid API calls or credit reservation", async () => {
  const src = await Deno.readTextFile("./supabase/functions/brand-product-crud/index.ts");
  assert(!src.includes("VPS_BASE"), "must not proxy to VPS");
  assert(!src.includes("reserve_generation_credits"), "must not reserve credits");
  assert(!src.includes("finalize_studio_job"), "must not finalize studio jobs");
  assert(!src.includes("STUDIO_COST"), "must not reference studio cost table");
  assert(!src.includes("x-vps-secret"), "must not call VPS with secret");
  assert(!src.includes("fetch("), "must not make external fetch calls (no paid APIs)");
});
