import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

async function persistImage(url: string, supabase: any): Promise<string> {
  if (!url || !url.startsWith("http")) return url;
  if (url.includes("product-images")) return url;
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
    return pub.publicUrl;
  } catch (e) {
    console.warn(`Failed to persist image: ${e}`);
    return url;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith("http://") && !formattedUrl.startsWith("https://")) {
      formattedUrl = `https://${formattedUrl}`;
    }

    console.log("Scraping product URL:", formattedUrl);

    // Scrape content AND branding in parallel
    const [scrapeRes, brandRes] = await Promise.all([
      fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: formattedUrl, formats: ["markdown"], onlyMainContent: true }),
      }),
      fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: formattedUrl, formats: ["branding"] }),
      }),
    ]);

    const scrapeData = await scrapeRes.json();
    const brandData = await brandRes.json();

    if (!scrapeRes.ok) {
      console.error("Firecrawl error:", scrapeData);
      if (scrapeRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "Firecrawl credits exhausted. Please top up your Firecrawl plan." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: scrapeData.error || "Failed to scrape URL" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    const metadata = scrapeData.data?.metadata || scrapeData.metadata || {};
    const branding = brandData.data?.branding || brandData.branding || null;

    if (!markdown) {
      return new Response(
        JSON.stringify({ error: "Could not extract content from this URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build branding context for the AI
    let brandingContext = "";
    if (branding) {
      const colors = branding.colors || {};
      const typography = branding.typography || {};
      const images = branding.images || {};
      brandingContext = `\n\nBRAND IDENTITY EXTRACTED:
- Color scheme: ${branding.colorScheme || "unknown"}
- Primary color: ${colors.primary || "unknown"}
- Secondary color: ${colors.secondary || "unknown"}  
- Accent color: ${colors.accent || "unknown"}
- Background: ${colors.background || "unknown"}
- Logo URL: ${images.logo || images.favicon || "none"}
- Font families: ${typography.fontFamilies ? JSON.stringify(typography.fontFamilies) : "unknown"}
- Font sizes: ${typography.fontSizes ? JSON.stringify(typography.fontSizes) : "unknown"}

Use this brand identity to inform the product description and vibe.`;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const truncatedContent = markdown.substring(0, 8000);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You extract product and brand information from website content. Return ONLY a valid JSON object (no markdown, no code fences):
{
  "name": "Product or company/brand name exactly as displayed on the website",
  "description": "2-3 sentence description of what the product does, its key features and unique value proposition. Be specific about the product's actual functionality.",
  "audience": "Target audience based on the product positioning, tone of voice, and pricing",
  "budget": "",
  "brand": {
    "brandName": "The exact brand name as it appears on the site (may differ from product name)",
    "colorPalette": "Describe the brand's color palette in natural language, e.g. 'Deep navy blue with warm gold accents and clean white backgrounds — premium and trustworthy feel'",
    "vibe": "The overall brand personality and mood in 1-2 sentences, e.g. 'Minimalist and sophisticated with a playful edge. Feels like a premium lifestyle brand aimed at young professionals.'",
    "logoUrl": "URL of the brand logo if found, otherwise empty string",
    "typography": "Describe the typography style, e.g. 'Clean geometric sans-serif headings with a warm humanist body font — modern but approachable'"
  }
}
Be concise and specific. The brand fields should paint a vivid picture of the brand's visual identity and personality.`,
          },
          {
            role: "user",
            content: `Extract product and brand information from this website:\n\nURL: ${formattedUrl}\nPage title: ${metadata.title || "Unknown"}\nPage description: ${metadata.description || "Unknown"}${brandingContext}\n\nContent:\n${truncatedContent}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — please try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error("No AI response");

    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const product = JSON.parse(cleaned);

    // Persist logo to our storage
    if (product.brand?.logoUrl) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      product.brand.logoUrl = await persistImage(product.brand.logoUrl, supabase);
    }

    return new Response(JSON.stringify(product), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-product error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
