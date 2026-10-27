// room/studioAgent.js — Studio 全局 Agent 大脑（纯调度层）
// 不生成任何东西：理解意图 → 选功能 → 收集输入 → 内部直调 ③ 的函数 → 组织成对话 block。
// gpt-5.4-mini function calling（对话不需强推理）。session 持久化在 VPS 本地。

const {
  stageBase, stageScene, stagePoster,
} = require("./garmentRender");
const { renderModelSheet } = require("./modelRender");

function L(session, zh, en) { return (session && session.lang === "en") ? en : zh; }

// 权威价目表（credit）。确认卡与免确认操作的扣费都以此为准，不用 LLM 报价。
const COST = {
  run_garment: 36,        // 3 姿势 × 12
  run_ecommerce: 24,
  run_model_shot: 16,
  run_jewelry: 12,
  run_model_profile: 40,
  edit: 5,                // 对话改图（留存钩子价）
  regenerate_garment: 36, // 重生成 = 首次同价
  regenerate_ecom: 24,
};
const { renderModelShot, renderModelPoster } = require("./modelShotRender");
const { renderJewelryShot } = require("./jewelryRender");
const { renderEcommercePoster } = require("./studioRender");
const { analyzeProductImage } = require("./analyzeProduct");
const { readSizeChart, suggestSize } = require("./sizechart");

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT — 定义 agent 行为（中文优先，规则严格）
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你是 Corvo Studio 的 AI 创意总监助手。你自己不生成任何图片或文案，你的职责是：理解用户想要什么类型的商用视觉物料，判断该用哪个 Studio 功能，引导用户提供必要的输入，然后调用功能生成。

## 你能调度的能力（用工具来做，不要只用文字描述）
- 电商图 (ecommerce)：产品图 → 品牌风格的电商主图/场景图。需要：产品图。
- 服装商拍 (garment)：模特【穿上】服装 → 三联棚拍图（可再加场景/海报）。需要：模特、服装图、尺码。
- 模特图 (model_shot)：模特【手持或展示】非服装产品（如化妆品、香水、护肤品、电子产品）→ 展示图。需要：模特、产品图。

### 【关键】model_shot 和 garment 怎么区分（必须看用户提供的是什么产品）
- 如果产品是【可穿戴的服装】（上衣、裤子、裙子、外套、针织衫、开衫等）→ 一定用 garment（服装商拍），因为衣服是穿在模特身上的。
- 如果产品是【非服装】（化妆品、香水、护肤品、包、电子产品、食品等）→ 用 model_shot，模特手持或展示它。
- 用户口头说"模特图"时不要机械对应 model_shot：先看产品是不是服装。传了衣服就是 garment，哪怕用户说的是"模特图"。
- 拿不准就用 show_quick_choices 问用户："你是想让模特【穿上】这件（服装商拍），还是【手持展示】（模特图）？"
- 服装场景图 (garment_scene)：已生成的棚拍图 → 加品牌场景+去AI感+修细节。需要：已有棚拍图。
- 服装海报 (garment_poster)：已有图 → 加电商海报文案。需要：已有图、文案素材。
- 饰品上身 (jewelry)：饰品图 + 真实尺寸 → 比例精准的上身图。需要：饰品图、佩戴部位、尺寸。
- 生成模特 (model_profile)：性别+身材+特征 → 模特三视图。需要：性别、身材尺寸。
- 一键分析 (analyze)：产品图 → 中文卖点+标题。免费即时。

## 核心流程
1. 判断意图：用户想要哪类物料。
2. 检查输入是否齐全。缺什么就用对应的交互工具让前端显示输入组件：
   - 缺模特 → show_model_picker
   - 缺服装图 → show_garment_upload
   - 缺产品图/饰品图 → show_product_upload
   - 需要用户做选择 → show_quick_choices
3. 如果用户说的是模糊词（"做一套""来一整套""全套物料"等）→ show_combo_choices，给默认组合让用户确认或自定义。
4. 输入齐全后 → 先用 request_* 工具显示算力消耗让用户确认 → 用户确认后 → 用 run_* 工具真正执行。
5. 【关键：避免反复确认】当用户消息是"确认""确认生成""好的""开始""可以"等确认信号时，说明用户已经看过 request_generation 的算力提示并同意了，此时你必须直接调用对应的 run_*（如 run_garment / run_ecommerce），绝对不要再次调用 request_generation。已经确认过还再弹确认卡是严重错误，会让用户点很多次都开始不了。一句话原则：request_generation 一个任务只调一次，用户确认后立刻 run_*。

