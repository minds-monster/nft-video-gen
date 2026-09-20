// Notes on a daily: the visitor telling the Director what was wrong with a take it delivered.
//
// WHY THIS LOOP EXISTS AT ALL. Every other input the Director gets is something it produced
// itself. The risk register measures what the artwork will do to a render; a screen test answers
// a question the Director thought to ask. Neither can report that the coat went grey in the last
// second — only the person who watched the finished clip can, and until this path existed the
// only way they could say anything was through a rehearsal's three buttons, which can discuss
// nothing the Director did not already suspect.
//
// THE FAILURES THIS FILE EXISTS TO PREVENT, in the order they would cost money:
//
//   1. PRAISE TREATED AS A DEFECT. "That is the one" must not buy a rehearsal or rewrite a block.
//      A script that survived a delivered take is a script that works, and an agent looking busy
//      is the exact failure worker/director-agent.js already guards on the screen-test side.
//   2. A REHEARSAL AGAINST A BEAT THE FILM DOES NOT HAVE. A demand invented from notes is priced
//      and gated exactly like one from the shooting plan, so it goes through the same filter —
//      the model does not get a looser rule because the input came from a person.
//   3. A PRICE QUOTED BY THE MODEL. Computed from the parameters here as everywhere else.
//   4. A DEMAND THE NEXT READING SILENTLY DROPS. A rehearsal asked for after watching a take did
//      not come from reading the script, so re-reading the script must not retire it.
//   5. NOTES THAT REACH NOTHING. The words are durable on the take before anything that can fail.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewDaily } from '../../worker/director-agent.js';
import {
  addNotedDemands,
  appendTake,
  loadProduction,
  recordTakeNotes,
  saveShootingPlan,
  startNotesReview,
  handleDirectorQueue,
} from '../../worker/director-job.js';
import { testGate } from '../../worker/director-gate.js';
import { DAILY_NOTES_SCHEMA, REVISABLE_BLOCKS } from '../../worker/director-brief.js';
import { handleDirectorNotes } from '../../worker/director.js';
import { signSession } from '../../worker/session.js';

const MIND = 'mind-notes';
const FILM = 'film-notes';

class MockKV {
  store = new Map();
  async get(key, type = 'text') {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

class MockQueue {
  sent = [];
  async send(body, options) { this.sent.push({ body, options }); }
}

const makeEnv = () => ({
  MIND_CONNECTIONS: new MockKV(),
  DIRECTOR_JOBS: new MockQueue(),
  SCREENWRITER_MODEL: 'test-model',
  NVIDIA_API_KEY: 'k',
  NVIDIA_BASE_URL: 'https://nim.test/v1',
});

const spec = (over = {}) => ({
  title: 'Night Grid',
  logline: 'Three cars launch.',
  world: 'Night on a wet grid.',
  grade: 'Photoreal.',
  guard: 'Every character has ordinary skin.',
  staging: '<Subject 1> is the ape.',
  continuity: '',
  camera: 'the camera trucks left',
  beats: ['the ape steps out of the car', 'the grid lights come up'],
  referencePlan: [{ key: 'ape' }],
  duration: 6,
  resolution: '768P',
  ratio: '16:9',
  ...over,
});

const TAKE = {
  takeId: 'take-1111',
  kind: 'take',
  status: 'ready',
  costUsd: 1.95,
  params: { model: 'MiniMax-H3', resolution: '1080P', duration: 6, ratio: '16:9' },
  script: { source: 'screenplay', text: 'integrated_multimodal_description: a shot' },
};

/** Stub the provider. `reply` is whatever the forced tool call returns. */
const stub = (reply) => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(reply) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200 },
    );
  };
  return seen;
};

