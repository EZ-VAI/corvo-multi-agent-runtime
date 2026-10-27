// Endpoints for the Brand & Product Understanding Agent. All DB access
// goes through the proxy — no service_role key on the VPS.

const { v4: uuidv4 } = require("uuid");
const { understand } = require("./agent");
const { buildReport } = require("./report");
const { buildStrategy } = require("../strategy/agent");
const { dbRead, dbWrite, aiComplete } = require("./proxy");

// Fallback: if the autonomous loop converges without a high-confidence
// value_translation, distill one from whatever product signal WAS gathered
// (websiteSignals often carries the real product description even when the
// dedicated analyze_product fetch returns null). Grounded only — no invention.
const VT_FALLBACK_SYS = [
  "You turn real product facts into value_translation: why a buyer wants this,",
  "expressed so it can SELL and be filmed. You are given raw signals gathered",
  "about ONE product (website copy, product text/data, brand essence).",
  "Extract ONLY what the signals actually support — never invent ingredients,",
  "claims, or mechanisms not present in the input.",
  "Return ONLY JSON:",
  "{",
  '  "product_name": "the product, if named in the signals",',
  '  "why_worth_the_price": "the real reason it is worth it, grounded in the facts",',
  '  "moment_of_use": "the concrete moment/feeling of using it",',
  '  "_seed_selling_angles": ["3-5 short, specific angles drawn from the real facts"]',
  "}",
  "If the signals contain no usable product information, return {}.",
].join("\n");

const sessions = new Map();

function unwrap(r) {
  if (r && typeof r === "object" && "data" in r) return r.data;
  return r;
}

function persist(sessionId, userId) {
  return async function (state) {
    sessions.set(sessionId, { status: state.status, round: state.round });
    try {
      await dbWrite("understanding_session", "upsert", {
        row: { id: sessionId, user_id: userId, brain: state.brain, gathered: state.gathered, log: state.log, status: state.status },
        onConflict: "id",
      });
    } catch (e) { console.warn("[understand] persist failed:", e.message); }
  };
}

async function writeBrain(userId, brain, productKey) {
  try {
    const bb = unwrap(await dbRead("brand_brain", {
      filters: { user_id: userId },
      single: true,
    }));
    const brandRow = {
      user_id: userId,
      essence: brain.essence || {},
      visual_dna: brain.visual_dna || {},
      anti_identity: Object.assign(
        {},
        (bb && bb.anti_identity) || {},
        brain.anti_identity || {}
      ),
      tonal_register: brain.tonal_register || {},
    };
    if (bb && bb.id) {
      await dbWrite("brand_brain", "update", {
        row: brandRow,
        filters: { id: bb.id },
      });
    } else {
      await dbWrite("brand_brain", "insert", { row: brandRow });
    }

    const vt = brain.value_translation;
    if (vt && Object.keys(vt).length) {
      const pb = unwrap(await dbRead("product_brain", {
        filters: productKey ? { user_id: userId, product_key: productKey } : { user_id: userId },
        order: { column: "updated_at", ascending: false },
        limit: 1,
        single: true,
      }));
      if (pb && pb.id) {
        await dbWrite("product_brain", "update", {
          row: { value_translation: vt },
          filters: { id: pb.id },
        });
      } else {
        await dbWrite("product_brain", "insert", {
          row: productKey ? { user_id: userId, product_key: productKey, value_translation: vt } : { user_id: userId, value_translation: vt },
        });
      }
    }
  } catch (e) {
    console.warn("[understand] writeBrain failed:", e.message);
  }
}


