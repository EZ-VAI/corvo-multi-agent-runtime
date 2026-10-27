/**
 * Hero Image Selection — pick the 3 most complementary product images.
 *
 * Extracted from analyze-product so agent-chat (and any future pipeline
 * that takes raw image uploads) can reuse the same Gemini Vision curator
 * logic. Returns the picked URLs in selection order; falls back to the
 * first 3 of `urls` on any failure (never throws to caller).
 */

const HERO_SELECT_SYSTEM = `You are a product photography curator. Given multiple product images, pick the 3 MOST COMPLEMENTARY images that together give the most complete visual understanding of the product. Selection criteria, in order:
1. ONE main view: the clearest, most complete product silhouette (front/3-quarter/best angle).
2. ONE complementary angle: shows what view #1 hides (side, back, top, opposite angle).
3. ONE detail/macro shot: material texture, finish, logo, or distinctive feature close-up.

If the product is being worn/used in some images, prioritize at least one product-only shot for #1.
Avoid: lifestyle/scene shots without the product, duplicates of the same angle, blurry images, banner/marketing graphics.
Return ONLY a JSON object — no markdown — with this shape: {"indices":[i,j,k]} where each index is the 0-based position of the chosen image. Pick exactly 3 indices unless fewer images exist.`;

function parseLooseJson(raw: string): { indices?: unknown } {
  try {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return {};
  }
}

export interface SelectHeroImagesArgs {
  urls: string[];
  /** LOVABLE_API_KEY for the AI Gateway (gemini-2.5-flash). */
  lovableApiKey: string;
  /** Optional logger. */
  log?: (msg: string) => void;
}

/**
 * Returns up to 3 image URLs picked as "most complementary". If the input
 * already has <=3 images, returns the input as-is. Never throws.
 */
export async function selectHeroImages(
  args: SelectHeroImagesArgs,
): Promise<string[]> {
  const log = args.log ?? ((m: string) => console.log(`[heroImageSelection] ${m}`));
  const candidatePool = (args.urls || []).filter(
    (u) => typeof u === "string" && (u.startsWith("http") || u.startsWith("data:")),
  );
  if (candidatePool.length <= 3) return [...candidatePool];
  if (!args.lovableApiKey) {
    log("no LOVABLE_API_KEY — returning first 3");
    return candidatePool.slice(0, 3);
  }

  try {
    const messages = [
      { role: "system", content: HERO_SELECT_SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Pick the 3 most complementary images from this set of ${candidatePool.length}. Indices are 0-based, in the order shown below.`,
          },
          ...candidatePool.flatMap((url, i) => [
            { type: "text" as const, text: `[Image ${i}]` },
            { type: "image_url" as const, image_url: { url } },
          ]),
        ],
      },
    ];
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
    });
    if (!res.ok) {
      log(`hero selection AI call failed: ${res.status}`);
      return candidatePool.slice(0, 3);
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content || "";
    const parsed = parseLooseJson(content);
    const indices: number[] = Array.isArray(parsed.indices)
      ? (parsed.indices as unknown[]).filter(
          (i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < candidatePool.length,
        ) as number[]
      : [];
    const picked = indices.slice(0, 3).map((i) => candidatePool[i]);
    const deduped = [...new Set(picked)].slice(0, 3);
    if (deduped.length === 0) {
      log("no usable indices — falling back to first 3");
      return candidatePool.slice(0, 3);
    }
    log(`picked indices ${JSON.stringify(indices)} -> ${deduped.length} images`);
    return deduped;
  } catch (e) {
    log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    return candidatePool.slice(0, 3);
  }
}
