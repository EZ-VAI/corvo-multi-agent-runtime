// agent-runtime/room/routes.js
//
// Endpoints for the Creative Room. Same shape as understanding/routes.js:
// trigger runs deliberation in the background and returns a session id immediately;
// the client polls GET /room/:id. All DB access goes through the proxy.
//
// POST /room/deliberate  body: { userId, brief, brandBrain? }
//   - brief: the strategy brief ({ audience, core_message, emotional_register,
//            target_reaction } — each { content, source }). For the P0 blind test
//            you can pass it straight in the body.
//   - brandBrain: optional; if omitted we read brand_brain for the user.
// GET  /room/:id  → { status, direction, shots, brief, result }

const { v4: uuidv4 } = require("uuid");
const { dbRead, dbWrite } = require("../understanding/proxy");
const { deliberate } = require("./deliberate");

const sessions = new Map();

function unwrap(r) {
  if (r && typeof r === "object" && "data" in r) return r.data;
  return r;
}

function registerRoom(app, auth) {
  app.post("/room/deliberate", auth, async function (req, res) {
    const b = req.body || {};
    const userId = b.userId;
    const brief = b.brief;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!brief) return res.status(400).json({ error: "brief required" });

    const sessionId = uuidv4();
    sessions.set(sessionId, { status: "working" });

    // seed the row immediately so GET works while deliberation runs
    try {
      await dbWrite("deliberation_session", "upsert", {
        row: { id: sessionId, user_id: userId, brief: brief, status: "working" },
        onConflict: "id",
      });
    } catch (e) {
      console.warn("[room] seed persist failed:", e.message);
    }

    res.json({ sessionId: sessionId });

    (async function () {
      try {
        let brandBrain = b.brandBrain;
        if (!brandBrain) {
          brandBrain = unwrap(await dbRead("brand_brain", {
            filters: { user_id: userId },
            single: true,
          })) || {};
        }
        // pull product truth (value_translation) so the director/critic can ground
        // the sell in real reasons-to-buy instead of inventing claims.
        if (!brandBrain.value_translation) {
          try {
            const pb = unwrap(await dbRead("product_brain", {
              filters: { user_id: userId },
              order: { column: "updated_at", ascending: false },
              limit: 1,
              single: true,
            }));
            if (pb) brandBrain.value_translation = pb.value_translation || {};
          } catch (e) {
            console.warn("[room] product_brain load failed (non-fatal):", e.message);
          }
        }

        // SANITIZE value_translation: strip pre-baked concepts/LOOK. The room OWNS
        // concept (Director) and LOOK (Cinematographer); it must NEVER inherit them.
        // Keep only product truth + fact->desire translation material.
        (function () {
          const vt = (brandBrain.value_translation && typeof brandBrain.value_translation === "object") ? brandBrain.value_translation : {};
          const fd = (vt.filmable_desire && typeof vt.filmable_desire === "object") ? vt.filmable_desire : {};
          brandBrain.value_translation = {
            product_specific_truths: vt.product_specific_truths || [],
            core_desire: fd.core_desire || vt.core_desire || "",
            texture_language: fd.texture_language || [],
            sensory_translations: fd.sensory_translations || vt.sensory_translations || [],
          };
        })();
        const __vt = brandBrain.value_translation;
        if (!((__vt.product_specific_truths && __vt.product_specific_truths.length) || (__vt.sensory_translations && __vt.sensory_translations.length))) {
          throw new Error("[room] value_translation has no usable product truth (only concepts/empty). Run /understand first.");
        }

        // vertical/subcategory are product facts the caller knows; the brain rows
        // don't store them structured yet, so accept them on the request and stash
        // for resolveShotContext (which reads bb.vertical / bb.subcategory first).
        if (b.vertical) brandBrain.vertical = b.vertical;
        if (b.subcategory) brandBrain.subcategory = b.subcategory;

        const out = await deliberate(
          { brief: brief, brandBrain: brandBrain },
          {
            maxRounds: b.maxRounds || 4,
            onProgress: async function (p) {
              sessions.set(sessionId, { status: "deliberating", round: p.round });
            },
          }
        );

        await dbWrite("deliberation_session", "update", {
          row: {
            direction: out.direction,
            shots: out.shots,
            brief: out.brief,
            result: out.result,
            log: out.log,
            status: "ready",
          },
          filters: { id: sessionId },
        });
        sessions.set(sessionId, { status: "ready" });
      } catch (e) {
        console.error("[room] deliberate failed:", e);
        sessions.set(sessionId, { status: "failed", error: String(e) });
        try {
          await dbWrite("deliberation_session", "update", {
            row: { status: "failed", result: { error: String(e && e.message ? e.message : e) } },
            filters: { id: sessionId },
          });
        } catch (e2) {}
      }
    })();
  });

  app.get("/room/:id", auth, async function (req, res) {
    try {
      const data = unwrap(await dbRead("deliberation_session", {
        filters: { id: req.params.id },
        single: true,
      }));
      if (!data) {
        const c = sessions.get(req.params.id);
        return c ? res.json(c) : res.status(404).json({ error: "not found" });
      }
      res.json({
        status: data.status,
        direction: data.direction || null,
        shots: data.shots || null,
        brief: data.brief || null,
        result: data.result || null,
        log: data.log || null,
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}

module.exports = { registerRoom };
