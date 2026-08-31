// The control cells' request, read out of worker/storyboarder.js at run time rather than copied.
//
// c0 exists to give "every beat comes back MWS" a number, and it is only a fair baseline if it
// is EXACTLY today's request. A copied schema would drift the first time production changed,
// and the probe would quietly start comparing the candidate against a fossil. So the schema and
// the brief are extracted from the worker source itself: if the file moves under us, extraction
// throws rather than silently measuring the wrong thing.
//
// This is the one place the probe reaches into worker/ — deliberately, and for the control only.
// The candidate cells share nothing with it.

import { readFileSync } from 'node:fs';
import { H3_FORMAT } from '../../worker/rulebook.js';

const SOURCE = 'worker/storyboarder.js';

/** Pull a balanced brace-delimited object literal out of source text, starting at `const NAME =`. */
const extractObjectLiteral = (src, name) => {
  const anchor = src.indexOf(`const ${name} = {`);
  if (anchor === -1) throw new Error(`${SOURCE} no longer declares ${name} — the control cannot be built.`);
  const open = src.indexOf('{', anchor);
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces while extracting ${name} from ${SOURCE}.`);
};

/** Pull a backtick template literal out of source text, starting at `const NAME = \``. */
const extractTemplate = (src, name) => {
  const anchor = src.indexOf(`const ${name} = \``);
  if (anchor === -1) throw new Error(`${SOURCE} no longer declares ${name} — the control cannot be built.`);
  const open = src.indexOf('`', anchor);
  let escaped = false;
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '`') return src.slice(open, i + 1);
  }
  throw new Error(`Unterminated template while extracting ${name} from ${SOURCE}.`);
};

/**
 * EXTRACTED LAZILY, and that change is worth explaining because eager extraction had already
 * cost more than it protected.
 *
 * The design is right: read the control's schema out of worker/storyboarder.js at run time so
 * c0 is EXACTLY today's request and cannot drift into a fossil. But it ran at MODULE LOAD, and
 * `BLOCKING_SCHEMA` was deleted from the worker at some point in rounds 9-10 — so importing this
 * file threw, and importing it is the first thing probe-storyboard-geometry.mjs does. The whole
 * geometry probe, which is this project's main quality gate, has therefore been unrunnable for
 * several rounds, and nothing said so: it fails before it can print a usage line.
 *
 * 🔑 A guard that fires at import time takes down every caller, including the ones that do not
 * use the thing it guards. The failure is now raised where the legacy control is actually
 * REQUESTED — still loud, still impossible to measure the wrong thing through, but no longer
 * able to disable four unrelated cells by existing.
 */
let cachedSrc = null;
const src = () => (cachedSrc ??= readFileSync(SOURCE, 'utf8'));

const lazy = (build) => {
  let value;
  let built = false;
  return () => {
    if (!built) { value = build(); built = true; }
    return value;
  };
};

// eslint-disable-next-line no-new-func
export const blockingSchema = lazy(() => new Function(`return (${extractObjectLiteral(src(), 'BLOCKING_SCHEMA')});`)());

// eslint-disable-next-line no-new-func
export const blockingBrief = lazy(() => new Function(
  'H3_FORMAT',
  `return (${extractTemplate(src(), 'BLOCKING_BRIEF')});`,
)(H3_FORMAT));

/** Today's per-beat request parameters, from blockingRequest (worker/storyboarder.js:220-232).
 * Numbers rather than extraction: they are three scalars, and a mis-parse would be silent. */
export const LEGACY_PARAMS = { temperature: 0.3, maxCompletionTokens: 1500, model: 'gpt-5.6-terra' };

/** The user message worker/storyboarder.js builds per beat, reproduced field for field from
 * blockingRequest's own assembly (lines 196-218). */
export const buildLegacyBeatMessage = (spec, cast, beatIndex, previousBlocking) => {
  const referenceLines = (spec.referencePlan ?? []).map((slot, i) => {
    const entry = cast.find((c) => c.key === slot.key);
    const dossier = entry?.dossier ?? {};
    const subject = dossier.subject ?? entry?.name ?? slot.key;
    const markers = dossier.identityMarkers?.length
      ? ` (${dossier.identityMarkers.slice(0, 3).join(', ')})`
      : '';
    return `<Subject ${i + 1}> — ${subject}${markers}`;
  });

  return [
    spec.world ? `World: ${spec.world}` : null,
    spec.staging ? `Staging: ${spec.staging}` : null,
    spec.guard ? `Guard: ${spec.guard}` : null,
    spec.camera ? `Film's overall camera direction: ${spec.camera}` : null,
    spec.continuity ? `Continuity: ${spec.continuity}` : null,
    '',
    'Cast with references available (referencePlan order):',
    ...referenceLines,
    '',
    `This beat: ${spec.beats[beatIndex]}`,
    previousBlocking
      ? `\nThe previous beat's own blocking JSON, for your continuityCheck comparison:\n${JSON.stringify(previousBlocking)}`
      : '\nThis is the first beat — continuityCheck should be { consistent: true, changes: [] }.',
    '',
    'Write the blocking spec.',
  ]
    .filter((line) => line !== null)
    .join('\n');
};

/** c1's only difference from c0: the model sees the whole beat list at once. Same schema, same
 * brief, same tier — so any gain is attributable to scope and not to the schema. */
export const buildLegacyFilmMessage = (spec, cast) => {
  const beats = spec.beats ?? [];
  const base = buildLegacyBeatMessage(spec, cast, 0, null);
  const head = base.split('\nThis beat:')[0];
  return [
    head,
    '',
    `The film is ${beats.length} beats long, in order:`,
    ...beats.map((text, i) => `Beat ${i + 1} of ${beats.length}: ${text}`),
    '',
    'Write the blocking spec for every beat, returning an array of one spec per beat in order.',
  ].join('\n');
};

/** c1 needs a container for many beats where production's schema describes exactly one. The
 * wrapper adds nothing else — the per-beat schema inside is untouched. */
export const legacyFilmSchema = lazy(() => ({
  type: 'object',
  properties: {
    beats: { type: 'array', items: blockingSchema() },
  },
  required: ['beats'],
}));
