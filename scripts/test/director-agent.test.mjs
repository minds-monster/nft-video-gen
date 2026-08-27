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

// -------------------------------------------------------------------------------- demands

const demand = (over = {}) => ({
  id: 'letters-become-brain',
  question: 'Do the letters physically become the brain?',
  why: 'the prompt says literally',
  beats: [2],
  subjects: [1],
  direction: 'The letters are rubber that inflates and fuses into one mass, which folds into the ridges of a brain. Nothing fades in.',
  onHeld: 'shoot the film',
  onFailed: 'split the change across two beats',
  ...over,
});

const brainSpec = () =>
  spec({
    beats: ['the camera closes on the letters', 'the letters inflate and become a brain'],
    referencePlan: [{ key: 'sign', role: 'prop', crop: '' }],
  });

test('a demand is kept, priced from the parameters, and bound to its subjects\' references', async () => {
  stub({ reading: 'x', tests: [], skip: [], fixes: [], demands: [demand()], plan: 'p' });
  const result = await planShoot(env, { spec: brainSpec(), risks: [], finalUsd: 0.72, remainingUsd: 6 });
  assert.equal(result.demands.length, 1);
  const kept = result.demands[0];
  assert.equal(kept.id, 'letters-become-brain');
  assert.equal(kept.estUsd, 0.48, 'the price comes from MOTION_TEST, never from the model');
  assert.deepEqual(kept.refKeys, ['sign'], '<Subject 1> resolves to the first reference slot');
  assert.match(kept.direction, /rubber that inflates/);
  assert.deepEqual(result.droppedDemands, []);
});

test('a demand with no rehearsal text is dropped and recorded — a question with nothing to render', async () => {
  stub({ reading: 'x', tests: [], skip: [], fixes: [], demands: [demand({ direction: '' })], plan: 'p' });
  const result = await planShoot(env, { spec: brainSpec(), risks: [], finalUsd: 0.72, remainingUsd: 6 });
  assert.deepEqual(result.demands, []);
  assert.equal(result.droppedDemands[0].reason, 'no rehearsal text');
});

test('a demand naming a beat the film does not have is a hallucination', async () => {
  stub({ reading: 'x', tests: [], skip: [], fixes: [], demands: [demand({ beats: [7] })], plan: 'p' });
  const result = await planShoot(env, { spec: brainSpec(), risks: [], finalUsd: 0.72, remainingUsd: 6 });
  assert.deepEqual(result.demands, []);
  assert.match(result.droppedDemands[0].reason, /beat the film does not have/);
});

test('a demand on a beat the register already rehearses is a duplicate charge, and dropped', async () => {
  const registerRehearsal = {
    id: 'transformation-faked:2',
    severity: 'hazard',
    what: 'beat 2 asks one thing to become another',
    measured: 'measured on the Hollywood sign',
    estUsd: 0.48,
    test: { question: 'q?', focus: 'rehearsal', beats: [2], refKeys: ['sign'] },
  };
  stub({ reading: 'x', tests: [], skip: [], fixes: [], demands: [demand()], plan: 'p' });
  const result = await planShoot(env, { spec: brainSpec(), risks: [registerRehearsal], finalUsd: 0.72, remainingUsd: 6 });
  assert.deepEqual(result.demands, []);
  assert.match(result.droppedDemands[0].reason, /register already rehearses/);
});

test('demands are capped at four and a repeated id counts once', async () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'a'].map((id) => demand({ id, beats: [1] }));
  stub({ reading: 'x', tests: [], skip: [], fixes: [], demands: many, plan: 'p' });
  const result = await planShoot(env, { spec: brainSpec(), risks: [], finalUsd: 0.72, remainingUsd: 6 });
  assert.deepEqual(result.demands.map((d) => d.id), ['a', 'b', 'c', 'd']);
  assert.equal(result.droppedDemands.find((d) => d.id === 'a')?.reason, 'duplicate');
});

test('the Director is shown the visitor\'s prompt verbatim', async () => {
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ reading: 'x', tests: [], skip: [], fixes: [], demands: [], plan: 'p' }) } }] } }] }),
      { status: 200 },
    );
  };
  const prompt = 'The Hollywood letters literally transform into an enormous white pulsating brain';
  await planShoot(env, { spec: brainSpec(), risks: [], prompt, finalUsd: 0.72, remainingUsd: 6 });
  const user = sent.messages.find((m) => m.role === 'user').content;
  assert.match(user, /THE VISITOR'S PROMPT, VERBATIM: "The Hollywood letters literally transform/);
  assert.match(sent.messages.find((m) => m.role === 'system').content, /THE PROMPT IS THE OTHER SOURCE OF HAZARDS/);
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

test('a failed test can ask to be run again, and a held one never does', async () => {
  stub({
    settled: true,
    finding: 'It dissolved.',
    revision: { block: 'continuity', text: 'The letters are the material that becomes the brain; nothing fades in.', why: 're-mechanised' },
    readyToShoot: false,
    retest: true,
  });
  const failed = await reviewTest(env, {
    spec: spec(),
    question: 'Does beat 2 physically happen?',
    verdict: { answer: 'failed', by: 'visitor' },
    direction: 'The letters inflate...',
    priorVerdicts: [{ question: 'Does the face survive?', answer: 'held', note: null }],
  });
  assert.equal(failed.retest, true);

  stub({ settled: true, finding: 'Held.', revision: null, readyToShoot: true, retest: true });
  const held = await reviewTest(env, { spec: spec(), question: 'q?', verdict: { answer: 'held', by: 'visitor' } });
  assert.equal(held.retest, false, 'a held test is settled by definition');
});

test('the review is shown the rehearsal text and every earlier verdict on the film', async () => {
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ settled: true, finding: 'f', revision: null, readyToShoot: true, retest: false }) } }] } }] }),
      { status: 200 },
    );
  };
  await reviewTest(env, {
    spec: spec(),
    question: 'q?',
    verdict: { answer: 'failed', by: 'visitor' },
    prompt: 'letters become a brain',
    direction: 'The letters are rubber.',
    priorVerdicts: [{ question: 'Does the face survive?', answer: 'held', note: 'clearly' }],
  });
  const user = sent.messages.find((m) => m.role === 'user').content;
  assert.match(user, /What the rehearsal was told to render: The letters are rubber\./);
  assert.match(user, /EARLIER TESTS ON THIS FILM:\n  - "Does the face survive\?" → held \(clearly\)/);
  assert.match(user, /PROMPT, VERBATIM: "letters become a brain"/);
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