const demand = (over = {}) => ({
  id: 'ape-steps-out',
  question: 'Does the ape physically open the door and step out?',
  why: 'They said it teleported onto the tarmac.',
  beats: [1],
  subjects: [1],
  direction:
    'The ape pulls the door open with one hand, swings a leg over the sill and puts a foot on the wet tarmac. ' +
    'Nothing fades, nothing dissolves, no second copy of the ape appears.',
  answers: { held: 'The ape stepped out', failed: 'The ape appeared outside' },
  onHeld: 'Shoot it.',
  onFailed: 'Split the step across two beats.',
  ...over,
});

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const deliver = (env, body) => {
  const acked = [];
  const batch = { queue: 'director-jobs', messages: [{ body, attempts: 1, ack: () => acked.push(body), retry: () => {} }] };
  return handleDirectorQueue(batch, env).then(() => acked);
};

// ──────────────────────────────────────────────────────────────────── what the model may do

test('praise buys nothing: no revision, no rehearsal, no second take', async () => {
  // The most expensive thing an agent can do with a compliment is find work in it.
  stub({
    finding: 'That is the film. Nothing needs changing.',
    revision: null,
    demands: [],
    shootAgain: false,
  });
  const result = await reviewDaily(makeEnv(), {
    spec: spec(),
    notes: 'This is perfect, exactly what I wanted.',
    take: TAKE,
  });

  assert.equal(result.revision, null);
  assert.deepEqual(result.demands, []);
  assert.equal(result.shootAgain, false, 'a delivered take the visitor likes IS the film');
});

test('a rehearsal against a beat the film does not have is dropped, never priced', async () => {
  stub({
    finding: 'The step needs rehearsing.',
    revision: null,
    demands: [demand({ beats: [9] })],
    shootAgain: true,
  });
  const result = await reviewDaily(makeEnv(), { spec: spec(), notes: 'The ape teleported out.', take: TAKE });

  assert.deepEqual(result.demands, []);
  assert.deepEqual(result.droppedDemands.map((d) => d.reason), ['names a beat the film does not have']);
});

test('the price of a rehearsal is computed here, never quoted by the model', async () => {
  stub({
    finding: 'Worth seeing before another take.',
    revision: null,
    // The model claims it is free. It is not, and it does not get to say.
    demands: [demand({ estUsd: 0 })],
    shootAgain: true,
  });
  const result = await reviewDaily(makeEnv(), { spec: spec(), notes: 'The ape teleported out.', take: TAKE });

  assert.equal(result.demands.length, 1);
  assert.ok(result.demands[0].estUsd > 0, 'a rehearsal costs what its parameters cost');
  assert.equal(result.demands[0].params.duration, 6);
});

test('a revision naming a block the Screenwriter does not emit is refused', async () => {
  stub({
    finding: 'Fixed the lighting.',
    revision: { block: 'lighting', text: 'Brighter.', why: 'They said it was murky.' },
    demands: [],
    shootAgain: true,
  });
  const result = await reviewDaily(makeEnv(), { spec: spec(), notes: 'Too murky to see the ape.', take: TAKE });

  assert.equal(result.revision, null, 'the model may not invent a block to write into');
  assert.equal(result.suppressedRevision, true, 'and the attempt is reported, not swallowed');
  assert.ok(!REVISABLE_BLOCKS.includes('lighting'));
});

test('a camera complaint EARNS a camera rehearsal — the shooting plan rule does not apply here', async () => {
  // worker/director-agent.js drops a camera-only demand from a shooting plan because every other
  // rehearsal carries the film's camera block and answers it in passing. After a delivered take
  // there is no other rehearsal to read it off, and the visitor has just said the move is wrong.
  stub({
    finding: 'The move has to be seen before another take.',
    revision: null,
    demands: [
      demand({
        id: 'camera-holds',
        question: 'Does the camera truck left without a jump?',
        direction: 'The camera trucks left at slow speed across the grid, never cutting and never teleporting.',
        answers: { held: 'The camera held', failed: 'The camera jumped' },
      }),
    ],
    shootAgain: true,
  });
  const result = await reviewDaily(makeEnv(), { spec: spec(), notes: 'The camera jumped halfway through.', take: TAKE });

  assert.equal(result.demands.length, 1, 'their own observation is not filtered out from under them');
  assert.deepEqual(result.droppedDemands, []);
});

