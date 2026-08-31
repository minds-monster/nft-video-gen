// The job event log, under the conditions that actually broke it.
//
// This file exists because the bug it guards against was INVISIBLE. A visitor watched a pass sit
// at eighteen minutes with a frozen progress panel, and the cause was not the model: the log
// flushed to KV every 250ms as a read-modify-write of one key, which loses events three separate
// ways (KV rate-limits same-key writes to ~1/s and the failed batch had already been spliced off
// the pending list; the read-back can be up to 60s stale, so a fresh batch pushed onto a stale
// array overwrote everything recorded in between). Every one of those failures was swallowed by a
// `catch` that logged "dropped progress narration" and carried on.
//
// So none of this can be checked by eye, and "the panel looked fine when I tried it" is not
// evidence. These are the assertions instead.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobLogger } from '../../worker/storyboarder.js';

/** A KV that can be told to misbehave in the specific ways the real one does. */
class FlakyKV {
  store = new Map();
  writes = [];
  failNext = 0;

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.writes.push({ key, at: Date.now() });
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('KV PUT failed: rate limited on this key');
    }
    this.store.set(key, value);
  }
}

const makeRecord = () => ({ jobId: 'job-1', mindId: 'mind-1', status: 'running', events: [] });
const settle = (ms = 1400) => new Promise((done) => setTimeout(done, ms));

test('a failed KV write delays events rather than losing them', async () => {
  const kv = new FlakyKV();
  const record = makeRecord();
  const logger = createJobLogger({ MIND_CONNECTIONS: kv }, 'mind-1', record);

  // The first write fails outright — exactly what a same-key rate limit looks like.
  kv.failNext = 1;
  logger.log('phase', { phase: 'planning' });
  await logger.flush();
  logger.log('phase', { phase: 'drafting' });
  await logger.flush();
  await logger.close();

  const stored = await kv.get('storyboard-job:mind-1:job-1', 'json');
  assert.deepEqual(
    stored.events.map((e) => e.data.phase),
    ['planning', 'drafting'],
    'the event lost to the failed write must still arrive on a later one',
  );
});

test('the log only ever grows, so a client resuming by index cannot skip or replay', async () => {
  const kv = new FlakyKV();
  const record = makeRecord();
  const logger = createJobLogger({ MIND_CONNECTIONS: kv }, 'mind-1', record);

  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    logger.log('phase', { step: i });
    await logger.flush();
    const stored = await kv.get('storyboard-job:mind-1:job-1', 'json');
    seen.push(stored.events.length);
  }
  await logger.close();

  // `handleStoryboardJobEvents` resumes with `record.events.slice(lastEvent)` — a positional
  // index. Any shrink, or any reorder, silently corrupts a reconnecting client's view.
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `event count went backwards: ${seen[i - 1]} -> ${seen[i]}`);
  }
  const stored = await kv.get('storyboard-job:mind-1:job-1', 'json');
  assert.deepEqual(stored.events.map((e) => e.data.step), [...Array(12).keys()]);
});

test('consecutive reasoning deltas coalesce without changing what the client reconstructs', async () => {
  const kv = new FlakyKV();
  const record = makeRecord();
  const logger = createJobLogger({ MIND_CONNECTIONS: kv }, 'mind-1', record);

  for (const delta of ['the ', 'camera ', 'sits ', 'high']) logger.log('reasoning', { delta, beatIndex: 0 });
  logger.log('phase', { phase: 'validating' });
  await logger.close();

  const stored = await kv.get('storyboard-job:mind-1:job-1', 'json');
  const reasoning = stored.events.filter((e) => e.type === 'reasoning');
  assert.equal(reasoning.length, 1, 'four deltas in one batch should become one event');
  // The client appends every delta onto a rolling string, so concatenating them server-side has
  // to produce exactly the same string it would have built itself.
  assert.equal(reasoning[0].data.delta, 'the camera sits high');
  assert.equal(stored.events.at(-1).type, 'phase', 'coalescing must not reorder anything');
});

test('narration is capped, but never at the expense of a load-bearing event', async () => {
  const kv = new FlakyKV();
  const record = makeRecord();
  const logger = createJobLogger({ MIND_CONNECTIONS: kv }, 'mind-1', record);

  // Far past the cap. Interleaved so a naive "stop logging once full" would drop the frames too.
  for (let i = 0; i < 400; i += 1) {
    logger.log('heartbeat', { i });
    if (i % 100 === 0) logger.log('frame', { beatIndex: i / 100 });
  }
  logger.log('result', { done: true });
  await logger.close();

  const stored = await kv.get('storyboard-job:mind-1:job-1', 'json');
  assert.equal(stored.events.filter((e) => e.type === 'frame').length, 4, 'every frame must survive the cap');
  assert.equal(stored.events.filter((e) => e.type === 'result').length, 1, 'the result must survive the cap');
  assert.ok(stored.events.filter((e) => e.type === 'heartbeat').length <= 300, 'narration must be bounded');
  assert.ok(record.refusedNarration === undefined || record.refusedNarration > 0);
});

test('writes to one key are not attempted faster than KV allows', async () => {
  const kv = new FlakyKV();
  const record = makeRecord();
  const logger = createJobLogger({ MIND_CONNECTIONS: kv }, 'mind-1', record);

  // A burst, as a streaming run produces. The old code scheduled a write every 250ms for each of
  // these; KV would have rejected most of them.
  for (let i = 0; i < 40; i += 1) logger.log('reasoning', { delta: `d${i}`, beatIndex: 0 });
  await settle();
  await logger.close();

  // Not a rate assertion per write — `flush`/`close` deliberately bypass the throttle so a
  // terminal event is never delayed. What must not happen is a burst of forty log calls turning
  // into a burst of forty writes.
  assert.ok(kv.writes.length <= 3, `40 logged deltas produced ${kv.writes.length} KV writes`);
});
