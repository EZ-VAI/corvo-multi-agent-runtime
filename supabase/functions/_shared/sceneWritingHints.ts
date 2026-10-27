/**
 * Scene-writing hints for LLMs that generate video prompts.
 *
 * These replace the removed ASSOCIATION_SCENE_RULES and SCENE_CAUSALITY_RULES
 * frameworks. They teach the LLM to write concrete, model-friendly descriptions
 * instead of abstract film theory that video models cannot interpret.
 */

/** Injected into LLM system prompts that produce generationPrompt / video descriptions. */
export const LLM_SCENE_WRITING_HINTS = `
WRITE FOR A VIDEO MODEL, NOT A HUMAN READER:
The final prompt is read by an AI video model that has NO understanding of film theory, metaphor, or abstract concepts. It only understands concrete visual descriptions.
1. SHORTER IS BETTER. Keep each shot description under 600 chars. Every extra word dilutes the model's focus.
2. Write ONLY what the camera literally sees: physical objects, position, material, color, motion direction, speed. NO "feeling", "emotion", "atmosphere", or "narrative tension".
3. ONE metaphor per film, MAX. Describe it as a PHYSICAL event ("silk slides off table, folds catching side-light"), NOT symbolism. Add ONE bridge shot where metaphor and product physically touch. Then move on.
4. CAUSE BEFORE EFFECT. Every motion needs a visible trigger: wind, a hand, gravity. Light leads the moving object — illuminate the path before the subject enters.
5. WEIGHT = SPEED. Heavy objects decelerate with inertia. Light objects drift. Match motion speed to real-world mass.
6. SURFACES REACT. Object touches surface → describe the response: marble reflects, water ripples, fabric wrinkles. Static surfaces next to moving objects look fake.
7. NEVER write abstract concepts the model cannot render: "tension builds", "desire awakens", "luxury whispers", "time stands still". These become random visual noise.`.trim();
