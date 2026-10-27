// room/modelRender.js — generate a brand model "three-view reference sheet"
// (front / side / back of the SAME person, side by side, one image) sized from
// the user-supplied real measurements + brand aesthetic. This sheet is the
// model's identity anchor; later model shots reference it.
// De-AI: direct on-camera flash + real skin texture kills the "anime/CGI perfect face" look.
const { generateFromText } = require("./imageEdit");

// 选项 → prompt 英文描述映射。前端传来的 traits 拼成 prompt 段落。
function buildModelTraits(t) {
  t = t || {};
  const parts = [];

  // 族裔
  const ETH = {
    east_asian: "East Asian", southeast_asian: "Southeast Asian", south_asian: "South Asian",
    white: "White / Caucasian", black: "Black / African", latino: "Latino / Hispanic",
    middle_eastern: "Middle Eastern", mixed: "mixed-race",
  };
  if (t.ethnicity && ETH[t.ethnicity]) parts.push(ETH[t.ethnicity] + " ethnicity");

  // 肤色（不选则跟族裔走，不强加）
  const SKIN = { fair: "fair skin tone", medium: "medium skin tone", deep: "deep skin tone" };
  if (t.skin && SKIN[t.skin]) parts.push(SKIN[t.skin]);

  // 发型 + 发色
  const HAIR = {
    short_straight: "short straight hair", short_curly: "short curly hair",
    medium_straight: "medium-length straight hair", medium_curly: "medium-length curly hair",
    long_straight: "long straight hair", long_curly: "long curly hair",
  };
  const HAIRCOLOR = { black: "black", brown: "brown", blonde: "blonde", grey: "grey", dyed: "fashionably dyed" };
  let hair = "";
  if (t.hair && HAIR[t.hair]) hair = HAIR[t.hair];
  if (t.hair_color && HAIRCOLOR[t.hair_color]) hair = (HAIRCOLOR[t.hair_color] + " " + (hair || "hair")).trim();
  if (hair) parts.push(hair);

  // 体型
  const BUILD = {
    slim: "slim, lean build", standard: "average athletic build",
    muscular: "muscular, athletic build", fuller: "fuller, curvier build",
  };
  if (t.build && BUILD[t.build]) parts.push(BUILD[t.build]);

  // 脸型
  const FACE = { round: "round face shape", square: "square face shape", oval: "oval face shape", long: "long face shape" };
  if (t.face_shape && FACE[t.face_shape]) parts.push(FACE[t.face_shape]);

  // 骨相
  const BONE = { soft: "soft, gentle bone structure", strong: "strong, defined bone structure with an angular jawline" };
  if (t.bone && BONE[t.bone]) parts.push(BONE[t.bone]);

  // 气质（影响神态）
  const VIBE = {
    aloof: "an aloof, cool, editorial expression", approachable: "a warm, approachable expression",
    sensual: "a sultry, sensual expression", artsy: "an artistic, soulful expression",
    sporty: "an energetic, sporty demeanour", business: "a composed, professional demeanour",
  };
  if (t.vibe && VIBE[t.vibe]) parts.push(VIBE[t.vibe]);

  // 年龄段
  const AGE = { young: "in their early-to-mid 20s", mature: "in their 30s-40s, mature" };
  if (t.age && AGE[t.age]) parts.push(AGE[t.age]);

  return parts;
}

// target_age_range → 模特年龄描述（带防老气锚）
function ageLineForModel(range) {
  if (!range) return "";
  const map = {
    "18-25": "The model should look like a young adult in their early 20s — fresh, current, youthful.",
    "25-35": "The model should look late-20s to early-30s — refined and contemporary.",
    "35-45": "The model should look late-30s to mid-40s — mature with quiet, elegant confidence.",
    "45+": "The model should look 45 or older — elegant, self-assured, gracefully mature.",
  };
  const line = map[range] || "";
  if (!line) return "";
  return line + " IMPORTANT: regardless of age, the model must look modern, high-end and editorial. A mature age means refined, sophisticated and current — NEVER dated, frumpy, dowdy or unflatteringly aged. Keep it aspirational and premium.";
}

