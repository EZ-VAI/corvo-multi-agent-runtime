/**
 * Prompt obfuscation layer — encodes internal generation prompts
 * so they are not human-readable in network responses.
 * Uses a simple XOR cipher + base64. Not cryptographic security,
 * but sufficient to prevent casual inspection of prompt strategies.
 */

const OBF_KEY = "crvx2026";

function xorCipher(input: string, key: string): string {
  const result: number[] = [];
  for (let i = 0; i < input.length; i++) {
    result.push(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return String.fromCharCode(...result);
}

export function encodePrompt(raw: string): string {
  if (!raw) return "";
  const xored = xorCipher(raw, OBF_KEY);
  // Convert to base64 — handle unicode by encoding to bytes first
  const bytes = new TextEncoder().encode(xored);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr);
}

export function decodePrompt(encoded: string): string {
  if (!encoded) return "";
  try {
    const binStr = atob(encoded);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const xored = new TextDecoder().decode(bytes);
    return xorCipher(xored, OBF_KEY);
  } catch {
    // If decoding fails, treat as plain text (backwards compat)
    return encoded;
  }
}

/**
 * Sanitize a generation prompt for user-facing display.
 * Strips Visual Bible injections, guard blocks, and technical directives.
 */
export function sanitizeForClient(raw: string): string {
  if (!raw) return "";
  let s = raw;

  // Strip Visual Bible preamble (Camera:/Lens:/Grade:/Film:/Light:/Mood:)
  s = s.replace(/^(?:Camera|Lens|Grade|Film|Light|Mood):\s*[^[\]]*?(?=\[|$)/gim, " ");
  // Strip guard blocks
  s = s.replace(/\[LIGHT\][^[]*?(?=\[|$)/gi, " ");
  s = s.replace(/\[MATERIAL\][^[]*?(?=\[|$)/gi, " ");
  s = s.replace(/COLOR:\s*[^[]*?(?=\[|$)/gi, " ");
  // Strip directives
  s = s.replace(/LIFELIKE:\s*[^.]*(?:\.[^.]*){0,5}\.\s*/gi, " ");
  s = s.replace(/(?:GAIT|Feet step forward only)\.\s*/gi, " ");
  s = s.replace(/REALISM:\s*[^.]+\.\s*/gi, " ");
  // Strip quality/silent tail
  s = s.replace(/,?\s*Photorealistic[^.]*\.?\s*(?:single continuous take[^.]*\.?\s*)?(?:natural imperfections[^.]*\.?\s*)?(?:SILENT[^.]*\.?\s*)?/gi, " ");
  s = s.replace(/,?\s*single continuous take[^.]*\.?\s*/gi, " ");
  s = s.replace(/,?\s*natural imperfections[^.]*\.?\s*/gi, " ");
  s = s.replace(/,?\s*SILENT:?\s*(?:no sound)?[^.]*\.?\s*/gi, " ");
  // Strip "Smooth, slow, breathing movement"
  s = s.replace(/Smooth,?\s*slow,?\s*breathing movement\.?\s*/gi, " ");

  // Friendly section labels
  const labels: Record<string, string> = {
    "[MOVEMENT]": "🎬 Camera:",
    "[SCALE]": "📐 Framing:",
    "[SUBJECT]": "🎯 Subject:",
    "[COMPOSITION]": "🖼 Composition:",
    "[FOCUS]": "🔍 Focus:",
    "[MOOD]": "✨ Mood:",
    "[FRAME 1]": "▶️ Opens with:",
    "[FRAME N]": "⏹ Ends with:",
  };
  for (const [tag, label] of Object.entries(labels)) {
    s = s.replace(new RegExp(tag.replace(/[[\]]/g, "\\$&"), "g"), label);
  }

  return s.replace(/\s+/g, " ").replace(/\.\s*\./g, ".").replace(/\s+\./g, ".").trim();
}
