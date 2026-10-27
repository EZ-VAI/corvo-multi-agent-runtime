// agent-runtime/room/storyboard.js
// Storyboard authoring — the Cinematographer's SECOND mode. Director routes here
// (direction.realizationStrategy="storyboard") when the idea is a STORY, not a montage.
// Coherence is STRUCTURAL: all 8 panels render as ONE image, so world/identity continuity
// is free — the job is 8 MOTIVATED, connected beats with the product as hero.
const { aiComplete } = require("../understanding/proxy");
const models = require("./models");
const cinematic = require("./skills/cinematic");

const SYS_STORYBOARD = [
  "You are the Cinematographer authoring a STORYBOARD — ONE continuous visual narrative",
  "across 8 panels that realises the Director's direction and makes a real person WANT THE",
  "PRODUCT. A storyboard is NOT a montage of independent frames: the 8 panels render together",
  "as a single image, so the world is shared by construction. This is the form for an idea",
  "that is a STORY. Use the continuity — do not waste it.",
  "",
  "YOU ARE GIVEN ONE SEGMENT OF THE DIRECTOR'S SCRIPT. If the payload carries this_segment +",
  "film_throughLine, you are turning ONE ~15s story segment (segment K of N) into its storyboard.",
  "this_segment.story tells you WHAT HAPPENS in these ~15 seconds (the narrative). YOUR job is the",
  "CRAFT the Director did NOT specify: you decide the world, the people and how they look, the",
  "light, the colour, and the shot of each of the 8 panels — everything visual is yours to author",
  "from the story. Serve film_throughLine and its motif: the recurring mark tying every segment",
  "together must appear here too. If prev_segment_story is given, this segment continues the SAME",
  "protagonist, wardrobe and world from the previous one (the renderer carries the prior board",
  "image as reference, so identity is preserved): pick up where it left off and move the story",
  "forward — do not redesign the person or reset the world.",
  "",
  "ONE WORLD, ONE THREAD. Across ALL 8 panels: same identity (same person/subject, same",
  "wardrobe), same set/world, same light logic, same colour treatment. Panel 2 is Panel 1 one",
  "beat later — nothing drifts to a different place or different people. This continuity is",
  "exactly what a shot list cannot give; throwing it away is the first failure mode.",
  "",
  "EACH PANEL IS A MOTIVATED BEAT, NOT A PRETTY FRAME. The panels are a sequence in time: each",
  "follows from the one before — an action advances, an emotion turns, the camera closes in.",
  "Across the 8 a viewer must feel a story moving with a shape: open -> build -> the peak the",
  "Director's emotional_arc names -> resolve. Eight beautiful but unconnected frames is just a",
  "montage drawn worse — the whole reason to storyboard is that the beats CONNECT.",
  "",
  "THE PRODUCT IS THE HERO AND THREADS THROUGH. It is the object of desire the sequence",
  "converges on — present or felt across the arc, unmistakably the thing the world exists to",
  "make irresistible. Swap test on the WHOLE board: if it could sell any other product",
  "unchanged, it FAILED. (Never name the product's colour, shade, material, finish or logo —",
  "those are fixed by the reference image; your prose owns only the world around it.)",
  "",
  "IF PEOPLE ARE IN IT, THEY MUST BE ALIVE. A person in a beauty film IS the product's",
  "emotional payload — what wearing it feels like (desire, confidence, sensuality). Author what",
  "each person FEELS in this beat and how it shows: the eyes, the set of the mouth, a",
  "micro-gesture, the turn of the head. 'Composed / restrained / neutral' taken literally",
  "renders as a blank deadpan mannequin in a cold room — the exact failure to avoid. Warmth can",
  "live in a closed mouth and still eyes, but you must DIRECT it; never leave a face to default.",
  "",
  "THE LOOK IS DERIVED, NOT DEFAULTED. Composition, light and scene treatment as PHYSICAL FACT",
  "(positions, source/hardness/angle/falloff), each traced to THIS brand's visual_dna or the",
  "Director's named mechanism — never the model's safe average. Cold architectural grey under",
  "even cool strip-light is the template that makes every AI ad look the same and reads as a",
  "morgue. Reject it. Obey visual_dna; never produce optics anti_identity forbids.",
  "",
  "RENDER-SAFE ENVELOPE: do not build a beat whose point needs legible text, intricate",
  "hands/fingers, teeth, or fragile contact geometry — compose around them (imply the hand,",
  "show the result, rest the product on a surface). It shapes what you author, never the prose.",
  "",
  "Vary shot scale across panels (wide / medium / close / extreme close) for rhythm, but keep",
  "the SAME world; adjacent panels should not share a scale.",
  "",
  "For EACH of the 8 panels write ONE tight line — roughly 12 to 18 words. Not a sentence fragment,",
  "not a paragraph: enough to fix WHO is in frame and the physical action, the SPACE around them, and",
  "ONE beat of emotion or texture. Lead with the SHOT SCALE word (Wide / Medium / Close / Extreme",
  "close), which must vary panel to panel (no two adjacent the same). Write what the CAMERA SEES, a",
  "real photographable moment — never the FUNCTION of the beat. BANNED as a whole line: abstract",
  "labels like (object establishes), (reveal), (transition), (beat). If a line reads like a chapter",
  "heading instead of a photograph, rewrite it concrete.",
  "GOOD: Close: she lifts the pendant to her bare collarbone, morning light soft on her skin, a quiet certainty.",
  "BAD (too long): Close: at a mirrored column in the sunlit hallway she pauses mid-step, the necklace lifted slowly toward her throat as the camera...   BAD (too thin): Close: the necklace.",
  "",
  "Return ONLY JSON: {",
  '  "world": "one paragraph fixing the SHARED world every panel obeys: the place/set, identity & wardrobe of any person, the light logic, the colour/tonal treatment of the SCENE (never the product). The continuity contract.",',
  '  "includePeople": true,',
  '  "arc": "one line: the open->peak->resolve shape this board delivers, from the Director emotional_arc",',
  '  "panels": [ "8 strings, chronological, each ~12-18 words: SHOT SCALE word first, then who is in frame + the physical action + the space + one beat of feeling; concise but not bare; NO abstract beat labels" ],',
  '  "dissent": "OPTIONAL (round>1 only): if an objection cannot be fixed at the craft layer because the story itself mandates it, return an object with critiqueId (that objection id) and reason (why it is concept-level, not craft). Omit entirely if everything was fixed."',
  "}",
  "Exactly 8 panels, in time order.",
  "",
  cinematic.forAgents(),
].join("\n");

