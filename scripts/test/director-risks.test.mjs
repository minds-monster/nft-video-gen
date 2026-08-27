// Guards on worker/director-risks.js — what the Director is told is wrong before it spends.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT has two halves, and they pull in opposite directions.
//
// A risk that never fires is money wasted on a render that was always going to fail. A risk that
// fires on everything is worse: it teaches a visitor that the warnings are noise, and the one
// that mattered goes past them with all the others. The brand scan in particular got this wrong
// on its first run — it flagged a cast entry called "tower" in a script that said "tower", which
// is EXACTLY what H3_RULES rule 1 asks a script to say. The hero's own shipped prompt describes
// "the stylised blue-furred ape character" against a collection with "Ape" in its name.
//
// So the load-bearing assertion in this file is not that a brand is caught. It is that the hero's
// real, correct, brand-free prose produces NOTHING.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessRisks, SCREEN_TEST, MOTION_TEST } from '../../worker/director-risks.js';
import { FIXTURES } from '../lib/storyboard-fixtures.mjs';

const dossier = (over = {}) => ({
  subject: 'a low, sharply-creased wedge-profile hypercar with Y-shaped running lights',
  identityMarkers: ['Y-shaped running lights', 'carbon inlets'],
  palette: ['white', 'black'],
  medium: '3d-render',
  burnedInText: '',
  framing: 'full-bleed',
  cropAdvice: '',
  isMannequin: false,
  motionNotes: '',
  hazards: [],
  ...over,
});

const spec = (over = {}) => ({
  world: 'A bright white gallery, seamless floor.',
  grade: 'Photoreal cinematic render. No captions, subtitles, watermarks or added signage.',
  guard: '',
  staging: '<Subject 1> is the car in <Picture 1>.',
  continuity: '',
  camera: 'The camera trucks left with small amplitude at slow speed.',
  beats: ['the car stands still under the overhead light'],
  sound: 'a quiet room tone',
  music: 'N/A',
  referencePlan: [{ key: 'car', role: 'vehicle', crop: '' }],
  duration: 6,
  resolution: '768P',
  ratio: '16:9',
  ...over,
});

const cast = (over = {}) => [{ key: 'car', name: 'Lamborghini Revuelto', dossier: dossier(), ...over }];
const ids = (result) => result.risks.map((risk) => risk.id);

// ------------------------------------------------------------------------- rule 1, both ways

test('the hero\'s own brand-free prose raises nothing, against the very cast it describes', () => {
  // The regression that matters most. Every word below is how scripts/launch-prompts.mjs actually
  // describes this car, and the cast entry is the marque it belongs to.
  const result = assessRisks({
    spec: spec({ beats: ['the low, sharply-creased wedge-profile hypercar with Y-shaped running lights stands still'] }),
    cast: cast(),
  });
  assert.deepEqual(ids(result), []);
});

test('an actual marque in the script is a floor violation, because the request would be rejected', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the Lamborghini Revuelto stands still on the grid'] }),
    cast: cast(),
  });
  const risk = result.risks.find((r) => r.id === 'brand-name-in-script');
  assert.ok(risk, 'a full marque appearing intact is unambiguous');
  assert.equal(risk.severity, 'floor');
  assert.equal(risk.estUsd, 0, 'a rejected request never rendered, so it costs nothing');
  assert.equal(risk.test, null, 'this is fixed by rewriting, never by paying to confirm it');
  assert.match(risk.measured, /1026/);
});

test('a single-word collection name that the dossier itself uses is NOT a brand hit', () => {
  // "tower" describing a tower is what rule 1 asks for. The dossier is contractually brand-free
  // (DOSSIER_SCHEMA: "Form, colour and material only — never a brand"), so its own vocabulary is
  // the reference set for what is safe to say.
  const result = assessRisks({
    spec: spec({ beats: ['the tower rises out of the fog'] }),
    cast: [{ key: 'car', name: 'Tower', dossier: dossier({ subject: 'a massive brutalist concrete tower' }) }],
  });
  assert.equal(ids(result).includes('brand-name-in-script'), false);
});

test('a single-word name no dossier vocabulary contains IS a brand hit', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the Rimowa case sits open'] }),
    cast: [{ key: 'car', name: 'Rimowa', dossier: dossier({ subject: 'a grooved aluminium cabin case' }) }],
  });
  assert.ok(result.risks.find((r) => r.id === 'brand-name-in-script'));
});

test('a contract address or chain name in prose is caught, because this model draws text it is shown', () => {
  const result = assessRisks({
    spec: spec({ staging: '<Subject 1> is the car at 0x28472a58a490c5e09a on ethereum.' }),
    cast: cast(),
  });
  const risk = result.risks.find((r) => r.id === 'identifier-in-script');
  assert.equal(risk.severity, 'floor');
  assert.match(risk.measured, /MCL_GENESIS/, 'the finding behind it is a real render, not a worry');
});

