// The Director's step machine, and the orderings that money depends on.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT has already happened once in this codebase, on the 3D
// side, and worker/mesh.js records it plainly: a task was awaited inside a single invocation, and
// "seven dev-server reloads in an afternoon abandoned $0.60 of already-charged generations."
//
// A render here costs up to $1.95 and takes up to nineteen minutes — longer than a Queue
// invocation lives. So the guarantees below are not stylistic:
//
//   1. THE TASK ID IS PERSISTED BEFORE THE SPEND IS RECORDED, and before anything else that could
//      throw. From the moment MiniMax accepts, we are charged; a task id we did not write down is
//      money nobody can ever collect.
//   2. A REJECTED REQUEST IS NEVER BILLED AND NEVER RETRIED. Waiting does not make a banned word
//      acceptable, and nothing was rendered.
//   3. A REDELIVERED MESSAGE NEVER RE-SUBMITS. Queues deliver at least once; charging twice for
//      one film is the worst bug this system could have.
//   4. A DEADLINE IS NOT A CANCELLATION. The clip has been paid for and may still arrive.

import test from 'node:test';
import assert from 'node:assert/strict';

import { setBudget, getSpend } from '../../worker/budget.js';
import { openEnvelope } from '../../worker/render-budget.js';
import {
  handleDirectorQueue,
  loadJob,
  loadProduction,
  startTake,
} from '../../worker/director-job.js';

const MIND = 'mind-test';
const FILM = 'film-1';

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

class MockR2 {
  objects = new Map();
  async put(key, bytes, meta) { this.objects.set(key, { bytes, meta }); }
  async get(key) { return this.objects.get(key) ?? null; }
}

const PARAMS = { model: 'MiniMax-H3', resolution: '768P', duration: 6, ratio: '16:9' };
const CAST = [{ key: 'ape', nft: { image: { pngUrl: 'https://art.example/ape.png' } } }];
const SCRIPT = { source: 'screenplay', text: 'integrated_multimodal_description: a shot' };

/**
 * MiniMax and the media hosts, as a routing table. `taskStates` is consumed one poll at a time,
 * so a test can say "pending, pending, then succeeded" and get exactly that.
 */
const stubFetch = ({ create = { task_id: 'task-abc' }, taskStates = [], video = new Uint8Array([0, 1, 2, 3]), art = true } = {}) => {
  const calls = { create: 0, query: 0, download: 0, art: 0 };
  const states = [...taskStates];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('/v2/video_generation') && init?.method === 'POST') {
      calls.create += 1;
      return new Response(JSON.stringify(create), { status: 200 });
    }
    if (href.includes('/v2/query/video_generation')) {
      calls.query += 1;
      return new Response(JSON.stringify({ task: states.shift() ?? { status: 'running' } }), { status: 200 });
    }
    if (href.includes('cdn.minimax') || href.includes('/download')) {
      calls.download += 1;
      return new Response(video, { status: 200 });
    }
    calls.art += 1;
    return art
      ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })
      : new Response('gone', { status: 404 });
  };
  return calls;
};

const makeEnv = () => ({
  MIND_CONNECTIONS: new MockKV(),
  DIRECTOR_JOBS: new MockQueue(),
  RENDERS: new MockR2(),
  MINIMAX_API_KEY: 'test-key',
  MINIMAX_BASE_URL: 'https://api.minimax.test',
});

/** A funded account with an open, unrestricted production. */
const ready = async (mode = 'allowance', allowanceUsd = 10) => {
  const env = makeEnv();
  await setBudget(env, MIND, { total: 20 });
  await openEnvelope(env, MIND, { filmId: FILM, mode, allowanceUsd, finalUsd: 0.48 });
  return env;
};

const deliver = (env, body, attempts = 1) => {
  const acked = [];
  const retried = [];
  const batch = {
    queue: 'director-jobs',
    messages: [{ body, attempts, ack: () => acked.push(body), retry: (o) => retried.push(o) }],
  };
  return handleDirectorQueue(batch, env).then(() => ({ acked, retried }));
};

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

// ────────────────────────────────────────────────────────────────────────────────── starting

test('ask mode parks before submitting, and nothing is sent to MiniMax', async () => {
  const env = await ready('ask', null);
  const calls = stubFetch();
  const { record, verdict } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });

  assert.equal(record.status, 'awaiting-approval');
  assert.equal(verdict.verdict, 'needs-approval');
  assert.equal(calls.create, 0, 'parking must not cost anything');
  assert.equal(env.DIRECTOR_JOBS.sent.length, 0, 'and must not queue work either');
  assert.equal((await getSpend(env, MIND)).totalSpent, 0);
});

test('allowance mode queues the submit step straight away', async () => {
  const env = await ready();
  stubFetch();
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  assert.equal(record.status, 'queued');
  assert.equal(env.DIRECTOR_JOBS.sent[0].body.step, 'submit');
});

// ───────────────────────────────────────────────────────────────── the ordering that matters

test('the task id is persisted BEFORE the spend is recorded', async () => {
  const env = await ready();
  stubFetch({ create: { task_id: 'task-xyz' } });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });

  // Fail the ledger write. If the task id were saved after it, this is the shape in which a
  // charged render is lost — and the assertion below is the whole reason for the ordering.
  const realPut = env.MIND_CONNECTIONS.put.bind(env.MIND_CONNECTIONS);
  env.MIND_CONNECTIONS.put = async (key, value) => {
    if (key.startsWith('spend:')) throw new Error('KV down');
    return realPut(key, value);
  };

  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });
  env.MIND_CONNECTIONS.put = realPut;

  const stored = await loadJob(env, MIND, record.jobId);
  assert.equal(stored.take.taskId, 'task-xyz', 'the id survives even when everything after it fails');
  assert.ok(stored.take.submittedAt);
});

