import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

const STYLE_ANALYSIS_PROMPT = `You are a professional cinematographer and creative director analyzing a reference video through its keyframes.

Extract a comprehensive STYLE PROFILE as JSON with these exact fields:

{
  "summary": "One-paragraph overall style description",
  "colorGrade": "Detailed color grading description — dominant palette, temperature, contrast, saturation, LUT reference",
  "lighting": "Lighting style, direction, quality, special effects (lens flares, volumetric fog, etc.)",
  "camera": "Dominant movement, avg shot duration, rhythm (fast-cut/medium/slow), angles",
  "environment": "Environment type, textures, materials, architectural elements, depth",
  "atmosphere": "Mood, energy level, atmosphere density (clear/haze/fog), depth structure",
  "productLook": "How products/subjects are presented — framing, focus, staging approach",
  "talent": "Human presence style — poses, expressions, wardrobe feel (or null if no humans)",
  "lut": "Closest film LUT or color science reference (e.g. 'Modified M31 with teal shifted to emerald')",
  "lightingDiagram": "Detailed lighting setup description (key light angle, fill ratio, rim/hair light, practical lights)",
  "colorPalette": "5 dominant hex colors comma-separated",
  "filmStock": "Closest analog film stock (e.g. 'CineStill 800T', 'Kodak Vision3 500T')",
  "dominantPalette": ["array", "of", "5", "hex", "colors"],
  "temperature": "warm/cool/neutral",
  "contrast": "high/medium/low",
  "grainIntensity": "none/subtle/medium/heavy",
  "atmosphereDensity": "clear/haze/fog/smoke",
  "rhythm": "fast-cut/medium/slow-contemplative",
  "avgShotDurationSec": 3,
  "energyLevel": "high/medium/low",
  "primaryEmotion": "e.g. power, elegance, mystery, desire, playfulness",
  "textureMaterials": "e.g. carbon fiber, polished metal, silk, marble, wet stone"
}

Be extremely specific and technical. Reference real film stocks, LUTs, and cinematographic techniques.
Return ONLY valid JSON, no markdown fencing.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const frames: string[] = body.frames;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      throw new Error("No frames provided. Send { frames: [dataUrl, ...] }");
    }

    if (frames.length > 12) {
      throw new Error("Too many frames (max 12)");
    }

    console.log(`Received ${frames.length} pre-extracted frames`);

    // Send frames to Gemini for analysis
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const userContent: any[] = [
      { type: "text", text: "Analyze these keyframes from a video ad and extract the complete style profile. These frames are in chronological order from a single video." },
      ...frames.map(f => ({
        type: "image_url",
        image_url: { url: f },
      })),
    ];

    console.log("Sending frames to AI for style analysis...");
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: STYLE_ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI analysis error:", aiRes.status, errText);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI analysis failed: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let styleProfile: any;
    try {
      const jsonStr = content.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
      styleProfile = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response as JSON:", content.substring(0, 500));
      throw new Error("AI returned invalid style analysis format");
    }

    return new Response(JSON.stringify({
      styleProfile,
      thumbnailUrl: frames[0] || null,
      frameCount: frames.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("analyze-video-style error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
