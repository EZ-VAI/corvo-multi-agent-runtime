/**
 * room-storyboard — SERVICE-ROLE storyboard generator for the VPS room.
 *
 * NOT user-facing. No auth, no credit deduction. Renders ONE 8-panel
 * horizontal storyboard image via gpt-image-2 conditioned on the real
 * product reference image(s) for fidelity, then uploads to product-images
 * and returns its public URL.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireVpsOrUser } from "../_shared/vpsAuthGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-caller",
};

interface Body {
  panels: string[];          // 8 captions
  world: string;             // shared-world paragraph
  includePeople: boolean;
  productImages: string[];   // public URLs of real product refs
  colorAnchor?: string;      // hex
  size?: string;
}

function buildPrompt(b: Body): string {
  const schedule = Array.from({ length: 8 }, (_, i) => {
    const start = +((i * 15) / 8).toFixed(1);
    const end = +(((i + 1) * 15) / 8).toFixed(1);
    return { idx: i + 1, label: `${start}s–${end}s` };
  });
  const panelList = schedule
    .map((s, i) => {
      const note = (b.panels[i] || "").trim().slice(0, 200);
      return `   Panel ${s.idx} (${s.label}): "${note}" — render this exact beat. The caption printed below the panel MUST read: "${s.label}: ${note}".`;
    })
    .join("\n");

  const people = b.includePeople === false
    ? "Product-only — NO people, NO hands, NO models in any panel."
    : "Include human presence (hands, partial figure, model) where it serves the story.";

  const colorLine = b.colorAnchor
    ? `\nThe product's colour is exactly ${b.colorAnchor}.`
    : "";

  return `Create a single, high-resolution HORIZONTAL STORYBOARD in the style of a professional film production storyboard.

SHARED WORLD / ART DIRECTION (applies to ALL panels):
${b.world.trim()}

LAYOUT (strict):
- Pure white background, no decorative borders.
- 4 columns × 2 rows = exactly 8 panels arranged in reading order (top-left → top-right → bottom-left → bottom-right).
- Each panel is a clean rectangular frame with a thin black border.
- BELOW each panel print ONE line of black sans-serif caption text: the timestamp range, a colon, and a SHORT action note. Example: "0s–1.9s: model unscrews cap, slow push-in".
- Generous white gutters between panels (~3% of panel width). NO panel numbers inside the image — only the timestamp captions below.

${people}

PANELS — render these 8 sequential beats:
${panelList}

PER-PANEL ART DIRECTION:
- Photorealistic, editorial commercial photography.
- CONSISTENT identity, wardrobe, set, lighting and colour grade ACROSS ALL 8 panels.
- Each panel = ONE clear shot (vary shot scale: wide, medium, close-up, extreme close-up — but keep the same world).
- The product in every panel is the item in the supplied reference image(s) — render its exact shape, colour and finish; never reinvent it.${colorLine}

CAPTION TEXT RULES:
- Black sans-serif on the white gutter directly below each panel, single line, no wrapping.
- Format exactly: "<start>s–<end>s: <short action>".

NO overall title, NO logos, NO watermarks, NO extra explanatory text outside the panel captions.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireVpsOrUser(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.panels) || body.panels.length !== 8) {
    return new Response(JSON.stringify({ ok: false, error: "panels must be an array of 8 strings" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!Array.isArray(body.productImages) || body.productImages.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "productImages required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const prompt = buildPrompt(body);
  const size = body.size || "1536x1024";

  try {
    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("prompt", prompt.slice(0, 32000));
    form.append("size", size);
    form.append("n", "1");

    let attached = 0;
    for (const url of body.productImages.slice(0, 6)) {
      try {
        const r = await fetch(url);
        if (!r.ok) { console.warn("[room-storyboard] ref fetch failed", url, r.status); continue; }
        const blob = await r.blob();
        const ext = (blob.type.split("/")[1] || "png").split(";")[0];
        form.append("image[]", new File([blob], `ref-${attached}.${ext}`, { type: blob.type || "image/png" }));
        attached++;
      } catch (e) {
        console.warn("[room-storyboard] ref error", url, (e as Error).message);
      }
    }
    if (attached === 0) {
      return new Response(JSON.stringify({ ok: false, error: "No product reference images could be downloaded" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const oaiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });

    if (!oaiRes.ok) {
      const txt = await oaiRes.text();
      console.error("[room-storyboard] OpenAI error:", oaiRes.status, txt.slice(0, 500));
      return new Response(JSON.stringify({ ok: false, error: `openai_${oaiRes.status}`, detail: txt.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const oaiJson = await oaiRes.json();
    const b64: string | undefined = oaiJson?.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ ok: false, error: "openai_empty" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `_storyboards/${crypto.randomUUID()}.png`;
    const { error: upErr } = await sb.storage.from("product-images").upload(path, bytes, {
      contentType: "image/png", upsert: false,
    });
    if (upErr) {
      return new Response(JSON.stringify({ ok: false, error: `upload_failed: ${upErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = sb.storage.from("product-images").getPublicUrl(path);

    return new Response(JSON.stringify({ ok: true, data: { url: pub.publicUrl } }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[room-storyboard] fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || "fatal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