// ------------------------------------------------------------------ rule 11, faces vs identity

test('a small-in-frame CHARACTER is warned about its face', () => {
  const result = assessRisks({
    spec: spec(),
    cast: cast({
      dossier: dossier({
        framing: 'small-in-frame',
        physicalProfile: { bodyPlan: 'biped', headRatio: 4 },
      }),
    }),
  });
  const risk = result.risks.find((r) => r.id === 'identity-at-risk:car');
  assert.match(risk.what, /FACE/);
  assert.equal(risk.evidence.hasFace, true);
  assert.deepEqual(risk.test.params, SCREEN_TEST, 'settled by the $0.32 diagnostic, not a real render');
  assert.equal(risk.estUsd, 0.32);
});

test('a small-in-frame BUILDING is warned about identity, and never told it has a face', () => {
  // headRatio is "null for anything without a head" (PHYSICAL_PROFILE). Applying rule 11's wording
  // to a tower block would be a check that fires correctly and then says something false.
  const result = assessRisks({
    spec: spec(),
    cast: cast({
      dossier: dossier({
        subject: 'a massive brutalist concrete tower',
        identityMarkers: ['stepped balconies', 'recessed windows'],
        framing: 'small-in-frame',
        physicalProfile: { bodyPlan: 'architecture', headRatio: null },
      }),
    }),
  });
  const risk = result.risks.find((r) => r.id === 'identity-at-risk:car');
  assert.doesNotMatch(risk.what, /face/i);
  assert.equal(risk.evidence.hasFace, false);
  assert.match(risk.what, /stepped balconies/, 'it should say what is actually at stake');
});

test('a dossier with no physical profile still raises the risk, stated as identity', () => {
  // Older cached dossiers and the Storyboarder's own fixtures carry no physicalProfile at all.
  const result = assessRisks({
    spec: spec(),
    cast: cast({ dossier: dossier({ framing: 'small-in-frame' }) }),
  });
  const risk = result.risks.find((r) => r.id === 'identity-at-risk:car');
  assert.ok(risk);
  assert.equal(risk.evidence.hasFace, null, 'unknown is its own state, not a guess either way');
});

test('a full-bleed subject raises nothing', () => {
  assert.deepEqual(ids(assessRisks({ spec: spec(), cast: cast() })), []);
});

// ------------------------------------------------------------------------- the other rules

test('a trading card is flagged, because the card is what gets reproduced', () => {
  const result = assessRisks({ spec: spec(), cast: cast({ dossier: dossier({ medium: 'trading-card' }) }) });
  assert.ok(result.risks.find((r) => r.id === 'card-reproduced:car'));
});

test('flat vector art is flagged, because it renders as a sticker', () => {
  const result = assessRisks({ spec: spec(), cast: cast({ dossier: dossier({ medium: 'flat-2d-vector' }) }) });
  assert.ok(result.risks.find((r) => r.id === 'flat-art:car'));
});

test('a mannequin without a guard is flagged, and with one is not', () => {
  const mannequin = dossier({ isMannequin: true, subject: 'a burgundy velvet jacket on a chrome form' });
  assert.ok(assessRisks({ spec: spec(), cast: cast({ dossier: mannequin }) }).risks.find((r) => r.id === 'mannequin-unguarded:car'));

  const guarded = spec({ guard: 'Every character has ordinary skin and is not a mannequin.' });
  assert.equal(
    assessRisks({ spec: guarded, cast: cast({ dossier: mannequin }) }).risks.some((r) => r.id === 'mannequin-unguarded:car'),
    false,
  );
});

test('the mannequin guard NEVER fires on a character, however synthetic', () => {
  // Getting this wrong is actively harmful rather than merely noisy: the guard instructs "ordinary
  // skin", which strips the fur off an animal. So it fires on the dossier's boolean and never on
  // a guess about what the subject looks like.
  const ape = dossier({ isMannequin: false, subject: 'a stylised blue-furred ape character in a chrome-trimmed jacket' });
  assert.equal(
    assessRisks({ spec: spec(), cast: cast({ dossier: ape }) }).risks.some((r) => r.id.startsWith('mannequin')),
    false,
  );
});

test('an absolute text ban against artwork that legitimately carries print is a note, not a blocker', () => {
  const result = assessRisks({
    spec: spec({ grade: 'Photoreal. No text or signage anywhere.' }),
    cast: cast({ dossier: dossier({ burnedInText: 'MCL_GENESIS' }) }),
  });
  const risk = result.risks.find((r) => r.id === 'type-ban-contradiction:car');
  assert.equal(risk.severity, 'note');
  assert.equal(result.blocking.length, 0);
});

