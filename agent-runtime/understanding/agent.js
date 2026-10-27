// Brand & Product Understanding Agent — first fully autonomous agent.
// Brain (loop + reasoning prompts) lives here; reaches AI/tools only
// through the proxy. Autonomy: each round self-assesses weakest
// dimension, decides next move. Guardrails: MAX_ROUNDS, TOOL_BUDGET.

const { TOOLS, getTool } = require("./tools");
const { aiComplete } = require("./proxy");

const MAX_ROUNDS = 7;
const TOOL_BUDGET = 6;

const DECIDE_SYS = [
  "You are a brand & product understanding specialist — the analyst",
  "on an AI ad team whose job is to deeply understand a brand and its",
  "product before any creative work.",
  "",
  "You work in rounds. Each round you assess your CURRENT understanding",
  "and decide ONE next action. Be economical: only gather what you need.",
  "",
  "Choose ONE of:",
  '- {"action":"use_tool","tool":"<key>","args":{...},"why":"..."}',
  '- {"action":"infer","dimension":"essence|visual_dna|anti_identity|value_translation","content":{...},"confidence":"high|low","why":"...","client_words":["...","..."]}',
  '- {"action":"converge","why":"..."}',
  "",
  "On EVERY infer, also give `client_words`: 2-4 SHORT plain-English phrases (1-3 words",
  "each) naming what you just understood, written for the brand owner to read on a board",
  "-- elegant and true to the brand, but immediately understandable to an ordinary person",
  '(e.g. "Clean & minimal", "Warm and natural", "Quiet luxury", "Handmade feel"). Not jargon,',
  "not full sentences. These are the words the team chalks onto the wall.",
  "",
  "high confidence -> drives decisions; low -> shown to brand to confirm.",
  "",
  'AVAILABLE TOOLS (use the key in quotes as "tool"):',
  '- "scrape_site": scrape brand website for branding signals. args:{url}',
  '- "analyze_past_creative": analyze style of past ads. args:{frames}',
  '- "analyze_product": extract product truth from image/URL. args:{url}',
  '- "infer_anti_identity": synthesize anti_identity from evidence.',
  "",
  "PRINCIPLES:",
  "- anti_identity (what the brand must NEVER be) is highest-value,",
  "  hardest. Infer from how the brand ACTUALLY looks (site, past ads),",
  "  not category cliches. Mark low-confidence unless direct evidence.",
  "- value_translation = turning product facts into filmable desire",
  '  (e.g. "cedar note" -> "misty cedar forest at dawn"). Makes it SELL.',
  "- Do not gather what you already have. Do not re-infer confident dims.",
  "- When productData is present, it is the SPECIFIC product's real truth —",
  "  ground value_translation in THAT product, not the brand homepage. Always",
  "  infer value_translation (high confidence) BEFORE you converge.",
  "- Converge when more work won't materially improve understanding.",
  "",
  "Return ONLY the JSON for your single next action.",
].join("\n");

