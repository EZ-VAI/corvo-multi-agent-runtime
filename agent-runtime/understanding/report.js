// Understanding report — the present moment: shows the brand "we get
// you". Plain language, confidence in human words, light to adjust.

function tone(conf) {
  return conf === "high"
    ? "We're confident about this"
    : "This is our read — tell us if it's off";
}

function buildReport(brain, strategyBrief) {
  const cm = brain.confidenceMap || {};
  const items = [];

  if (brain.essence && Object.keys(brain.essence).length) {
    items.push({
      key: "essence",
      heading: "Who you are",
      body: brain.essence.one_line
        || brain.essence.summary
        || JSON.stringify(brain.essence),
      confidence: cm.essence || "low",
      confidenceLabel: tone(cm.essence),
      editable: true,
    });
  }

  if (brain.visual_dna && Object.keys(brain.visual_dna).length) {
    const v = brain.visual_dna;
    const body = [v.palette, v.light_philosophy, v.material_truth]
      .filter(Boolean)
      .join(" · ") || JSON.stringify(v);
    items.push({
      key: "visual_dna",
      heading: "Your visual signature",
      body: body,
      confidence: cm.visual_dna || "low",
      confidenceLabel: tone(cm.visual_dna),
      editable: true,
    });
  }

  if (brain.anti_identity && Object.keys(brain.anti_identity).length) {
    const a = brain.anti_identity;
    const nevers = [].concat(a.never || [], a.banned_optics || []);
    items.push({
      key: "anti_identity",
      heading: "What we'll keep your films away from",
      body: nevers.length
        ? nevers.join("; ")
        : "We haven't pinned this down yet — anything you'd never want?",
      confidence: cm.anti_identity || "low",
      confidenceLabel: tone(cm.anti_identity),
      editable: true,
      highlight: true,
    });
  }

  if (brain.value_translation && Object.keys(brain.value_translation).length) {
    const vt = brain.value_translation;
    let body = vt.why_worth_the_price || vt.moment_of_use;
    if (!body) {
      body = Array.isArray(vt._seed_selling_angles)
        ? vt._seed_selling_angles.join("; ")
        : JSON.stringify(vt);
    }
    items.push({
      key: "value_translation",
      heading: "What we think makes people want it",
      body: body,
      confidence: cm.value_translation || "low",
      confidenceLabel: tone(cm.value_translation),
      editable: true,
    });
  }

  // --- Strategy brief (from the strategy agent) — second part of the present ---
  if (strategyBrief && Object.keys(strategyBrief).length) {
    const labels = {
      audience: "Who this film speaks to",
      core_message: "The one thing it says",
      emotional_register: "How it should feel",
      target_reaction: "What we want them to feel/do",
    };
    const order = ["audience", "core_message", "emotional_register", "target_reaction"];
    for (const f of order) {
      const cell = strategyBrief[f];
      if (cell && cell.content) {
        items.push({
          key: "strategy_" + f,
          section: "strategy",
          heading: labels[f] || f,
          body: cell.content,
          source: cell.source || "agent",
          editable: true,
          confidence: "high",
          confidenceLabel: "Our plan for this film — adjust if you'd like",
        });
      }
    }
  }

  let toConfirm = items.find(function (i) {
    return i.highlight && i.confidence === "low";
  });
  if (!toConfirm) {
    toConfirm = items.find(function (i) { return i.confidence === "low"; });
  }

  return {
    items: items,
    leadConfirm: toConfirm ? toConfirm.key : null,
    note: "Edit anything that's off, or skip — we'll run with this either way.",
  };
}

module.exports = { buildReport };
