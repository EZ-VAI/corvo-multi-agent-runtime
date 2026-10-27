/**
 * ENV_MOTION_ANCHOR — per-category environment motion clause for product-only
 * i2v shots. Without this, Kling/Seedance render rigid product categories
 * (handbags, watches, electronics, jewelry) as 5-second frozen photos.
 *
 * Extracted from generate-editorial-clips so brand_film, agent-chat, and any
 * future video-gen function can reuse the same anchors.
 */
export function envMotionAnchor(category?: string, material?: string): string {
  const c = (category || "").toLowerCase();
  const m = (material || "").toLowerCase();
  const hay = `${c} ${m}`;
  // Fragrance / liquid
  if (/(perfume|fragrance|cologne|eau de|scent|spray|mist|serum|oil|tonic|lotion)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): a faint mist of fragrance or fine cool vapor drifts upward across the frame, dust motes float slowly through a soft window-light shaft, and the bottle's specular highlight slowly travels across the glass curve.";
  }
  // Jewelry / watches / metallic / glass / gem
  if (/(jewel|ring|earring|necklace|bracelet|watch|chain|pendant|gem|diamond|gold|silver|metal|chrome|glass)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): the key light slowly ramps in intensity from one side to the other, specular highlights actively travel across each metal/gem facet, and fine dust motes drift through the light. Background gradient breathes from soft warm to soft cool.";
  }
  // Beauty / makeup / skincare jars
  if (/(beauty|makeup|cosmetic|skincare|cream|balm|lipstick|powder|foundation|mascara)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): a fine cosmetic powder or soft shimmer drifts across the frame, the key light slowly ramps from cool to warm, and the product's surface highlight travels visibly across the cap or applicator.";
  }
  // Bags / shoes / leather / fabric / clothing
  if (/(bag|handbag|clutch|tote|backpack|shoe|sneaker|boot|leather|suede|fabric|cloth|silk|wool|cotton|garment|jacket|coat|dress|skirt)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): a length of silk or sheer fabric drifts slowly across the background, soft window light ramps gently across the surface revealing grain and stitching, and dust motes float through the light.";
  }
  // Electronics / tech
  if (/(electronic|phone|earbud|headphone|camera|laptop|speaker|charger|device|tech|gadget)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): cool studio light slowly ramps across the casing surface, a faint reflection of moving light travels across the screen or polished face, and ambient fine dust drifts through the back-light.";
  }
  // Food / beverage
  if (/(food|drink|beverage|coffee|tea|wine|chocolate|snack|bottle|can|cup)/.test(hay)) {
    return "ENVIRONMENT MOTION (must be visible every second): warm steam, condensation droplets, or fine vapor drifts upward, soft warm light ramps across the surface, and the liquid or surface highlight slowly travels.";
  }
  // Generic fallback — never let the shot be static
  return "ENVIRONMENT MOTION (must be visible every second): soft window light slowly ramps across the surface, specular highlights actively travel across the product, fine dust motes drift through the light, and the background gradient breathes subtly from warm to cool. The shot must NEVER read as a frozen photograph.";
}
