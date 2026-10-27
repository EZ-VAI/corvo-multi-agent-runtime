// room/studioRoutes.js — Studio's own HTTP namespace (separate from /room).
// As Studio grows (model shots, detail pages, the agent orchestrator), endpoints
// live here, not piled into room/routes.js. Heavy media gen uses async + poll
// (POST returns a jobId, client polls GET) so slow generation never hits the
// nginx / proxy timeout — same pattern as /room/deliberate.
const { v4: uuidv4 } = require("uuid");
const { renderEcommercePoster } = require("./studioRender");
const { analyzeProductImage } = require("./analyzeProduct");
const { readSizeChart, suggestSize } = require("./sizechart");
const { renderModelSheet } = require("./modelRender");
const { renderModelShot, renderModelPoster } = require("./modelShotRender");
const { renderJewelryShot } = require("./jewelryRender");
const { stageBase, stageScene, stagePoster } = require("./garmentRender");

const studioJobs = new Map();

function gcJobs() {
  const now = Date.now();
  for (const [id, job] of studioJobs) {
    if (now - (job.ts || 0) > 3600000) studioJobs.delete(id);
  }
}


// ── 计费收尾:studio 生成完成/失败回调 settle-studio-job 做 capture/refund ──
// billing_job_id 由 studio-proxy reserve 后透传;缺失则跳过(兼容未接计费的旧调用)
var SETTLE_FN = process.env.SETTLE_FN_URL || "";
async function finalizeBilling(billingJobId, ok) {
  if (!billingJobId) return;
  try {
    await fetch(SETTLE_FN, { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ billing_job_id: billingJobId, outcome: ok ? "ready" : "failed" }) });
  } catch (e) { console.error("[billing] finalize 回调失败(cron watchdog 兜底退款):", e.message); }
}

