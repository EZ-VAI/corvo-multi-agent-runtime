// room/gridQC.js — objective pixel QC before Seedance spend. Binary checks only
// (counting & contradiction), zero aesthetic judgment. gpt-4o-mini vision.
async function gridQC(gridUrl, opts) {
  var key = process.env.OPENAI_API_KEY;
  // This function is the last cheap gate before Seedance spend. If the gate
  // itself is unavailable, that is NOT a pass: spending without inspection is
  // exactly the failure this gate exists to prevent.
  if (!key) return { pass: false, blocked: true, unavailable: true, reason: "no_openai_key", violations: [] };
  var c = (opts && opts.contract) || {};
  var lbl = (opts && opts.labelText) || null;
  var characterReference = (opts && opts.characterReference) || null;
  var checks = [
    "1. In any SINGLE panel, does the product appear more than once (two units, a duplicate, or a mirrored double)? Product duplicates in DIFFERENT panels are fine.",
    c.usage ? "2. Does any hand/gesture interacting with the product CONTRADICT this usage: \"" + c.usage + "\"? (e.g. spraying a roller product)" : null,
    "3. Is the product placed in a physically impossible or nonsensical way (floating, propped in front of a bag instead of inside/beside it, defying gravity)?",
    "4. Does any panel show a DIFFERENT product than the others (wrong shape/colour vs the rest)?",
    lbl ? ("5. In any panel where text on the product's own label/packaging is legible, is the brand word misspelled or altered from \"" + lbl + "\"? Extra words on the label are fine; only flag a wrong or misspelled brand word.") : null,
    "6. Does any single panel contain the protagonist TWICE (a reflection or duplicate with a different pose/face than the real person), or a second sharp-focus person competing with her?",
    characterReference ? "7. Compare the protagonist to the supplied CANONICAL CHARACTER reference. Is this clearly the SAME person with the same facial identity, hair and core wardrobe? Ignore pose, expression, camera angle and lighting." : null,
  ].filter(Boolean).join("\n");
  var content = [
    { type: "text", text: "IMAGE 1 is the NEW 8-panel storyboard grid for an ad." + (characterReference ? " IMAGE 2 is the CANONICAL CHARACTER reference from the first approved people-board." : "") + " Answer ONLY these objective checks — no aesthetic opinions:\n" + checks + "\nReturn JSON: {\"pass\": boolean (true only if ALL checks are clean), \"violations\": [{\"panel\": n, \"issue\": \"short factual description\"}]}" },
    { type: "image_url", image_url: { url: gridUrl, detail: "high" } },
  ];
  if (characterReference) content.push({ type: "image_url", image_url: { url: characterReference, detail: "high" } });
  var body = { model: "gpt-4o-mini", max_tokens: 500, response_format: { type: "json_object" }, messages: [
    { role: "user", content: content },
  ] };
  var r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) });
  var t = await r.text();
  if (!r.ok) { console.warn("[qc] api " + r.status); return { pass: false, blocked: true, unavailable: true, reason: "api_" + r.status, violations: [] }; }
  try {
    var out = JSON.parse(JSON.parse(t).choices[0].message.content);
    var violations = Array.isArray(out.violations) ? out.violations.slice(0, 8) : [];
    var pass = out.pass === true && violations.length === 0;
    if (!pass && !violations.length) violations.push({ panel: 0, issue: "QC returned a non-pass verdict without panel detail" });
    return { pass: pass, blocked: !pass, violations: violations, characterCompared: !!characterReference };
  } catch (e) { return { pass: false, blocked: true, unavailable: true, reason: "parse", violations: [] }; }
}
module.exports = { gridQC };