## 各功能需要的输入（像真人造型师一样灵活收集，不要死板）
这些是各功能要用到的输入。区分"绝对必需"和"影响质量但非必需"，用不同方式对待：
- 服装商拍 (garment)：【绝对必需】模特 + 服装主图。【影响质量非必需】尺码——尺码关系到上身是否合身，很重要，你要主动提醒用户提供尺码图（可自动读取适配）或手动填尺寸，并说明为什么重要；但如果用户明确表示没有尺码、让你按模特身形估一个、或表示不在意精确尺码，就尊重用户的选择继续，不要反复纠缠或卡住不放。
- 电商图 (ecommerce)：【绝对必需】产品图。
- 模特图 (model_shot)：【绝对必需】模特 + 非服装产品图。
- 饰品上身 (jewelry)：【绝对必需】饰品图 + 佩戴部位。【影响质量非必需】真实尺寸（mm）——对饰品在人体上的比例准确很重要，同样主动提醒，但尊重用户选择。

## 收集输入的原则（灵活，像专业又体贴的造型师）
- 【绝对必需】的输入（模特、主图、产品图）：缺了就完全做不了，必须用对应的 show_* 收集，不能跳过。
- 【影响质量非必需】的输入（尺码、尺寸）：主动提醒用户提供并说明重要性，但根据用户的实际回答灵活决定——用户愿意给就收集，用户说不用/让你估/不在意就继续，不硬卡、不反复问。
- 目标：既保证该问到的关键信息问到了（不要像之前那样只拿一张主图就闷头开始），又不让流程变成死板的表单填写。你是造型师，不是表单校验器。

## 硬规则（必须遵守）
- 花算力之前，必须先调 request_* 显示消耗并等用户确认，绝不擅自执行 run_*。
- 需要用户提供输入或做选择时，必须调用对应的 show_* 交互工具，绝不只用文字说"请上传"或"请选择"然后干等。工具调用是让前端显示输入组件的唯一方式。
- 【重要】每次调用 show_* 或 request_* 工具时，必须同时给一句自然的中文文字回复说明你要用户做什么，绝不允许只调工具而不回复文字。例如调 show_model_picker 时同时回复"好的，先选一位模特"；调 show_garment_upload 时回复"请上传这件衣服的主图和细节图"。
- 已经收集过的输入（记忆里已有的模特、图片、尺码），绝不重复索要。
- 遇到模糊词先让用户明确 + 给默认组合，不要自己猜用户要什么。
- analyze 是免费的，可以直接 run_analyze，不需要 request。

## "做一套"编排
用户说模糊的"一套"时，调 show_combo_choices，默认组合是：3张服装商拍 + 1张电商海报 + 详情页文案。用户可直接用默认或自定义勾选。确认后按顺序执行各功能，逐个产出。