function registerStudio(app, auth) {
  // POST /studio/ecommerce  body: { brief, productImageBase64, subtype?, ratio?, productInfo?, count? }
  //   brief = composeBrandBrief(brand_skill) output (computed on the frontend)
  //   productImageBase64 = user's product image (zero-retention; not persisted beyond this job)
  app.post("/studio/ecommerce", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.productImageBase64) {
      return res.status(400).json({ error: "brief + productImageBase64 required" });
    }
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });

    (async function () {
      try {
        const out = await renderEcommercePoster({
          brief: b.brief,
          subtype: b.subtype,
          ratio: b.ratio,
          productInfo: b.productInfo,
          productImageBase64: b.productImageBase64,
          count: b.count,
        });
        studioJobs.set(jobId, { status: "done", images: out.images, error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/ecommerce]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  app.get("/studio/ecommerce/:jobId", auth, function (req, res) {
    const job = studioJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "job not found" });
    res.json(job);
  });

  // POST /studio/analyze  body: { productImageBase64 }  -> { productInfo }
  // Synchronous (vision is fast); zero-retention — image not persisted.
  app.post("/studio/analyze", auth, async function (req, res) {
    const b = req.body || {};
    if (!b.productImageBase64) return res.status(400).json({ error: "productImageBase64 required" });
    try {
      const out = await analyzeProductImage({ productImageBase64: b.productImageBase64 });
      res.json(out);
    } catch (e) {
      console.error("[studio/analyze]", e && e.message);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  // POST /studio/model-profile  body: { brief, profile:{gender,height_cm,bust_cm,waist_cm,hip_cm,shoulder_cm,traits?} }
  //   traits?: { ethnicity,skin,hair,hair_color,build,face_shape,bone,vibe,age } — all optional, drive model appearance
  //   -> { jobId }   async; generates the three-view sheet; poll GET /studio/job/:jobId
  app.post("/studio/model-profile", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.profile || !b.profile.height_cm) {
      return res.status(400).json({ error: "brief + profile.height_cm required" });
    }
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await renderModelSheet({ profile: b.profile, brief: b.brief });
        studioJobs.set(jobId, { status: "done", images: [out.sheetUrl], error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/model-profile]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // GET /studio/job/:jobId — generic poll (works for any studioJobs job)
  app.get("/studio/job/:jobId", auth, function (req, res) {
    const job = studioJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "job not found" });
    res.json(job);
  });

  // POST /studio/model-shot  body: { brief, modelRefBase64, productImageBase64, framing?, ratio?, productInfo?, dims?, count? }
  //   -> { jobId } ; poll GET /studio/job/:jobId
  app.post("/studio/model-shot", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.modelRefBase64 || !b.productImageBase64) {
      return res.status(400).json({ error: "brief + modelRefBase64 + productImageBase64 required" });
    }
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await renderModelShot({
          brief: b.brief, modelRefBase64: b.modelRefBase64, productImageBase64: b.productImageBase64,
          framing: b.framing, ratio: b.ratio, productInfo: b.productInfo, dims: b.dims, count: b.count,
        });
        studioJobs.set(jobId, { status: "done", images: out.images, error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/model-shot]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // POST /studio/model-poster  body: same as model-shot  -> { jobId }
  app.post("/studio/model-poster", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.modelRefBase64 || !b.productImageBase64) {
      return res.status(400).json({ error: "brief + modelRefBase64 + productImageBase64 required" });
    }
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await renderModelPoster({
          brief: b.brief, modelRefBase64: b.modelRefBase64, productImageBase64: b.productImageBase64,
          framing: b.framing, ratio: b.ratio, productInfo: b.productInfo, dims: b.dims, count: b.count,
        });
        studioJobs.set(jobId, { status: "done", images: out.images, error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/model-poster]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // POST /studio/jewelry  body: { brief, productImageBase64, modelRefBase64?, partKey?, customPart?, dims?, ratio?, productInfo?, count? }
  app.post("/studio/jewelry", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.productImageBase64) return res.status(400).json({ error: "brief + productImageBase64 required" });
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await renderJewelryShot({
          brief: b.brief, productImageBase64: b.productImageBase64, modelRefBase64: b.modelRefBase64,
          partKey: b.partKey, customPart: b.customPart, dims: b.dims, ratio: b.ratio, productInfo: b.productInfo, count: b.count,
        });
        studioJobs.set(jobId, { status: "done", images: out.images, error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/jewelry]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });


  // ===== APPAREL (delivery-checkpoint split) =====
  // ① base: gpt triptych + FASHN multi-pose(can be multi-garment) + split -> N clean panels. Stops here.
  // body: { brief, identityImage, garments:[{image,dims}], poses?, lowerMode?('neutral'|'half'), resolution? }
  app.post("/studio/garment-base", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.identityImage || !b.garments || !b.garments.length) {
      return res.status(400).json({ error: "brief + identityImage + garments[] required" });
    }
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await stageBase({
          brief: b.brief, identityImage: b.identityImage, garments: b.garments,
          poses: b.poses, lowerMode: b.lowerMode, resolution: b.resolution,
          detailImages: b.detailImages, useTrend: b.useTrend,
        });
        studioJobs.set(jobId, { status: "done", images: out.panels, baseUrl: out.baseUrl, vtoUrl: out.vtoUrl, styling: out.styling, trendSummary: out.trendSummary, error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/garment-base]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // ② scene: single panel -> add on-brand scene (de-AI). body: { brief, panelImage, ratio? }
  app.post("/studio/garment-scene", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.panelImage) return res.status(400).json({ error: "brief + panelImage required" });
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await stageScene({ brief: b.brief, panelImage: b.panelImage, identityImage: b.identityImage, detailImages: b.detailImages, ratio: b.ratio });
        studioJobs.set(jobId, { status: "done", images: [out.url], error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/garment-scene]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // ③ poster: single panel -> e-commerce poster. body: { brief, panelImage, productInfo?, ratio? }
  app.post("/studio/garment-poster", auth, function (req, res) {
    const b = req.body || {};
    if (!b.brief || !b.panelImage) return res.status(400).json({ error: "brief + panelImage required" });
    gcJobs();
    const jobId = uuidv4();
    studioJobs.set(jobId, { status: "running", images: [], error: null, ts: Date.now() });
    res.json({ jobId: jobId });
    (async function () {
      try {
        const out = await stagePoster({ brief: b.brief, panelImage: b.panelImage, identityImage: b.identityImage, detailImages: b.detailImages, productInfo: b.productInfo, ratio: b.ratio });
        studioJobs.set(jobId, { status: "done", images: [out.url], error: null, ts: Date.now() });
        finalizeBilling(b.billing_job_id, true);
      } catch (e) {
        console.error("[studio/garment-poster]", e && e.message);
        studioJobs.set(jobId, { status: "error", images: [], error: String((e && e.message) || e), ts: Date.now() });
        finalizeBilling(b.billing_job_id, false);
      }
    })();
  });

  // ===== SIZE CHART (size-from-image + model-aware size suggestion) =====
  // ① read-sizechart: vision reads a size-chart image -> structured rows (all sizes, cm)
  // body: { sizeChartImageBase64 }  -> { unit, garment_type, measure_type, rows:[...] }  (synchronous)
  app.post("/studio/read-sizechart", auth, async function (req, res) {
    const b = req.body || {};
    if (!b.sizeChartImageBase64) return res.status(400).json({ error: "sizeChartImageBase64 required" });
    try {
      const out = await readSizeChart({ sizeChartImageBase64: b.sizeChartImageBase64 });
      res.json(out);
    } catch (e) {
      console.error("[studio/read-sizechart]", e && e.message);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  // ② suggest-size: given a parsed chart + a model's body measurements -> recommended size
  // body: { chart:{measure_type,rows}, model:{height_cm,bust_cm,waist_cm,hip_cm,shoulder_cm} }
  //   -> { recommended_size, recommended_row, reason, all_scores }  (synchronous, pure compute)
  app.post("/studio/suggest-size", auth, function (req, res) {
    const b = req.body || {};
    if (!b.chart || !b.model) return res.status(400).json({ error: "chart + model required" });
    try {
      const out = suggestSize({ chart: b.chart, model: b.model });
      res.json(out);
    } catch (e) {
      console.error("[studio/suggest-size]", e && e.message);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });
}

module.exports = { registerStudio };
