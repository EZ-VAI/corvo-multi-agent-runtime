// Shared server-side credit charging helper for video clip generation.
// Called by poll-* and generate-content-* edge functions when a clip task hits
// "completed". Idempotent — safe to call multiple times for the same
// (sessionId, blockId) pair; the SQL function uses generation_tasks.credits_charged
// as the lock.
//
// Why this exists: client-side deduct_credits in Create.tsx is fragile —
// if the user closes the tab between server-side completion and the client's
// post-completion logic, credits never get billed. Server-side charging fixes
// the credit leak permanently.

const CLIP_CREDIT_COST: Record<string, number> = {
  // Engine values as written into generation_tasks.engine by the client.
  std: 5,           // Kling Standard
  "kling-std": 5,
  pro: 18,          // Kling Pro
  "kling-pro": 18,
  seedance: 20,
  minimax: 4,
  veo: 18,          // legacy
  mix: 14,
};

export function getClipCreditCostByEngine(engine: string | null | undefined): number {
  if (!engine) return CLIP_CREDIT_COST["std"];
  return CLIP_CREDIT_COST[engine] ?? CLIP_CREDIT_COST["std"];
}

/**
 * Server-side, idempotent clip credit charge.
 * - Looks up the generation_tasks row by (sessionId, blockId)
 * - Resolves user_id + engine from that row
 * - Calls public.charge_clip_credits which atomically deducts + flags
 *   the row as charged (so reruns are no-ops)
 *
 * Returns true on success or "already charged"; false on hard failure.
 */
export async function chargeClipCreditsServerSide(opts: {
  supabaseUrl: string;
  serviceKey: string;
  sessionId: string;
  blockId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; charged?: number; alreadyCharged?: boolean; reason?: string }> {
  const { supabaseUrl, serviceKey, sessionId, blockId, description, metadata } = opts;
  if (!sessionId || !blockId) return { ok: false, reason: "missing_session_or_block" };

  try {
    // 1) Read task to get user_id + engine
    const taskRes = await fetch(
      `${supabaseUrl}/rest/v1/generation_tasks?session_id=eq.${encodeURIComponent(sessionId)}&block_id=eq.${encodeURIComponent(blockId)}&select=user_id,engine,credits_charged&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    );
    if (!taskRes.ok) {
      console.warn(`[chargeClipCredits] task lookup failed: ${taskRes.status}`);
      return { ok: false, reason: `task_lookup_${taskRes.status}` };
    }
    const rows = await taskRes.json();
    const task = Array.isArray(rows) ? rows[0] : null;
    if (!task) return { ok: false, reason: "task_not_found" };

    if (task.credits_charged) {
      return { ok: true, alreadyCharged: true };
    }

    const amount = getClipCreditCostByEngine(task.engine);

    // 2) Call charge RPC (atomic, idempotent at SQL layer too)
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/charge_clip_credits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        _session_id: sessionId,
        _block_id: blockId,
        _user_id: task.user_id,
        _amount: amount,
        _description: description ?? `Clip ${blockId} (${task.engine || "std"})`,
        _metadata: metadata ?? {},
      }),
    });

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      console.warn(`[chargeClipCredits] RPC failed [${rpcRes.status}]: ${errText}`);
      return { ok: false, reason: `rpc_${rpcRes.status}` };
    }

    const result = await rpcRes.json();
    if (result?.ok === false) {
      console.warn(`[chargeClipCredits] RPC returned not-ok: ${result?.reason}`);
      return { ok: false, reason: result?.reason || "rpc_not_ok" };
    }

    if (result?.already_charged) {
      console.log(`[chargeClipCredits] task ${sessionId}/${blockId} already charged — skipping`);
      return { ok: true, alreadyCharged: true };
    }

    console.log(`[chargeClipCredits] charged ${amount} cr for task ${sessionId}/${blockId} (engine=${task.engine})`);
    return { ok: true, charged: amount };
  } catch (e) {
    console.error("[chargeClipCredits] error:", e);
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}
