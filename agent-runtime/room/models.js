// agent-runtime/room/models.js
//
// Per-role model assignment for the creative room. Env-overridable so cost/
// quality can be retuned without code changes.
//
//   director        — orchestration + ruling. strongest model.
//   critic          — must genuinely push back; a weak critic only rubber-stamps.
//                     strongest model.
//   cinematographer — NOW a real shot DECISION agent (absorbed generate-blocks'
//                     decision half), no longer a translator. It DECIDES the shots
//                     AND writes the generationPrompt itself, drawing on
//                     shot_knowledge as reference (no separate prompt-writing tool —
//                     a rigid recipe tool would cage the model and breed sameness).
//                     Promoted to the strongest model.

module.exports = {
  director: process.env.MODEL_DIRECTOR || "openai/gpt-5.5",
  critic: process.env.MODEL_CRITIC || "openai/gpt-5.5",
  cinematographer: process.env.MODEL_CINEMATOGRAPHER || "openai/gpt-5.5",
  overseer: process.env.MODEL_OVERSEER || "openai/gpt-5.5",
};
