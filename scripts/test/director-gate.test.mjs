// The gate between a read film and a shot one — worker/director-gate.js.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is the one that happened twice in the week this was
// written: a film shot with the Director's questions unanswered, because nothing stood between
// "the Director asked" and "the visitor paid". The hero was made probes-first. This is the
// probes-first method as a rule rather than a habit.
//
// The second thing guarded is the opposite failure — a gate that never opens. A test the Director
// asked for and then settled for free (a continuity block written into the script) must retire,
// not block the film forever.

import test from 'node:test';
import assert from 'node:assert/strict';

import { askedTests, testGate } from '../../worker/director-gate.js';

const plan = (over = {}) => ({
  reading: 'A sign becomes a brain.',
  tests: [{ riskId: 'transformation-faked:2', question: 'Does beat 2 physically happen?', estUsd: 0.48 }],
  demands: [
    {
      id: 'brain-pulses-like-tissue',
      question: 'Does the brain pulse like living tissue?',
      estUsd: 0.48,
      direction: 'The brain swells and relaxes...',
    },
  ],
  ...over,
});

const shot = (riskId, over = {}) => ({
  takeId: `test-${riskId}-${Math.random().toString(36).slice(2, 6)}`,
  kind: 'screen-test',
  riskId,
  status: 'ready',
  ...over,
});

const held = { answer: 'held', by: 'visitor' };
const failed = { answer: 'failed', by: 'visitor' };

// ------------------------------------------------------------------------------- what is asked

test('every register test and every demand is asked, demands under their demand: id', () => {
  const asked = askedTests(plan());
  assert.deepEqual(
    asked.map((t) => t.riskId),
    ['transformation-faked:2', 'demand:brain-pulses-like-tissue'],
  );
  assert.equal(asked[1].source, 'director');
  assert.equal(asked[1].estUsd, 0.48, 'the price travels with the ask');
});

test('no plan means nothing asked and the film is unread', () => {
  assert.deepEqual(askedTests(null), []);
  const gate = testGate(null, []);
  assert.equal(gate.unread, true);
  assert.equal(gate.cleared, false, 'unread is never cleared — reading is free and mandatory');
});

// ------------------------------------------------------------------------------- outstanding

test('a plan with unshot tests is read but not cleared, and names what is owed', () => {
  const gate = testGate(plan(), []);
  assert.equal(gate.unread, false);
  assert.equal(gate.cleared, false);
  assert.deepEqual(gate.outstanding.map((t) => t.state), ['unshot', 'unshot']);
  assert.equal(gate.outstandingUsd, 0.96);
});

test('a test that came back and nobody judged is still outstanding', () => {
  const gate = testGate(plan(), [shot('transformation-faked:2')]);
  assert.equal(gate.outstanding.find((t) => t.riskId === 'transformation-faked:2').state, 'unjudged');
});

test('a test that FAILED is outstanding; one that held is not', () => {
  const gate = testGate(plan(), [
    shot('transformation-faked:2', { verdict: failed }),
    shot('demand:brain-pulses-like-tissue', { verdict: held }),
  ]);
  assert.deepEqual(gate.outstanding.map((t) => t.riskId), ['transformation-faked:2']);
  assert.equal(gate.outstanding[0].state, 'failed');
});

test('a failed test is superseded by a later run of the same question', () => {
  const gate = testGate(plan(), [
    shot('transformation-faked:2', { verdict: failed }),
    shot('demand:brain-pulses-like-tissue', { verdict: held }),
    shot('transformation-faked:2', { verdict: held }),
  ]);
  assert.equal(gate.cleared, true);
});

test('"cannot tell" clears unless the Director asked for a re-test', () => {
  const unclear = { answer: 'unclear', by: 'visitor' };
  const lenient = testGate(plan(), [
    shot('transformation-faked:2', { verdict: unclear }),
    shot('demand:brain-pulses-like-tissue', { verdict: held }),
  ]);
  assert.equal(lenient.cleared, true);

  const strict = testGate(plan(), [
    shot('transformation-faked:2', { verdict: unclear, retest: true }),
    shot('demand:brain-pulses-like-tissue', { verdict: held }),
  ]);
  assert.equal(strict.cleared, false);
  assert.equal(strict.outstanding[0].state, 'retest');
});

// ------------------------------------------------------------------------------- retiring

test('a test the Director asked for and then fixed for free retires instead of blocking forever', () => {
  // The continuity hazard vanishes once a continuity block exists. Its proposed test must go too.
  const withContinuity = plan({
    tests: [{ riskId: 'uncommitted-continuity', question: 'One take or several?', estUsd: 0.48 }],
    demands: [],
  });
  const gate = testGate(withContinuity, [], { knownRiskIds: ['identity-at-risk:ape'] });
  assert.deepEqual(gate.outstanding, []);
  assert.equal(gate.cleared, true);
});

test('a demand is always known, because it is the Director\'s own ask', () => {
  const gate = testGate(plan({ tests: [] }), [], { knownRiskIds: ['demand:brain-pulses-like-tissue'] });
  assert.equal(gate.outstanding.length, 1);
});

test('a running or failed RENDER does not count as an answer', () => {
  const gate = testGate(plan({ demands: [] }), [shot('transformation-faked:2', { status: 'failed' })]);
  assert.equal(gate.outstanding[0].state, 'unshot');
});