// ── SHARED understanding pipeline ─────────────────────────────────────────────
// The full understanding->fidelity->strategy flow, callable from BOTH the
// /understand HTTP endpoint AND the blackboard controller (run_understanding).
// Behaviour identical to the original endpoint body; onProgress(step) is an
// optional hook the controller uses to mirror progress into the film's events.
async function runUnderstandingPipeline(userId, opts, deps, onProgress) {
  opts = opts || {}; deps = deps || {};
  const persistFn = deps.persist || (async function(){});
  const writeBrainFn = deps.writeBrain;
  const note = function(step, payload){ try { if (onProgress) onProgress(step, payload || {}); } catch(e){} };
  const sessionId = opts.sessionId || uuidv4();
  const { productKeyFromUrl } = require("../productKey");
  const urlKey = productKeyFromUrl(opts.productUrl);

  note("understanding_started", { sessionId: sessionId });
  const seed = urlKey ? unwrap(await dbRead("product_brain", {
    filters: { user_id: userId, product_key: urlKey }, order: { column: "updated_at", ascending: false }, limit: 1, single: true,
  })) : null;
  let capturedGathered = null;
  var _existingBrain = null;
  if (opts.feedback) {
    try { _existingBrain = unwrap(await dbRead("brand_brain", { filters: { user_id: userId }, single: true })) || null; } catch (e) {}
  }
  const out = await understand({
    userId: userId,
    brief: {
      productImageUrl: opts.productImageUrl, productUrl: opts.productUrl,
      productDescription: opts.productDescription, frames: opts.pastCreativeFrames,
    },
    seedUnderstanding: seed,
    existingBrain: _existingBrain || undefined,
    newFeedback: opts.feedback || undefined,
  }, async function (state) {
    if (state && state.gathered) capturedGathered = state.gathered;
    note("understanding_round", { round: state && state.round, status: state && state.status });
    // Surface the agent's live thinking (its own `why`, the tool/url it is using, or what it
    // just inferred) so the blackboard can narrate the research as it happens.
    if (state && state.decision) {
      var d = state.decision;
      note("understanding_thinking", {
        round: state.round || null,
        action: d.action || null,
        tool: d.tool || null,
        url: d.url || null,
        why: d.why || null,
        dimension: d.dimension || null,
        infer: d.infer || null,
        client_words: d.client_words || null,
      });
    }
    return persistFn(sessionId, userId)(state);
  });

  try {
    // Product images come ONLY from analyze-product's filtered, single-SKU fields.
    // analyze-product (Lovable edge) already applied the 3-tier clean strategy
    // (Shopify .json -> JSON-LD -> scoped gallery), so heroImages/images are this
    // product's own angles -- never recommended/related products. We deliberately do
    // NOT merge product_images / _pd.images / seed fields, which historically pulled in
    // other products. We also do not pad to a fixed count: a product has as many real
    // angle shots as it has (could be 1, could be several).
    const harvested = [];
    const _pd = (capturedGathered && capturedGathered.productData) || {};
    const _inner = _pd.data || _pd;
    // Prefer the curated hero set; fall back to the full clean gallery; then user uploads.
    // Clean product-image sources, in order of preference:
    //  - heroImages: Gemini-picked best shots (URL-scrape path)
    //  - images: full clean gallery (URL-scrape path, post 3-tier filter)
    //  - product_images: the Shopify direct-sync path writes here (already clean bucket URLs)
    // The old "dirty merge" problem was the markdown sweep inside the edge function, which the
    // edge's 3-tier fix now handles -- so product_images is safe to use as the Shopify-path source.
    const _cleanSources = [_inner.heroImages, _inner.images, _inner.product_images, _pd.heroImages, _pd.images, _pd.product_images, opts.uploadedImages, opts.productImageUrl];
    _cleanSources.forEach(function (c) {
      if (!c) return;
      (Array.isArray(c) ? c : [c]).forEach(function (it) {
        const _u = typeof it === "string" ? it : (it && (it.url || it.src || it.publicUrl));
        if (typeof _u === "string") harvested.push(_u);
      });
    });
    const productImages = harvested
      .filter(function (u) { return typeof u === "string" && /^https?:\/\//.test(u); })
      .filter(function (u) { return !/\.html?($|\?)/i.test(u); })
      .filter(function (u, i, a) { return a.indexOf(u) === i; });
    if (productImages.length) {
      const pbImg = unwrap(await dbRead("product_brain", { filters: urlKey ? { user_id: userId, product_key: urlKey } : { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true }));
      if (pbImg && pbImg.id) await dbWrite("product_brain", "update", { row: { product_images: productImages }, filters: { id: pbImg.id } });
      else await dbWrite("product_brain", "insert", { row: urlKey ? { user_id: userId, product_key: urlKey, product_images: productImages } : { user_id: userId, product_images: productImages } });
      note("product_images", { count: productImages.length, urls: productImages.slice(0, 6) });
      console.log("[understand] product_images persisted:", productImages.length);
    } else { console.warn("[understand] no product images found to persist"); }
  } catch (e) { console.warn("[understand] product_images persist failed:", e.message); }

  try {
    const pbC = unwrap(await dbRead("product_brain", { filters: urlKey ? { user_id: userId, product_key: urlKey } : { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true }));
    const heroUrl = pbC && Array.isArray(pbC.product_images) && pbC.product_images[0];
    if (heroUrl) {
      const shade = await aiComplete({
        model: "openai/gpt-5.5",
        system: "You identify the exact color of a physical product from a photo. Return ONLY JSON.",
        user: "Identify the product's OWN color in the attached photo. For cosmetics, the SHADE of the product itself (lipstick bullet / cream / powder), NOT the packaging, tube, cap, metal, or background. Return JSON {\"hex\":\"#RRGGBB\",\"name\":\"short shade name\"}. If no product-color is visible, return {\"hex\":null}.",
        images: [{ url: heroUrl }], json: true,
      });
      if (shade && typeof shade.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(shade.hex)) {
        const fid = { colorCalibration: { dominantColors: [{ hex: shade.hex, name: shade.name || "product shade" }], isColorSensitive: true } };
        if (pbC && pbC.id) await dbWrite("product_brain", "update", { row: { fidelity: fid }, filters: { id: pbC.id } });
        note("shade_extracted", { hex: shade.hex, name: shade.name || "" });
        console.log("[understand fidelity] shade extracted:", shade.hex, shade.name || "");
      } else { console.warn("[understand fidelity] no usable shade hex extracted"); }
    }
  } catch (e) { console.warn("[understand fidelity] shade extraction failed:", e.message); }

  if (!out.brain.value_translation || !Object.keys(out.brain.value_translation).length) {
    try {
      const g = capturedGathered || {};
      const vt = await aiComplete({
        model: "openai/gpt-5.5", system: VT_FALLBACK_SYS,
        user: JSON.stringify({ websiteSignals: g.websiteSignals || "", productText: g.productText || "", productData: g.productData || null, essence: out.brain.essence || {} }),
        temperature: 0.4,
      });
      if (vt && !vt._parseError && Object.keys(vt).length) {
        out.brain.value_translation = vt;
        out.brain.confidenceMap = out.brain.confidenceMap || {};
        out.brain.confidenceMap.value_translation = "medium";
      }
    } catch (e) { console.warn("[understand] value_translation fallback failed:", e.message); }
  }

  if (writeBrainFn) await writeBrainFn(userId, out.brain, urlKey);
  note("brain_written", {});

  let strategyBrief = {};
  try {
    const pbForStrat = unwrap(await dbRead("product_brain", { filters: urlKey ? { user_id: userId, product_key: urlKey } : { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true }));
    strategyBrief = await buildStrategy({ brandBrain: out.brain, productBrain: pbForStrat, brief: { aspectRatio: opts.aspectRatio, durationSec: opts.durationSec } });
    note("brief_ready", { brief: strategyBrief });
  } catch (e) { console.warn("[strategy] failed (non-fatal):", e.message); }

  const report = buildReport(out.brain, strategyBrief);
  try { await dbWrite("understanding_session", "update", { row: { report: report, status: "ready" }, filters: { id: sessionId } }); } catch(e){}
  note("understanding_done", { sessionId: sessionId });
  return { sessionId: sessionId, brain: out.brain, brief: strategyBrief, report: report };
}

function registerUnderstanding(app, auth) {



  app.post("/understand", auth, async function (req, res) {
    const b = req.body || {};
    const userId = b.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const sessionId = uuidv4();
    sessions.set(sessionId, { status: "working", round: 0 });
    res.json({ sessionId: sessionId });

    (async function () {
      try {
        const seed = unwrap(await dbRead("product_brain", {
          filters: { user_id: userId },
          order: { column: "updated_at", ascending: false },
          limit: 1,
          single: true,
        }));
        let capturedGathered = null;
        const out = await understand({
          userId: userId,
          brief: {
            productImageUrl: b.productImageUrl,
            productUrl: b.productUrl,
            productDescription: b.productDescription,
            frames: b.pastCreativeFrames,
          },
          seedUnderstanding: seed,
        }, async function (state) {
          if (state && state.gathered) capturedGathered = state.gathered;
          return persist(sessionId, userId)(state);
        });
        // ---- persist REAL product images (事实数据,不绕 LLM 合成) ----
        // analyze-product 抓到的 images ∪ 用户 productImageUrl ∪ uploadedImages。
        // 这是 "anchored" 第一次有真锚;没有它 generate-keyframe 只能幻觉产品。
        try {
          const harvested = [];
          const _pd = (capturedGathered && capturedGathered.productData) || {};
          const _inner = _pd.data || _pd; // analyze-product nests its real payload under .data
          [_inner.heroImages, _inner.images, _inner.product_images, _pd.product_images, _pd.images, b.productImageUrl, b.uploadedImages].forEach(function (c) {
            if (!c) return;
            (Array.isArray(c) ? c : [c]).forEach(function (it) {
              const _u = typeof it === "string" ? it : (it && (it.url || it.src || it.publicUrl));
              if (typeof _u === "string") harvested.push(_u);
            });
          });
          const productImages = harvested
            .filter(function (u) { return typeof u === "string" && /^https?:\/\//.test(u); })
            .filter(function (u) { return !/\.html?($|\\?)/i.test(u); })
            .filter(function (u, i, a) { return a.indexOf(u) === i; })
            .slice(0, 6);
          if (productImages.length) {
            const pbImg = unwrap(await dbRead("product_brain", {
              filters: { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true,
            }));
            if (pbImg && pbImg.id) {
              await dbWrite("product_brain", "update", { row: { product_images: productImages }, filters: { id: pbImg.id } });
            } else {
              await dbWrite("product_brain", "insert", { row: { user_id: userId, product_images: productImages } });
            }
            console.log("[understand] product_images persisted:", productImages.length);
          } else {
            console.warn("[understand] no product images found to persist");
          }
        } catch (e) {
          console.warn("[understand] product_images persist failed:", e.message);
        }
        // ---- extract + persist product SHADE (color fidelity guard, from the REAL photo) ----
        // No exact color is stored upstream, and the cinematographer tends to invent one in prose.
        // Extract the true shade HEX from the curated hero image via Vision (once, cached) so
        // generate-keyframe colorAnchor can hard-lock it. A fact/guard, not creative content.
        try {
          const { aiComplete } = require("./proxy");
          const pbC = unwrap(await dbRead("product_brain", {
            filters: { user_id: userId }, order: { column: "updated_at", ascending: false }, limit: 1, single: true,
          }));
          const heroUrl = pbC && Array.isArray(pbC.product_images) && pbC.product_images[0];
          if (heroUrl) {
            const shade = await aiComplete({
              model: "openai/gpt-5.5",
              system: "You identify the exact color of a physical product from a photo. Return ONLY JSON.",
              user: "Identify the product's OWN color in the attached photo. For cosmetics, the SHADE of the product itself (lipstick bullet / cream / powder), NOT the packaging, tube, cap, metal, or background. Return JSON {\"hex\":\"#RRGGBB\",\"name\":\"short shade name\"}. If no product-color is visible, return {\"hex\":null}.",
              images: [{ url: heroUrl }],
              json: true,
            });
            if (shade && typeof shade.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(shade.hex)) {
              const fid = { colorCalibration: { dominantColors: [{ hex: shade.hex, name: shade.name || "product shade" }], isColorSensitive: true } };
              if (pbC && pbC.id) await dbWrite("product_brain", "update", { row: { fidelity: fid }, filters: { id: pbC.id } });
              console.log("[understand fidelity] shade extracted:", shade.hex, shade.name || "");
            } else {
              console.warn("[understand fidelity] no usable shade hex extracted");
            }
          }
        } catch (e) {
          console.warn("[understand fidelity] shade extraction failed:", e.message);
        }
        // fallback: the autonomous loop sometimes converges without a
        // high-confidence value_translation even when product signal exists.
        // Distill it from the gathered signals so the room/strategy aren't starved.
        if (!out.brain.value_translation || !Object.keys(out.brain.value_translation).length) {
          try {
            const g = capturedGathered || {};
            const vt = await aiComplete({
              model: "openai/gpt-5.5",
              system: VT_FALLBACK_SYS,
              user: JSON.stringify({
                websiteSignals: g.websiteSignals || "",
                productText: g.productText || "",
                productData: g.productData || null,
                essence: out.brain.essence || {},
              }),
              temperature: 0.4,
            });
            if (vt && !vt._parseError && Object.keys(vt).length) {
              out.brain.value_translation = vt;
              out.brain.confidenceMap = out.brain.confidenceMap || {};
              out.brain.confidenceMap.value_translation = "medium";
            }
          } catch (e) {
            console.warn("[understand] value_translation fallback failed:", e.message);
          }
        }
        await writeBrain(userId, out.brain);
        // strategy runs right after understanding (A1: one combined present)
        let strategyBrief = {};
        try {
          const pbForStrat = unwrap(await dbRead("product_brain", {
            filters: { user_id: userId },
            order: { column: "updated_at", ascending: false },
            limit: 1,
            single: true,
          }));
          strategyBrief = await buildStrategy({
            brandBrain: out.brain,
            productBrain: pbForStrat,
            brief: {
              aspectRatio: b.aspectRatio,
              durationSec: b.durationSec,
            },
          });
        } catch (e) {
          console.warn("[strategy] failed (non-fatal):", e.message);
        }
        const report = buildReport(out.brain, strategyBrief);
        await dbWrite("understanding_session", "update", {
          row: { report: report, status: "ready" },
          filters: { id: sessionId },
        });
        sessions.set(sessionId, { status: "ready" });
      } catch (e) {
        console.error("[understand] failed:", e);
        sessions.set(sessionId, { status: "failed", error: String(e) });
        try {
          await dbWrite("understanding_session", "update", {
            row: { status: "failed" },
            filters: { id: sessionId },
          });
        } catch (e2) {}
      }
    })();
  });

  app.get("/understand/:id", auth, async function (req, res) {
    try {
      const data = unwrap(await dbRead("understanding_session", {
        filters: { id: req.params.id },
        single: true,
      }));
      if (!data) {
        const c = sessions.get(req.params.id);
        return c ? res.json(c) : res.status(404).json({ error: "not found" });
      }
      res.json({ status: data.status, report: data.report || null });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post("/understand/:id/apply", auth, async function (req, res) {
    const b = req.body || {};
    const userId = b.userId;
    const edits = b.edits;
    if (!userId || !edits) {
      return res.status(400).json({ error: "userId + edits required" });
    }
    try {
      const bb = unwrap(await dbRead("brand_brain", {
        filters: { user_id: userId },
        single: true,
      }));
      const patch = {
        confirmed_by_brand: true,
        confirmed_at: new Date().toISOString(),
      };
      if (edits.essence) patch.essence = edits.essence;
      if (edits.visual_dna) patch.visual_dna = edits.visual_dna;
      if (edits.anti_identity) {
        patch.anti_identity = Object.assign(
          {},
          (bb && bb.anti_identity) || {},
          edits.anti_identity,
          { confirmed: true }
        );
      }
      if (bb && bb.id) {
        await dbWrite("brand_brain", "update", {
          row: patch,
          filters: { id: bb.id },
        });
      }
      if (edits.value_translation) {
        const pb = unwrap(await dbRead("product_brain", {
          filters: { user_id: userId },
          order: { column: "updated_at", ascending: false },
          limit: 1,
          single: true,
        }));
        if (pb && pb.id) {
          await dbWrite("product_brain", "update", {
            row: {
              value_translation: edits.value_translation,
              confirmed_by_brand: true,
            },
            filters: { id: pb.id },
          });
        }
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post("/understand/wake", auth, async function (req, res) {
    const b = req.body || {};
    const userId = b.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });
    res.json({ ok: true });
    (async function () {
      try {
        const bb = unwrap(await dbRead("brand_brain", {
          filters: { user_id: userId },
          single: true,
        })) || {};
        const out = await understand({
          userId: userId,
          brief: {},
          existingBrain: bb,
          newFeedback: b.feedback,
        }, async function () {});
        await writeBrain(userId, out.brain);
      } catch (e) {
        console.warn("[understand] wake failed:", e.message);
      }
    })();
  });
}

module.exports = { registerUnderstanding, runUnderstandingPipeline, persist: persist, writeBrain: writeBrain };
