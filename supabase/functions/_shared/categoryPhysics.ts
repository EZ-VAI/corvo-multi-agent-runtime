/**
 * Category Physics Lock
 * ─────────────────────
 * Single source of truth for "what physical elements are allowed in the frame
 * for this product type". Replaces ad-hoc per-function jewelry checks.
 *
 * Three tiers:
 *   - DRY          → hard surfaces only. Bans water, fire, smoke, lava, foam,
 *                    melting material, anti-gravity. Used for jewelry, watches,
 *                    electronics, makeup, home decor.
 *   - WET_OK       → product itself is or produces moisture. Allows water /
 *                    mist / droplets WHEN consistent with the product (perfume
 *                    spray, skincare drop, beverage condensation, shampoo
 *                    foam). Still bans submerging, sinks, washing-hands tropes.
 *   - OUTDOOR_OK   → outdoor environments are part of the brief — weather,
 *                    sand, puddles, sweat are fine (apparel, footwear, sports
 *                    gear, accessories).
 *
 * Why this file exists: free-text mood ("molten", "honeyed", "fluid") was
 * being literalized by image models into water / lava / honey drips. The fix
 * is two layers — (1) replace free-text mood with controlled enums in the
 * visual chain, and (2) layer this category lock on top so even hostile
 * prompts can't escape physics.
 */

export type CategoryLock = "DRY" | "WET_OK" | "OUTDOOR_OK";

interface ProductLike {
  productName?: string | null;
  category?: string | null;
  material?: string | null;
  description?: string | null;
}

