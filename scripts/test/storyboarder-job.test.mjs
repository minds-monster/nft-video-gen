// Job lifecycle for the storyboarder: POST creates a durable job, status returns it, and the
// events endpoint streams its log. This guards the refactor that moved the long model call out of
// the HTTP response stream.

import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../../worker/session.js';
import {
  handleStoryboard,
  handleStoryboardJobStatus,
  handleStoryboardJobEvents,
  createStoryboardJob,
  handleStoryboardQueue,
} from '../../worker/storyboarder.js';

class MockKV {
  store = new Map();

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    if (type === 'json') return JSON.parse(value);
    if (type === 'arrayBuffer') return new TextEncoder().encode(value);
    return value;
  }

  async put(key, value, _options) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
}

class MockQueue {
  messages = [];

  async send(body, _options) {
    this.messages.push({ body, acked: false, retries: 0 });
    return { metadata: { metrics: { backlogCount: this.messages.length, backlogBytes: 0, oldestMessageTimestamp: Date.now() } } };
  }
}

const makeEnv = () => ({
  SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  MIND_CONNECTIONS: new MockKV(),
  STORYBOARD_JOBS: new MockQueue(),
  FREE_STORYBOARD_MODEL: 'nvidia/nemotron-3-ultra-550b-a55b:free',
});

const authRequest = (env, { url, method = 'GET', body } = {}) =>
  signSession(env, { mindId: 'mind-test', exp: Date.now() + 3600000 }).then((token) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['content-type'] = 'application/json';
    return new Request(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  });

const readSseEvents = async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      let type = 'message';
      let raw = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) raw += line.slice(5).trim();
      }
      if (!raw) continue;
      events.push({ type, data: JSON.parse(raw) });
    }
  }
  return events;
};

test('POST /api/storyboard creates a queued job and sends it to the storyboard queue', async () => {
  const env = makeEnv();
  const request = await authRequest(env, {
    url: 'http://localhost/api/storyboard',
    method: 'POST',
    body: {
      spec: { beats: ['Beat 1: the ape looks at the camera.'] },
      cast: [{ key: 'k1', dossier: { subject: 'a weathered ape' }, name: 'Ape' }],
    },
  });

  const response = await handleStoryboard(request, env, { waitUntil: () => {} });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.jobId);
  assert.ok(body.filmId);
  assert.equal(body.plan.tier, 'free');
  assert.equal(env.STORYBOARD_JOBS.messages.length, 1, 'a queue message should be sent');
  assert.equal(env.STORYBOARD_JOBS.messages[0].body.jobId, body.jobId);
  assert.ok(env.STORYBOARD_JOBS.messages[0].body.spec);
  assert.ok(Array.isArray(env.STORYBOARD_JOBS.messages[0].body.cast));
});

test('POST /api/storyboard rejects a Zero Budget spec over the hard caps', async () => {
  const env = makeEnv();
  const request = await authRequest(env, {
    url: 'http://localhost/api/storyboard',
    method: 'POST',
    body: {
      spec: { beats: ['b1', 'b2', 'b3', 'b4'] },
      cast: [{ key: 'k1', dossier: { subject: 'a weathered ape' }, name: 'Ape' }],
    },
  });

  const response = await handleStoryboard(request, env, { waitUntil: () => {} });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'over_cap');
  assert.ok(body.violations.some((v) => v.code === 'too-many-beats'));
  assert.equal(env.STORYBOARD_JOBS.messages.length, 0, 'no queue message should be sent for a capped spec');
});

test('handleStoryboardQueue executes a queued job and reaches a terminal state', async () => {
  const env = makeEnv();
  const plan = { tier: 'free', maxBeats: 3, label: 'Zero Budget', model: env.FREE_STORYBOARD_MODEL };
  const { jobId } = await createStoryboardJob(env, 'mind-test', { plan, filmId: 'film-123' });

  const acked = [];
  const message = {
    body: {
      mindId: 'mind-test',
      spec: { beats: ['Beat 1: the ape looks at the camera.'] },
      cast: [{ key: 'k1', dossier: { subject: 'a weathered ape' }, name: 'Ape' }],
      plan,
      jobId,
      filmId: 'film-123',
    },
    attempts: 1,
    ack() {
      acked.push(jobId);
    },
    retry() {
      throw new Error('retry should not be called');
    },
  };

  await handleStoryboardQueue({ messages: [message] }, env, { waitUntil: () => {} });

  assert.equal(acked.length, 1, 'message should be acked');
  const record = JSON.parse(env.MIND_CONNECTIONS.store.get(`storyboard-job:mind-test:${jobId}`));
  assert.ok(record.status === 'failed' || record.status === 'complete', `expected terminal status, got ${record.status}`);
});

