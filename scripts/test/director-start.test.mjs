// The gate on POST /api/director/start, and the demand path through /api/director/test.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is the Hollywood-sign film: a take bought with the
// Director's questions unasked or unanswered. The hero was made probes-first, and this is that
// order enforced at the one endpoint that spends the visitor's money on the film itself.
//
// The second thing guarded is the override. A visitor may shoot past the gate — it is their
// money — but only by saying so, and the take must carry the fact.

import test from 'node:test';
import assert from 'node:assert/strict';

import { signSession } from '../../worker/session.js';
import { setBudget } from '../../worker/budget.js';
import { handleDirectorPlan, handleDirectorStart, handleDirectorTest } from '../../worker/director.js';
import { appendTake, appendRevision, dropRevision, loadJob, loadProduction, replaceFreeRevisions, saveShootingPlan } from '../../worker/director-job.js';
import { filmIdFor } from '../../worker/film-id.js';
import { FIXTURES } from '../lib/storyboard-fixtures.mjs';

const MIND = 'mind-test';

class MockKV {
  store = new Map();
  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) { this.store.set(key, value); }
  async delete(key) { this.store.delete(key); }
}

class MockQueue {
  sent = [];
  async send(body, options) { this.sent.push({ body, options }); }
}

const makeEnv = async () => {
  const env = {
    SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
    MIND_CONNECTIONS: new MockKV(),
    DIRECTOR_JOBS: new MockQueue(),
    MINIMAX_API_KEY: 'test-key',
  };
  await setBudget(env, MIND, { total: 20 });
  return env;
};

const post = async (env, path, body) => {
  const token = await signSession(env, { mindId: MIND, exp: Date.now() + 3600000 });
  return new Request(`https://minds.monster${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

const fixture = FIXTURES.find((f) => f.id === 'grid-launch');
const filmId = filmIdFor(fixture.spec);
// Ask mode parks every spend for approval, so nothing here ever reaches MiniMax.
const start = async (env, extra = {}) =>
  handleDirectorStart(await post(env, '/api/director/start', { spec: fixture.spec, cast: fixture.cast, mode: 'ask', ...extra }), env);

const demand = {
  id: 'letters-become-brain',
  question: 'Do the letters physically become the brain?',
  why: 'the prompt says literally',
  beats: [1],
  subjects: [1],
  direction: 'The letters are rubber that inflates and fuses into one mass. Nothing fades in.',
  refKeys: [fixture.spec.referencePlan[0].key],
  answers: { held: 'The letters became the brain', failed: 'A brain faded in over them', unclear: 'Cannot tell' },
  params: { model: 'MiniMax-H3', resolution: '768P', duration: 6, ratio: '16:9' },
  estUsd: 0.48,
};

const readWithDemand = (env) =>
  saveShootingPlan(env, MIND, filmId, { reading: 'r', plan: 'p', tests: [], skip: [], fixes: [], demands: [demand], totalTestUsd: 0.48, at: Date.now() });

const held = (env, over = {}) =>
  appendTake(env, MIND, filmId, {
    takeId: `test-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'screen-test',
    riskId: 'demand:letters-become-brain',
    status: 'ready',
    verdict: { answer: 'held', by: 'visitor' },
    ...over,
  });

// ------------------------------------------------------------------------------- the gate

test('an unread film is refused: reading is free and shooting blind is not', async () => {
  const env = await makeEnv();
  const response = await start(env);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'unread');
  assert.equal(body.gate.unread, true);
  assert.deepEqual(env.DIRECTOR_JOBS.sent, [], 'and nothing was queued');
});

test('a read film with an unanswered demand is refused, and the refusal names the question', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  const response = await start(env);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, 'untested');
  assert.deepEqual(body.outstanding.map((t) => t.riskId), ['demand:letters-become-brain']);
  assert.equal(body.outstanding[0].question, demand.question);
  assert.equal(body.outstanding[0].estUsd, 0.48);
});

test('a failed test keeps the gate shut; a later held one opens it', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  await held(env, { verdict: { answer: 'failed', by: 'visitor' } });
  assert.equal((await start(env)).status, 409);
  await held(env);
  const response = await start(env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'awaiting-approval', 'ask mode parks it — the gate passed');
  assert.equal(body.override, null);
});

test('override shoots past the gate and the take says so', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  const response = await start(env, { override: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.override.outstanding, ['demand:letters-become-brain']);
  const job = await loadJob(env, MIND, body.jobId);
  assert.deepEqual(job.take.override.outstanding, ['demand:letters-become-brain'], 'written on the take itself');
});

test('override on an unread film records that too', async () => {
  const env = await makeEnv();
  const body = await (await start(env, { override: true })).json();
  assert.equal(body.override.unread, true);
});

test('a cleared gate records no override even when the flag is sent', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  await held(env);
  const body = await (await start(env, { override: true })).json();
  assert.equal(body.override, null, 'nothing was overridden, so nothing is claimed');
});

// ------------------------------------------------------------------------------- the plan

test('the plan carries the gate and merges the demand into the priced register', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  const response = await handleDirectorPlan(await post(env, '/api/director/plan', { spec: fixture.spec, cast: fixture.cast }), env);
  const body = await response.json();
  assert.equal(body.gate.unread, false);
  assert.equal(body.gate.cleared, false);
  const risk = body.risks.find((r) => r.id === 'demand:letters-become-brain');
  assert.ok(risk, 'the demand is a risk the panel can show');
  assert.equal(risk.source, 'director');
  assert.equal(risk.test.focus, 'rehearsal');
  assert.ok(body.estimate.testsCeilingUsd >= 0.48, 'and it is in the ceiling');
  assert.equal(body.ready, true, '`ready` is still only legality');
});