const HAYSTACK = (p: ProductLike): string =>
  [p.productName, p.category, p.material, p.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const DRY_PATTERNS: RegExp[] = [
  // Jewelry
  /\b(ring|jewel(?:ry|lery)?|bracelet|necklace|earring|pendant|bangle|brooch|cufflink|gem|diamond|sapphire|ruby|emerald|pearl|gold|silver|platinum|titanium)\b/,
  // Watches
  /\b(watch|timepiece|chronograph|wristwatch|smartwatch)\b/,
  // Electronics & 3C
  /\b(phone|smartphone|laptop|tablet|earbud|headphone|earphone|speaker|camera|drone|console|monitor|keyboard|mouse|router|charger|adapter|power bank|usb|hub|electronics?|gadget|device|wearable|fitness tracker)\b/,
  // Makeup (powder, lipstick, mascara — no liquid step)
  /\b(lipstick|lip balm|lip gloss|mascara|eyeliner|eyeshadow|blush|powder|foundation stick|concealer stick|bronzer|highlighter|brow|nail polish|cosmetic compact|palette)\b/,
  // Home decor / hard goods
  /\b(candle|vase|bookend|sculpture|figurine|frame|lamp|chair|stool|table|shelf|tray|coaster|ornament|planter|clock|mirror)\b/,
];

const WET_OK_PATTERNS: RegExp[] = [
  // Perfume / fragrance — allows the spray moment
  /\b(perfume|fragrance|cologne|eau de (?:parfum|toilette|cologne)|edp|edt|edc|scent|atomi[sz]er)\b/,
  // Skincare — drops, mist, water-based product
  /\b(serum|essence|toner|mist|moisturi[sz]er|cream|lotion|oil drop|hyaluronic|hydrating|skincare|cleanser|face wash|exfoliant|sheet mask|sunscreen|spf)\b/,
  // Bath / body — foam, lather
  /\b(shampoo|conditioner|body wash|shower gel|soap bar|hand wash|bubble bath|bath salt|hair oil|hair mist)\b/,
  // Beverage — condensation, pour
  /\b(beer|wine|champagne|cocktail|spirit|whisk(?:e)?y|vodka|gin|rum|tequila|liquor|liqueur|soda|cola|juice|coffee drink|cold brew|kombucha|tea drink|sparkling water|seltzer|beverage|drink|bottle of)\b/,
];

const OUTDOOR_OK_PATTERNS: RegExp[] = [
  // Apparel — clothing, sets, outerwear
  /\b(shirt|t-shirt|tee|blouse|dress|gown|skirt|pant[s]?|trouser[s]?|jean[s]?|short[s]?|jacket|coat|parka|hoodie|sweater|cardigan|knit|jumper|suit|blazer|outfit|set|ensemble|two-piece|three-piece|apparel|clothing|garment|loungewear|sleepwear|activewear|swimwear|bikini|swimsuit|lingerie)\b/,
  // Footwear
  /\b(shoe[s]?|sneaker[s]?|trainer[s]?|boot[s]?|sandal[s]?|heel[s]?|loafer[s]?|moccasin[s]?|slipper[s]?|footwear)\b/,
  // Sports / outdoor gear
  /\b(yoga mat|gym|sport[s]?|running|cycling|surf|skate|snow|ski|hike|hiking|outdoor|backpack|tent|water bottle|trail|fitness)\b/,
  // Accessories often outdoor
  /\b(hat|cap|sunglasses|scarf|gloves|umbrella|tote|crossbody|messenger bag|duffel|luggage|suitcase)\b/,
];

/** Resolve a category lock from product context. Defaults to DRY when unknown
 *  — DRY is the "safest" choice because it strips the highest-risk hallucinations
 *  (water/fire/smoke/anti-gravity) and the cost of a false negative is just a
 *  slightly more conservative scene, not a broken render. */
export function resolveCategoryLock(p: ProductLike): CategoryLock {
  const h = HAYSTACK(p);
  if (!h) return "DRY";
  // Order matters — WET_OK and OUTDOOR_OK win over DRY when both could match
  // (e.g. "perfume bottle" matches both "bottle of" hint and DRY=jewelry-like
  // glassware), since the more permissive lock is the user's actual intent.
  if (WET_OK_PATTERNS.some((r) => r.test(h))) return "WET_OK";
  if (OUTDOOR_OK_PATTERNS.some((r) => r.test(h))) return "OUTDOOR_OK";
  if (DRY_PATTERNS.some((r) => r.test(h))) return "DRY";
  return "DRY";
}

/** Short clause appended to image / video prompts. Each lock is phrased
 *  positively first ("WHAT IS ALLOWED") then bans the AI-trope failure modes
 *  for that lock. Keep under ~280 chars per clause to stay budget-friendly. */
export function categoryPhysicsClause(lock: CategoryLock): string {
  switch (lock) {
    case "DRY":
      return "PHYSICS LOCK (dry hard surface): all surfaces are dry — skin, fabric, stone, wood, metal, glass. NO water, droplets, splashes, rain, sink, faucet, foam, steam, mist, lava, fire, melting material, smoke clouds. NO floating product or anti-gravity. Any 'molten' or 'fluid' wording = solid polished metal contour only, never literal liquid.";
    case "WET_OK":
      return "PHYSICS LOCK (product-consistent moisture only): water / mist / droplets / lather are allowed ONLY when produced by the product itself (perfume spray, skincare drop, beverage condensation, shower foam). NO submerging in sinks, washing hands, rain, ocean, pool, bath. NO fire, lava, smoke clouds, anti-gravity floating.";
    case "OUTDOOR_OK":
      return "PHYSICS LOCK (real outdoor environment): natural weather (sunlight, overcast, light wind, sand, dust, puddles, light rain, sweat) is allowed when scene-appropriate. NO surreal weather, no lava / fire / smoke FX, no anti-gravity floating product, no underwater scenes.";
  }
}

/** Sanitize a free-text mood string for the visual chain. Removes the most
 *  literally-rendered "imagery words" so legacy drafts (which still pass raw
 *  vibe/texture into prompts) don't trigger water-tropes. The new editorial
 *  flow drops free-text mood from the visual chain entirely; this function
 *  is only used as a safety net for old drafts. */
export function sanitizeMoodForVisuals(value: string | undefined | null, lock: CategoryLock): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  // OUTDOOR_OK gets the lightest filtering — water words may be legitimate.
  // WET_OK keeps moisture vocabulary; only strips submerge / wash-hands tropes.
  // DRY strips the full liquid family.
  let out = raw;
  if (lock === "DRY") {
    out = out
      .replace(/\b(water|watery|wet|liquid|fluid|droplet[s]?|splash(?:es|ing)?|rain|underwater|submerg\w*|dipp?ed|dipp?ing|sink|faucet|soap|foam|steam|mist|lava|molten|melting|burning|fiery|ember|flame|smok(?:e|y|ing))\b/gi, "polished")
      .replace(/\b(floating|hovering|suspended|levitating|weightless)\b/gi, "balanced")
      .replace(/\b(glow(?:ing)?|luminous|radiant|halo|bloom|sparkle|starlit|starburst)\b/gi, "softly lit");
  } else if (lock === "WET_OK") {
    out = out
      .replace(/\b(submerg\w*|underwater|sink|faucet|wash(?:ing)? hands?|bathtub|ocean|swimming pool)\b/gi, "")
      .replace(/\b(lava|molten|burning|fiery|ember|flame)\b/gi, "")
      .replace(/\b(floating|hovering|levitating|weightless)\b/gi, "balanced");
  } else {
    // OUTDOOR_OK
    out = out
      .replace(/\b(lava|molten|burning|fiery)\b/gi, "")
      .replace(/\b(floating|hovering|levitating|weightless)\b/gi, "grounded");
  }
  return out.replace(/\s+/g, " ").trim();
}
