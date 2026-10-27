// ============================================================
// cinematic.js — Corvo 电影感/真实感审美 skill（单一来源）
// 规则改这里 = 全链生效。禁止在任何消费者里复制粘贴本文件文本。
// render 消费者(直接进模型 prompt): bb_render(full) / seedance(oneLine) / storyboardRender(panel)
// agent 消费者(只进 system 层塑造写作): director·cinematographer(forAgents)
// ============================================================

const VERSION = '1.2';

// 正向哨兵：render 最终 prompt 必须包含，否则注入未发生
const SENTINEL = 'real pores';        // oneLine + panel（含皮肤的视图）
const SENTINEL_ANCHOR = 'CINEMATIC REALISM'; // full（anchor 无人，用这个校验）

// 反向哨兵：agent 原始输出若命中，说明 agent 抄了 skill 文本而非"学习"
const LEAK_SIGNATURES = [
  'HOW TO THINK LIKE THE DIRECTOR',
  'the render layer owns grade',
  'do not copy any line',
  'real pores',
  'low-saturation'
];

// ---------- 五大支柱（结构化真值） ----------
const PILLARS = [
  { id: 'directional_light', name: '有向光',
    principle: 'Light has direction: one motivated key source, visible falloff, a retained shadow side. Subjects are modeled by light and shadow, never evenly lit.',
    positive: ['single motivated key light', 'soft rim or hair light', 'visible falloff', 'retained shadow side'],
    negative: ['flat even lighting', 'shadowless illumination'], appliesTo: 'all' },
  { id: 'true_skin', name: '真实皮肤',
    principle: 'Where faces or skin appear: raw unretouched skin, visible pores, faint freckles, natural uneven tone. Never smoothed, never beautified.',
    positive: ['visible pores', 'faint freckles', 'natural uneven skin tone'],
    negative: ['airbrushed skin', 'beauty-filter smoothness', 'porcelain complexion'], appliesTo: 'faces_only' },
  { id: 'restrained_grade', name: '克制调色',
    principle: 'Muted, low-saturation grade with soft contrast and gently lifted blacks. Cinematic quality comes from subtraction, not enhancement.',
    positive: ['muted low-saturation palette', 'soft contrast', 'gently lifted blacks'],
    negative: ['HDR look', 'oversaturation', 'crushed blacks', 'hyper-sharpness'], appliesTo: 'all' },
  { id: 'depth_layering', name: '景深分层',
    principle: 'Three-plane depth: soft out-of-focus foreground occlusion, sharp mid-plane subject, softly blurred background. Photographed, not rendered flat.',
    positive: ['blurred foreground occlusion', 'sharp mid-plane subject', 'soft background bokeh'],
    negative: ['everything-in-focus flatness', 'floating subject on clean backdrop'], appliesTo: 'all' },
  { id: 'film_texture', name: '胶片质感',
    principle: 'Subtle fine film grain and slight optical softness. Digital crispness reads as synthetic.',
    positive: ['fine film grain', 'slight optical softness', 'subtle halation on highlights'],
    negative: ['digital crispness', 'clinical sharpness'], appliesTo: 'all' }
];

// ---------- CAMERA 词库（给 agent 层参考，不整段外泄） ----------
const CAMERA = {
  shotSizes: ['extreme close-up (ECU) for material and texture','close-up (CU) for emotion and detail','medium shot (MS) for gesture and body language','wide shot (WS) for environment and scale'],
  lenses: ['35mm natural perspective for environment','85mm portrait compression with shallow depth of field','macro for product surface detail'],
  angles: ['eye level for intimacy','low angle for stature and presence','top-down for graphic composition'],
  movement: ['locked-off tripod (stillness reads as confidence)','slow dolly push-in','lateral tracking','subtle handheld breathing'],
  movementBans: ['drone swoop','speed ramp','whip pan','constant motion'],
  composition: ['foreground occlusion layering','negative space around subject','rule-of-thirds placement','leading lines toward subject']
};