test('a revision means the film is not finished, whatever the model ticked', async () => {
  stub({
    finding: 'Rewrote the guard.',
    revision: { block: 'guard', text: 'The ape has ordinary fur and never turns to chrome.', why: 'It went metallic.' },
    demands: [],
    // Self-contradiction: an amended script and nothing to do with it.
    shootAgain: false,
  });
  const result = await reviewDaily(makeEnv(), { spec: spec(), notes: 'The ape went chrome.', take: TAKE });

  assert.equal(result.shootAgain, true);
});

test('the visitor’s words, the script rendered, and earlier notes all reach the model verbatim', async () => {
  const seen = stub({ finding: 'x', revision: null, demands: [], shootAgain: false });
  await reviewDaily(makeEnv(), {
    spec: spec(),
    notes: 'The coat went grey in the last second.',
    take: TAKE,
    prompt: 'an ape stepping out of a car at night',
    priorNotes: [{ index: 1, notes: 'The grid was too dark.' }],
    priorVerdicts: [{ question: 'Does the face survive?', answer: 'held', note: null }],
  });

  const user = seen[0].messages.find((message) => message.role === 'user').content;
  assert.match(user, /The coat went grey in the last second/);
  assert.match(user, /an ape stepping out of a car at night/, 'the prompt they paid for, verbatim');
  assert.match(user, /integrated_multimodal_description: a shot/, 'the script H3 was actually sent');
  assert.match(user, /The grid was too dark/, 'what they said about the last take');
  assert.match(user, /Does the face survive\?/, 'and what the rehearsals already proved');
});

test('the schema forbids the model inventing fields, and demands are capped', () => {
  assert.equal(DAILY_NOTES_SCHEMA.additionalProperties, false);
  assert.equal(DAILY_NOTES_SCHEMA.properties.demands.maxItems, 2);
  assert.deepEqual(DAILY_NOTES_SCHEMA.required, ['finding', 'revision', 'demands', 'shootAgain']);
});

// ─────────────────────────────────────────────────────────────── what reaches the durable record

test('notes are on the take before anything that can fail', async () => {
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await recordTakeNotes(env, MIND, FILM, TAKE.takeId, 'The coat went grey.');

  const production = await loadProduction(env, MIND, FILM);
  assert.equal(production.takes[0].notes.text, 'The coat went grey.');
  assert.equal(production.takes[0].notes.by, 'visitor');
});

test('writing again amends the notes rather than growing a second set', async () => {
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await recordTakeNotes(env, MIND, FILM, TAKE.takeId, 'Too dark.');
  await recordTakeNotes(env, MIND, FILM, TAKE.takeId, 'Too dark, and the coat went grey.');

  const production = await loadProduction(env, MIND, FILM);
  assert.equal(production.takes[0].notes.text, 'Too dark, and the coat went grey.');
});

test('a rehearsal born from notes holds the Shoot button shut', async () => {
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await saveShootingPlan(env, MIND, FILM, { reading: 'r', tests: [], skip: [], demands: [], totalTestUsd: 0, at: 1 });

  const added = await addNotedDemands(env, MIND, FILM, [{ ...demand(), estUsd: 0.48 }], { fromTakeId: TAKE.takeId });
  assert.equal(added.length, 1);
  assert.equal(added[0].fromTakeId, TAKE.takeId);

  const production = await loadProduction(env, MIND, FILM);
  const gate = testGate(production.shootingPlan, production.takes);
  assert.equal(gate.cleared, false, 'the next take waits on the rehearsal');
  assert.deepEqual(gate.toRun.map((entry) => entry.riskId), ['demand:ape-steps-out']);
  assert.equal(gate.outstandingUsd, 0.48, 'and it is priced where the visitor can see it');
});

test('the same defect written twice buys one rehearsal, not two', async () => {
  const env = makeEnv();
  await saveShootingPlan(env, MIND, FILM, { reading: 'r', tests: [], skip: [], demands: [], totalTestUsd: 0, at: 1 });
  await addNotedDemands(env, MIND, FILM, [{ ...demand(), estUsd: 0.48 }], { fromTakeId: TAKE.takeId });
  const again = await addNotedDemands(env, MIND, FILM, [{ ...demand(), estUsd: 0.48 }], { fromTakeId: TAKE.takeId });

  assert.equal(again, null);
  const production = await loadProduction(env, MIND, FILM);
  assert.equal(production.shootingPlan.demands.length, 1);
});

