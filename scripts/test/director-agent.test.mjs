// The Director's judgement, and the guards around it.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a model spending someone's money on a hazard nobody
// measured. Every entry in worker/director-risks.js cites a real failed render; a risk id the
// model invented cites nothing, and charging $0.32 against it would be the exact thing the
// deterministic register was built to stop.
//
// The second guard is quieter and would look like diligence: a revision proposed against a test
// that HELD. A script that survived a test is a script that works, and "improving" it anyway is
// how a working shot gets broken by an agent looking busy. The hero's own history is the argument
// — six takes, each fixing a NAMED defect, and nothing touched that was not broken.
//
// The model is stubbed throughout. What is under test is what this code does with an answer, not
// whether a model gives a good one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRevisions, planShoot, reviewTest } from '../../worker/director-agent.js';
import { REVISABLE_BLOCKS } from '../../worker/director-brief.js';

const env = { SCREENWRITER_MODEL: 'test-model', NVIDIA_API_KEY: 'k', NVIDIA_BASE_URL: 'https://nim.test/v1' };

const spec = (over = {}) => ({
  title: 'Night Grid',
  logline: 'Three cars launch.',
  world: 'Night on a wet grid.',
  grade: 'Photoreal.',
  guard: '',
  staging: '<Subject 1> is the ape.',
  continuity: '',
  camera: 'the camera trucks left',
  beats: ['one', 'two'],
  duration: 6,
  resolution: '768P',
  ratio: '16:9',
  ...over,
});

const risks = [
  {
    id: 'identity-at-risk:ape',
    severity: 'hazard',
    what: 'the ape may lose its face',
    measured: 'Probe P8 measured a full-length reference losing its subject entirely.',
    estUsd: 0.32,
    test: { question: "Does the ape's face survive?", focus: 'identity', refKeys: ['ape'] },
  },
  {
    id: 'brand-name-in-script',
    severity: 'floor',
    what: 'the script names a brand',
    measured: 'MiniMax error 1026 rejects the request outright.',
    estUsd: 0,
    test: null,
    fix: 'rewrite',
  },
];

/** Stub the provider. `reply` is whatever the forced tool call should return. */
const stub = (reply) => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(reply) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200 },
    );
};

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ------------------------------------------------------------------------------- planning

test('a hallucinated risk id is filtered out, never charged', async () => {
  stub({
    reading: 'A night grid film.',
    tests: [
      { riskId: 'identity-at-risk:ape', why: 'the face is the whole film' },
      { riskId: 'the-vibes-might-be-off', why: 'I feel uneasy' },
    ],
    skip: [],
    plan: 'shoot it',
  });
  const result = await planShoot(env, { spec: spec(), risks, finalUsd: 0.48, remainingUsd: 6 });

  assert.deepEqual(result.tests.map((t) => t.riskId), ['identity-at-risk:ape']);
  assert.deepEqual(result.dropped, ['the-vibes-might-be-off'], 'and it is recorded, not merely absent');
});

test('a real risk with no render-based test cannot be proposed as one', async () => {
  // A brand name is fixed by rewriting. Paying to watch MiniMax reject it would be absurd, and the
  // model asking for it must not be enough to make it happen.
  stub({
    reading: 'x',
    tests: [{ riskId: 'brand-name-in-script', why: 'lets check' }],
    skip: [],
    plan: 'y',
  });
  const result = await planShoot(env, { spec: spec(), risks, finalUsd: 0.48, remainingUsd: 6 });
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.dropped, ['brand-name-in-script']);
});

test('the proposed test carries the measured risk with it, so a price is never invented', async () => {
  stub({ reading: 'x', tests: [{ riskId: 'identity-at-risk:ape', why: 'w' }], skip: [], plan: 'p' });
  const result = await planShoot(env, { spec: spec(), risks, finalUsd: 0.48, remainingUsd: 6 });
  assert.equal(result.tests[0].risk.estUsd, 0.32, 'the price comes from the register, not the model');
  assert.equal(result.tests[0].risk.test.question, "Does the ape's face survive?");
});