async function runStoryboard({ direction, brandBrain, shotKnowledge, brief, totalDuration, round, criticReport, segment, prevSegmentStory, throughLine, boardIndex, boardCount }) {
  const dur = totalDuration || (brief && (brief.totalDuration || brief.durationSec)) || 15;
  const payload = {
    direction: direction || {},
    visual_dna: (brandBrain && brandBrain.visual_dna) || {},
    anti_identity: (brandBrain && brandBrain.anti_identity) || {},
    value_translation: (brandBrain && brandBrain.value_translation) || {},
    shot_knowledge: shotKnowledge || null,
    total_duration_sec: dur,
    round: round || 1,
  };
  if (segment) {
    payload.this_segment = segment; // { segment, title, story } — the narrative the Director wrote
    payload.film_throughLine = throughLine || (direction && direction.filmPlan && direction.filmPlan.throughLine) || null;
    payload.segment_index = boardIndex || segment.segment || null;
    payload.segment_count = boardCount || null;
    if (prevSegmentStory) payload.prev_segment_story = prevSegmentStory;
    payload.instruction = "Turn this_segment.story into a storyboard. The STORY (what happens) is given; YOU author all the craft the Director did not specify: the world, the people and their look, the light, the colour, and the shot/scale of each of the 8 panels. Serve film_throughLine and its motif. If prev_segment_story is present, continue the SAME protagonist, wardrobe and world from it (the renderer carries the prior board image as reference) — pick up and move forward. Panel 1 of THIS board must be the NEXT INSTANT of the previous segment's final beat: the same action continuing mid-flow, same place, same light, never a new scene, a time jump, or a re-establishing shot. PACING LAW: each panel is a roughly 2-second beat of REAL-TIME action — write each beat with enough actual movement to fill those 2 seconds at natural speed; never a micro-gesture that would have to be stretched into slow motion. CHARACTER LAW: this film has exactly ONE protagonist — never write a second sharp person; background figures may appear only as distant, heavily defocused silhouettes that never share focus with her; a mirror or reflection shot must show the SAME person in the SAME instant and pose, never a second version of her; never two instances of the protagonist in one panel.";
    if (payload.segment_count && payload.segment_index && Number(payload.segment_index) === Number(payload.segment_count)) {
      payload.instruction += " THIS BOARD ENDS THE ENTIRE FILM: Panel 8 is the SETTLE SHOT that closes it — the product resting still at the heart of the frame, placed on a REAL surface inside THIS film's world (never a studio void), with quiet environmental storytelling around it: props, textures and light that echo the story just told; the protagonist may appear only as a small, out-of-focus figure already walking away in the background. Generous negative space, warm settled light, all motion resolved; the story LANDS here, never ending mid-action. Panel 8 contains NO overlaid text, no brand name, no logo, no lettering of any kind — the ONLY text allowed is the product's own label exactly as it exists on the real product; any brand mark is composited later at the video layer.";
    } else if (payload.segment_count && Number(payload.segment_count) > 1) {
      payload.instruction += " THIS BOARD IS NOT THE END OF THE FILM: it must NOT resolve. Panel 8 ends ON MOMENTUM — an action mid-flow, a turn begun, a door opening — pulling the viewer into the next segment. NEVER end this board on a settled product hero shot or any closing/fade feeling; the film's landing belongs exclusively to the final board. Panel 8 (the handoff frame) must contain NO human face: end on hands, the product, a telling detail, an environment beat, or a figure seen from behind — the MOTION carries into the next segment, the face does not.";
    }
  }
  if (round > 1 && criticReport) {
    payload.critic_objections = criticReport.objections || [];
    payload.instruction = "Revise the storyboard for the Critic's objections (each objection has an id). Keep ONE continuous world, motivated connected beats, and the product threaded as hero. BUT if an objection cannot be honestly fixed at the craft layer because this_segment.story itself mandates the thing it objects to (e.g. the story is built on a render-fragile action), do not fake a fix. Return a dissent { critiqueId, reason }: the objection's id and why it is concept-level (the Director's story), not craft. Still fix everything you can and return your best 8 panels.";
  }
  let out;
  for (let attempt = 1; attempt <= 2; attempt++) {
    out = await aiComplete({
      system: SYS_STORYBOARD,
      user: JSON.stringify(payload),
      temperature: 1,
      model: models.cinematographer,
      maxTokens: attempt === 1 ? 16000 : 24000,
    });
    if (!(out && out._parseError)) break;
    console.warn("[storyboard] non-JSON (likely truncation) attempt " + attempt + " - retry higher cap");
  }
  if (out && out._parseError) {
    throw new Error("storyboard returned non-JSON after retry: " + String(out.raw || "").slice(0, 300));
  }
  const rawAgentText = JSON.stringify(out || {});
  const leakage = cinematic.detectLeakage(rawAgentText);
  if (leakage.length) console.warn("[storyboard] cinematic skill leakage:", leakage.join(", "));
  const panels = Array.isArray(out && out.panels) ? out.panels.map((s) => cinematic.scrub(String(s || "").trim()).slice(0, 180)).filter(Boolean) : [];
  return {
    storyboard: { world: cinematic.scrub((out && out.world) || ""), includePeople: !!(out && out.includePeople), arc: cinematic.scrub((out && out.arc) || ""), panels },
    panelCount: panels.length,
    dissent: (out && out.dissent) || null,
    cinematicWarnings: leakage,
  };
}

module.exports = { runStoryboard, SYS_STORYBOARD };