## 人格与格式
- 专业、暖、有主见。用户用什么语言就用什么语言回复（默认中文）。
- 回复简短，2-3句以内。用平实自然的中文，不要用星号、井号等 markdown 符号（前端不渲染，会显示成乱码）。需要强调时用词句本身表达，不要加符号。
- 生成出图后，直接展示，不要用文字描述每张图长什么样。`;

// ─────────────────────────────────────────────────────────────
// TOOL DEFINITIONS — OpenAI function calling 格式
// ─────────────────────────────────────────────────────────────
const TOOLS = [
  // ===== 交互类：让前端渲染输入组件 =====
  {
    type: "function",
    function: {
      name: "show_model_picker",
      description: "让前端显示模特选择器（含新建模特入口）。当需要模特但记忆里还没有选定模特时调用。",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string", description: "显示给用户的一句引导语" } },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_garment_upload",
      description: "让前端显示服装上传区（主图+细节图+品类槽位+尺码图一键读取）。当需要服装图但记忆里还没有时调用。",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_product_upload",
      description: "让前端显示单图上传框（电商图或饰品用）。当需要产品图/饰品图但记忆里还没有时调用。",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          purpose: { type: "string", enum: ["ecommerce", "jewelry", "model_shot"], description: "这张图的用途" },
        },
        required: ["prompt", "purpose"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_quick_choices",
      description: "让前端显示一组快速选项按钮，用于收集用户的单项选择（如姿势数、横竖比例、佩戴部位）。",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "问题文字" },
          choices: { type: "array", items: { type: "string" }, description: "选项标签数组" },
          key: { type: "string", description: "这个选择对应的字段名，如 poses / ratio / bodyPart" },
        },
        required: ["prompt", "choices", "key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_combo_choices",
      description: "当用户说'做一套'等模糊词时，显示默认物料组合让用户确认或自定义。",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
    },
  },

  // ===== 请求确认类：显示算力消耗，等用户确认 =====
  {
    type: "function",
    function: {
      name: "request_generation",
      description: "在真正花算力生成之前，显示即将执行的操作和算力消耗，让用户确认。必须在任何 run_* 之前调用（run_analyze 除外，它免费）。调用时必须在 run_tool 里写明用户确认后要执行的那个 run_ 工具名。",
      parameters: {
        type: "object",
        properties: {
          run_tool: { type: "string", description: "用户确认后要执行的 run_ 工具名，必须是以下之一：run_garment / run_ecommerce / run_model_shot / run_jewelry / run_model_profile", enum: ["run_garment","run_ecommerce","run_model_shot","run_jewelry","run_model_profile"] },
          summary: { type: "string", description: "一句话说明将生成什么" },
          credits: { type: "number", description: "预计算力消耗" },
        },
        required: ["run_tool", "summary", "credits"],
      },
    },
  },

  // ===== 执行类：内部直调 ③ 的函数 =====
  {
    type: "function",
    function: {
      name: "run_analyze",
      description: "分析产品图，产出中文卖点和标题。免费，可直接调用无需 request。产品图从记忆里取。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "run_ecommerce",
      description: "生成电商图。产品图从记忆取。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          subtype: { type: "string", description: "电商图子类型，如 主图/场景图/白底图" },
          count: { type: "number", description: "生成张数，默认2" },
          ratio: { type: "string", enum: ["1:1", "3:4", "4:5", "9:16", "16:9"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_model_shot",
      description: "生成模特手持/展示非服装产品的图。模特和产品图从记忆取。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          framing: { type: "string", description: "构图，如 半身/全身/特写" },
          count: { type: "number" },
          ratio: { type: "string", enum: ["1:1", "3:4", "4:5", "9:16", "16:9"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_garment",
      description: "生成服装三联棚拍图。模特、服装图、尺码从记忆取。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          poses: { type: "number", description: "姿势数 1-4，默认3" },
          lowerMode: { type: "string", enum: ["neutral", "half"], description: "下身处理：neutral智能搭配 / half半身" },
          useTrend: { type: "boolean", description: "是否融入当季潮流，默认false" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_garment_scene",
      description: "对已生成的某张棚拍图加品牌场景+去AI感+修细节。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          panelIndex: { type: "number", description: "对哪张棚拍图加工（0-based，从记忆里已生成的棚拍图中选）" },
          ratio: { type: "string", enum: ["1:1", "3:4", "4:5", "9:16", "16:9"] },
        },
        required: ["panelIndex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_garment_poster",
      description: "对已生成的某张图加电商海报文案。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          panelIndex: { type: "number" },
          productInfo: { type: "string", description: "海报文案素材/卖点" },
          ratio: { type: "string", enum: ["1:1", "3:4", "4:5", "9:16", "16:9"] },
        },
        required: ["panelIndex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_jewelry",
      description: "生成饰品上身图。饰品图、部位、尺寸从记忆取。用户确认后调用。",
      parameters: {
        type: "object",
        properties: {
          partKey: { type: "string", description: "佩戴部位，如 ear/neck/wrist/finger" },
          customPart: { type: "string", description: "自定义部位描述" },
          count: { type: "number" },
          ratio: { type: "string", enum: ["1:1", "3:4", "4:5", "9:16", "16:9"] },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_model_profile",
      description: "生成模特三视图。性别、身材尺寸、特征从记忆里的 profile 取。用户确认后调用。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  {
    type: "function",
    function: {
      name: "run_edit_image",
      description: "对话式修改最近生成的图。用户对已生成的图不满意并说出具体要改什么时调用（如'扣子不对，改成单颗''背景太亮''logo应该在左胸'）。会拿当前图 + 用户的修改要求 + 服装细节图重绘。免确认（不用先 request）。",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "用户要改什么，翻译成清晰的修改指令（中文即可），如：扣子改为单颗金色小扣；logo只保留左胸一个；背景调暗" },
          imageIndex: { type: "number", description: "改第几张图（0-based）。用户没指明就不传，默认最近一张" },
        },
        required: ["instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_regenerate",
      description: "重新生成。用户对结果整体不满意、想再来一次时调用（如'再生成一次''换个感觉再来''重新做'）。用记忆里已有的全部输入直接重跑，不需要重新收集任何东西。免确认。",
      parameters: {
        type: "object",
        properties: {
          hint: { type: "string", description: "用户对新一次生成的额外期望（可选），如'姿势更动感''换个氛围'" },
        },
        required: [],
      },
    },
  },

  // ===== 记忆类：静默 =====
  {
    type: "function",
    function: {
      name: "run_read_sizechart",
      description: "读取用户上传的尺码图。尺码图从记忆取。读完自动匹配推荐码。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ─────────────────────────────────────────────────────────────
// OpenAI chat/completions with function calling (gpt-5.4-mini)
// ─────────────────────────────────────────────────────────────

// ── ①b: agent 对话内 run_* 的计费(reserve 前置 + finalize 收尾)──
// user_id 由 studio-proxy 转发时注入 session._userId;价目用本地权威 COST 表。
var STUDIO_FN_BASE = process.env.STUDIO_BILLING_FN || "";
async function reserveForTool(session, tool) {
  var userId = session && session._userId;
  var amount = COST[tool];
  if (!userId || !amount) return null;
  try {
    var r = await fetch(STUDIO_FN_BASE + "/reserve-studio-job", { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ user_id: userId, engine: tool, amount: amount }) });
    var j = await r.json();
    if (!j || !j.ok) { var e = new Error(j && j.reason === "insufficient_credits" ? "算力不足" : "计费预留失败"); e._insufficient = (j && j.reason === "insufficient_credits"); e._balance = j && j.balance; throw e; }
    return j.job_id;
  } catch (e) { if (e._insufficient) throw e; console.error("[billing] reserve 失败:", e.message); return null; }
}
async function settleForTool(billingJobId, ok) {
  if (!billingJobId) return;
  try {
    await fetch(STUDIO_FN_BASE + "/settle-studio-job", { method: "POST",
      headers: { "Content-Type": "application/json", "x-vps-secret": process.env.VPS_SHARED_SECRET },
      body: JSON.stringify({ billing_job_id: billingJobId, outcome: ok ? "ready" : "failed" }) });
  } catch (e) { console.error("[billing] settle 失败(cron 兜底):", e.message); }
}

async function callLLM(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const body = {
    model: "gpt-5.4-mini",
    messages,
    tools: TOOLS,
    tool_choice: "auto",
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error("LLM " + resp.status + ": " + text.slice(0, 400));
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────
// TOOL DISPATCH — 交互类返回 block；执行类内部直调 ③ 函数
// session.memory 累积输入；session.brief 是品牌 brief（前端传入）
// ─────────────────────────────────────────────────────────────
async function dispatchTool(name, args, session, onProgress) {
  const mem = session.memory;
  const brief = session.brief;

  switch (name) {
    // ===== 交互类：返回 block 让前端渲染，不执行生成 =====
    case "show_model_picker":
      return { block: { type: "model_picker", prompt: args.prompt } };
    case "show_garment_upload":
      return { block: { type: "garment_upload", prompt: args.prompt } };
    case "show_product_upload":
      return { block: { type: "product_upload", prompt: args.prompt, purpose: args.purpose } };
    case "show_quick_choices":
      return { block: { type: "quick_choices", prompt: args.prompt, choices: args.choices, key: args.key } };
    case "show_combo_choices":
      return {
        block: {
          type: "combo_choices",
          prompt: args.prompt,
          default_combo: ["3张服装商拍", "1张电商海报", "详情页文案"],
        },
      };
    case "request_generation":
      // 方案B：把"用户确认后要执行什么"存进 memory，确认卡带可执行标记
      mem.pending_action = { tool: args.run_tool || null };
      return { block: { type: "confirm_card", run_tool: args.run_tool, summary: args.summary, credits: (COST[args.run_tool] || args.credits || 12), executable: true } };

    // ===== 执行类：内部直调 =====
    case "run_analyze": {
      if (!mem.product || !mem.product.image) throw new Error("记忆里没有产品图");
      const out = await analyzeProductImage({ productImageBase64: mem.product.image });
      mem.product.info = out.productInfo;
      return { block: { type: "text_result", label: "卖点文案", text: out.productInfo } };
    }

    case "run_read_sizechart": {
      if (!mem.size_chart_image) throw new Error("记忆里没有尺码图");
      const chart = await readSizeChart({ sizeChartImageBase64: mem.size_chart_image });
      mem.size_chart = chart;
      // 若已选模特，自动匹配码
      let sizeMsg = "已读取尺码表（" + chart.rows.length + " 个码）";
      if (mem.picked_model && mem.picked_model.measurements) {
        const sug = suggestSize({ chart, model: mem.picked_model.measurements });
        mem.recommended_size = sug.recommended_size;
        mem.size_dims = sug.recommended_row;
        sizeMsg += "，推荐 " + sug.recommended_size + " 码（" + sug.reason + "）";
      }
      return { block: { type: "text_result", label: "尺码", text: sizeMsg } };
    }

    case "run_ecommerce": {
      if (!mem.product || !mem.product.image) throw new Error("记忆里没有产品图");
      onProgress && onProgress("生成电商图中…");
      const out = await renderEcommercePoster({
        brief,
        subtype: args.subtype || "主图",
        ratio: args.ratio || "1:1",
        productInfo: mem.product.info || "",
        productImageBase64: mem.product.image,
        count: args.count || 2,
      });
      pushAssets(mem, "ecommerce", out.images);
      return { block: { type: "image_result", label: "电商图", urls: out.images } };
    }

    case "run_model_shot": {
      if (!mem.picked_model) throw new Error("记忆里没有选定模特");
      if (!mem.product || !mem.product.image) throw new Error("记忆里没有产品图");
      onProgress && onProgress("生成模特图中…");
      const out = await renderModelShot({
        brief,
        modelRefBase64: mem.picked_model.refBase64,
        productImageBase64: mem.product.image,
        framing: args.framing || "全身",
        ratio: args.ratio || "3:4",
        productInfo: mem.product.info || "",
        dims: mem.product.dims || {},
        count: args.count || 2,
      });
      pushAssets(mem, "model_shot", out.images);
      return { block: { type: "image_result", label: "模特图", urls: out.images } };
    }

    case "run_garment": {
      if (!mem.picked_model) throw new Error("记忆里没有选定模特");
      if (!mem.garment || !mem.garment.image) throw new Error("记忆里没有服装图");
      onProgress && onProgress(L(session, "造型决策 → 生成模特姿势 → 试穿 → 裁切（约 3-5 分钟）…", "Styling, poses, try-on, crop (3-5 min)…"));
      const dims = mem.size_dims || mem.garment.dims || {};
      const out = await stageBase({
        brief,
        identityImage: mem.picked_model.refBase64,
        garments: [{
          image: mem.garment.image,
          detailImages: mem.garment.detailImages || [],
          slot: mem.garment.slot || "top",
          dims,
        }],
        detailImages: mem.garment.detailImages || [],
        poses: args.poses || 3,
        lowerMode: args.lowerMode || "neutral",
        resolution: "2k",
        useTrend: !!args.useTrend,
      });
      mem.garment_panels = out.panels; // 存棚拍图供后续 scene/poster
      // 方案B：棚拍图是预览，不是成品。返回棚拍图 + 精修引导，让用户继续跑 stageScene
      return {
        blocks: [
          { type: "image_result", label: L(session, "棚拍预览（未精修）", "Studio preview (not refined)"), urls: out.panels },
          { type: "refine_prompt",
            panels: out.panels,
            note: L(session, "这是棚拍预览。精修会做三件事：① 修正 logo、扣子等细节，让它们匹配你上传的细节图；② 去除 AI 感，还原真实拍摄质感；③ 加入品牌场景氛围。选择你满意的一张来精修成最终成片。", "This is a studio preview. Refining does three things: 1) corrects logo, buttons and details to match your close-ups; 2) removes the AI look for a real-photo finish; 3) adds brand scene atmosphere. Pick the panel you like to refine into the final shot.") },
        ],
        extra: out.styling ? { styling: out.styling } : null,
      };
    }

    case "run_garment_scene": {
      const panels = mem.garment_panels || [];
      const panel = panels[args.panelIndex];
      if (!panel) throw new Error("记忆里没有第 " + args.panelIndex + " 张棚拍图");
      onProgress && onProgress(L(session, "加场景 + 去AI感 + 修细节中…", "Adding scene, removing AI look, fixing details…"));
      const out = await stageScene({
        brief,
        panelImage: panel,
        identityImage: mem.picked_model ? mem.picked_model.refBase64 : undefined,
        detailImages: mem.garment ? (mem.garment.detailImages || []) : [],
        ratio: args.ratio || "3:4",
      });
      pushAssets(mem, "garment_scene", [out.url]);
      return { block: { type: "image_result", label: "场景成片", urls: [out.url] } };
    }

    case "run_garment_poster": {
      const panels = mem.garment_panels || [];
      const panel = panels[args.panelIndex];
      if (!panel) throw new Error("记忆里没有第 " + args.panelIndex + " 张棚拍图");
      onProgress && onProgress("生成海报中…");
      const out = await stagePoster({
        brief,
        panelImage: panel,
        identityImage: mem.picked_model ? mem.picked_model.refBase64 : undefined,
        detailImages: mem.garment ? (mem.garment.detailImages || []) : [],
        productInfo: args.productInfo || (mem.product ? mem.product.info : "") || "",
        ratio: args.ratio || "3:4",
      });
      pushAssets(mem, "garment_poster", [out.url]);
      return { block: { type: "image_result", label: "海报成片", urls: [out.url] } };
    }

    case "run_jewelry": {
      if (!mem.product || !mem.product.image) throw new Error("记忆里没有饰品图");
      onProgress && onProgress("生成饰品上身图中…");
      const out = await renderJewelryShot({
        brief,
        productImageBase64: mem.product.image,
        modelRefBase64: mem.picked_model ? mem.picked_model.refBase64 : undefined,
        partKey: args.partKey,
        customPart: args.customPart,
        dims: mem.product.dims || {},
        ratio: args.ratio || "3:4",
        productInfo: mem.product.info || "",
        count: args.count || 2,
      });
      pushAssets(mem, "jewelry", out.images);
      return { block: { type: "image_result", label: "饰品上身图", urls: out.images } };
    }

    case "run_edit_image": {
      // 对话式改图：拿最近生成的图 + 用户指令 + 细节图，callEdits 重绘
      const assets = mem.generated_assets || [];
      let targetUrl = null;
      // 收集所有已生成图（含棚拍图），按时间序
      const allImages = [];
      if (mem.garment_panels) for (const p of mem.garment_panels) allImages.push(p);
      for (const a of assets) for (const u of (a.urls || [])) allImages.push(u);
      if (!allImages.length) throw new Error("还没有生成过图，无法修改");
      const idx = (args.imageIndex !== undefined && args.imageIndex !== null) ? args.imageIndex : allImages.length - 1;
      targetUrl = allImages[idx] || allImages[allImages.length - 1];
      onProgress && onProgress(L(session, "按你的要求修改图片中…", "Editing the image as requested…"));
      const { bufferFromUrl, bufferFromBase64 } = require("./imageEdit");
      const imgBuf = /^https?:/i.test(targetUrl) ? await bufferFromUrl(targetUrl) : bufferFromBase64(targetUrl);
      const editRefs = [imgBuf];
      // 细节图作参考（修扣子/logo时关键）
      const dImgs = (mem.garment && mem.garment.detailImages) || [];
      for (const di of dImgs.slice(0, 2)) {
        editRefs.push(/^https?:/i.test(di) ? await bufferFromUrl(di) : bufferFromBase64(di));
      }
      const editPrompt = [
        "Edit the FIRST reference image according to this instruction, changing ONLY what is asked and preserving everything else exactly (model face, body, pose, garment fit, background unless asked):",
        "INSTRUCTION: " + args.instruction,
        dImgs.length ? "Additional close-up reference images show the REAL garment details (buttons, logo, embroidery) — corrections must match these real details faithfully." : "",
        "Photorealistic result, no AI look.",
      ].filter(Boolean).join("\n");
      const { generateToFile } = require("./imageEdit");
      const editOut = await generateToFile({ prompt: editPrompt, refs: editRefs, size: "1024x1536", prefix: "edit" });
      pushAssets(mem, "edit", [editOut.url]);
      return { block: { type: "image_result", label: L(session, "修改后", "Edited"), urls: [editOut.url], credits: COST.edit } };
    }

    case "run_regenerate": {
      // 重生成：用现有 memory 直接重跑对应功能，不重新收集
      if (mem.garment && mem.garment.image && mem.picked_model) {
        onProgress && onProgress(L(session, "用已有信息重新生成中（约 3-5 分钟）…", "Regenerating from what we have (3-5 min)…"));
        const dims2 = mem.size_dims || mem.garment.dims || {};
        const out2 = await stageBase({
          brief,
          identityImage: mem.picked_model.refBase64,
          garments: [{ image: mem.garment.image, detailImages: mem.garment.detailImages || [], slot: mem.garment.slot || "top", dims: dims2 }],
          detailImages: mem.garment.detailImages || [],
          poses: 3, lowerMode: "neutral", resolution: "2k", useTrend: false,
        });
        mem.garment_panels = out2.panels;
        return {
          blocks: [
            { type: "image_result", label: L(session, "重新生成 · 棚拍预览", "Regenerated - studio preview"), urls: out2.panels, credits: COST.regenerate_garment },
            { type: "refine_prompt", panels: out2.panels, note: L(session, "新一批棚拍预览。选择满意的一张精修（修正细节 + 去AI感 + 加场景）。", "A new set of studio previews. Pick one to refine (fix details, remove AI look, add scene).") },
          ],
        };
      }
      if (mem.product && mem.product.image) {
        onProgress && onProgress(L(session, "重新生成电商图中…", "Regenerating e-commerce shots…"));
        const out3 = await renderEcommercePoster({ brief, subtype: "主图", ratio: "1:1", productInfo: mem.product.info || "", productImageBase64: mem.product.image, count: 2 });
        pushAssets(mem, "ecommerce", out3.images);
        return { block: { type: "image_result", label: "重新生成", urls: out3.images, credits: COST.regenerate_ecom } };
      }
      throw new Error("记忆里没有可重新生成的任务输入");
    }

    case "run_model_profile": {
      if (!mem.profile) throw new Error("记忆里没有模特设定");
      onProgress && onProgress("生成模特三视图（约 2-3 分钟）…");
      const out = await renderModelSheet({ profile: mem.profile, brief });
      mem.generated_model_sheet = out.sheetUrl;
      return { block: { type: "image_result", label: "模特三视图", urls: [out.sheetUrl] } };
    }

    default:
      throw new Error("未知工具: " + name);
  }
}

function pushAssets(mem, type, urls) {
  mem.generated_assets = mem.generated_assets || [];
  mem.generated_assets.push({ type, urls, ts: Date.now() });
}

// ─────────────────────────────────────────────────────────────
// runAgentTurn — 一轮对话：组 prompt → 调 LLM → 执行 tool → 返回
// 支持一轮多个 tool call（如"做一套"串行执行多个 run_*）
// ─────────────────────────────────────────────────────────────
// 给 history 用的工具结果摘要：让下一轮 LLM 知道上一轮工具做了什么，避免重复调用
function summarizeToolResult(name, block) {
  if (!block) return "done";
  switch (block.type) {
    case "model_picker": return "已向用户显示模特选择器（等待用户选择）";
    case "garment_upload": return "已向用户显示服装上传区（等待用户上传）";
    case "product_upload": return "已向用户显示图片上传框（等待用户上传）";
    case "quick_choices": return "已向用户显示选项（等待用户选择）";
    case "combo_choices": return "已向用户显示套餐组合选择（等待用户确认）";
    case "confirm_card": return "已向用户显示算力确认卡（等待用户点确认）。下一步用户确认后应直接执行 run_*，不要再弹确认卡。";
    case "refine_prompt": return "已生成棚拍预览并向用户显示精修引导（等待用户选择哪张精修）。用户选择后调 run_garment_scene 对那张跑精修。";
    case "image_result": return "已生成图片展示给用户。";
    case "image_result": return "已生成图片并展示给用户：" + (block.label || "");
    case "text_result": return "已生成文字结果：" + (block.label || "");
    case "error": return "出错：" + (block.text || "");
    default: return "done";
  }
}

// 安全裁剪 history：保留最近 maxTurns 条，但绝不让开头是孤立的 tool 消息
// （OpenAI 要求 assistant.tool_calls 后必须紧跟 tool 消息；从中间切断会 400）
function safeHistorySlice(history, maxCount) {
  if (!history || history.length <= maxCount) return history || [];
  let start = history.length - maxCount;
  // 如果起点落在 tool 消息上，或落在"被切掉 tool_calls 的 assistant"之后的 tool 上，
  // 往前挪到一个干净的边界（user 或 不带 tool_calls 的 assistant）
  while (start > 0) {
    const m = history[start];
    if (m.role === "tool") { start--; continue; }              // 孤立 tool，往前带
    if (m.role === "assistant" && m.tool_calls) { break; }      // assistant+tool_calls 是完整轮开头，OK
    if (m.role === "user") { break; }                            // user 是干净边界
    start--;
  }
  return history.slice(start);
}

async function runAgentTurn(session, userMessage, onProgress) {
  const mem = session.memory;

  // ★★★ 精修：refine_panel_index 直接执行 run_garment_scene（绕过 LLM）★★★
  if (session._refinePanelIndex !== undefined && session._refinePanelIndex !== null) {
    const idx = session._refinePanelIndex;
    session._refinePanelIndex = null;
    console.log("[AGENT] 精修直接执行 run_garment_scene, panelIndex=", idx);
    const blocks = [];
    try {
      const result = await dispatchTool("run_garment_scene", { panelIndex: idx }, session, onProgress);
      if (result && result.blocks && result.blocks.length) { for (const b of result.blocks) blocks.push(b); }
      else if (result && result.block) blocks.push(result.block);
    } catch (e) {
      blocks.push({ type: "error", text: "精修失败：" + (e && e.message) });
    }
    session.history.push({ role: "user", content: "（精修第 " + (idx+1) + " 张）" });
    return { reply: "", blocks: blocks };
  }

  // ★★★ 方案B：execute_pending 直接执行（绕过 LLM）★★★
  // 前端点"确认生成"按钮时发 inputs.execute_pending=true，这里直接执行 pending_action，
  // 不经过 LLM 判断，从根本上杜绝"反复弹确认卡"。打字说"确认"不走这里（走正常 LLM）。
  if (session._executePending && mem.pending_action && mem.pending_action.tool) {
    session._executePending = false;
    const tool = mem.pending_action.tool;
    mem.pending_action = null;
    console.log("[AGENT] execute_pending 直接执行:", tool);
    const blocks = [];
    let _billingJob = null;
    try {
      _billingJob = await reserveForTool(session, tool);
    } catch (e) {
      blocks.push({ type: "error", text: e._insufficient ? ("算力不足，无法执行。当前余额 " + (e._balance != null ? e._balance : "?")) : "计费预留失败，请重试" });
      session.history.push({ role: "user", content: "（确认生成）" });
      return { reply: "", blocks: blocks };
    }
    try {
      const result = await dispatchTool(tool, {}, session, onProgress);
      if (result && result.blocks && result.blocks.length) { for (const b of result.blocks) blocks.push(b); }
      else if (result && result.block) blocks.push(result.block);
      await settleForTool(_billingJob, true);
    } catch (e) {
      await settleForTool(_billingJob, false);
      blocks.push({ type: "error", text: (tool + " 失败：" + (e && e.message)) });
    }
    // 存进 history（用户的确认动作 + 执行结果）
    session.history.push({ role: "user", content: "（确认生成）" });
    return { reply: "", blocks: blocks };
  }

  // 构建 memory 上下文（让 LLM 知道已经有什么）
  const memFacts = [];
  if (mem.picked_model) memFacts.push("已选模特：" + (mem.picked_model.name || "未命名") + (mem.picked_model.measurements ? "（身高" + mem.picked_model.measurements.height_cm + "cm）" : ""));
  if (mem.garment && mem.garment.image) memFacts.push("已上传服装图（品类：" + (mem.garment.slot || "上衣") + "）");
  if (mem.product && mem.product.image) memFacts.push("已上传产品图");
  if (mem.product && mem.product.info) memFacts.push("已有卖点文案");
  if (mem.size_chart) memFacts.push("已读尺码表" + (mem.recommended_size ? "，推荐 " + mem.recommended_size + " 码" : ""));
  if (mem.size_chart_image && !mem.size_chart) memFacts.push("用户刚上传了尺码图（还没读取）");
  if (mem.generated_model_sheet) memFacts.push("已生成模特三视图");
  if (mem.garment_panels && mem.garment_panels.length) memFacts.push("已生成 " + mem.garment_panels.length + " 张服装棚拍图");
  if (mem.combo_plan) memFacts.push("用户选定的一套组合：" + mem.combo_plan.join("、"));
  const memContext = memFacts.length
    ? "\n\n## 当前记忆（已收集的输入，不要重复索要）\n" + memFacts.map(f => "- " + f).join("\n")
    : "\n\n## 当前记忆\n（还没有收集任何输入）";

  const messages = [
    { role: "system", content: SYSTEM_PROMPT + memContext },
    ...safeHistorySlice(session.history, 16), // 保留最近若干条（不切断 tool 配对）
    { role: "user", content: userMessage },
  ];

  const data = await callLLM(messages);
  const choice = data.choices && data.choices[0];
  const msg = choice && choice.message;
  if (!msg) throw new Error("LLM 无响应");

  const replyText = msg.content || "";
  const blocks = [];
  const toolCalls = msg.tool_calls || [];
  console.log("[AGENT] user said:", JSON.stringify(userMessage).slice(0,80), "| LLM reply:", JSON.stringify(replyText).slice(0,60), "| tools:", toolCalls.map(function(t){return t.function.name;}).join(",") || "(none)");
  console.log("[AGENT] history len:", session.history.length, "| memory keys:", Object.keys(session.memory||{}).join(","));

  // 先把用户消息存进 history
  session.history.push({ role: "user", content: userMessage });

  // 执行所有 tool call（可能多个：如做一套串行）
  const toolResultsForHistory = [];
  for (const tc of toolCalls) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch (e) { args = {}; }
    let resultSummary = "";
    try {
      const result = await dispatchTool(tc.function.name, args, session, onProgress);
      if (result && result.blocks && result.blocks.length) {
        // 支持一个工具返回多个 block（如棚拍图 + 精修引导）
        for (const b of result.blocks) blocks.push(b);
        resultSummary = summarizeToolResult(tc.function.name, result.blocks[0]);
      } else if (result && result.block) {
        blocks.push(result.block);
        resultSummary = summarizeToolResult(tc.function.name, result.block);
      } else {
        resultSummary = "done";
      }
    } catch (e) {
      blocks.push({ type: "error", text: (tc.function.name + " 失败：" + (e && e.message)) });
      resultSummary = "error: " + (e && e.message);
    }
    toolResultsForHistory.push({ id: tc.id, name: tc.function.name, summary: resultSummary });
  }

  // ★ 关键修复：把 assistant 这一轮的完整动作存进 history（含 tool_calls），
  //   否则下一轮 LLM 看不到自己调过什么工具 → 会反复弹确认卡等（agent 失忆 bug）。
  if (toolCalls.length > 0) {
    // assistant 消息带 tool_calls（OpenAI 标准格式）
    session.history.push({
      role: "assistant",
      content: replyText || null,
      tool_calls: toolCalls.map(function (tc) {
        return { id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } };
      }),
    });
    // 每个 tool_call 对应一条 tool 结果消息（OpenAI 要求 tool_calls 后必须跟 tool 消息）
    for (const tr of toolResultsForHistory) {
      session.history.push({ role: "tool", tool_call_id: tr.id, content: tr.summary });
    }
  } else if (replyText && replyText.trim()) {
    // 纯文字回复
    session.history.push({ role: "assistant", content: replyText.trim() });
  }

  return { reply: replyText, blocks };
}

module.exports = { runAgentTurn, dispatchTool, SYSTEM_PROMPT, TOOLS };