// ---------- 塑料禁词表（scrub 用） ----------
const BANNED_WORDS = ['4K','8K','HDR','ultra-detailed','ultra detailed','ultra-sharp','ultra sharp','hyper-realistic','hyper realistic','hyper-detailed','broadcast-ready','razor-sharp','crystal clear','vivid colors','highly saturated','maximum detail'];

// ---------- 视图 ----------

// anchor 帧（无人高分辨率 still）：四支柱完整版，不含皮肤（anchor 无人）
function full() {
  const used = PILLARS.filter(p => p.id !== 'true_skin');
  return [
    'CINEMATIC REALISM (this frame sets the photographic baseline for the entire film):',
    ...used.map(p => `- ${p.principle}`),
    `Never: ${used.flatMap(p => p.negative).join(', ')}.`
  ].join('\n');
}

// storyboard 每格（8 格小图）：中等粒度，皮肤条件触发
function panel() {
  return 'Photographic realism in every panel: directional key light with a true shadow side; muted low-saturation grade, soft contrast; layered depth with soft foreground occlusion where natural; fine film grain. Where faces appear: raw unretouched skin, visible pores, never smoothed. Never HDR, oversaturated, or hyper-sharp.';
}

// Seedance（追加到 buildText）：只留 anchor 图承载不了的——皮肤(anchor 无人)+ 反塑料负锚
function oneLine() {
  return 'Skin renders with real pores and fine detail; no HDR, oversaturation or plastic sheen.';
}

// agent 层写作教练（进 director / cinematographer 的 system 层，绝不拼进其输出）
function forAgents() {
  return [
    'HOW TO THINK LIKE THE DIRECTOR (internalize this — it is NOT text to reproduce):',
    'Author each shot with deliberate physical choices, in your own words about THIS product and THIS beat:',
    '  - shot size: texture wants ECU/macro, emotion wants CU, gesture wants MS, scale wants WS',
    '  - lens feel: 85mm compression + shallow DOF for portraiture, macro for surface, 35mm for environment',
    '  - angle: eye level / low / top-down, chosen for the feeling it creates',
    '  - movement: locked-off, slow push-in, lateral track, or subtle handheld — stillness is often the stronger choice. Forbidden: drone swoop, speed ramp, whip pan, constant motion',
    '  - composition: foreground occlusion, negative space, leading lines, thirds',
    '  - light intent: one motivated key with a real shadow side — never flat, even light',
    'The render layer owns grade, grain and skin texture — do NOT describe them; describe the frame.',
    `Forbidden words in anything you write: ${BANNED_WORDS.slice(0, 8).join(', ')} — they force a plastic look.`,
    'TEST BEFORE YOU OUTPUT: if your shot could belong to any film, it failed — make it specific to this exact product and moment. Do not copy any line from this guidance.'
  ].join('\n');
}

// 工具：从任意 prompt 剔除塑料禁词
function scrub(text) {
  if (!text) return text;
  let out = String(text);
  for (const w of BANNED_WORDS) out = out.replace(new RegExp(w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'), '');
  return out.replace(/ {2,}/g, ' ').replace(/ ,/g, ',');
}

// 校验 agent 原始输出——非空即为抄袭泄漏
function detectLeakage(text) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  return LEAK_SIGNATURES.filter(s => t.includes(s.toLowerCase()));
}

// ---------- 启动自证（pm2 日志必须出现这一行） ----------
const wc = s => s.split(/\s+/).filter(Boolean).length;
console.log(`[cinematic-skill] v${VERSION} loaded | full=${wc(full())}w panel=${wc(panel())}w oneLine=${wc(oneLine())}w forAgents=${wc(forAgents())}w`);

module.exports = { VERSION, SENTINEL, SENTINEL_ANCHOR, LEAK_SIGNATURES, PILLARS, CAMERA, BANNED_WORDS, full, panel, oneLine, forAgents, scrub, detectLeakage };
