const { toolInvoke } = require("./proxy");

const TOOLS = {
  analyze_product: {
    name: "analyze-product",
    when: "Extract product truth (materials, traits, benefits, selling angles) from product image/URL. Use when product understanding is thin.",
    run: (args) => toolInvoke("analyze-product", {
      url: args.url,
      uploadedImages: args.uploadedImages || [],
      productTitle: args.productTitle,
      productDescription: args.productDescription,
    }),
  },
  scrape_site: {
    name: "scrape-product",
    when: "Scrape the brand's website for branding signals (colors, tone, copy). Use when brand identity/visual_dna is thin and a URL is available. May fail if blocked.",
    run: (args) => toolInvoke("scrape-product", { url: args.url }),
  },
  analyze_past_creative: {
    name: "analyze-video-style",
    when: "Analyze the visual style of the brand's PAST ads/posters (highest-signal evidence for anti_identity). Use when frames are available and brand visual identity / anti_identity is uncertain.",
    run: (args) => toolInvoke("analyze-video-style", { frames: (args.frames || []).slice(0, 12) }),
  },
  infer_anti_identity: {
    name: "infer-anti-identity",
    when: "Synthesize what the brand must NEVER be (anti_identity) from gathered website + past-creative + product signals. Use once enough evidence is gathered.",
    run: (args) => toolInvoke("infer-anti-identity", {
      websiteSignals: args.websiteSignals || "",
      pastCreativeStyle: args.pastCreativeStyle || "",
      productText: args.productText || "",
      userId: args.userId || null,
    }),
  },
};

function getTool(key) { return TOOLS[key]; }

module.exports = { TOOLS, getTool };
