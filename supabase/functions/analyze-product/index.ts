import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ANTI_BIAS_SYSTEM_PROMPT } from "../_shared/antiBiasPrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }

  return cleaned.slice(start);
}

function parseLooseJson(text: string) {
  const extracted = extractJsonObject(text);
  if (!extracted) throw new Error("No valid JSON object found in AI response");

  const attempts = [
    extracted,
    extracted
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, ""),
  ];

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }

  throw new Error("Malformed JSON");
}

/** Download an external image and upload it to the product-images bucket.
 *  Returns the public URL, or the original URL on failure. */
async function persistImage(url: string, supabase: any): Promise<string> {
  if (!url || !url.startsWith("http")) return url;
  // Already in our bucket
  if (url.includes("product-images")) return url;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.split("/")[1]?.split(";")[0]?.replace("+xml", "") || "jpg";
      const path = `products/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { error } = await supabase.storage.from("product-images").upload(path, bytes, { contentType, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
      console.log(`Persisted image: ${url.slice(0, 60)}... -> ${pub.publicUrl.slice(0, 80)}`);
      return pub.publicUrl;
    } catch (e) {
      console.warn(`Failed to persist image (attempt ${attempt + 1}/${MAX_RETRIES}) ${url.slice(0, 80)}: ${e}`);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return url; // fallback to original after all retries
    }
  }
  return url;
}

/** Image source tag — drives debugging + downstream trust. Earlier in this list = more trusted. */
type ImageSource =
  | "shopify-json"
  | "json-ld"
  | "og"
  | "twitter"
  | "img-gallery-fallback"
  | "markdown-fallback";

interface SourcedImage { url: string; source: ImageSource }

/** Common junk filter — icons, trackers, logos, etc. Returns true to KEEP. */
function notJunkUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    !lower.includes("icon") &&
    !lower.includes("favicon") &&
    !lower.includes("logo") &&
    !lower.includes("pixel") &&
    !lower.includes("tracking") &&
    !lower.includes("badge") &&
    !lower.includes("1x1") &&
    !lower.includes("avatar") &&
    !lower.includes("emoji") &&
    !lower.includes("social") &&
    !lower.startsWith("data:")
  );
}

/** Resolve a possibly-relative URL against the page URL. Returns null if not http(s). */
function resolveUrl(raw: string, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Decode common HTML entities found in attribute values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** ── TIER 1 — Shopify public product JSON ──
 *  If the URL contains /products/<handle>, append `.json` and parse `product.images[].src`.
 *  Zero pollution: this is authoritative for the single product. */
async function tryShopifyProductJson(pageUrl: string): Promise<string[]> {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/^(.*\/products\/[^/?#]+)/i);
    if (!m) return [];
    const handlePath = m[1].replace(/\.json$/i, "");
    const jsonUrl = `${u.origin}${handlePath}.json`;
    const res = await fetch(jsonUrl, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; ProductBot/1.0)" },
    });
    if (!res.ok) {
      console.log(`[tier1-shopify] ${jsonUrl} -> ${res.status}, skipping`);
      return [];
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      console.log(`[tier1-shopify] ${jsonUrl} returned non-JSON (${ct}), skipping`);
      return [];
    }
    const data = await res.json().catch(() => null);
    const imgs: any[] = data?.product?.images || [];
    const urls = imgs
      .map((i) => (typeof i === "string" ? i : i?.src))
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((s) => resolveUrl(s, pageUrl))
      .filter((s): s is string => !!s && notJunkUrl(s));
    const unique = Array.from(new Set(urls));
    console.log(`[tier1-shopify] ${jsonUrl} -> ${unique.length} authoritative product images`);
    return unique;
  } catch (e) {
    console.warn("[tier1-shopify] failed:", (e as Error).message);
    return [];
  }
}

/** ── TIER 2a — JSON-LD Product.image ── */
function extractJsonLdImages(html: string, pageUrl: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const resolved = resolveUrl(decodeEntities(raw.trim()), pageUrl);
    if (resolved && notJunkUrl(resolved) && !out.includes(resolved)) out.push(resolved);
  };
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const type = node["@type"];
    const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
    if (isProduct && node.image) {
      const img = node.image;
      if (typeof img === "string") push(img);
      else if (Array.isArray(img)) img.forEach((x) => {
        if (typeof x === "string") push(x);
        else if (x && typeof x === "object") push(x.url || x["@id"]);
      });
      else if (typeof img === "object") push(img.url || img["@id"]);
    }
    if (node["@graph"]) visit(node["@graph"]);
  };
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRegex.exec(html)) !== null) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* best effort */ }
  }
  return out;
}

/** ── TIER 2b — og:image / twitter:image — returned separately so we can tag source. */
function extractOgImages(html: string, pageUrl: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const r = resolveUrl(decodeEntities(raw.trim()), pageUrl);
    if (r && notJunkUrl(r) && !out.includes(r)) out.push(r);
  };
  let m: RegExpExecArray | null;
  const a = /<meta[^>]+property=["'](og:image(?::secure_url)?)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  const b = /<meta[^>]+content=["']([^"']+)["'][^>]*property=["'](og:image(?::secure_url)?)["'][^>]*>/gi;
  while ((m = a.exec(html)) !== null) push(m[2]);
  while ((m = b.exec(html)) !== null) push(m[1]);
  return out;
}
function extractTwitterImages(html: string, pageUrl: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const r = resolveUrl(decodeEntities(raw.trim()), pageUrl);
    if (r && notJunkUrl(r) && !out.includes(r)) out.push(r);
  };
  let m: RegExpExecArray | null;
  const a = /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  const b = /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/gi;
  while ((m = a.exec(html)) !== null) push(m[1]);
  while ((m = b.exec(html)) !== null) push(m[1]);
  return out;
}

/** ── TIER 3a — DOM-scoped gallery <img> fallback ──
 *  Only scan containers that look like a product gallery; explicitly skip containers
 *  whose class/id signals "you may also like / related / recommended / upsell".
 *  Coarse string scan over raw HTML (no DOM parser in Deno edge runtime). */
const GALLERY_ALLOW = /\b(?:gallery|product-gallery|product-media|product-image|product__media|main-image|featured|carousel|swiper)\b/i;
const RECOMMEND_DENY = /\b(?:recommend(?:ed|ation)?|related|upsell|crosssell|cross-sell|you-?may-?also|also-?like|similar)\b/i;

function extractGalleryImgFallback(html: string, pageUrl: string): string[] {
  if (!html) return [];

  // Strip recommendation blocks first. We approximate by removing chunks that
  // contain a deny-listed class/id between a tag open and its matching depth.
  // Cheap approach: blank out 8KB windows around each deny hit. Imperfect but
  // dramatically lowers false positives without a real parser.
  let safeHtml = html;
  const denyHits: number[] = [];
  const denyRe = new RegExp(`<[^>]*(?:class|id)=["'][^"']*${RECOMMEND_DENY.source}[^"']*["'][^>]*>`, "gi");
  let dm: RegExpExecArray | null;
  while ((dm = denyRe.exec(html)) !== null) denyHits.push(dm.index);
  if (denyHits.length) {
    const masked = html.split("");
    for (const idx of denyHits) {
      const end = Math.min(html.length, idx + 8000);
      for (let i = idx; i < end; i++) masked[i] = " ";
    }
    safeHtml = masked.join("");
    console.log(`[tier3-fallback] masked ${denyHits.length} recommendation blocks`);
  }

  // Now scan <img> tags but only keep those inside ~2KB window of an allow-listed container open.
  const allowHits: number[] = [];
  const allowRe = new RegExp(`<[^>]*(?:class|id)=["'][^"']*${GALLERY_ALLOW.source}[^"']*["'][^>]*>`, "gi");
  let am: RegExpExecArray | null;
  while ((am = allowRe.exec(safeHtml)) !== null) allowHits.push(am.index);

  // If we found explicit gallery containers, restrict to imgs inside their windows.
  // Otherwise (some sites don't class their gallery), bail out — return nothing
  // and let the markdown-fallback tier handle it; we don't want a blind page scan
  // here because it's the original pollution source.
  if (allowHits.length === 0) {
    console.log(`[tier3-fallback] no gallery containers found, skipping (avoids pollution)`);
    return [];
  }

  const out: string[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(safeHtml)) !== null) {
    const inGallery = allowHits.some((h) => im!.index >= h && im!.index < h + 4000);
    if (!inGallery) continue;
    const tag = im[0];
    const srcMatch =
      /\bsrc=["']([^"']+)["']/i.exec(tag) ||
      /\bdata-src=["']([^"']+)["']/i.exec(tag) ||
      /\bdata-original=["']([^"']+)["']/i.exec(tag) ||
      /\bsrcset=["']([^"'\s,]+)/i.exec(tag);
    if (!srcMatch) continue;
    const r = resolveUrl(decodeEntities(srcMatch[1]), pageUrl);
    if (r && notJunkUrl(r) && !out.includes(r)) out.push(r);
    if (out.length >= 8) break;
  }
  console.log(`[tier3-fallback] gallery-scoped scan -> ${out.length} images`);
  return out;
}

/** ── TIER 3b — last-resort markdown regex ── unscoped, only used when nothing else worked. */
function extractMarkdownFallback(markdown: string): string[] {
  const urls = new Set<string>();
  const mdImgRegex = /!\[.*?\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImgRegex.exec(markdown)) !== null) urls.add(match[1]);
  const rawUrlRegex = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;
  while ((match = rawUrlRegex.exec(markdown)) !== null) urls.add(match[0]);
  return Array.from(urls).filter(notJunkUrl).slice(0, 8);
}