test('a film shot past the gate gets a shooting plan opened for it, rather than none', async () => {
  // `override: true` shoots with no plan at all, so the gate says `unread` forever. A rehearsal
  // asked for after watching that take is a truer description of what the film now owes.
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await addNotedDemands(env, MIND, FILM, [{ ...demand(), estUsd: 0.48 }], {
    reading: 'The ape teleported out of the car.',
    fromTakeId: TAKE.takeId,
  });

  const production = await loadProduction(env, MIND, FILM);
  const gate = testGate(production.shootingPlan, production.takes);
  assert.equal(gate.unread, false);
  assert.equal(gate.toRun.length, 1);
});

test('a fresh reading of the film cannot retire a rehearsal the visitor’s notes asked for', async () => {
  // THE DROP THIS GUARDS. `saveShootingPlan` replaces the last reading wholesale, on purpose — a
  // demand from a reading that no longer applies must not block forever. But a demand born from
  // watching a take did not come from reading the script, so re-reading the script cannot answer
  // it. It retires the way any test does: by being shot and answered.
  const env = makeEnv();
  await saveShootingPlan(env, MIND, FILM, { reading: 'first', tests: [], skip: [], demands: [], totalTestUsd: 0, at: 1 });
  await addNotedDemands(env, MIND, FILM, [{ ...demand(), estUsd: 0.48 }], { fromTakeId: TAKE.takeId });

  await saveShootingPlan(env, MIND, FILM, {
    reading: 'second',
    tests: [],
    skip: [],
    demands: [{ ...demand({ id: 'from-the-register' }), estUsd: 0.48 }],
    totalTestUsd: 0.48,
    at: 2,
  });

  const production = await loadProduction(env, MIND, FILM);
  assert.deepEqual(
    production.shootingPlan.demands.map((entry) => entry.id).sort(),
    ['ape-steps-out', 'from-the-register'],
    'the reading is replaced; what the visitor saw is not',
  );
  assert.equal(production.shootingPlan.reading, 'second');
});

// ─────────────────────────────────────────────────────────────────────────────── the whole step

test('end to end: notes become a finding, a revision and a priced rehearsal on the record', async () => {
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await recordTakeNotes(env, MIND, FILM, TAKE.takeId, 'The ape teleported onto the tarmac and its coat went grey.');
  const production = await loadProduction(env, MIND, FILM);

  stub({
    finding: 'Two defects: the step is faked and the coat loses colour. I have pinned the coat in the guard block and want the step rehearsed.',
    revision: { block: 'guard', text: 'The ape keeps its brown coat throughout and never turns grey or chrome.', why: 'You saw the coat go grey.' },
    demands: [demand()],
    shootAgain: true,
  });

  const record = await startNotesReview(env, MIND, {
    filmId: FILM,
    take: production.takes[0],
    spec: spec(),
    prompt: 'an ape stepping out of a car at night',
  });
  assert.ok(record, 'a read-back job is opened');
  assert.equal(record.take.takeId, TAKE.takeId, 'and it reads the DELIVERED take, not a fresh one');
  assert.equal(record.proposalId, null, 'reading notes spends nothing, so nothing is authorised');
  assert.deepEqual(
    env.DIRECTOR_JOBS.sent.map((message) => message.body.step),
    ['notes'],
    'and nothing is queued but the read-back itself',
  );

  const acked = await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'notes' });
  assert.equal(acked.length, 1);

  const after = await loadProduction(env, MIND, FILM);
  const take = after.takes.find((entry) => entry.takeId === TAKE.takeId);

  assert.match(take.review.finding, /coat/, 'the finding is on the take, where they wrote the notes');
  assert.equal(take.review.revised.block, 'guard');
  assert.equal(take.review.shootAgain, true);
  assert.deepEqual(take.review.demands.map((entry) => entry.riskId), ['demand:ape-steps-out']);

  assert.equal(after.revisions.length, 1, 'the revision is appended, never written over the screenplay');
  assert.equal(after.revisions[0].block, 'guard');
  assert.equal(after.revisions[0].fromTakeId, TAKE.takeId, 'and it says which take caused it');

  const gate = testGate(after.shootingPlan, after.takes);
  assert.equal(gate.cleared, false, 'and the next take now waits on the rehearsal');
});