test('job status endpoint returns a queued job', async () => {
  const env = makeEnv();
  const token = await signSession(env, { mindId: 'mind-test', exp: Date.now() + 3600000 });
  const plan = { tier: 'free', maxBeats: 5, label: 'Zero Budget' };
  const { jobId } = await createStoryboardJob(env, 'mind-test', { plan, filmId: 'film-123' });

  const statusRequest = new Request(`http://localhost/api/storyboard/job/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const statusResponse = await handleStoryboardJobStatus(statusRequest, env);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.status, 'queued');
  assert.equal(status.filmId, 'film-123');
  assert.ok(Array.isArray(status.events));
});

test('job events endpoint streams the recorded event log', async () => {
  const env = makeEnv();
  const token = await signSession(env, { mindId: 'mind-test', exp: Date.now() + 3600000 });
  const plan = { tier: 'free', maxBeats: 5, label: 'Zero Budget' };
  const { jobId } = await createStoryboardJob(env, 'mind-test', { plan, filmId: 'film-123' });

  const key = `storyboard-job:mind-test:${jobId}`;
  const record = JSON.parse(env.MIND_CONNECTIONS.store.get(key));
  record.status = 'running';
  record.events = [
    { type: 'phase', data: { phase: 'planning' }, at: Date.now() },
    { type: 'reasoning', data: { delta: 'planning beat 1', beatIndex: 0 }, at: Date.now() },
    { type: 'heartbeat', data: { elapsedSeconds: 15 }, at: Date.now() },
  ];
  env.MIND_CONNECTIONS.store.set(key, JSON.stringify(record));

  const eventsRequest = new Request(`http://localhost/api/storyboard/job/${jobId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const eventsResponse = await handleStoryboardJobEvents(eventsRequest, env, { waitUntil: () => {} });
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');

  // The endpoint will poll until the job is terminal. Mark it complete in the background so the
  // test does not wait for the stagnation timeout.
  setTimeout(() => {
    const updated = JSON.parse(env.MIND_CONNECTIONS.store.get(key));
    updated.status = 'complete';
    updated.events.push({ type: 'result', data: { frames: [] }, at: Date.now() });
    env.MIND_CONNECTIONS.store.set(key, JSON.stringify(updated));
  }, 100);

  const events = await readSseEvents(eventsResponse);
  assert.ok(events.some((e) => e.type === 'phase'));
  assert.ok(events.some((e) => e.type === 'reasoning'));
  assert.ok(events.some((e) => e.type === 'heartbeat'));
  assert.ok(events.some((e) => e.type === 'result'));
});

test('job events endpoint closes after sending a terminal status', async () => {
  const env = makeEnv();
  const token = await signSession(env, { mindId: 'mind-test', exp: Date.now() + 3600000 });
  const plan = { tier: 'free', maxBeats: 5, label: 'Zero Budget' };
  const { jobId } = await createStoryboardJob(env, 'mind-test', { plan, filmId: 'film-123' });

  const key = `storyboard-job:mind-test:${jobId}`;
  const record = JSON.parse(env.MIND_CONNECTIONS.store.get(key));
  record.status = 'complete';
  record.events = [
    { type: 'phase', data: { phase: 'finalising' }, at: Date.now() },
    { type: 'result', data: { frames: [] }, at: Date.now() },
  ];
  env.MIND_CONNECTIONS.store.set(key, JSON.stringify(record));

  const eventsRequest = new Request(`http://localhost/api/storyboard/job/${jobId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const eventsResponse = await handleStoryboardJobEvents(eventsRequest, env, { waitUntil: () => {} });
  const events = await readSseEvents(eventsResponse);
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'result');
});