async function understand(ctx, persist) {
  const save = persist || (async () => {});
  const gathered = {
    websiteSignals: "",
    pastCreativeStyle: "",
    productText: (ctx.brief && ctx.brief.productDescription) || "",
    productData: ctx.seedUnderstanding || null,
  };
  const brain = {
    essence: {},
    visual_dna: {},
    anti_identity: {},
    value_translation: {},
    pending: [],
    confidenceMap: {},
  };
  if (ctx.existingBrain) Object.assign(brain, ctx.existingBrain);
  // existingBrain（restudy 时从已存品牌读回）可能把 pending 覆盖成 null/对象，
  // 后续 brain.pending.push 会崩。强制复位为数组。
  if (!Array.isArray(brain.pending)) brain.pending = [];
  const log = [];
  let toolCalls = 0;

  // The autonomous loop reliably leans on scrape_site (brand-level) and skips
  // analyze_product, leaving productData null and the understanding floating to
  // the brand homepage instead of THIS product. If a product URL/image is given,
  // analyze it up front so productData is always grounded in the specific product.
  const productRef =
    (ctx.brief && (ctx.brief.productUrl || ctx.brief.productImageUrl)) || null;
  const _seedImgs = gathered.productData && Array.isArray(gathered.productData.product_images) && gathered.productData.product_images.length;
  if (productRef && !_seedImgs) {
    try {
      const apTool = getTool("analyze_product");
      if (apTool) {
        const apRes = await apTool.run({ url: productRef, userId: ctx.userId });
        if (apRes && apRes.ok && apRes.data) {
          gathered.productData = apRes.data; // fresh analysis is authoritative; do NOT blend a prior product's seed
          toolCalls++;
        }
        log.push({
          round: 0,
          tool: "analyze_product",
          forced: true,
          ok: apRes && apRes.ok,
          error: apRes && apRes.error,
        });
        await save({ brain, gathered, log, round: 0, status: "working" });
        // A direct uploaded image remains a valid visual anchor even if semantic
        // analysis is temporarily unavailable. A URL-only film does not: stop
        // visibly instead of inventing product truth from the brand homepage.
        if ((!apRes || !apRes.ok) && !(ctx.brief && ctx.brief.productImageUrl)) {
          const err = new Error("product_analysis_unavailable: " + String((apRes && apRes.error) || "analyze_product failed"));
          err.code = "product_analysis_unavailable";
          await save({ brain, gathered, log, round: 0, status: "blocked", providerError: { code: err.code } });
          throw err;
        }
      }
    } catch (e) {
      log.push({ round: 0, note: "forced analyze_product failed: " + e.message });
      if (e && e.code === "product_analysis_unavailable") throw e;
    }
  }

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const view = {
      round: round,
      brief: ctx.brief,
      gathered: gathered,
      currentBrain: {
        essence: brain.essence,
        visual_dna: brain.visual_dna,
        anti_identity: brain.anti_identity,
        value_translation: brain.value_translation,
        confidenceMap: brain.confidenceMap,
      },
      newFeedback: ctx.newFeedback || null,
      toolBudgetLeft: TOOL_BUDGET - toolCalls,
    };

    const decision = await aiComplete({
      model: "openai/gpt-5.5",
      system: DECIDE_SYS,
      user: JSON.stringify(view),
      temperature: 0.4,
    });
    log.push({ round: round, decision: decision });
    // ── emit this round's thinking so the room can narrate it live (zero extra cost: the agent already produced `why`) ──
    try {
      await save({ brain, gathered, log, round, status: "working", decision: {
        action: decision.action,
        tool: decision.tool || null,
        url: (decision.args && (decision.args.url || decision.args.siteUrl || decision.args.website)) || null,
        why: decision.why || null,
        dimension: decision.dimension || null,
        infer: (decision.action === "infer" && decision.content) ? decision.content : null,
        client_words: (decision.action === "infer" && Array.isArray(decision.client_words)) ? decision.client_words.slice(0, 4) : null,
      } });
    } catch (e) {}

    if (decision.action === "converge") break;

    if (decision.action === "use_tool") {
      if (toolCalls >= TOOL_BUDGET) {
        log.push({ round: round, note: "tool budget exhausted" });
        continue;
      }
      const tool = getTool(decision.tool);
      if (!tool) {
        log.push({ round: round, note: "unknown tool " + decision.tool });
        continue;
      }
      toolCalls++;
      const args = Object.assign({}, decision.args, { userId: ctx.userId });
      if (decision.tool === "infer_anti_identity") {
        args.websiteSignals = gathered.websiteSignals;
        args.pastCreativeStyle = gathered.pastCreativeStyle;
        args.productText = gathered.productText;
      }
      let result;
      try {
        result = await tool.run(args);
      } catch (toolErr) {
        result = { ok: false, error: String((toolErr && toolErr.message) || toolErr) };
      }
      if (result.ok) {
        const dataStr = typeof result.data === "string"
          ? result.data
          : JSON.stringify(result.data);
        if (decision.tool === "scrape_site") {
          gathered.websiteSignals = dataStr;
        } else if (decision.tool === "analyze_past_creative") {
          gathered.pastCreativeStyle = dataStr;
        } else if (decision.tool === "analyze_product") {
          gathered.productData = result.data;
        } else if (decision.tool === "infer_anti_identity") {
          if (result.data && result.data.anti_identity) {
            brain.anti_identity = result.data.anti_identity;
            brain.confidenceMap.anti_identity = "high";
            const pend = result.data.anti_identity.pending;
            if (Array.isArray(pend)) brain.pending.push.apply(brain.pending, pend);
          }
        }
      }
      log.push({
        round: round,
        tool: decision.tool,
        ok: result.ok,
        error: result.error,
      });
      await save({ brain, gathered, log, round, status: "working" });
      continue;
    }

    if (decision.action === "infer") {
      const dim = decision.dimension;
      const valid = ["essence", "visual_dna", "anti_identity", "value_translation"];
      if (valid.indexOf(dim) !== -1) {
        if (decision.confidence === "low") {
          brain.pending.push({
            dimension: dim,
            content: decision.content,
            why: decision.why,
          });
        } else {
          brain[dim] = Object.assign({}, brain[dim] || {}, decision.content);
          brain.confidenceMap[dim] = "high";
        }
      }
      await save({ brain, gathered, log, round, status: "working" });
      continue;
    }

    log.push({ round: round, note: "no valid action, advancing" });
  }

  await save({ brain, gathered, log, status: "done" });
  return { brain, log, toolCalls };
}

module.exports = { understand, MAX_ROUNDS, TOOL_BUDGET };
