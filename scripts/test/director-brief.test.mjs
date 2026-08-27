// The scope brief: a marker inside prose, and the boundary it draws.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is scaffolding reaching a visitor's eyes, and its
// mirror image: a brief that silently applies itself.
//
// The first is the same risk probe P8 was run to settle about H3 — "this model prints text it is
// shown" — except here the model is talking to a person, so a malformed block must degrade to
// clean prose rather than to visible machinery. The second is the whole boundary of this round:
// the assistant PROPOSES a scope in its own reply and the visitor presses a button. Parsing one
// must never be the same as accepting it.
//
// `mustHold` is asserted hardest because it is the only field that does deterministic work — it
// reorders a register of hazards that were each measured with real money.

import test from 'node:test';
import assert from 'node:assert/strict';

import { BRIEF_MARKER, formatBrief, parseBrief } from '../../src/lib/directorBrief.js';
import { assessRisks } from '../../worker/director-risks.js';

const spec = (over = {}) => ({
  world: 'Night.',
  grade: 'Photoreal.',
  guard: '',
  staging: '<Subject 1> is the ape.',
  continuity: '',
  camera: 'the camera trucks left',
  beats: ['one', 'two', 'three'],
  sound: 'rain',
  music: 'N/A',
  referencePlan: [{ key: 'ape', role: 'character', crop: '' }],
  duration: 6,
  resolution: '768P',
  ratio: '16:9',
  ...over,
});

const cast = [
  {
    key: 'ape',
    name: 'ape',
    dossier: {
      subject: 'a stylised ape character',
      identityMarkers: ['yellow hat'],
      palette: ['blue'],
      medium: '3d-render',
      burnedInText: '',
      framing: 'small-in-frame',
      cropAdvice: '',
      isMannequin: false,
      hazards: [],
      physicalProfile: { bodyPlan: 'biped', headRatio: 4 },
    },
  },
];

// --------------------------------------------------------------------------------- parsing

test('a brief is lifted out and the visitor is left with clean prose', () => {
  const { brief, text } = parseBrief(
    `Right, the jacket reveal it is.\n\n${BRIEF_MARKER}\nintent: a slow reveal in a rain-lit alley\nduration: 6\nresolution: 768P\nmust hold: the ape's face; one unbroken take\nspend: $6\n`,
  );
  assert.equal(text, 'Right, the jacket reveal it is.', 'no scaffolding may reach a reader');
  assert.equal(brief.intent, 'a slow reveal in a rain-lit alley');
  assert.equal(brief.duration, 6);
  assert.equal(brief.resolution, '768P');
  assert.equal(brief.willingToSpend, 6, 'a dollar sign is not a parse failure');
  assert.deepEqual(brief.mustHold, ["the ape's face", 'one unbroken take']);
});

test('prose after the block survives, so a model can keep talking', () => {
  const { brief, text } = parseBrief(
    `Here you go.\n\n${BRIEF_MARKER}\nintent: a wide establishing shot\n\nShall I ask about the music too?`,
  );
  assert.equal(brief.intent, 'a wide establishing shot');
  assert.match(text, /Here you go\./);
  assert.match(text, /Shall I ask about the music too\?/);
  assert.doesNotMatch(text, /\[BRIEF\]/);
});

test('no marker is the common case and is not an error', () => {
  const { brief, text } = parseBrief('Just chatting about the cast.');
  assert.equal(brief, null);
  assert.equal(text, 'Just chatting about the cast.');
});

test('a marker with nothing under it is a typo, not a proposal', () => {
  assert.equal(parseBrief(`Hello.\n${BRIEF_MARKER}\n`).brief, null);
});

test('a malformed block degrades to what parsed, and still strips the marker', () => {
  // Fails open. A visitor must never see raw machinery because a model forgot a colon.
  const { brief, text } = parseBrief(`Sure.\n\n${BRIEF_MARKER}\nintent: a night shot\nduration six seconds\n`);
  assert.equal(brief.intent, 'a night shot');
  assert.equal(brief.duration, null);
  assert.doesNotMatch(text, /\[BRIEF\]/);
});

test('an unknown field is ignored rather than stored', () => {
  const { brief } = parseBrief(`ok\n${BRIEF_MARKER}\nintent: a shot\nvibe: moody\n`);
  assert.equal(brief.vibe, undefined);
  assert.equal(brief.intent, 'a shot');
});

test('formatBrief round-trips through parseBrief', () => {
  const original = {
    intent: 'a slow reveal',
    duration: 10,
    resolution: '2K',
    mustHold: ['the face', 'one take'],
    willingToSpend: 12,
  };
  assert.deepEqual(parseBrief(formatBrief(original)).brief, original);
});

// ------------------------------------------------------------------- what mustHold actually does

test('must hold reorders the register so the named hazard comes first', () => {
  const before = assessRisks({ spec: spec(), cast });
  assert.equal(before.risks[0].id, 'uncommitted-continuity', 'baseline order');

  const after = assessRisks({ spec: spec(), cast, mustHold: ["the ape's face"] });
  assert.equal(after.risks[0].id, 'identity-at-risk:ape');
  assert.equal(after.risks[0].elevatedBy, "the ape's face", 'and it says whose words did it');
  assert.equal(after.elevated.length, 1);
});

test('a vague must hold matches nothing rather than everything', () => {
  // "make it cinematic" names no hazard anyone measured. Matching it to all of them would make
  // the ordering meaningless, which is worse than the field doing nothing.
  const after = assessRisks({ spec: spec(), cast, mustHold: ['make it cinematic', 'high quality'] });
  assert.equal(after.elevated.length, 0);
});

test('elevation reorders and never escalates', () => {
  // A visitor caring about something cannot make it dangerous, only make it first.
  const plain = assessRisks({ spec: spec(), cast });
  const asked = assessRisks({ spec: spec(), cast, mustHold: ["the ape's face"] });
  const severityOf = (result, id) => result.risks.find((r) => r.id === id).severity;
  assert.equal(severityOf(asked, 'identity-at-risk:ape'), severityOf(plain, 'identity-at-risk:ape'));
  assert.equal(asked.blocking.length, plain.blocking.length);
  assert.equal(asked.testableUsd, plain.testableUsd, 'and it never changes the price');
});

test('a floor violation still outranks anything the visitor asked for', () => {
  // What would be REJECTED comes before what someone wants to be sure of, always.
  const withBrand = spec({ beats: ['the Rimowa case sits open'] });
  const brandCast = [{ ...cast[0], name: 'Rimowa' }];
  const result = assessRisks({ spec: withBrand, cast: brandCast, mustHold: ["the ape's face"] });
  assert.equal(result.risks[0].severity, 'floor');
});