test('skips are kept, because what it chose not to spend on is also a decision', async () => {
  stub({
    reading: 'x',
    tests: [],
    skip: [{ riskId: 'brand-name-in-script', why: 'cheap to fix in the script' }],
    plan: 'p',
  });
  const result = await planShoot(env, { spec: spec(), risks, finalUsd: 0.48, remainingUsd: 6 });
  assert.equal(result.skip.length, 1);
  assert.match(result.skip[0].why, /cheap to fix/);
});

test('an invented skip is dropped too', async () => {
  stub({ reading: 'x', tests: [], skip: [{ riskId: 'nope', why: 'because' }], plan: 'p' });
  assert.deepEqual((await planShoot(env, { spec: spec(), risks, finalUsd: 0.48, remainingUsd: 6 })).skip, []);
});

// -------------------------------------------------------------------------------- reviewing

test('a test that HELD never yields a revision, even when the model proposes one', async () => {
  // The guard that matters. A script that survived a test is a script that works.
  stub({
    settled: true,
    finding: 'The face held.',
    revision: { block: 'guard', text: 'Some extra guard text.', why: 'belt and braces' },
    readyToShoot: true,
  });
  const result = await reviewTest(env, {
    spec: spec(),
    question: "Does the ape's face survive?",
    verdict: { answer: 'held', by: 'visitor' },
  });
  assert.equal(result.revision, null);
  assert.equal(result.suppressedRevision, true, 'and the attempt is visible rather than silently dropped');
  assert.equal(result.readyToShoot, true);
});

test('a test that FAILED yields the revision, on a named block', async () => {
  stub({
    settled: true,
    finding: 'The face came back wrong.',
    revision: { block: 'staging', text: '<Subject 1> is the ape, framed close on the head.', why: 'the head has to dominate' },
    readyToShoot: false,
  });
  const result = await reviewTest(env, {
    spec: spec(),
    question: "Does the ape's face survive?",
    verdict: { answer: 'failed', by: 'visitor', note: 'wrong species' },
  });
  assert.equal(result.revision.block, 'staging');
  assert.ok(REVISABLE_BLOCKS.includes(result.revision.block));
  assert.match(result.finding, /came back wrong/);
  assert.equal(result.readyToShoot, false);
});

test('an unclear result can still revise, because ambiguity is a finding', async () => {
  stub({
    settled: false,
    finding: 'Could not tell from this framing.',
    revision: { block: 'camera', text: 'The camera holds a static shot on the head.', why: 'a tighter look' },
    readyToShoot: false,
  });
  const result = await reviewTest(env, {
    spec: spec(),
    question: 'q?',
    verdict: { answer: 'unclear', by: 'director' },
  });
  assert.equal(result.settled, false);
  assert.equal(result.revision.block, 'camera');
});

// -------------------------------------------------------------------------------- applying

test('a revision replaces exactly one named block and touches nothing else', () => {
  const original = spec();
  const next = applyRevisions(original, [{ block: 'guard', text: 'Ordinary skin, not a mannequin.' }]);
  assert.equal(next.guard, 'Ordinary skin, not a mannequin.');
  assert.equal(next.world, original.world);
  assert.deepEqual(next.beats, original.beats);
  assert.equal(original.guard, '', 'and the visitor\'s own screenplay is never mutated');
});

test('revisions layer in order, so a later one supersedes an earlier one', () => {
  const next = applyRevisions(spec(), [
    { block: 'continuity', text: 'first' },
    { block: 'continuity', text: 'second' },
  ]);
  assert.equal(next.continuity, 'second');
});

test('a malformed revision is skipped rather than corrupting the script', () => {
  const next = applyRevisions(spec(), [{ block: null, text: 'x' }, { block: 'guard' }, { block: 'guard', text: 'ok' }]);
  assert.equal(next.guard, 'ok');
});

test('no revisions returns the very same object', () => {
  const original = spec();
  assert.equal(applyRevisions(original, []), original, 'no copy, no churn, no accidental divergence');
});