test('a submitted take is billed once, against its own film', async () => {
  const env = await ready();
  stubFetch();
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });

  const spend = await getSpend(env, MIND);
  assert.equal(spend.events.length, 1);
  assert.equal(spend.events[0].kind, 'video');
  assert.equal(spend.events[0].amountUsd, 0.48);
  assert.equal(spend.events[0].filmId, FILM);
});

test('a redelivered message on a finished job neither re-submits nor re-charges', async () => {
  const env = await ready();
  const calls = stubFetch({ taskStates: [{ status: 'succeeded', content: { url: 'https://cdn.minimax.test/x.mp4' } }] });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'poll' });
  assert.equal((await loadJob(env, MIND, record.jobId)).status, 'complete');

  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });
  assert.equal(calls.create, 1, 'Queues deliver at least once — charging twice is the worst bug here');
  assert.equal((await getSpend(env, MIND)).events.length, 1);
});

// ──────────────────────────────────────────────────────────────────────────── refusals

test('a content-filter rejection is fatal, unbilled and never retried', async () => {
  const env = await ready();
  const calls = stubFetch({ create: { base_resp: { status_code: 1026, status_msg: 'invalid params' } } });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  const { retried } = await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });

  const stored = await loadJob(env, MIND, record.jobId);
  assert.equal(stored.status, 'failed');
  assert.equal(retried.length, 0, 'waiting cannot make a banned word acceptable');
  assert.equal((await getSpend(env, MIND)).totalSpent, 0, 'nothing rendered, so nothing is owed');
  assert.equal(calls.create, 1);
});

test('an unreachable reference stops the shoot rather than rendering a film missing a piece', async () => {
  const env = await ready();
  const calls = stubFetch({ art: false });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST }, 4);

  assert.equal(calls.create, 0, 'rule 4: a dropped asset is the commonest cause of a wrong render');
  assert.equal((await loadJob(env, MIND, record.jobId)).status, 'failed');
  assert.equal((await getSpend(env, MIND)).totalSpent, 0);
});

// ───────────────────────────────────────────────────────────────────────────── the poll loop

test('a pending task re-enqueues a poll rather than blocking the invocation', async () => {
  const env = await ready();
  stubFetch({ taskStates: [{ status: 'running' }] });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });

  env.DIRECTOR_JOBS.sent.length = 0;
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'poll' });

  const next = env.DIRECTOR_JOBS.sent.at(-1);
  assert.equal(next.body.step, 'poll');
  assert.ok(next.options.delaySeconds > 0, 'the wait is a delay on the next message, never a sleep');
  assert.equal((await loadJob(env, MIND, record.jobId)).status, 'running');
});

test('a settled take is mirrored to R2 and recorded on the durable production', async () => {
  const env = await ready();
  stubFetch({ taskStates: [{ status: 'succeeded', content: { url: 'https://cdn.minimax.test/x.mp4' }, usage: { total_tokens: 5 } }] });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'poll' });

  const stored = await loadJob(env, MIND, record.jobId);
  assert.equal(stored.status, 'complete');
  assert.equal(stored.take.status, 'ready');

  // Mirrored, not linked — a MiniMax URL is short-lived.
  const key = stored.take.r2Key;
  assert.match(key, new RegExp(`^director/${MIND}/${FILM}/take-`));
  assert.ok(await env.RENDERS.get(key));

  // The job log expires in a day; the film does not.
  const production = await loadProduction(env, MIND, FILM);
  assert.equal(production.takes.length, 1);
  assert.equal(production.takes[0].r2Key, key);
  assert.ok(production.takes[0].script, 'the exact request is kept beside the result');
});

test('a failed render is recorded as spent, because it was', async () => {
  const env = await ready();
  stubFetch({ taskStates: [{ status: 'failed', error: { message: 'internal' } }] });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'poll' });

  const stored = await loadJob(env, MIND, record.jobId);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.take.status, 'failed');
  assert.equal((await getSpend(env, MIND)).totalSpent, 0.48, 'the money left, so the ledger says so');
});

test('passing the deadline stops us waiting, and never claims the clip is gone', async () => {
  const env = await ready();
  stubFetch({ taskStates: [{ status: 'running' }] });
  const { record } = await startTake(env, MIND, { filmId: FILM, script: SCRIPT, params: PARAMS, refKeys: ['ape'], cast: CAST });
  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'submit', cast: CAST });

  const job = await loadJob(env, MIND, record.jobId);
  job.deadlineAt = Date.now() - 1;
  await env.MIND_CONNECTIONS.put(`director-job:${MIND}:${record.jobId}`, JSON.stringify(job));

  await deliver(env, { mindId: MIND, jobId: record.jobId, step: 'poll' });
  const stored = await loadJob(env, MIND, record.jobId);
  assert.equal(stored.take.status, 'unsettled');
  assert.equal(stored.take.taskId, 'task-abc', 'the id has to survive so the clip can still be collected');
  assert.match(stored.take.reason, /already been paid for/);
  assert.match(stored.take.reason, /rather than shooting it again/);
});

test('a job that has vanished is acked, not looped on forever', async () => {
  const env = await ready();
  const { acked, retried } = await deliver(env, { mindId: MIND, jobId: 'nope', step: 'poll' });
  assert.equal(acked.length, 1);
  assert.equal(retried.length, 0);
});