test('notes with no screenplay in hand are kept, and nothing is invented against them', async () => {
  const env = makeEnv();
  await appendTake(env, MIND, FILM, TAKE);
  await recordTakeNotes(env, MIND, FILM, TAKE.takeId, 'The coat went grey.');
  const production = await loadProduction(env, MIND, FILM);

  const record = await startNotesReview(env, MIND, { filmId: FILM, take: production.takes[0], spec: null });

  assert.equal(record, null, 'no job, because there is nothing to amend');
  const after = await loadProduction(env, MIND, FILM);
  assert.equal(after.takes[0].notes.text, 'The coat went grey.', 'but their words are still on the record');
  assert.equal(after.revisions.length, 0);
});

test('an empty note reaches no model and costs no tokens', async () => {
  const env = makeEnv();
  const calls = [];
  globalThis.fetch = async () => { calls.push(1); return new Response('{}', { status: 200 }); };
  const record = await startNotesReview(env, MIND, {
    filmId: FILM,
    take: { ...TAKE, notes: { text: '   ' } },
    spec: spec(),
  });
  assert.equal(record, null);
  assert.equal(calls.length, 0);
});

// ──────────────────────────────────────────────────────────────────────────────── the endpoint

const ENDPOINT_ENV = () => ({
  SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  MIND_CONNECTIONS: new MockKV(),
  DIRECTOR_JOBS: new MockQueue(),
});

const postNotes = async (env, body) => {
  const token = await signSession(env, { mindId: MIND, exp: Date.now() + 3600000 });
  const request = new Request('https://minds.monster/api/director/notes', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await handleDirectorNotes(request, env);
  return { status: response.status, body: await response.json() };
};

test('an empty note is refused rather than written as a note that says nothing', async () => {
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, TAKE);
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: TAKE.takeId, notes: '   ' });
  assert.equal(status, 400);
  assert.equal(body.error, 'nothing_said');
});

test('notes sent to a screen test are refused, not filed where nothing reads them', async () => {
  // A rehearsal has a question, three buttons and its own read-back. Accepting notes here would
  // record them on a take whose review step never looks for them.
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, { ...TAKE, takeId: 'test-2222', kind: 'screen-test', question: 'Does it hold?' });
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: 'test-2222', notes: 'It wobbled.' });
  assert.equal(status, 400);
  assert.equal(body.error, 'not_a_daily');
});

test('a take that produced no film has nothing to have been seen', async () => {
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, { ...TAKE, status: 'failed', reason: 'content filter' });
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: TAKE.takeId, notes: 'Bad.' });
  assert.equal(status, 400);
  assert.equal(body.error, 'not_watched');
});

test('a take id from another film is refused', async () => {
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, TAKE);
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: 'take-9999', notes: 'Bad.' });
  assert.equal(status, 404);
  assert.equal(body.error, 'unknown_take');
});

test('with no screenplay open, the notes are kept and the visitor is told why nothing read them', async () => {
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, TAKE);
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: TAKE.takeId, notes: 'The coat went grey.' });

  assert.equal(status, 200);
  assert.equal(body.reading, false);
  assert.match(body.detail, /screenplay/, 'said out loud, not left to be inferred from a null jobId');
  const production = await loadProduction(env, MIND, FILM);
  assert.equal(production.takes[0].notes.text, 'The coat went grey.');
});

test('notes longer than the cap are refused — this is notes, not a second screenplay', async () => {
  const env = ENDPOINT_ENV();
  await appendTake(env, MIND, FILM, TAKE);
  const { status, body } = await postNotes(env, { filmId: FILM, takeId: TAKE.takeId, notes: 'x'.repeat(2001) });
  assert.equal(status, 400);
  assert.equal(body.error, 'too_long');
});
