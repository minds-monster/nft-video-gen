// A shot spec → the script MiniMax-H3 actually wants.
//
// Pure and dependency-free, like nftMedia.js beside it, and for the same reason: both the
// browser (the treatment panel's "H3 request" panel) and scripts/*.mjs (gen-video.mjs, the
// Director when it lands) have to produce this string, and they have to produce the SAME
// string. If the UI formatted its own preview, the preview would become a lie the moment
// the two drifted — and the whole point of showing it is to catch format regressions early.
// That is how probe P8's findings surfaced in the first place.
//
// The format is the one MiniMax shipped with the H3 open weights, verified against the
// hosted /v2 API by P8 (scripts/probe-h3.mjs). Three named fields, preceded by the subject
// definitions that bind each character to its reference image.

/**
 * Which cast piece `<Subject N>` refers to.
 *
 * N is 1-based and indexes `referencePlan`, which is the contract worker/rulebook.js states
 * to the Screenwriter. Kept here rather than in the component so the UI's reading of the
 * tags and the renderer's ordering of the reference images can never disagree.
 */
export const subjectKey = (spec, n) => spec?.referencePlan?.[n - 1]?.key ?? null;

/** Every `<Subject N>` / `<Picture N>` tag in a string, as numbers, in order of appearance. */
export const SUBJECT_TAG = /<(?:Subject|Picture)\s+(\d+)>/g;

/**
 * Numbered beats. Rule 6: ordering is the thing H3 is most likely to shuffle, and numbering
 * is what holds it — a bare list of sentences does not.
 */
const numbered = (beats) => beats.map((beat, index) => `Beat ${index + 1}: ${beat}`).join(' ');

/**
 * The visual track, assembled in one deliberate order.
 *
 * `grade` leads because H3's own guide says to open with visual style and composition
 * ("Live-action, cinematic, a medium-wide shot frames..."). That is a change from
 * scripts/launch-prompts.mjs, which puts GRADE last — it worked there, but it was written
 * before the official format was known, and the guide is explicit about the opener.
 *
 * `guard` trails, because it is a negative constraint and reads as a correction to
 * everything above it rather than as part of the scene.
 */
const description = ({ grade, world, continuity, camera, beats, guard }) =>
  [grade, world, continuity, camera, numbered(beats), guard]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');

/**
 * The full script.
 *
 * Subject definitions sit above the three fields, unlabelled — that is the shape P8 sent and
 * H3 accepted, and critically none of this scaffolding leaked into the rendered picture.
 */
/**
 * The three named fields, plus the subject definitions, as the string H3 actually receives.
 *
 * Split out from `h3Script` because there are now TWO ways to arrive at those fields and only
 * one wire format. `h3Script` below derives them from a Screenwriter spec; worker/scene.js's
 * `compileSceneToH3` derives them from a blocked storyboard's geometry. Both must serialise
 * identically or the Director's preview stops describing what the Director sends — and a preview
 * that can drift from the request is exactly the lie this file's header warns about.
 *
 * Subject definitions sit above the three fields, unlabelled — that is the shape P8 sent and H3
 * accepted, and critically none of this scaffolding leaked into the rendered picture.
 */
export const h3ScriptFrom = ({ staging, description, soundscape, music }) => {
  const blocks = [];
  if (staging?.trim()) blocks.push(staging.trim());

  blocks.push(`integrated_multimodal_description: ${description ?? ''}`);
  blocks.push(`overall_soundscape: ${soundscape?.trim() || 'N/A'}`);
  // "N/A" is a documented legal value here, and a deliberate one: a film that should be
  // scored only by its own diegetic sound has to be able to say so.
  blocks.push(`non_diegetic_music: ${music?.trim() || 'N/A'}`);

  return blocks.join('\n\n');
};

export const h3Script = (spec) => {
  if (!spec) return '';
  return h3ScriptFrom({
    staging: spec.staging,
    description: description(spec),
    soundscape: spec.sound,
    music: spec.music,
  });
};

/** The render parameters that travel with the script, ready for createH3Task. */
export const h3Params = (spec) => ({
  model: 'MiniMax-H3',
  resolution: spec?.resolution ?? '768P',
  duration: spec?.duration ?? 6,
  ratio: spec?.ratio ?? '16:9',
});