/** ── Orchestrator ──
 *  Strategy: walk tiers from cleanest to noisiest, stop early once we have
 *  a confident source. Fidelity > recall. */
async function gatherProductImages(opts: {
  pageUrl: string;
  html: string;
  markdown: string;
}): Promise<SourcedImage[]> {
  const { pageUrl, html, markdown } = opts;

  // Tier 1 — Shopify .json. If present → exclusive, skip everything else.
  if (/\/products\//i.test(pageUrl)) {
    const shopify = await tryShopifyProductJson(pageUrl);
    if (shopify.length >= 1) {
      return shopify.map((url) => ({ url, source: "shopify-json" as const }));
    }
  }

  // Tier 2 — JSON-LD authoritative; og/twitter as same-product reinforcement.
  const jsonLd = extractJsonLdImages(html, pageUrl);
  const og = extractOgImages(html, pageUrl);
  const tw = extractTwitterImages(html, pageUrl);

  if (jsonLd.length >= 2) {
    const out: SourcedImage[] = jsonLd.map((url) => ({ url, source: "json-ld" as const }));
    const seen = new Set(jsonLd);
    for (const u of og) if (!seen.has(u)) { out.push({ url: u, source: "og" }); seen.add(u); }
    for (const u of tw) if (!seen.has(u)) { out.push({ url: u, source: "twitter" }); seen.add(u); }
    console.log(`[tier2] json-ld=${jsonLd.length}, og=${og.length}, tw=${tw.length}, total=${out.length}`);
    return out;
  }

  // Mixed: 1 json-ld + og/twitter can still beat nothing.
  if (jsonLd.length + og.length + tw.length >= 2) {
    const out: SourcedImage[] = [];
    const seen = new Set<string>();
    for (const u of jsonLd) if (!seen.has(u)) { out.push({ url: u, source: "json-ld" }); seen.add(u); }
    for (const u of og)     if (!seen.has(u)) { out.push({ url: u, source: "og" });      seen.add(u); }
    for (const u of tw)     if (!seen.has(u)) { out.push({ url: u, source: "twitter" }); seen.add(u); }
    console.log(`[tier2-mixed] total=${out.length}`);
    return out;
  }

  // Tier 3 — constrained gallery-scoped <img> scan.
  const gallery = extractGalleryImgFallback(html, pageUrl);
  if (gallery.length >= 1) {
    return gallery.map((url) => ({ url, source: "img-gallery-fallback" as const }));
  }

  // Last resort — markdown blob regex. Known pollution risk; warn loudly.
  const md = extractMarkdownFallback(markdown);
  if (md.length) {
    console.warn(`[tier3-markdown] LAST RESORT — using ${md.length} markdown-scanned images, fidelity NOT guaranteed`);
    return md.map((url) => ({ url, source: "markdown-fallback" as const }));
  }

  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Lifted into outer scope so the catch can return partial-success with whatever
  // images we already extracted, instead of dropping the whole request on a finalization error.
  let _partialExtracted: string[] = [];
  let _partialUploaded: string[] = [];
  let _partialFormattedUrl = "";

  try {
    const { url, platform, goal, style, uploadedImages, onModelImages, productTitle, productDescription } = await req.json();
    _partialUploaded = Array.isArray(uploadedImages) ? uploadedImages.filter((u: any) => typeof u === "string") : [];

    if (!url && (!uploadedImages || !uploadedImages.length)) {
      return new Response(JSON.stringify({ error: "URL or images required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let markdown = "";
    let metadata: any = {
      title: typeof productTitle === "string" ? productTitle : "",
      description: typeof productDescription === "string" ? productDescription : "",
    };
    let branding: any = null;
    let extractedImages: string[] = [];
    let imageSources: Record<string, ImageSource> = {};
    let formattedUrl = "";

    // If URL provided, scrape it
    if (url) {
      const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
      if (!FIRECRAWL_API_KEY) {
        return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      formattedUrl = url.trim();
      if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
        formattedUrl = `https://${formattedUrl}`;
      }
      _partialFormattedUrl = formattedUrl;


      console.log("Analyzing product URL:", formattedUrl);

      // Scrape content, branding, AND screenshot in parallel
      const [scrapeRes, brandRes, screenshotRes] = await Promise.all([
        fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: formattedUrl, formats: ["markdown", "links", "html"], onlyMainContent: true }),
        }),
        fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: formattedUrl, formats: ["branding"] }),
        }),
        fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: formattedUrl, formats: ["screenshot"] }),
        }),
      ]);

      const scrapeData = await scrapeRes.json();
      const brandData = await brandRes.json();
      const screenshotData = await screenshotRes.json();

      if (!scrapeRes.ok) {
        console.error("Firecrawl error:", scrapeData);
        if (scrapeRes.status === 402) {
          return new Response(
            JSON.stringify({ error: "Firecrawl credits exhausted. Please top up your plan." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: scrapeData.error || "Failed to scrape URL" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
      metadata = {
        ...(scrapeData.data?.metadata || scrapeData.metadata || {}),
        ...(productTitle ? { title: productTitle } : {}),
        ...(productDescription ? { description: productDescription } : {}),
      };
      branding = brandData.data?.branding || brandData.branding || null;

      // Three-tier product image extraction. Fidelity > recall — we'd rather
      // return 1 authoritative image than 6 contaminated ones. Each image is
      // tagged with its source for downstream trust + debugging.
      const rawHtml: string = scrapeData.data?.html || scrapeData.html || "";
      try {
        const sourced = await gatherProductImages({
          pageUrl: formattedUrl,
          html: rawHtml,
          markdown,
        });
        const counts = sourced.reduce<Record<string, number>>((acc, s) => {
          acc[s.source] = (acc[s.source] || 0) + 1; return acc;
        }, {});
        console.log(`[image-tiers] final breakdown:`, counts);
        extractedImages = sourced.map((s) => s.url);
        imageSources = Object.fromEntries(sourced.map((s) => [s.url, s.source]));
      } catch (e) {
        console.warn("gatherProductImages failed:", (e as Error).message);
      }

      // Add screenshot as a fallback reference image (page-level, never confused with product)
      const screenshot = screenshotData.data?.screenshot || screenshotData.screenshot;
      if (screenshot && screenshot.startsWith("data:")) {
        extractedImages.unshift(screenshot);
      }
      _partialExtracted = [...extractedImages];



      if (!markdown) {
        return new Response(
          JSON.stringify({ error: "Could not extract content from this URL" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Merge user-uploaded images (these take priority)
    const allImages: string[] = [
      ...(uploadedImages || []),
      ...extractedImages,
    ].slice(0, 10);

    // On-model reference images (separate category for proportion analysis)
    const modelImages: string[] = (onModelImages || []).slice(0, 4);

    // Build branding context
    let brandingContext = "";
    if (branding) {
      const colors = branding.colors || {};
      const typography = branding.typography || {};
      const images = branding.images || {};
      brandingContext = `\n\nBRAND IDENTITY EXTRACTED:
- Color scheme: ${branding.colorScheme || "unknown"}
- Primary: ${colors.primary || "unknown"}, Secondary: ${colors.secondary || "unknown"}, Accent: ${colors.accent || "unknown"}
- Logo: ${images.logo || images.favicon || "none"}
- Fonts: ${typography.fontFamilies ? JSON.stringify(typography.fontFamilies) : "unknown"}`;
    }

    const truncatedContent = markdown.substring(0, 10000);

    // Build AI messages — include product images for visual analysis
    const messages: any[] = [
      {
        role: "system",
        content: `${ANTI_BIAS_SYSTEM_PROMPT}

You are an expert product analyst and ad creative director. Analyze a product and extract comprehensive product understanding for ad creation.

CRITICAL: If product images are provided, you MUST analyze the actual visual appearance of the product in detail: exact shape, color, material, texture, finish, proportions, packaging, labels, and any distinctive visual features. Your "images" field in the response must include the URLs of the real product images that were provided or extracted.

ANTI-CLICHÉ MANDATE FOR THIS ANALYSIS:
- "audience" must NOT be "the modern woman who values quality" or any template phrase. Be specific about lifestyle, age band, daily context, what they buy this INSTEAD of.
- "vibe" must NOT be "elegant, sophisticated, timeless" stack. Pick one concrete trait the brand actually demonstrates (visible on the page or in the imagery).
- "whyPeopleWantIt" must NOT restate the brand's marketing copy. Identify the underlying tension or job-to-be-done in plain language.
- "visualIdentity" must describe what is ACTUALLY in the photo, not what the category usually looks like.

Return ONLY valid JSON (no markdown, no code fences):
{
  "title": "Product name as displayed",
  "brand": {
    "brandName": "Brand name",
    "colorPalette": "Natural language description of colors, e.g. 'Deep navy with gold accents'",
    "vibe": "Brand personality in 1-2 sentences",
    "logoUrl": "URL if found, else empty string",
    "typography": "Typography style description"
  },
  "price": "Price if found, else empty string",
  "category": "Product category",
  "keyFeatures": ["feature1", "feature2", "feature3", "feature4"],
  "benefits": ["benefit1", "benefit2", "benefit3", "benefit4"],
  "images": ["url1", "url2"],
  "audience": "Who this product is for — specific demographics, psychographics, lifestyle",
  "objections": ["objection1", "objection2", "objection3"],
  "useCases": ["use case 1", "use case 2", "use case 3"],
  "sellingAngles": ["angle1", "angle2", "angle3", "angle4"],
  "adDirectionRecommendations": ["recommendation1", "recommendation2"],
  "summary": "2-3 sentence product summary — what it is, what makes it special",
  "whyPeopleWantIt": "1-2 sentences on the core desire or pain point this solves",
  "visualIdentity": "DETAILED description of the product's visual appearance: shape, color, material, texture, finish, proportions, any distinctive visual markers. This will be used to ensure all generated visuals match the real product exactly.",
  "physicalTraits": {
    "dimensions": "Approximate real-world size description, e.g. '2cm drop length earrings', '15cm tall bottle', 'palm-sized compact'. Be specific with numbers when possible.",
    "proportions": "Relative proportions and scale relationships, e.g. 'chain links are 2mm wide, pearls are 3mm diameter', 'pendant is thumbnail-sized'. Describe how parts relate to each other in size.",
    "weight": "Perceived weight class: 'ultra-lightweight/delicate', 'light', 'medium', 'substantial/heavy'. This affects how the product moves and hangs.",
    "scaleReference": "How the product relates to human body: 'sits flush against earlobe', 'wraps around wrist once', 'covers palm'. Critical for on-model shots. If ON-MODEL REFERENCE IMAGES are provided, use them as ground truth for scale.",
    "distinctiveShape": "The ONE most recognizable shape feature that must never change: 'rectangular chain links alternating with oval pearls', 'tapered bottle with flat cap'. If this changes, the product is wrong.",
    "onModelObservations": "If on-model photos are provided, describe EXACTLY how the product looks when worn: its size relative to the body part, how it drapes/hangs/fits, the visual weight. This is the ground truth for all generated on-model shots."
  }
}

The "images" array MUST include all provided product image URLs — these are the source of truth for the product's visual identity.
The ad will be for: platform=${platform}, goal=${goal}, style=${style}. Factor these into your analysis.`,
      },
    ];

    // Build user message with images if available
    if (allImages.length > 0 || modelImages.length > 0) {
      const onModelNote = modelImages.length > 0
        ? `\n\nON-MODEL REFERENCE IMAGES PROVIDED (${modelImages.length}): These show the product being worn/used on a real person. Use these as GROUND TRUTH for size, proportions, drape, and fit. The product must look EXACTLY this size relative to the body in all generated on-model shots.`
        : "";
      const content: any[] = [
        {
          type: "text",
          text: `Analyze this product:\n\nURL: ${formattedUrl || "User-uploaded product"}\nTitle: ${metadata.title || "Unknown"}\nDescription: ${metadata.description || "Unknown"}${brandingContext}\n\nProduct images found: ${allImages.filter(img => img.startsWith("http")).join(", ")}${onModelNote}\n\nContent:\n${truncatedContent || "No webpage content — analyze from images only."}`,
        },
      ];
      // Include product images for visual analysis (up to 4)
      for (const img of allImages.slice(0, 4)) {
        if (img && (img.startsWith("http") || img.startsWith("data:"))) {
          content.push({
            type: "image_url",
            image_url: { url: img },
          });
        }
      }
      // Include on-model images (up to 3, labeled)
      for (const img of modelImages.slice(0, 3)) {
        if (img && (img.startsWith("http") || img.startsWith("data:"))) {
          content.push({
            type: "text",
            text: "[ON-MODEL REFERENCE — product worn on person, use for size/proportion ground truth]",
          });
          content.push({
            type: "image_url",
            image_url: { url: img },
          });
        }
      }
      messages.push({ role: "user", content });
    } else {
      messages.push({
        role: "user",
        content: `Analyze this product:\n\nURL: ${formattedUrl}\nTitle: ${metadata.title || "Unknown"}\nDescription: ${metadata.description || "Unknown"}${brandingContext}\n\nContent:\n${truncatedContent}`,
      });
    }

    const doAiCall = async (msgs: any[]) => {
      return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: msgs }),
      });
    };

    let aiRes = await doAiCall(messages);

    // If 400 and we sent images, retry without images (URLs may be inaccessible to the model)
    if (aiRes.status === 400 && allImages.length > 0) {
      console.log("Retrying without inline images due to 400 error");
      const textOnlyMessages = [
        messages[0], // system
        {
          role: "user",
          content: `Analyze this product:\n\nURL: ${formattedUrl || "User-uploaded product"}\nTitle: ${metadata.title || "Unknown"}\nDescription: ${metadata.description || "Unknown"}${brandingContext}\n\nProduct image URLs (analyze these): ${allImages.filter(img => img.startsWith("http")).join(", ")}\n\nContent:\n${truncatedContent || "No webpage content available."}`,
        },
      ];
      aiRes = await doAiCall(textOnlyMessages);
    }

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errBody = await aiRes.text();
      console.error("AI gateway error body:", errBody);
      throw new Error(`AI gateway error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error("No AI response");

    let understanding: any;
    try {
      understanding = parseLooseJson(content);
    } catch (_parseErr) {
      const extracted = extractJsonObject(content) || content;
      console.error("JSON repair failed. First 500 chars:", extracted.slice(0, 500));
      console.error("Last 200 chars:", extracted.slice(-200));
      throw new Error("AI returned malformed JSON — please retry");
    }

    // CRITICAL: Ensure real product images are preserved in the output
    const existingImages = understanding.images || [];
    const finalImages = [...new Set([
      ...(uploadedImages || []),
      ...existingImages,
      ...extractedImages.filter(img => img.startsWith("http")),
    ])].slice(0, 15);

    // Persist external images to our storage bucket so downstream functions can access them
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parallelize image persistence (was serial — saved 5-15s on multi-image products)
    const persistResults = await Promise.all(
      finalImages.map((img) => persistImage(img, supabase).then((p) => ({ orig: img, persisted: p })))
    );
    const persistedImages: string[] = [];
    for (const { orig, persisted } of persistResults) {
      if (persisted.includes("product-images") || persisted.startsWith("data:")) {
        persistedImages.push(persisted);
      } else {
        console.warn(`Dropping unpersistable image: ${orig.slice(0, 80)}`);
      }
    }
    understanding.images = persistedImages;
    if (persistedImages.length) _partialExtracted = persistedImages;


    // Persist logo (in parallel with branding fallback if needed)
    const logoTasks: Promise<void>[] = [];
    if (understanding.brand?.logoUrl) {
      logoTasks.push(
        persistImage(understanding.brand.logoUrl, supabase).then((u) => {
          understanding.brand.logoUrl = u;
        })
      );
    } else if (branding && understanding.brand) {
      const logoSrc = branding.images?.logo || branding.images?.favicon || "";
      if (logoSrc) {
        logoTasks.push(
          persistImage(logoSrc, supabase).then((u) => {
            understanding.brand.logoUrl = u;
          })
        );
      }
    }
    if (logoTasks.length) await Promise.all(logoTasks);

    // ─── Hero Image Selection + Recommended Look (run in PARALLEL) ───
    // Both are independent of each other — saves ~10-20s vs serial.
    const candidatePool = persistedImages.filter(img => img.startsWith("http") || img.startsWith("data:"));

    const VIBE_IDS = [
      { id: "editorial-quiet", desc: "Editorial — quiet, refined, slow. Magazine restraint, negative space, almost still." },
      { id: "cinematic-bold",  desc: "Cinematic — bold, dramatic, widescreen. Anamorphic feel, deep blacks, hero-shot pacing." },
      { id: "old-money",       desc: "Old Money — refined, timeless, warm. Coastal villa, linen, golden hour, heritage." },
      { id: "street-raw",      desc: "Street — raw, kinetic, honest. Handheld energy, daylight, real city texture, documentary edge." },
      { id: "dreamy-soft",     desc: "Dreamy — soft, romantic, diffused. Hazy bloom, gentle pastels, slow drift, memory-like." },
      { id: "playful-pop",     desc: "Playful — pop, saturated, fast. Bright color blocks, snappy cuts, joyful kinetic energy." },
    ];
    const TEXTURE_IDS = [
      { id: "matte-window",     desc: "Matte surface + warm window light. Soft north-window glow on velvety, light-absorbing surfaces." },
      { id: "glossy-spotlight", desc: "Glossy surface + crisp spotlight. Specular highlights snap across mirror-finish surfaces." },
      { id: "metal-rim",        desc: "Brushed metal + cool rim light. Cold backlight catches the grain of brushed steel/aluminum." },
      { id: "glass-haze",       desc: "Frosted glass + diffused haze. Translucent depth, refracted light, soft fog edges." },
      { id: "ceramic-amber",    desc: "Ceramic + amber side light. Smooth porcelain warmed by a low golden side light." },
      { id: "velvet-low",       desc: "Velvet + low-key shadow. Deep plush surfaces fading into pure shadow, theatrical and intimate." },
    ];

    const heroTask = (async (): Promise<string[]> => {
      if (candidatePool.length <= 3) return [...candidatePool];
      try {
        const heroSelectionMessages = [
          {
            role: "system",
            content: `You are a product photography curator. Given multiple product images, pick the 3 MOST COMPLEMENTARY images that together give the most complete visual understanding of the product. Selection criteria, in order:
1. ONE main view: the clearest, most complete product silhouette (front/3-quarter/best angle).
2. ONE complementary angle: shows what view #1 hides (side, back, top, opposite angle).
3. ONE detail/macro shot: material texture, finish, logo, or distinctive feature close-up.

If the product is being worn/used in some images, prioritize at least one product-only shot for #1.
Avoid: lifestyle/scene shots without the product, duplicates of the same angle, blurry images, banner/marketing graphics.
Return ONLY a JSON object — no markdown — with this shape: {"indices":[i,j,k]} where each index is the 0-based position of the chosen image. Pick exactly 3 indices unless fewer images exist.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Pick the 3 most complementary images from this set of ${candidatePool.length}. Indices are 0-based, in the order shown below.` },
              ...candidatePool.map((url, i) => ([
                { type: "text" as const, text: `[Image ${i}]` },
                { type: "image_url" as const, image_url: { url } },
              ])).flat(),
            ],
          },
        ];
        const heroRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: heroSelectionMessages }),
        });
        if (heroRes.ok) {
          const heroData = await heroRes.json();
          const heroContent = heroData.choices?.[0]?.message?.content || "";
          const parsed = parseLooseJson(heroContent);
          const indices: number[] = Array.isArray(parsed.indices) ? parsed.indices : [];
          const picked = indices
            .filter((i: any) => Number.isInteger(i) && i >= 0 && i < candidatePool.length)
            .slice(0, 3)
            .map((i: number) => candidatePool[i]);
          const heroImages = [...new Set(picked)].slice(0, 3);
          console.log(`Hero selection picked indices ${JSON.stringify(indices)} -> ${heroImages.length} images`);
          if (heroImages.length > 0) return heroImages;
        } else {
          console.warn(`Hero selection AI call failed: ${heroRes.status}`);
        }
      } catch (heroErr) {
        console.warn("Hero selection failed, falling back to first 3:", heroErr);
      }
      return candidatePool.slice(0, 3);
    })();

    const lookTask = (async (): Promise<{ vibeId: string; textureId: string; rationale: string }> => {
      try {
        const lookMessages = [
          {
            role: "system",
            content: `You are a luxury ad creative director. Pick the ONE creative vibe and the ONE texture/lighting setup that best fit a product, from these fixed libraries.

VIBES:
${VIBE_IDS.map((v) => `- ${v.id}: ${v.desc}`).join("\n")}

TEXTURES:
${TEXTURE_IDS.map((t) => `- ${t.id}: ${t.desc}`).join("\n")}

Match the vibe to the brand personality and target audience. Match the texture to the product's actual surface material and the lighting style that flatters it most.

Return ONLY a JSON object — no markdown — with this exact shape:
{"vibeId":"<one id from VIBES>","textureId":"<one id from TEXTURES>","rationale":"<one short sentence>"}`,
          },
          {
            role: "user",
            content: `Product: ${understanding.title || "Unknown"}
Category: ${understanding.category || "Unknown"}
Brand: ${understanding.brand?.brandName || "Unknown"} — ${understanding.brand?.vibe || ""}
Audience: ${understanding.audience || "Unknown"}
Visual identity: ${understanding.visualIdentity || ""}
Material/finish hint: ${(understanding as any)?.physicalTraits?.distinctiveShape || ""}

Pick the best vibeId and textureId.`,
          },
        ];
        const lookRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: lookMessages }),
        });
        if (lookRes.ok) {
          const lookData = await lookRes.json();
          const lookContent = lookData.choices?.[0]?.message?.content || "";
          const parsed = parseLooseJson(lookContent);
          const vibeOk = VIBE_IDS.some((v) => v.id === parsed.vibeId);
          const texOk = TEXTURE_IDS.some((t) => t.id === parsed.textureId);
          if (vibeOk && texOk) {
            console.log(`Recommended look: ${parsed.vibeId} + ${parsed.textureId}`);
            return {
              vibeId: parsed.vibeId,
              textureId: parsed.textureId,
              rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
            };
          }
          console.warn("Look recommendation invalid IDs, falling back to defaults");
        } else {
          console.warn(`Look recommendation AI call failed: ${lookRes.status}`);
        }
      } catch (lookErr) {
        console.warn("Look recommendation failed, using defaults:", lookErr);
      }
      return { vibeId: "editorial-quiet", textureId: "matte-window", rationale: "Default starting point." };
    })();

    const [heroImages, recommendedLook] = await Promise.all([heroTask, lookTask]);
    understanding.heroImages = heroImages;
    understanding.recommendedLook = recommendedLook;
    // Source-tag map keyed by ORIGINAL upstream URL — survives persistImage rewrite
    // only if downstream re-keys to persisted URLs. Kept for debugging/observability.
    understanding.imageSources = imageSources;

    return new Response(JSON.stringify(understanding), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    console.error("analyze-product error:", e);

    // Partial-success fallback: if finalization (LLM polish / persist / hero pick) failed
    // but we already extracted images, return them instead of dropping the whole request.
    // The image grab finishes in ~6s; the long tail is optional enhancement — don't 500 over it.
    const fallbackImages = [..._partialUploaded, ..._partialExtracted].filter(
      (u, i, a) => typeof u === "string" && u.length > 0 && a.indexOf(u) === i,
    );

    if (fallbackImages.length > 0) {
      console.warn(
        `analyze-product returning partial success with ${fallbackImages.length} images despite finalization error: ${errMsg}`,
      );
      const httpImages = fallbackImages.filter((u) => u.startsWith("http"));
      return new Response(
        JSON.stringify({
          partial: true,
          partialReason: errMsg,
          title: "",
          brand: {},
          category: "",
          keyFeatures: [],
          benefits: [],
          images: fallbackImages,
          heroImages: httpImages.slice(0, 3),
          audience: "",
          objections: [],
          useCases: [],
          sellingAngles: [],
          adDirectionRecommendations: [],
          summary: "",
          whyPeopleWantIt: "",
          visualIdentity: "",
          physicalTraits: {},
          recommendedLook: { vibeId: "editorial-quiet", textureId: "matte-window", rationale: "Default (analyze finalization failed)." },
          sourceUrl: _partialFormattedUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  }
});
