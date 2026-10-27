import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodePrompt } from "../_shared/promptObfuscation.ts";
import { requireVpsOrUser } from "../_shared/vpsAuthGuard.ts";
import { PHYSICAL_SCALE_GUARD, PHYSICAL_REALISM_GUARD, HUMAN_FACE_GUARD, buildAntiCinematicGuard, enforceImagePromptBudget, buildRepeatingUnitGuard } from "../_shared/realismGuards.ts";
import { buildFidelityPreamble, NON_APPAREL_CATEGORIES } from "../_shared/fidelityPreamble.ts";
import { getStyleDna, styleAnchorPrefix, styleAnchorClause } from "../_shared/styleDna.ts";
import { callNativeGeminiImage, messagesToNativeParts } from "../_shared/nativeGeminiImage.ts";
import { buildKeyframeDaringLayer } from "../_shared/recipes/keyframeDaringLayer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-caller",
};

// Kling JWT helper — needed for direct VTO polling when the VTO edge fn times out
async function createKlingToken(accessKey: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };
  function base64url(data: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const _auth = await requireVpsOrUser(req, corsHeaders);
  if (_auth instanceof Response) return _auth;

  try {
    const payload = await req.json();
    const { shot, block, productImages, brand, platform, aspectRatio: requestedAR, visualIdentity, visualBible: rawVisualBible, previousKeyframes, totalBlocks, blockIndex, wearable, frameType = "start", nextBlock, colorCalibration, sizingContext, productSpecs, characterReferenceUrl, physicalTraits, onModelImages, quickMode, vibeId, textureId, colorGrade, anchorWord, sensoryPalette, humanState, keyframeEngine = "gemini", filmMode, filmMood, culturalRegister, siblingAnchorUrl, editBaseUrl, editInstruction } = payload;

    // ════════════════════════════════════════════════════════════════════
    // CANONICAL SHOT PATH — VPS agent runtime contract.
    // Cinematographer has baked shot-knowledge / craft / guards into
    // shot.generationPrompt. Use it AS-IS. Do NOT re-build from
    // visualDescription/purpose/blockType (would dilute/overwrite the
    // agent's authoritative decision). Keep machinery: productImages
    // conditioning, data:→public URL, AR fallback, color calibration.
    // NEVER set siblingAnchorUrl here (no implicit cluster siblings).
    // ════════════════════════════════════════════════════════════════════
    if (shot && typeof shot === "object") {
      const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
      if (!GOOGLE_AI_API_KEY) {
        return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY is not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authoritativePrompt = String(shot.generationPrompt || "").trim();
      if (!authoritativePrompt) {
        return new Response(JSON.stringify({ error: "shot.generationPrompt is required (Cinematographer must populate it)" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aspectRatio = requestedAR
        ? `${requestedAR} ${requestedAR === "9:16" ? "vertical" : requestedAR === "16:9" ? "horizontal" : ""}`
        : (platform === "shorts" || platform === "tiktok" || platform === "reels" ? "9:16 vertical" : "16:9 horizontal");

      // Color calibration (structured machine input; not creative rewriting)
      let colorAnchor = "";
      if (colorCalibration?.dominantColors?.length) {
        const colorList = colorCalibration.dominantColors
          .map((c: any) => `${c.hex} (${c.name || "primary"})`)
          .join(", ");
        colorAnchor = `\n\nCOLOR CALIBRATION (ground truth from product photos — match precisely): ${colorList}.${colorCalibration.isColorSensitive ? " Color-sensitive category: zero tolerance for shade shifts." : ""}`;
      }

      // Frame moment hint — start vs end. Does NOT rewrite creative prompt.
      const frameMoment = frameType === "end"
        ? (shot.frameNDescription ? `\n\nFRAME MOMENT (end of shot, where motion settles): ${String(shot.frameNDescription).trim()}` : "")
        : (shot.frame1Description ? `\n\nFRAME MOMENT (start of shot, neutral readable pose before motion): ${String(shot.frame1Description).trim()}` : "");

      const brandTail = brand
        ? `\n\nBrand context: ${brand.brandName || ""}${brand.colorPalette ? ` · palette ${brand.colorPalette}` : ""}${brand.vibe ? ` · vibe ${brand.vibe}` : ""}.`
        : "";

      const arTail = `\n\nAspect ratio: ${aspectRatio}. One unified frame, one camera, one scene — no split-screen, diptych, collage, or multi-panel. No watermarks.`;
      const finalPrompt = `${authoritativePrompt}${frameMoment}${colorAnchor}${brandTail}${arTail}`;

      // ── Rendering machinery: product reference conditioning ──
      async function fetchToBase64(url: string): Promise<string | null> {
        if (!url) return null;
        if (url.startsWith("data:")) return url;
        try {
          const resp = await fetch(url);
          if (!resp.ok) return null;
          const buf = await resp.arrayBuffer();
          const contentType = resp.headers.get("content-type") || "image/jpeg";
          const bytes = new Uint8Array(buf);
          let binary = "";
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          return `data:${contentType};base64,${btoa(binary)}`;
        } catch { return null; }
      }

      const productRefs = Array.isArray(productImages) ? productImages.slice(0, 3) : [];
      const validProductImages: string[] = [];
      if (productRefs.length) {
        const results = await Promise.all(productRefs.map((u: string) => fetchToBase64(u)));
        for (const r of results) if (r) validProductImages.push(r);
      }

      // Fidelity decision — trust canonical shot_schema.generationMode.
      // anchored/hybrid ⇒ compositing on; free ⇒ off. No prose regex here —
      // the cinematographer already classified the shot upstream.
      const canonicalGenMode: string | undefined =
        typeof shot.generationMode === "string" ? shot.generationMode : undefined;
      const useCompositing =
        validProductImages.length > 0 &&
        (canonicalGenMode === "anchored" || canonicalGenMode === "hybrid");

      // Category signal: explicit only. NEVER infer from undefined wearable.
      const canonicalCategoryRaw =
        (typeof shot.category === "string" && shot.category) ||
        (typeof shot.productCategory === "string" && shot.productCategory) ||
        (typeof brand?.category === "string" && brand.category) ||
        (typeof brand?.productCategory === "string" && brand.productCategory) ||
        (typeof payload?.productCategory === "string" && payload.productCategory) ||
        null;

      const fidelity = buildFidelityPreamble({
        shot,
        productCategory: canonicalCategoryRaw,
        validProductImages,
      });

      console.log(
        `[FIDELITY] category=${fidelity.resolvedCategory ?? "null"} ` +
        `nonApparel=${fidelity.isNonApparel} preambleApplied=${fidelity.applied && useCompositing} ` +
        `refs=${validProductImages.length} genMode=${canonicalGenMode ?? "n/a"} branch=canonical`,
      );
      if (!fidelity.resolvedCategory && validProductImages.length > 0) {
        console.log("[FIDELITY] productCategory UNRESOLVED (NON_APPAREL_LOCK skipped; authority+scale still applied)");
      }

      const messages: any[] = [{
        role: "system",
        content: "You are a product photography AI. Generate ONE photorealistic image. ABSOLUTE RULE: zero text, zero letters, zero logos, zero watermarks unless the user prompt explicitly specifies on-screen text.",
      }];

      if (editBaseUrl) {
        // RETRY · LOCAL EDIT — keep the existing frame, change only the called-out defect.
        const editBase = await fetchToBase64(editBaseUrl);
        const editText =
          `EDIT MODE. The FIRST image is the current render. Keep it IDENTICAL — same composition, lighting, palette, and everything already correct. Change ONLY this: ${String(editInstruction || "").trim()}. Do NOT re-imagine the scene.` +
          (validProductImages.length ? ` The product must match the reference image(s) that follow.` : ``);
        const content: any[] = [{ type: "text", text: editText }];
        if (editBase) content.push({ type: "image_url", image_url: { url: editBase } });
        for (const dataUri of validProductImages) content.push({ type: "image_url", image_url: { url: dataUri } });
        messages.push({ role: "user", content });
        console.log(`[generate-keyframe canonical] EDIT MODE shot=${shot.id} editBase=${editBase ? "ok" : "missing"} instruction="${String(editInstruction || "").slice(0,120)}"`);
      } else if (validProductImages.length > 0 && useCompositing) {
        const preamble = fidelity.text;
        const userText =
          `${preamble}\n\n` +
          `Product reference image(s) attached — the product in your output must be IDENTICAL to the reference (same silhouette, proportions, color, material, hardware, logo placement). Adapt only lighting and shadows to the scene.\n\n` +
          `${finalPrompt}`;
        const content: any[] = [{ type: "text", text: userText }];
        for (const dataUri of validProductImages) {
          content.push({ type: "image_url", image_url: { url: dataUri } });
        }
        messages.push({ role: "user", content });
      } else if (validProductImages.length > 0) {
        // Refs present but generationMode=free → attach for color/grade continuity only, no hard lock.
        const content: any[] = [{
          type: "text",
          text: `Reference image(s) attached for color/lighting continuity only — this is a free/environment shot; do NOT feature the product as the subject.\n\n${finalPrompt}`,
        }];
        for (const dataUri of validProductImages) {
          content.push({ type: "image_url", image_url: { url: dataUri } });
        }
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: "user", content: finalPrompt });
      }

      console.log(`[generate-keyframe canonical] shot=${shot.id} frameType=${frameType} productRefs=${validProductImages.length}/${productRefs.length} ar=${aspectRatio} useCompositing=${useCompositing}`);

      const parts = messagesToNativeParts(messages);
      const modelId = quickMode ? "google/gemini-3.1-flash-image-preview" : "google/gemini-3-pro-image-preview";
      let imageUrl = "";
      try {
        const result = await callNativeGeminiImage({ model: modelId, parts, apiKey: GOOGLE_AI_API_KEY, retries: 3, aspectRatio });
        imageUrl = result.imageDataUrl;
      } catch (err: any) {
        const status = err?.status || 500;
        console.error("[generate-keyframe canonical] error:", status, err?.message || err);
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402 || status === 403) {
          return new Response(JSON.stringify({ error: "AI quota exhausted." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `Keyframe generation failed: ${status}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // data:image → public HTTPS URL (Seedance/Ark reject data: URIs; VPS
      // agent runtime is keyless and needs a fetchable URL).
      let finalKeyframeUrl: string = imageUrl;
      try {
        if (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) {
          const m = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          if (m) {
            const mime = m[1];
            const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
            const bin = atob(m[2]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const admin = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            );
            const path = `_agent-keyframes/${shot.id || "kf"}-${frameType}-${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await admin.storage
              .from("product-images")
              .upload(path, bytes, { contentType: mime, upsert: false });
            if (!upErr) {
              const { data } = admin.storage.from("product-images").getPublicUrl(path);
              if (data?.publicUrl) finalKeyframeUrl = data.publicUrl;
            } else {
              console.warn("[generate-keyframe canonical] data: URI upload failed:", upErr.message);
            }
          }
        }
      } catch (uploadErr) {
        console.warn("[generate-keyframe canonical] data: URI conversion failed:", uploadErr);
      }

      return new Response(JSON.stringify({
        shotId: shot.id,
        keyframeUrl: finalKeyframeUrl,
        prompt: finalPrompt,
        frameType,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ════════════════════════════════════════════════════════════════════
    // LEGACY BLOCK PATH (brand_film + editorial pipelines still call this)
    // ════════════════════════════════════════════════════════════════════

    // [KEYFRAME INPUT AUDIT] — observability for the brand_film pipeline parity contract.
    // If embedded/main-site/MCP diverge, this log makes the missing fields immediately visible.
    // Do NOT log full payloads — only field presence + caller hint.
    try {
      console.log("[KEYFRAME INPUT AUDIT]", JSON.stringify({
        caller: req.headers.get("x-caller") ?? "unknown",
        blockIndex, totalBlocks, frameType,
        hasVisualBible: !!rawVisualBible && Object.keys(rawVisualBible ?? {}).length > 0,
        prevKfCount: Array.isArray(previousKeyframes) ? previousKeyframes.length : 0,
        productImageCount: Array.isArray(productImages) ? productImages.length : 0,
        hasBrand: !!brand?.brandName || !!brand?.productName,
        hasVisualIdentity: !!visualIdentity,
        hasCharacterRef: !!characterReferenceUrl,
        hasPhysicalTraits: !!physicalTraits,
        hasConcept: !!anchorWord || !!sensoryPalette || !!humanState,
        hasVibe: !!vibeId || !!textureId || !!colorGrade,
        hasFilm: !!filmMode || !!filmMood || !!culturalRegister,
        hasWearable: !!wearable,
      }));
    } catch { /* never break keyframe generation on logging */ }



    // ── Director Lens (L1) preamble — informs lighting, framing, and surface choice
    // for every keyframe so that the entire film shares the chosen lens identity.
    const directorLensPreamble = (filmMode || filmMood || culturalRegister)
      ? `DIRECTOR LENS — every choice in this frame must read as: filmMode=${filmMode || "PRODUCT_FILM"} (lens identity), mood=${filmMood || "REVERENCE"} (emotional register), register=${culturalRegister || "en-luxury"} (cultural voice). Lighting, framing, and surface texture must visibly belong to this lens — not a generic premium ad look.\n\n`
      : "";

    // STYLE_DNA — overwrite the visualBible.colorGrade with the user-picked
    // STYLE_DNA "positive" descriptor so every prompt path that reads
    // visualBible.colorGrade automatically reflects the chosen look.
    const styleDna = getStyleDna(colorGrade);
    const visualBible = rawVisualBible
      ? { ...rawVisualBible, colorGrade: styleDna.positive }
      : rawVisualBible;

    // ── Phase B: Keyframe Daring Layer (composition + light geometry) ──
    // Creative decisions for composition + light *geometry* live HERE, not in
    // the clip prompt; the i2v video model inherits them from the first frame.
    // Palette defers to STYLE_DNA (visualBible.colorGrade) — see arbitration
    // rules inside buildKeyframeDaringLayer.
    const keyframeDaringSection = buildKeyframeDaringLayer({
      filmMode,
      filmMood,
      culturalRegister,
      visualBible: visualBible
        ? { colorGrade: visualBible.colorGrade, lighting: (visualBible as any).lighting }
        : null,
    });

    // ═══ PHASE 3: SENSORY ANCHOR WORLD INJECTION ═══
    // Keyframes must visually inhabit the concept's sensory universe so that
    // every still image — and every video clip generated from it — shares
    // the same texture, light, temperature, and movement language.
    let sensoryWorldPreamble = "";
    if (anchorWord) {
      const sp = sensoryPalette || {};
      const dims = [
        sp.texture ? `TEXTURE: ${sp.texture}` : "",
        sp.temperature ? `TEMPERATURE: ${sp.temperature}` : "",
        sp.light ? `LIGHT: ${sp.light}` : "",
        sp.movement ? `MOVEMENT: ${sp.movement}` : "",
      ].filter(Boolean).join(" • ");
      sensoryWorldPreamble = `SENSORY WORLD ANCHOR — "${anchorWord}":
This frame must inhabit the sensory universe of the word "${anchorWord}". ${dims ? `Defining dimensions — ${dims}.` : ""} Every surface, every shadow, every micro-detail must feel like it belongs to that world. Do NOT render a generic premium ad — render the specific atmosphere this word implies.

`;
    }
    // Human-as-experiencer override (when concept provides humanState and block has a human)
    const humanStateBlock = (humanState && block?.hasHuman)
      ? `HUMAN STATE — EXPERIENCER, NOT DISPLAYER: ${String(humanState).slice(0, 200)}. The person is feeling/experiencing the world, not posing for the camera. Eyes, breath, micro-tension all suggest internal experience.

`
      : "";

    if (!block) {
      return new Response(JSON.stringify({ error: "Block is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Native Google AI Studio path (cost optimization vs Lovable Gateway).
    // generate-keyframe is one of the 2 highest-volume image fns — going direct
    // saves ~80% of total Gateway image-credit consumption.
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Visual Bible consistency preamble
    let biblePreamble = "";
    if (visualBible) {
      biblePreamble = `VISUAL CONSISTENCY BIBLE — This keyframe is block ${(blockIndex || 0) + 1} of ${totalBlocks || "several"} in a single ad. ALL blocks MUST share these exact visual specifications:
- COLOR GRADE: ${visualBible.colorGrade}
- LIGHTING: ${visualBible.lighting}
- ENVIRONMENT/SET: ${visualBible.environment}
${visualBible.talent ? `- TALENT: ${visualBible.talent} (the SAME person in every block where talent appears — same skin tone, hair, wardrobe, accessories)` : ""}
    ${visualBible.characterSheet ? `- TALENT IDENTITY (casting contract — same person in EVERY block):
${visualBible.characterSheet}` : ""}
- PRODUCT: ${visualBible.productLook}
- ATMOSPHERE: ${visualBible.atmosphere}
- CAMERA: ${visualBible.camera}

Do NOT deviate from this visual bible. The final ad will cut these blocks together — any inconsistency in color, lighting, talent, or product appearance will break the edit.

`;
    }

    // Build a rich keyframe prompt anchored to the product
    const brandContext = brand
      ? `Brand: "${brand.brandName}". Colors: ${brand.colorPalette}. Vibe: ${brand.vibe}. Typography: ${brand.typography}.`
      : "";

    // Use client-provided aspect ratio; fall back to platform-based guess
    const aspectRatio = requestedAR
      ? `${requestedAR} ${requestedAR === "9:16" ? "vertical" : requestedAR === "16:9" ? "horizontal" : ""}`
      : (platform === "shorts" || platform === "tiktok" || platform === "reels" ? "9:16 vertical" : "16:9 horizontal");

    // Color calibration anchor — ALWAYS try to match real colors, extra strict for sensitive categories
    let colorAnchor = "";
    if (colorCalibration?.dominantColors?.length) {
      const colorList = colorCalibration.dominantColors.map((c: any) => `${c.hex} (${c.name || "primary"})`).join(", ");
      colorAnchor = `\nCOLOR CALIBRATION — CRITICAL: The product's exact colors have been extracted from real photos. Match these HEX values precisely:\n${colorList}\nDo NOT shift, saturate, or reinterpret these colors. They are the ground truth from the real product.${colorCalibration.isColorSensitive ? "\nThis is a COLOR-SENSITIVE product (cosmetics/beauty). Color accuracy is paramount — even slight shade shifts are unacceptable." : ""}`;
    }

    // Sizing/fit anchor — ALWAYS preserve real proportions, extra strict for clothing
    let sizingAnchor = "";
    if (sizingContext?.isSizingSensitive) {
      sizingAnchor = `\nSIZING & FIT — CRITICAL: This is a CLOTHING/WEARABLE product. The following rules are mandatory:
- Do NOT idealize or alter the garment's real proportions, silhouette, or fit
- Match the EXACT cut, drape, length, and structure visible in the reference product images
- If shown on a model, the garment must hang/fit naturally with realistic fabric physics — no vacuum-sealed or painted-on looks
- Preserve real fabric behavior: wrinkles at joints, natural gravity drape, sleeve/hem lengths consistent with reference
- Do NOT change the garment's proportions to flatter the model — show how it actually looks
- BANNED: impossibly perfect fit, fabric defying gravity, proportions that differ from the real product`;
    }

    // Universal fidelity mandate — applies to ALL products regardless of category
    const universalFidelity = `\nUNIVERSAL PRODUCT FIDELITY — MANDATORY FOR ALL PRODUCTS:
- EVERY product attribute must match reality as closely as possible: color, size, shape, proportions, material texture, finish
- When reference product images are provided, treat them as absolute ground truth — the generated image must look like the SAME physical object
- Color: match the real product's hue, saturation, and brightness. Do NOT let lighting dramatically alter the product's perceived color
- Size/Proportions: if the product appears alongside hands, faces, or bodies, maintain correct real-world scale relationships
- Material: preserve the real surface finish — matte vs glossy, rough vs smooth, transparent vs opaque
- Details: logos, labels, stitching, hardware, caps, clasps, buckles — every detail must match the reference
- This is NOT artistic interpretation — this is product reproduction. Accuracy over aesthetics.`;

    // User-provided product specifications
    let specsAnchor = "";
    const specs = productSpecs;
    if (specs) {
      const parts: string[] = [];
      if (specs.colorCodes?.trim()) parts.push(`EXACT COLOR/SHADE: ${specs.colorCodes.trim()} — match these specific shades precisely`);
      if (specs.sizing?.trim()) parts.push(`EXACT SIZING: ${specs.sizing.trim()} — ensure the product's proportions reflect these measurements`);
      if (specs.material?.trim()) parts.push(`MATERIAL/FINISH: ${specs.material.trim()} — render this exact surface texture and finish`);
      if (specs.additionalNotes?.trim()) parts.push(`ADDITIONAL DETAILS: ${specs.additionalNotes.trim()}`);
      if (parts.length > 0) {
        specsAnchor = `\nUSER-PROVIDED PRODUCT SPECIFICATIONS — These are exact details from the product owner. Treat as ground truth:\n${parts.map(p => `- ${p}`).join("\n")}`;
      }
    }

    // Physical traits anchor — prevents AI from distorting product dimensions
    let physicalTraitsAnchor = "";
    if (physicalTraits) {
      const traitParts: string[] = [];
      if (physicalTraits.dimensions?.trim()) traitParts.push(physicalTraits.dimensions.trim());
      if (physicalTraits.distinctiveShape?.trim()) traitParts.push(physicalTraits.distinctiveShape.trim());
      if (physicalTraits.scaleReference?.trim()) traitParts.push(physicalTraits.scaleReference.trim());
      if (traitParts.length > 0) {
        physicalTraitsAnchor = `\nProduct real size: ${traitParts.join(". ")}. Keep accurate — do NOT enlarge.`;
      }
    }

    // Hybrid A+B Strategy: detect whether this block features the product or is environment-only.
    // PRIMARY: trust canonical shot_schema.generationMode set upstream by the creative room.
    //   - "anchored" / "hybrid"  → must composite the real product reference
    //   - "free"                 → environment/atmosphere only, no product anchoring
    // FALLBACK (legacy block-era prose regex) is used ONLY when generationMode is absent,
    // so an anchored product shot whose prose contains cinematic words like "atmosphere",
    // "a quiet pause", or "mood" no longer gets silently downgraded to environment-only.
    const isEnvironmentBlock = block.blockType === "time-lapse"
      || block.blockType === "text-animation"
      || /\b(establishing|skyline|cityscape|landscape|atmosphere|environment[- ]only|no product)\b/i.test(block.visualDescription || "")
      || /\b(transition|breath|pause|mood)\b/i.test(block.purpose || "");

    const shotGenerationMode: "anchored" | "hybrid" | "free" | undefined =
      typeof shot?.generationMode === "string" ? shot.generationMode : undefined;

    const useCompositing =
      (productImages?.length ?? 0) > 0 && (
        shotGenerationMode === "anchored" || shotGenerationMode === "hybrid"
          ? true
          : shotGenerationMode === "free"
            ? false
            : !isEnvironmentBlock // fallback ONLY when shot.generationMode is absent
      );

    // Detect non-apparel product for extra-strict 1:1 reproduction rules.
    // PRIMARY: explicit category signal from shot_schema / ctx / brand.
    // FALLBACK: only trust wearable.isWearable when the wearable object was actually
    // provided — undefined wearable must NOT accidentally flip the 1:1 lock on.
    // Use shared fidelity preamble helper as the single source for the
    // NON_APPAREL_1_1_LOCK + REFERENCE_AUTHORITY + PHYSICAL_SCALE guards.
    // Category resolution: explicit signal only; legacy retains the
    // wearable fallback ONLY when wearable was actually provided
    // (undefined must never flip the lock).
    const explicitCategory = (
      shot?.category || shot?.productCategory ||
      brand?.category || brand?.productCategory ||
      payload?.productCategory
    );
    const explicitCategoryLower = typeof explicitCategory === "string" ? explicitCategory.toLowerCase() : null;

    // Compute valid refs upfront for the preamble; legacy fetch pipeline still
    // runs below and may overwrite into its own variable. The helper only needs
    // to know whether refs exist (length-gated), not the exact base64.
    const _legacyRefCount = Array.isArray(productImages) ? productImages.length : 0;
    const _refsPresentForPreamble = _legacyRefCount > 0 ? new Array(_legacyRefCount).fill("") : [];
    const _legacyFidelity = buildFidelityPreamble({
      shot,
      productCategory: explicitCategoryLower,
      validProductImages: _refsPresentForPreamble,
    });

    // Preserve legacy wearable fallback for isNonApparel (used downstream in
    // compositingPreamble logic), but ONLY when wearable was actually provided.
    const isNonApparel = explicitCategoryLower
      ? _legacyFidelity.isNonApparel
      : (wearable && typeof wearable.isWearable === "boolean" ? !wearable.isWearable : false);

    console.log(
      `[FIDELITY] category=${_legacyFidelity.resolvedCategory ?? "null"} ` +
      `nonApparel=${isNonApparel} preambleApplied=${useCompositing && _legacyFidelity.applied} ` +
      `refs=${_legacyRefCount} genMode=${shotGenerationMode ?? "n/a"} branch=legacy`,
    );
    if (!_legacyFidelity.resolvedCategory && _legacyRefCount > 0) {
      console.log("[FIDELITY] productCategory UNRESOLVED (NON_APPAREL_LOCK skipped; authority+scale still applied)");
    }

    // If non-apparel was set via wearable fallback (no explicit category),
    // synthesize a category-driven preamble so the lock still appears.
    const fidelityPreambleText = (!explicitCategoryLower && isNonApparel)
      ? buildFidelityPreamble({
          shot: null,
          productCategory: "cosmetics", // any non-apparel sentinel; preamble text is category-agnostic
          validProductImages: _refsPresentForPreamble,
        }).text
      : _legacyFidelity.text;

    const nonApparelLock = fidelityPreambleText ? `\n\n${fidelityPreambleText}` : "";

    const imageAnchor = useCompositing
      ? `AI COMPOSITING MODE — PRODUCT FIDELITY MANDATE:
The reference product image(s) are the ABSOLUTE GROUND TRUTH. Your task is to PLACE this exact product into the scene described below.
- The product in your output must be IDENTICAL to the reference: same shape, proportions, material, color, hardware, logo, texture, finish
- Do NOT "re-imagine", "re-interpret", or "stylize" ANY aspect of the product — reproduce it exactly
- Adapt ONLY the lighting and shadows to match the scene environment naturally
- The product is the ANCHOR — build the scene AROUND it, not the other way around
- If any detail conflicts between the scene description and the product reference, the PRODUCT REFERENCE WINS${nonApparelLock}${visualIdentity ? `\nProduct visual identity: ${visualIdentity}` : ""}${universalFidelity}${colorAnchor}${sizingAnchor}${specsAnchor}${physicalTraitsAnchor}`
      : isEnvironmentBlock
      ? `ENVIRONMENT-ONLY SHOT — ZERO PRODUCT PRESENCE:
This is a pure atmosphere/environment/transition shot. Do NOT include the product, packaging, or any brand-identifiable objects in this frame.
Focus entirely on: environment, architecture, landscape, lighting mood, atmospheric elements.
${visualBible ? `COLOR TONE ANCHOR — MANDATORY (ensures seamless intercutting with product shots):
- Color grade: ${visualBible.colorGrade}
- Lighting direction & temperature: ${visualBible.lighting}
- Atmosphere density & haze: ${visualBible.atmosphere}
${visualBible.camera ? `- Lens character: ${visualBible.camera}` : ""}
These values are extracted from the same Visual Bible governing all product shots. Match them EXACTLY so environment frames and product frames share identical color science when edited together. Do NOT introduce cooler/warmer shifts or different contrast curves.` : "The Visual Bible's color grade and lighting direction still apply for visual continuity."}${colorAnchor ? `\n${colorAnchor.replace("product's exact colors", "ad's established color palette")}` : ""}`
      : productImages?.length
      ? `Product reference images provided — match this exact product appearance.${visualIdentity ? `\nProduct visual identity: ${visualIdentity}` : ""}${universalFidelity}${colorAnchor}${sizingAnchor}${specsAnchor}${physicalTraitsAnchor}`
      : visualIdentity
      ? `Product visual identity (match this exactly): ${visualIdentity}${universalFidelity}${colorAnchor}${sizingAnchor}${specsAnchor}${physicalTraitsAnchor}`
      : `${universalFidelity}${colorAnchor}${sizingAnchor}${specsAnchor}${physicalTraitsAnchor}`;

    const previousKeyframeNote = previousKeyframes?.length
      ? `\n\nCONTINUITY REFERENCE (grading & light ONLY): Reference images of previously generated keyframes from this same ad are included. Match them ONLY in these dimensions so the cut feels seamless: color grade, lighting direction/temperature, environment/backdrop family, and — if talent appears — the same person with the same wardrobe.

🚨 DO NOT copy their composition, subject, framing, or shot scale. These previous frames are a COLOR/LIGHT continuity reference, NOT a layout to reproduce.

SHOT INTENT — EXECUTE THIS BLOCK'S OWN BRIEF: This keyframe's blockType, shotScale, composition, camera and subject were decided by the upstream director for THIS specific beat and are DELIBERATELY different from the previous shot. Render exactly what THIS block asks for — a new angle, a new scale, a new framing, or a new subject is the POINT, not a deviation. Visual variation across shots is what makes this an ad and not a catalog of one product re-shot from slightly different angles. The ONLY thing you carry over from the previous frames is the color/light grade above; everything compositional comes from this block's brief.`
      : "";

    // Wearable-specific instructions
    let wearableInstructions = "";
    if (wearable?.isWearable) {
      if (wearable.displayMode === "product-only") {
        wearableInstructions = `\nWEARABLE PRODUCT-ONLY — ABSOLUTE ZERO-HUMAN RULE: Show the ${wearable.category} as a standalone product ONLY. ABSOLUTELY NO humans, NO hands, NO arms, NO fingers, NO body parts, NO silhouettes, NO reflections of people, NO shadows of people. Not even a hint of human presence. Focus EXCLUSIVELY on premium product photography — shape, material, texture, reflections, and craftsmanship. If a hand or body part appears, the image is REJECTED.`;
      } else if (wearable.displayMode === "on-model" || wearable.displayMode === "both") {
        const framingDesc = wearable.framing === "close-up"
          ? `Show ONLY the body area where the ${wearable.category} is worn (hand, wrist, ear, neck, face, etc). Tight framing. Do NOT show full body.`
          : wearable.framing === "half-body"
          ? `Show upper body/torso with the ${wearable.category} clearly visible. Half-body framing.`
          : `Show full body with the ${wearable.category} as part of a complete look. Full-body framing.`;

        // Model body specifications for realistic fit
        let modelDesc = "";
        const ms = wearable.modelSpecs;
        if (ms) {
          const parts: string[] = [];
          if (ms.gender) parts.push(`${ms.gender} model`);
          if (ms.height?.trim()) parts.push(`height: ${ms.height.trim()}`);
          if (ms.weight?.trim()) parts.push(`weight: ${ms.weight.trim()}`);
          if (ms.bodyType) parts.push(`${ms.bodyType} body type`);
          if (ms.additionalNotes?.trim()) parts.push(ms.additionalNotes.trim());
          if (parts.length > 0) {
            modelDesc = `\nMODEL BODY SPECIFICATIONS: ${parts.join(", ")}. 
The garment MUST fit this specific body type realistically:
- A ${ms.bodyType || "average"} build at ${ms.height || "average height"} will have specific proportions — respect them
- Show how the garment ACTUALLY drapes on this body — do NOT idealize the fit
- If the garment is meant to be loose/tight/fitted, show that accurately for THIS body
- The relationship between garment size and body size must be physically correct`;
          }
        }

        wearableInstructions = `\nWEARABLE ON-MODEL: ${framingDesc} The product must look EXACTLY like the original — preserve shape, color, material, pattern, finish.${modelDesc}`;
      }
    }

    // Transition instructions removed — transitions are now post-production only
    const transitionInstructions = "";

    // End-frame specific instructions
    const endFrameInstructions = frameType === "end" ? `
END FRAME GENERATION — This is the FINAL FRAME of block ${(blockIndex || 0) + 1}.
Generate the image that represents the LAST moment of this shot — where the camera motion ends, where the action settles.
Based on the block's camera motion "${block.cameraMotion}" and subject motion "${block.subjectMotion}":
- Show the END STATE of the motion described in the block
- If camera pushes in: show the close-up destination
- If subject turns: show the completed turn position
- If hand lifts product: show product held up
- Maintain EXACT same lighting, color grade, talent, wardrobe, and product as the start frame
${nextBlock ? `\nIMPORTANT — CONTINUITY WITH NEXT BLOCK:
This end frame will also serve as the START FRAME of the next block "${nextBlock.title}" (${nextBlock.blockType}).
The composition should naturally lead into: ${nextBlock.visualDescription}
Ensure the framing, subject position, and environment can seamlessly transition into the next shot.` : ""}
` : "";

    // Block-type-specific keyframe instructions
    let blockTypeInstructions = "";
    if (block.blockType === "time-lapse") {
      blockTypeInstructions = `
TIME-LAPSE KEYFRAME — SPECIAL INSTRUCTIONS:
This block is a TIME-LAPSE environmental transition shot. The keyframe should show:
- A WIDE or ESTABLISHING shot of an environment/cityscape/landscape
- Visible elements that imply motion over time: clouds with directional streaks, light trails from traffic, sun position suggesting golden hour or dusk
- Long-exposure aesthetic: slightly blurred cloud edges, smooth water surfaces, light streaks from moving vehicles
- NO product and NO humans in this shot — this is a pure environment/atmosphere shot
- The composition should feel cinematic and grand — think drone/elevated perspective or architectural framing
- Include subtle motion blur cues that suggest the passage of time even in a still image
- Color palette should match the Visual Bible but can be more dramatic (deeper skies, warmer/cooler extremes)
Do NOT show the product. This is an environment-only transitional moment between scenes.

`;
    } else if (block.blockType === "text-animation") {
      blockTypeInstructions = `
TEXT-ANIMATION KEYFRAME — SPECIAL INSTRUCTIONS:
This block is a TYPOGRAPHY / BRAND TEXT animation frame. The keyframe should show:
- A clean, designed composition featuring text/typography as the PRIMARY visual element
- The text should appear INTEGRATED into a physical surface or material: embossed on marble, printed on textured paper, etched in metal, gold-leafed on dark surface, projected on architecture
- Background should be simple but textured — NOT plain solid color. Use: marble, brushed metal, linen, concrete, leather, dark wood, or architectural surface
- Typography style should match the brand aesthetic: serif for heritage/luxury, sans-serif for modern/minimal, display for bold/editorial
- The composition should feel like a premium title card or chapter break in a brand film
- Lighting should create depth on the text: shadows from letter forms, subtle highlights on embossed edges, light catching metallic finishes
- If the on-screen text is empty, use the brand name as the primary text element
- Color palette: restrained, matching Visual Bible — typically dark background with light text or vice versa
This is NOT a text overlay on footage — it's a DESIGNED typographic composition as its own visual moment.

`;
    }

    // Determine if this is a product-only block (no humans intended)
    const isProductOnly = !block.hasHuman && (wearable?.displayMode === "product-only" || !block.visualDescription?.match(/\b(model|person|man|woman|hand|hands|wearing|worn)\b/i));

    // STYLE LOCK — opens every prompt with the same descriptor so independent
    // generations land in the same visual register. STYLE_DNA palette + positive
    // is also re-anchored at the end so it survives prompt truncation.
    const styleLockPrefix = `${styleAnchorPrefix(colorGrade)}\n\n`;
    const styleLockSuffix = `\n\n${styleAnchorClause(colorGrade)}`;
    // REALISM RULES — single source of truth lives in shared guards.
    // Inline rules removed (used to duplicate ~2700 chars of bokeh/floating/
    // 5-fingers/split-screen warnings already covered by PRG/PSG/ACG).
    // Per-scene rules kept here are ONLY the ones not in the shared guards:
    // (1) frame-completion rule for product-only shots,
    // (2) micro-expression intensity rule for human shots,
    // (3) one-frame composition rule (no diptych/split).
    const sceneSpecificRules = isProductOnly
      ? `NO FRAME COMPLETION: do NOT add hands, arms, fingers or human silhouettes. If the scene has no person, ZERO human presence — no off-frame hands, no reflections of people. A disembodied hand is worse than no hand.`
      : `MICRO-EXPRESSION: all facial expressions stay subtle (3-5 on 1-10). Use "hint of / barely-there / subtle shift toward". BANNED: beaming, grinning, gasping, wide-eyed wonder, ecstatic, overjoyed. Correct anatomy: exactly 5 fingers per hand, natural joints, proportional limbs.`;

    const exactTextRule = block.onScreenText ? `On-screen text overlay: "${block.onScreenText}"
BRAND TEXT LOCK — ABSOLUTE RULE: If any text appears in this image, it must be EXACTLY this string, character-for-character: "${block.onScreenText}". Do NOT rewrite, paraphrase, translate, shorten, expand, beautify, fix grammar, correct spelling, or change punctuation/capitalization in ANY way. If you cannot render the text exactly, OMIT all text entirely.` : `ABSOLUTE ZERO-TEXT RULE — NO TEXT OF ANY KIND: ZERO text, letters, words, typography, logos with text, watermarks, captions, titles, brand names, slogans.`;

    // ── PROMPT-BUDGET FIX ──
    // The per-block creative content (Scene/Subject/Shot/Camera) used to live
    // AFTER the film-level CONSTANT preambles (directorLens + sensoryWorld) in
    // the body. Because enforceImagePromptBudget truncates the body FROM THE
    // TAIL while keeping the head guards, in heavy cases (human + compositing,
    // or rich anchorWord/filmMode) the constant preambles survived and THIS
    // block's unique brief got truncated away — making every block render from
    // the same surviving text (a second homogenization driver, independent of
    // siblingAnchor). Fix: pin a compact, per-block SHOT BRIEF at offset 0 of
    // the body so it always survives, regardless of how aggressive truncation
    // gets. The fuller Scene/Subject/Shot lines below remain (harmless dupes).
    const priorityShotBrief = `SHOT BRIEF — HIGHEST PRIORITY, this block's unique creative intent (never omit): Scene: ${block.visualDescription} · Subject: ${block.subject} · Shot: ${block.shotType} · Camera: ${block.cameraMotion} · Purpose: ${block.purpose}. This shot is DELIBERATELY different from the others — render its specific scene, not a generic version.\n\n`;

    const keyframeBody = `${priorityShotBrief}${directorLensPreamble}${keyframeDaringSection}${sensoryWorldPreamble}${humanStateBlock}Generate a single high-quality advertising keyframe / storyboard still image.
${frameType === "end" ? "This is the END FRAME (final moment) of the shot." : "This is the START FRAME (opening moment) of the shot."}

ONE unified frame, ONE camera, ONE scene — NO split screen, diptych, collage or multi-panel.

Scene: ${block.visualDescription}
Subject: ${block.subject}
Shot type: ${block.shotType}
Camera angle/motion frozen at: ${frameType === "end" ? "END of motion — " : "START of motion — "}${block.cameraMotion}
${frameType !== "end" ? `NEUTRAL START POSE — MANDATORY: This is the FIRST FRAME the viewer sees. Every subject must be in a neutral, settled, readable pose BEFORE any action begins. Feet planted flat, weight balanced, both limbs in natural rest or start position. NO mid-motion frames: no lifted heel, no raised toe, no partial gesture, no arm mid-swing, no hair mid-flip, no fabric mid-swirl. The viewer must be able to read the full scene and understand the spatial relationships before motion begins. Motion starts ONLY after frame 1 — this frame is the calm before the action.` : ""}
Motion preset style: ${block.motionPreset}
Block purpose: ${block.purpose}
${exactTextRule}
${brandContext}
${biblePreamble}${transitionInstructions}${endFrameInstructions}${blockTypeInstructions}${imageAnchor}${previousKeyframeNote}${wearableInstructions}

Technical requirements:
- ${aspectRatio} aspect ratio for ${platform || "social media"} advertising
- Natural lighting matching the Visual Bible mood and direction
- Natural color tones matching the Visual Bible — no heavy grading or film stock filters
- Clean composition suitable for a premium ad
- Photo-realistic quality — looks like a REAL photograph, not a styled/filtered AI image
- No watermarks, no text artifacts unless specified in on-screen text
- This is block ${(blockIndex || 0) + 1} of ${totalBlocks || "several"} — maintain visual continuity

Style: Real photography. This should look like a genuine photograph someone took on set — natural light, real textures, real imperfections. NOT a stylized, filtered, or cinematic-graded AI render.`;

    // Detect beaded / repeating-unit products (bracelets, malas, link chains, …).
    // Pull haystack from block purpose + wearable category + brand name so the
    // regex can fire even if only one carries the keyword (e.g. "Shungite Bracelet 6 mm").
    const repeatingUnitHaystack = [block?.purpose, block?.title, wearable?.category, brand?.brandName, brand?.productName].filter(Boolean).join(" ");
    const repeatingUnitGuard = buildRepeatingUnitGuard(repeatingUnitHaystack);

    const keyframePrompt = enforceImagePromptBudget({
      head: [styleLockPrefix, sceneSpecificRules, useCompositing ? "REFERENCE FIDELITY: attached product image is absolute ground truth; preserve exact silhouette, proportions, color, material, logo and construction. Do not redesign." : "", PHYSICAL_REALISM_GUARD, PHYSICAL_SCALE_GUARD, repeatingUnitGuard, block.hasHuman ? HUMAN_FACE_GUARD : "", buildAntiCinematicGuard(vibeId, textureId)].filter(Boolean).join(" "),
      body: keyframeBody,
      tail: "Product/reference fidelity is mandatory when images are attached. One photoreal frame only; no collage; no watermarks; obey the text rule above.",
    }, `keyframe:${block.id || block.blockType}:${frameType}`);

    // Helper: re-persist an external image to our storage bucket, returning a permanent public URL
    async function rePersistImage(url: string): Promise<string> {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const path = `products/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { error } = await sb.storage.from("product-images").upload(path, bytes, { contentType, upsert: false });
      if (error) throw error;
      const { data: pub } = sb.storage.from("product-images").getPublicUrl(path);
      return pub.publicUrl;
    }

    // Helper: download image URL to base64 data URI, with auto-repersist for external URLs
    async function toBase64DataUri(url: string): Promise<string | null> {
      if (url.startsWith("data:")) return url;
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            console.warn(`Failed to fetch image (${resp.status}): ${url} [attempt ${attempt + 1}/${MAX_RETRIES}]`);
            
            // On final attempt failure for external URLs, try to find a persisted copy or bail
            if (attempt === MAX_RETRIES - 1) {
              // If this is an external URL (not our storage), it's likely expired
              if (!url.includes("supabase.co/storage")) {
                console.warn(`External image expired: ${url.slice(0, 80)}... — will return null (cannot re-persist a 404)`);
              }
              return null;
            }
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          const buf = await resp.arrayBuffer();
          const contentType = resp.headers.get("content-type") || "image/jpeg";
          // Chunk the conversion to avoid "Maximum call stack size exceeded" on large images
          const bytes = new Uint8Array(buf);
          let binary = "";
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const base64 = btoa(binary);
          
          // If this is an external URL that succeeded, persist it for future resilience
          if (!url.includes("supabase.co/storage")) {
            try {
              const persistedUrl = await rePersistImage(url);
              console.log(`Auto-persisted external image for future use: ${persistedUrl.slice(0, 80)}`);
            } catch (e) {
              // Non-fatal — we already have the base64
            }
          }
          
          return `data:${contentType};base64,${base64}`;
        } catch (err) {
          console.warn(`Error fetching image (attempt ${attempt + 1}/${MAX_RETRIES}): ${url}`, err);
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          return null;
        }
      }
      return null;
    }

    // ── VTO Pre-Step: For wearable clothing with on-model images, generate a try-on composite ──
    // This gives the keyframe generator a "product already worn" reference instead of a flat product image
    let vtoCompositeUrl: string | null = null;
    const isClothingVTO = useCompositing
      && wearable?.isWearable
      && (wearable?.displayMode === "on-model" || wearable?.displayMode === "both")
      && onModelImages?.length > 0
      && productImages?.length > 0
      && (
        ["fashion"].includes(block.vertical || "")
        || (wearable?.category && ["dress", "tops", "outerwear", "pants", "knitwear", "suiting"].includes(wearable.category))
      );

    if (isClothingVTO) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          // Pick best on-model image (first) and best product image (first)
          const humanImg = onModelImages[0];
          const clothImg = productImages[0];
          // Map wearable category to cloth type
          const clothTypeMap: Record<string, string> = {
            dress: "overall", tops: "upper", outerwear: "upper",
            knitwear: "upper", pants: "lower", suiting: "overall",
          };
          const clothType = clothTypeMap[wearable?.category || ""] || "overall";

          console.log(`VTO pre-step: Calling kling-virtual-tryon (clothType=${clothType})`);
          const vtoRes = await fetch(`${supabaseUrl}/functions/v1/kling-virtual-tryon`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ humanImageUrl: humanImg, clothImageUrl: clothImg, clothType }),
          });

          if (vtoRes.ok) {
            const vtoData = await vtoRes.json();
            if (vtoData.status === "completed" && vtoData.imageUrl) {
              vtoCompositeUrl = vtoData.imageUrl;
              console.log(`VTO pre-step: Success — composite image obtained`);
            } else if (vtoData.status === "polling" && vtoData.taskId) {
              // VTO timed out in its edge fn — continue polling directly from here
              console.log(`VTO pre-step: Still processing (taskId=${vtoData.taskId}), polling directly...`);
              const KLING_AK = Deno.env.get("KLING_ACCESS_KEY");
              const KLING_SK = Deno.env.get("KLING_SECRET_KEY");
              if (KLING_AK && KLING_SK) {
                const vtoToken = await createKlingToken(KLING_AK, KLING_SK);
                const VTO_POLL_LIMIT = 10; // ~30s more (VTO edge fn already used ~25s, total ~55s before keyframe gen)
                for (let vi = 0; vi < VTO_POLL_LIMIT; vi++) {
                  await new Promise(r => setTimeout(r, 3000));
                  try {
                    const pr = await fetch(`https://api-singapore.klingai.com/v1/images/kolors-virtual-try-on/${vtoData.taskId}`, {
                      headers: { Authorization: `Bearer ${vtoToken}` },
                    });
                    if (!pr.ok) { console.warn(`VTO poll failed (${pr.status})`); await pr.text(); break; }
                    const pd = await pr.json();
                    const st = pd.data?.task_status;
                    if (st === "succeed") {
                      const imgs = pd.data?.task_result?.images;
                      if (imgs?.length) {
                        vtoCompositeUrl = imgs[0].url;
                        console.log(`VTO pre-step: Success after extended polling (${vi + 1} polls)`);
                      }
                      break;
                    }
                    if (st === "failed") { console.warn(`VTO failed: ${pd.data?.task_status_msg}`); break; }
                    console.log(`VTO extended poll ${vi + 1}: status=${st}`);
                  } catch (pollErr) {
                    console.warn("VTO extended poll error:", pollErr);
                    break;
                  }
                }
                if (!vtoCompositeUrl) console.warn("VTO extended polling exhausted, proceeding without VTO");
              }
            }
            console.warn(`VTO pre-step failed (${vtoRes.status}), proceeding without VTO`);
          }
        }
      } catch (vtoErr) {
        console.warn("VTO pre-step error, proceeding without:", vtoErr);
      }
    }

    // Build messages — include product images AND previous keyframes as visual reference
    const hasText = !!block.onScreenText;
    const systemMsg = hasText
      ? `You are a product photography AI. Generate ONE photorealistic image. If on-screen text is specified, render it EXACTLY character-for-character. Never alter, translate, or "improve" the provided text.`
      : `You are a product photography AI. Generate ONE photorealistic image. ABSOLUTE RULE: The output image must contain ZERO text, ZERO letters, ZERO words, ZERO typography, ZERO logos with text, ZERO watermarks of any kind. Do NOT render any brand name, product name, slogan, or any string — even if mentioned in the scene description. Text in output = FAILURE.`;
    const messages: any[] = [{ role: "system", content: systemMsg }];

    // Character reference image gets highest priority — it's the identity anchor
    // For environment-only blocks: EXCLUDE product images to keep the scene product-free
    // If VTO composite exists, use it INSTEAD of raw product + on-model images
    const allImageUrls = [
      ...(characterReferenceUrl ? [characterReferenceUrl] : []),
      ...(siblingAnchorUrl ? [siblingAnchorUrl] : []),
      ...(vtoCompositeUrl
        ? [vtoCompositeUrl] // VTO composite replaces both product + on-model images
        : [
          ...(!isEnvironmentBlock ? (productImages || []).slice(0, 3) : []),
          ...(!isEnvironmentBlock ? (onModelImages || []).slice(0, 2) : []),
        ]),
      ...(previousKeyframes || []).slice(0, characterReferenceUrl ? 1 : 2),
    ].filter((u: string) => u && (u.startsWith("http") || u.startsWith("data:")));

    let effectiveUseCompositing = useCompositing;
    if (allImageUrls.length > 0) {
      // Convert all URLs to base64 in parallel
      const base64Results = await Promise.all(allImageUrls.map((u: string) => toBase64DataUri(u)));
      const validImages = base64Results.filter(Boolean) as string[];

      // Check how many product images survived the fetch
      const productImageCount = (!isEnvironmentBlock ? (productImages || []).slice(0, 3).length : 0);
      const characterRefCount = characterReferenceUrl ? 1 : 0;
      const siblingAnchorCount = siblingAnchorUrl ? 1 : 0;
      const prevKeyframeCount = (previousKeyframes || []).slice(0, characterReferenceUrl ? 1 : 2).length;
      const expectedNonProductCount = characterRefCount + siblingAnchorCount + prevKeyframeCount + (vtoCompositeUrl ? 1 : 0);
      const productImagesFetched = validImages.length - Math.min(expectedNonProductCount, validImages.length);

      // [KEYFRAME IMAGES TRACE] — single line answering: (1) did images arrive & base64 OK,
      // (2) which flags decided COMPOSITING / 1:1 NON-APPAREL preamble.
      try {
        console.log("[KEYFRAME IMAGES TRACE]", JSON.stringify({
          caller: req.headers.get("x-caller") ?? "unknown",
          blockIndex,
          // Inbound
          productImagesIn: Array.isArray(productImages) ? productImages.length : 0,
          characterRefIn: !!characterReferenceUrl,
          siblingAnchorIn: !!siblingAnchorUrl,
          vtoCompositeIn: !!vtoCompositeUrl,
          prevKeyframesIn: Array.isArray(previousKeyframes) ? previousKeyframes.length : 0,
          // Base64 result
          totalUrls: allImageUrls.length,
          base64OK: validImages.length,
          productImagesBase64: productImagesFetched,
          // Preamble decision inputs
          useCompositing,
          isEnvironmentBlock,
          isNonApparel,
          wearableIsWearable: wearable?.isWearable ?? null,
          blockType: block?.blockType ?? null,
          blockPurpose: typeof block?.purpose === "string" ? block.purpose.slice(0, 60) : null,
        }));
      } catch { /* never break on logging */ }

      
      
      // If compositing was expected but ALL product images failed → return actionable error
      if (useCompositing && productImageCount > 0 && productImagesFetched === 0) {
        console.error(`PRODUCT IMAGES EXPIRED: All ${productImageCount} product image(s) failed to fetch. Returning error to client.`);
        return new Response(JSON.stringify({ 
          error: "Product reference images have expired. Please go back and re-upload your product photos to continue.",
          code: "PRODUCT_IMAGES_EXPIRED"
        }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract compact identity string from characterSheet for image-level anchoring
      const identitySummary = characterReferenceUrl && visualBible?.characterSheet
        ? ` Identity: ${String(visualBible.characterSheet).slice(0, 200)}.`
        : "";

      // Compositing-aware prompt: when product images exist AND block features product
      const compositingPreamble = useCompositing
        ? vtoCompositeUrl
          ? `VTO-ANCHORED COMPOSITING: A Virtual Try-On image is provided showing the EXACT product already worn on a model. This is your PRIMARY reference for how the garment looks when worn — match the fit, drape, proportions, and fabric behavior EXACTLY. Your task is to place this clothed figure into the cinematic scene below, adapting ONLY lighting and environment.\n\n`
          : isNonApparel
          ? `1:1 PRODUCT COMPOSITING — NON-APPAREL: The reference image shows the EXACT physical product. Your output must contain this IDENTICAL object — same silhouette, same number of facets/curves/edges, same cap/lid/hardware, same material finish, same proportions. This is NOT creative interpretation — this is product REPRODUCTION. Study every detail of the reference before generating. Adapt ONLY lighting/shadows to the scene.\n\n`
          : `COMPOSITING TASK: Place the EXACT product from the reference image(s) into the scene below. The product must be pixel-faithful to the reference — same shape, hardware, material, finish. Adapt only lighting/shadows to the scene.\n\n`
        : isEnvironmentBlock
        ? `ENVIRONMENT SHOT: No product in this frame. Focus on atmosphere, architecture, and cinematic environment.\n\n`
        : "";

      const siblingAnchorClause = siblingAnchorUrl
        ? `SIBLING SHOT — STRICT CONSISTENCY: An anchor frame from the SAME scene/cluster is included as a reference image. Your output MUST match its wardrobe, hair, skin tone, lighting direction & temperature, color grade, background, and props EXACTLY. Only the camera framing/angle changes — everything else is identical. Treat this as the visual ground truth for scene continuity.\n\n`
        : "";
      const content: any[] = [
        {
          type: "text",
          text: `${characterReferenceUrl ? `IMAGE #1 IS THE CHARACTER REFERENCE — match this EXACT person.${identitySummary} Same face, skin tone, ethnicity, age, hair, build in every block.\n\n` : ""}${siblingAnchorClause}${useCompositing ? "Product reference images follow — the product must appear IDENTICAL to these references, placed naturally into the scene." : ""}${previousKeyframes?.length ? "\nPrevious keyframes from this ad included — match their color grading, lighting, and talent." : ""}\n\n${compositingPreamble}${keyframePrompt}`,
        },
      ];
      for (const dataUri of validImages) {
        content.push({
          type: "image_url",
          image_url: { url: dataUri },
        });
      }
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: keyframePrompt });
    }

    const strategy = useCompositing ? "METHOD-B (compositing)" : isEnvironmentBlock ? "METHOD-A (environment-only)" : "METHOD-A (standard)";
    const engineLabel = keyframeEngine === "gpt-image-2" ? "GPT Image 2 (Gateway)" : "native Gemini";
    console.log(`Generating keyframe for block: ${block.title} (${block.blockType}) — strategy: ${strategy} [${engineLabel}]`);

    let imageUrl = "";

    if (keyframeEngine === "gpt-image-2") {
      // ── GPT Image 2 via Lovable AI Gateway ──
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

      const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
      const gptPayload = {
        model: "google/gemini-3-pro-image-preview",
        // GPT Image 2 doesn't exist on Gateway yet — use the best available
        // image model. When OpenAI image gen is added to Gateway, swap model here.
        // For now we route to gemini-3-pro-image-preview but via Gateway (not native).
        messages,
        modalities: ["image", "text"],
        generationConfig: { maxOutputTokens: 8192 },
      };

      const MAX_RETRIES = 3;
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const resp = await fetch(AI_GATEWAY_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(gptPayload),
          });
          if (!resp.ok) {
            const errText = await resp.text();
            if ([429, 500, 502, 503, 504].includes(resp.status) && attempt < MAX_RETRIES) {
              console.warn(`[GPT-Image-2] attempt ${attempt}/${MAX_RETRIES} → ${resp.status}`);
              await new Promise(r => setTimeout(r, 1000 * attempt));
              lastErr = new Error(`Gateway ${resp.status}: ${errText.slice(0, 200)}`);
              continue;
            }
            if (resp.status === 429) {
              return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
                status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            if (resp.status === 402) {
              return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
                status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            throw new Error(`Gateway ${resp.status}: ${errText.slice(0, 200)}`);
          }
          const data = await resp.json();
          imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
          if (!imageUrl) throw new Error("No image returned from Gateway");
          break;
        } catch (e: any) {
          lastErr = e;
          if (attempt === MAX_RETRIES) throw lastErr;
        }
      }
    } else {
      // ── Native Gemini (default, cost-optimized) ──
      const parts = messagesToNativeParts(messages);
      const modelId = quickMode ? "google/gemini-3.1-flash-image-preview" : "google/gemini-3-pro-image-preview";

      try {
        const result = await callNativeGeminiImage({ model: modelId, parts, apiKey: GOOGLE_AI_API_KEY, retries: 3, aspectRatio });
        imageUrl = result.imageDataUrl;
      } catch (err: any) {
        const status = err?.status || 500;
        console.error("Keyframe generation error:", status, err?.message || err);
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402 || status === 403) {
          return new Response(JSON.stringify({ error: "AI quota exhausted. Please check your Google AI Studio billing." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`Keyframe generation failed: ${status}`);
      }
    }

    console.log(`Keyframe generated successfully for block: ${block.title}`);

    // If the model returned a data:image base64 URI, persist it to product-images
    // (service-role upload) and return a public HTTPS URL. Seedance/Ark + several
    // i2v engines reject data: URIs outright, so this MUST happen before we
    // return to a keyless caller (e.g. the VPS agent runtime).
    let finalKeyframeUrl: string = imageUrl;
    try {
      if (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) {
        const m = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (m) {
          const mime = m[1];
          const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
          const bin = atob(m[2]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const admin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          );
          const path = `_agent-keyframes/${block.id || "kf"}-${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await admin.storage
            .from("product-images")
            .upload(path, bytes, { contentType: mime, upsert: false });
          if (!upErr) {
            const { data } = admin.storage.from("product-images").getPublicUrl(path);
            if (data?.publicUrl) finalKeyframeUrl = data.publicUrl;
          } else {
            console.warn("[generate-keyframe] data: URI upload failed:", upErr.message);
          }
        }
      }
    } catch (uploadErr) {
      console.warn("[generate-keyframe] data: URI conversion failed:", uploadErr);
    }

    return new Response(JSON.stringify({
      blockId: block.id,
      keyframeUrl: finalKeyframeUrl,
      prompt: keyframePrompt,
      frameType,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-keyframe error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