function buildModelSheetPrompt({ gender, height_cm, bust_cm, waist_cm, hip_cm, shoulder_cm, traits, brief }) {
  const g = gender === "male" ? "male" : "female";
  const m = ["height " + height_cm + "cm"];
  if (bust_cm) m.push("bust " + bust_cm + "cm");
  if (waist_cm) m.push("waist " + waist_cm + "cm");
  if (hip_cm) m.push("hips " + hip_cm + "cm");
  if (shoulder_cm) m.push("shoulder width " + shoulder_cm + "cm");
  const measures = m.join(", ");
  const a = (brief && brief.aesthetic) || {};

  const traitList = buildModelTraits(traits);
  const traitLine = traitList.length
    ? "The model has these specific characteristics: " + traitList.join(", ") + "."
    : "";

  return [
    "Create ONE high-resolution fashion MODEL REFERENCE SHEET: the SAME " + g + " model shown in THREE full-body views side by side, left to right — FRONT view, SIDE (profile) view, BACK view — evenly spaced on a plain seamless neutral-grey studio background.",
    "CRITICAL: it must be the IDENTICAL person in all three views — same face, same hairstyle, same skin tone, same body, same proportions. This is a turnaround of one model, not three different people.",
    "This is a professional, non-sexual fashion model reference sheet for garment fitting, comparable to a standard e-commerce model turnaround. The model is fully and tastefully clothed.",
    "FACIAL EXPRESSION — the model must have a compelling, professional editorial expression, NOT a blank, dull, vacant or lifeless stare. Choose ONE of: a classic composed high-fashion serious look with intensity in the eyes and a relaxed strong jaw, OR a subtle micro-expression (a faint knowing look, softly parted lips, a hint of attitude). The eyes must look alive and engaged with a clear focal point, as in a real professional model's headshot. Avoid the empty 'dead-eyed' AI look. Keep the same expression consistent across all three views.",
    traitLine,
    ageLineForModel((brief && brief.target_age_range) || null),
    "The body MUST reflect these real measurements (do NOT idealize away from them): " + measures + ".",
    "Standing straight in a neutral A-pose, arms slightly away from the body, wearing MODEST but form-fitting neutral athletic wear that FULLY covers the torso and legs — specifically a fitted long-sleeve or short-sleeve athletic top plus fitted full-length leggings — so the true body shape and proportions are clearly readable for garment fitting while keeping the model tastefully and fully covered (this is a professional fashion reference sheet).",
    "Model styling and mood fit this brand — density: " + a.density + "; colour temperature: " + a.color_temperature + "; expression: " + a.expression + ".",
    // ===== 去 AI 味：核心改动 =====
    "CRITICAL PHOTOGRAPHIC REALISM — this must look like a REAL PHOTOGRAPH of a real human shot on a professional camera, NOT a polished CGI render or an AI image. Use DIRECT ON-CAMERA FLASH lighting (like a real fashion lookbook / e-comm turnaround shot), which produces slightly flat, even, true-to-life illumination. Render REAL human skin with visible texture, pores, subtle imperfections, natural skin unevenness and slight asymmetry. The face must NOT be airbrushed, smoothed, idealized, doll-like or anime-like. Avoid soft glamour lighting, avoid the over-smooth flawless 'AI beauty' look entirely.",
    "Shot on a full-frame camera, realistic depth and skin detail. No text, no labels, no props, no measurement annotations.",
  ].filter(Boolean).join("\n");
}

async function renderModelSheet({ profile, brief }) {
  const prompt = buildModelSheetPrompt({
    gender: profile.gender, height_cm: profile.height_cm, bust_cm: profile.bust_cm,
    waist_cm: profile.waist_cm, hip_cm: profile.hip_cm, shoulder_cm: profile.shoulder_cm,
    traits: profile.traits, brief: brief,
  });
  const r = await generateFromText({ prompt: prompt, size: "1536x1024", prefix: "model" });
  return { sheetUrl: r.url, prompt: prompt };
}

module.exports = { renderModelSheet, buildModelSheetPrompt, buildModelTraits };