test('an uncommitted continuity is settled by a MOTION test, because 4 seconds cannot show a cut', () => {
  const result = assessRisks({
    spec: spec({ beats: ['one', 'two', 'three'], continuity: '' }),
    cast: cast(),
  });
  const risk = result.risks.find((r) => r.id === 'uncommitted-continuity');
  assert.deepEqual(risk.test.params, MOTION_TEST);
  assert.equal(risk.estUsd, 0.48);

  const committed = spec({ beats: ['one', 'two', 'three'], continuity: 'One unbroken take. There are no cuts.' });
  assert.equal(assessRisks({ spec: committed, cast: cast() }).risks.some((r) => r.id === 'uncommitted-continuity'), false);
});

test('a tenth reference slot is a floor violation that names what does not fit', () => {
  const referencePlan = Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, role: 'prop', crop: '' }));
  const result = assessRisks({ spec: spec({ referencePlan }), cast: cast() });
  const risk = result.risks.find((r) => r.id === 'over-nine-slots');
  assert.equal(risk.severity, 'floor');
  assert.deepEqual(risk.evidence, ['p9']);
  assert.equal(risk.fix, 'trim-cast', 'composites cannot be built in a Worker — say so, do not drop one');
});

// ------------------------------------------------------------------------------ the shape

test('risks come back floor-first, so the top of the list is what to act on', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the Lamborghini Revuelto stands still'], grade: 'No text anywhere.' }),
    cast: cast({ dossier: dossier({ framing: 'small-in-frame', burnedInText: 'X' }) }),
  });
  assert.deepEqual(result.risks.map((r) => r.severity), ['floor', 'hazard', 'note']);
});

test('testableUsd counts only what actually needs a render', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the Lamborghini Revuelto stands still'] }),
    cast: cast({ dossier: dossier({ framing: 'small-in-frame' }) }),
  });
  assert.equal(result.testableUsd, 0.32, 'the brand hit is a rewrite and must not be priced');
  assert.equal(result.free.length, 1);
});

test('a brand PRINTED on the artwork is caught in the script, even when the dossier laundered it', () => {
  // The Casting Director already refuses a dossier that reuses its own burnedInText — but only
  // going forward. This repo's captured fixture carries a dossier opening "A Bored Ape character"
  // beside a burnedInText of "PHASE 2 BORED APE YACHT CLUB", which is that exact defect surviving
  // in cached data, and the Screenwriter duly wrote it into the staging block. This is the last
  // place it can be caught before MiniMax rejects the request.
  const result = assessRisks({
    spec: spec({ staging: '<Subject 1> is the Bored Ape character in <Picture 1>.' }),
    cast: [{ key: 'car', name: 'ape', dossier: dossier({ burnedInText: 'PHASE 2 BORED APE YACHT CLUB INDIGO' }) }],
  });
  const risk = result.risks.find((r) => r.id === 'brand-name-in-script');
  assert.ok(risk, 'the bigram appearing intact is unambiguous');
  assert.equal(risk.evidence[0].text, 'bored ape');
  assert.equal(risk.evidence[0].piece, 'ape', 'the message has to say which piece it came from');
});

test('the noun survives even though the brand does not', () => {
  // "bored ape" is a brand. "ape" is a description, and the hero's shipped prompt says "the
  // stylised blue-furred ape character" against this very collection. A check that cannot tell
  // those apart would refuse the film that actually worked.
  const result = assessRisks({
    spec: spec({ beats: ['the stylised blue-furred ape character turns to the lens'] }),
    cast: [{ key: 'car', name: 'ape', dossier: dossier({ burnedInText: 'PHASE 2 BORED APE YACHT CLUB INDIGO' }) }],
  });
  assert.equal(result.risks.some((r) => r.id === 'brand-name-in-script'), false);
});

test('a colour printed on the card stays usable as a colour', () => {
  // "INDIGO" is lettering on the adidas card AND a legitimate palette entry. Flagging it would
  // stop a script describing the thing's actual colour.
  const result = assessRisks({
    spec: spec({ beats: ['the indigo jacket catches the light'] }),
    cast: [
      {
        key: 'car',
        name: 'ape',
        dossier: dossier({ burnedInText: 'BORED APE YACHT CLUB INDIGO', palette: ['indigo', 'yellow'] }),
      },
    ],
  });
  assert.equal(result.risks.some((r) => r.id === 'brand-name-in-script'), false);
});

test('a brand named only in the dossier hazards is caught by its capitalised token', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the McLaren pulls away'] }),
    cast: [{ key: 'car', name: 'camoCar', dossier: dossier({ hazards: ['McLaren text', 'MSO LAB logo'] }) }],
  });
  assert.ok(result.risks.find((r) => r.id === 'brand-name-in-script'));
});