test('an unread plan says so, and is never cleared', async () => {
  const env = await makeEnv();
  const body = await (await handleDirectorPlan(await post(env, '/api/director/plan', { spec: fixture.spec, cast: fixture.cast }), env)).json();
  assert.equal(body.gate.unread, true);
  assert.equal(body.gate.cleared, false);
});

// ------------------------------------------------------------------------------- the test

test('a demand id runs as a rehearsal of the real film, carrying its direction', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  const response = await handleDirectorTest(
    await post(env, '/api/director/test', { spec: fixture.spec, cast: fixture.cast, riskId: 'demand:letters-become-brain', mode: 'ask' }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.question, demand.question);
  assert.equal(body.costUsd, 0.48);
  const job = await loadJob(env, MIND, body.jobId);
  assert.equal(job.take.kind, 'screen-test');
  assert.equal(job.take.riskId, 'demand:letters-become-brain');
  assert.equal(job.direction, demand.direction, 'the review step will be told what was rendered');
  assert.equal(job.take.answers.failed, 'A brain faded in over them', 'the buttons under the clip speak the film\'s language');
  assert.match(job.script.text, /rubber that inflates/, 'the direction IS the beat');
  assert.match(job.script.text, /Nothing fades in or out, nothing dissolves/);
  assert.equal(job.params.duration, 6);
});

test('a demand the plan does not have is not on this film', async () => {
  const env = await makeEnv();
  await readWithDemand(env);
  const response = await handleDirectorTest(
    await post(env, '/api/director/test', { spec: fixture.spec, cast: fixture.cast, riskId: 'demand:nope', mode: 'ask' }),
    env,
  );
  assert.equal(response.status, 404);
});

// ------------------------------------------------------------------------------- revisions

test('a fresh reading replaces the last reading\'s free fixes and keeps the ones tests paid for', async () => {
  const env = await makeEnv();
  await appendRevision(env, MIND, filmId, { block: 'world', text: 'scrubbed', why: 'Removes the prohibited brand name.', fromRiskId: 'brand-name-in-script', free: true });
  await appendRevision(env, MIND, filmId, { block: 'continuity', text: 'one take', why: 'from a test', fromTakeId: 'test-1' });
  await replaceFreeRevisions(env, MIND, filmId, [{ block: 'world', text: 'the letters are the material', why: 'rule 12', fromRiskId: 'transformation-faked:2' }]);
  const { revisions } = await loadProduction(env, MIND, filmId);
  assert.deepEqual(revisions.map((r) => [r.block, r.text, Boolean(r.free)]), [
    ['continuity', 'one take', false],
    ['world', 'the letters are the material', true],
  ]);
});

test('a revision can be dropped by its timestamp, through the endpoint', async () => {
  const env = await makeEnv();
  await appendRevision(env, MIND, filmId, { block: 'world', text: 'scrubbed', why: 'w', free: true });
  const { revisions } = await loadProduction(env, MIND, filmId);
  const { handleDirectorRevisionDrop } = await import('../../worker/director.js');
  const response = await handleDirectorRevisionDrop(await post(env, '/api/director/revision/drop', { filmId, at: revisions[0].at }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).revisions, []);
  assert.deepEqual((await loadProduction(env, MIND, filmId)).revisions, []);
  assert.equal(typeof dropRevision, 'function');
});

// ------------------------------------------------------------------------------- verdicts

test('a verdict on a take whose job is gone still reaches the Director, via a rebuilt review job', async () => {
  // Tests shot before 2026-08-28 do not remember their job, and jobs expire in a day either way.
  const env = await makeEnv();
  await env.MIND_CONNECTIONS.put(`draft:${MIND}`, JSON.stringify({ filmId, spec: fixture.spec, prompt: 'letters become a brain' }));
  await appendTake(env, MIND, filmId, {
    takeId: 'test-old',
    kind: 'screen-test',
    riskId: 'transformation-faked:prompt',
    question: 'Does it physically happen?',
    status: 'ready',
    r2Key: 'director/x/y/test-old/video.mp4',
    params: { model: 'MiniMax-H3', resolution: '768P', duration: 6, ratio: '16:9' },
  });
  const { handleDirectorVerdict } = await import('../../worker/director.js');
  const response = await handleDirectorVerdict(
    await post(env, '/api/director/verdict', { filmId, takeId: 'test-old', answer: 'held', note: 'the letters folded into the brain in place' }),
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reviewing, true);
  const queued = env.DIRECTOR_JOBS.sent.find((m) => m.body.step === 'review');
  assert.ok(queued, 'a review step is queued');
  const job = await loadJob(env, MIND, queued.body.jobId);
  assert.equal(job.take.takeId, 'test-old', 'and it judges THIS take');
  assert.equal(job.take.verdict.answer, 'held');
  assert.equal(job.take.verdict.note, 'the letters folded into the brain in place');
  assert.equal(job.prompt, 'letters become a brain', 'with the visitor\'s words to hand');
  assert.deepEqual(job.spec.beats, fixture.spec.beats);
});

test('a verdict with no draft for the film is recorded but cannot be reviewed', async () => {
  const env = await makeEnv();
  await appendTake(env, MIND, filmId, { takeId: 'test-orphan', kind: 'screen-test', riskId: 'x', status: 'ready' });
  const { handleDirectorVerdict } = await import('../../worker/director.js');
  const body = await (await handleDirectorVerdict(await post(env, '/api/director/verdict', { filmId, takeId: 'test-orphan', answer: 'failed' }), env)).json();
  assert.equal(body.reviewing, false);
  assert.equal(body.production.takes[0].verdict.answer, 'failed', 'the answer itself is never lost');
});