test('generic words inside a hazard sentence are not treated as brands', () => {
  // hazards is free prose. Taking every long word from "visible shield-shaped badge on hood
  // (brand mark)" would flag "shield", "badge" and "brand", which a real description uses.
  const result = assessRisks({
    spec: spec({ beats: ['a shield-shaped badge catches the light on the hood'] }),
    cast: [{ key: 'car', name: 'whiteCar', dossier: dossier({ hazards: ['visible shield-shaped badge on hood (brand mark)'] }) }],
  });
  assert.equal(result.risks.some((r) => r.id === 'brand-name-in-script'), false);
});

test('the captured fixture is NOT shootable, and the register says exactly why', () => {
  // Asserted as a defect rather than as health. An earlier version of this test claimed every
  // fixture was shootable, which was simply wrong: `captured` writes a real brand into its
  // staging block and MiniMax would reject the whole request. A test that asserts the happy
  // answer about real data is worse than no test.
  const captured = FIXTURES.find((f) => f.id === 'captured');
  const result = assessRisks({ spec: captured.spec, cast: captured.cast ?? [] });
  assert.deepEqual(result.blocking.map((r) => r.id), ['brand-name-in-script']);
  assert.equal(result.blocking[0].estUsd, 0, 'caught for free, which is the entire point');
});

test('every other fixture is shootable', () => {
  for (const fixture of FIXTURES.filter((f) => f.id !== 'captured')) {
    const result = assessRisks({ spec: fixture.spec, cast: fixture.cast ?? [] });
    assert.deepEqual(result.blocking.map((r) => r.id), [], `${fixture.id} should be shootable`);
  }
});

// ------------------------------------------------------------------------- rule 12

test('a beat that asks one thing to become another is a rehearsal, six seconds long, in the real film', () => {
  // The Hollywood-sign film. This is the hazard that went unnamed, and the reason rule 12 exists.
  const result = assessRisks({
    spec: spec({
      beats: [
        'the camera closes on the white letters of the sign',
        'the letters inflate like balloons and morph into an enormous white pulsating brain',
      ],
    }),
    cast: cast(),
  });
  const risk = result.risks.find((r) => r.id === 'transformation-faked:2');
  assert.ok(risk, 'the beat is named by number');
  assert.equal(risk.rule, 12);
  assert.equal(risk.test.focus, 'rehearsal');
  assert.deepEqual(risk.test.params, MOTION_TEST, 'a transformation needs two beats of time');
  assert.deepEqual(risk.test.beats, [2]);
  assert.match(risk.what, /morph into an enormous white pulsating brain/, 'and quotes the clause');
  assert.match(risk.measured, /faded in on top/);
  assert.equal(risk.estUsd, 0.48);
});

test('the visitor\'s own transformation verb fires the rule when the Screenwriter softened it', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the letters swell and a brain is revealed'] }),
    cast: cast(),
    prompt: 'The Hollywood letters literally transform into an enormous white pulsating brain',
  });
  const risk = result.risks.find((r) => r.id === 'transformation-faked:prompt');
  assert.ok(risk, 'the prompt is a source of hazards too');
  assert.deepEqual(risk.test.beats, [], 'no single beat to name, so the rehearsal renders the opening beats');
});

test('a beat that already names the transformation is not ALSO raised from the prompt', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the letters morph into a brain'] }),
    cast: cast(),
    prompt: 'the letters transform into a brain',
  });
  assert.deepEqual(
    ids(result).filter((id) => id.startsWith('transformation-faked')),
    ['transformation-faked:1'],
  );
});

test('a camera move that "becomes" a view is not a transformation', () => {
  // scripts/launch-prompts.mjs, verbatim: the hero's own closing beat.
  const result = assessRisks({
    spec: spec({ beats: ['the camera rises until the grid becomes a distant aerial view.'] }),
    cast: cast(),
  });
  assert.deepEqual(ids(result).filter((id) => id.startsWith('transformation-faked')), []);
});

test('the fixtures raise no transformation, so rule 12 is not noise on ordinary films', () => {
  for (const fixture of FIXTURES) {
    const result = assessRisks({ spec: fixture.spec, cast: fixture.cast ?? [] });
    assert.deepEqual(
      ids(result).filter((id) => id.startsWith('transformation-faked')),
      [],
      `${fixture.id} has no transformation`,
    );
  }
});

test('every risk cites something measured, because a risk that cannot is judgement', () => {
  const result = assessRisks({
    spec: spec({ beats: ['the Lamborghini Revuelto stands still'], grade: 'No text anywhere.' }),
    cast: cast({ dossier: dossier({ framing: 'small-in-frame', medium: 'trading-card', burnedInText: 'X' }) }),
  });
  assert.ok(result.risks.length >= 3);
  for (const risk of result.risks) {
    assert.ok(risk.measured && risk.measured.length > 40, `${risk.id} must carry its evidence`);
    assert.ok(Number.isInteger(risk.rule), `${risk.id} must name the rule it comes from`);
  }
});
