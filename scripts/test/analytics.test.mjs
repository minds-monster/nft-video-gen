// The analytics foundation: a closed allowlist, a no-op without the binding, a hashed
// index that is unlinkable across days, and an overview that reads rollups.
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { record, guestHashFor, handleAnalyticsEvent, summarize, rollupDay, overview, rollupKey, countsForWindow } from '../../worker/analytics.js';
import { makeEnv } from './mock-kv.mjs';

const fakeDataset = () => {
  const points = [];
  return { points, writeDataPoint: (point) => points.push(point) };
};

test('record refuses an unknown event and is a no-op without the binding', () => {
  const env = makeEnv();
  assert.equal(record(env, 'page_view'), false);
  assert.equal(record({ ...env, ANALYTICS: fakeDataset() }, 'not_a_thing'), false);
});

test('record writes one data point with the name, page, mind prefix and hashed visitor', () => {
  const dataset = fakeDataset();
  const env = makeEnv({ ANALYTICS: dataset });
  assert.equal(record(env, 'film_shot', { page: '/#dailies', guestHash: 'abc', mindId: '240b453e-f36b', value: 1.95 }), true);
  assert.deepEqual(dataset.points[0], { blobs: ['film_shot', '/#dailies', '240b453e'], doubles: [1.95], indexes: ['abc'] });
});

test('the guest hash is stable within a day and different across days', async () => {
  const env = makeEnv();
  const a = await guestHashFor(env, 'guest-1', '2026-08-27');
  const b = await guestHashFor(env, 'guest-1', '2026-08-27');
  const c = await guestHashFor(env, 'guest-1', '2026-08-28');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(await guestHashFor(env, '', '2026-08-27'), '');
});

test('the event endpoint accepts only the client allowlist', async () => {
  const dataset = fakeDataset();
  const env = makeEnv({ ANALYTICS: dataset });
  const post = (body) =>
    handleAnalyticsEvent(new Request('https://minds.monster/api/analytics/event', { method: 'POST', body: JSON.stringify(body) }), env);
  assert.equal((await post({ name: 'film_shot' })).status, 400, 'a server-only event cannot be sent from a browser');
  assert.equal((await post({ name: 'page_view', page: '/', guestId: 'g1' })).status, 204);
  assert.equal(dataset.points.length, 1);
  assert.equal(dataset.points[0].blobs[0], 'page_view');
  assert.notEqual(dataset.points[0].indexes[0], 'g1', 'the raw guestId never reaches the store');
});

test('summarize folds days and fills every known event with a zero', () => {
  const totals = summarize([
    { counts: { page_view: 10, connect_init: 1 }, uniques: 4 },
    { counts: { page_view: 5 }, uniques: 2 },
  ]);
  assert.equal(totals.page_view, 15);
  assert.equal(totals.connect_init, 1);
  assert.equal(totals.film_shot, 0);
  assert.equal(totals.uniques, 6);
});

test('countsForWindow and rollupDay speak the SQL API and store one key per day', async () => {
  const env = makeEnv({ CF_ACCOUNT_ID: 'acct', CF_ANALYTICS_TOKEN: 'tok' });
  const queries = [];
  const fetchImpl = async (url, init) => {
    queries.push(init.body);
    assert.match(url, /accounts\/acct\/analytics_engine\/sql$/);
    assert.equal(init.headers.authorization, 'Bearer tok');
    const rows = /GROUP BY name/.test(init.body)
      ? [{ name: 'page_view', total: 12.0 }, { name: 'connect_init', total: 2 }]
      : [{ visitor: 'h1' }, { visitor: 'h2' }, { visitor: 'h3' }];
    return { ok: true, text: async () => JSON.stringify({ data: rows }) };
  };
  const counts = await countsForWindow(env, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z', { fetchImpl });
  assert.deepEqual(counts, { counts: { page_view: 12, connect_init: 2 }, uniques: 3 });
  assert.match(queries[0], /timestamp >= toDateTime\('2026-08-26 00:00:00'\)/);

  const rollup = await rollupDay(env, '2026-08-26', { fetchImpl });
  assert.equal(rollup.uniques, 3);
  assert.equal((await env.MIND_CONNECTIONS.get(rollupKey('2026-08-26'), 'json')).counts.page_view, 12);
});

test('overview reads rollups, zero-fills missing days, and seeds lifetime totals from existing keys', async () => {
  const env = makeEnv();
  const now = new Date('2026-08-27T12:00:00Z');
  await env.MIND_CONNECTIONS.put(rollupKey('2026-08-26'), JSON.stringify({ day: '2026-08-26', counts: { page_view: 7, film_shot: 1 }, uniques: 3 }));
  await env.MIND_CONNECTIONS.put(rollupKey('2026-08-25'), JSON.stringify({ day: '2026-08-25', counts: { page_view: 3 }, uniques: 1 }));
  await env.MIND_CONNECTIONS.put('connects:mind-a', '{}');
  await env.MIND_CONNECTIONS.put('connects:mind-b', '{}');
  await env.MIND_CONNECTIONS.put('subscriber:x@y.z', 'now');

  const result = await overview(env, { now });
  assert.equal(result.readable, false);
  assert.equal(result.liveError, 'analytics_not_readable');
  assert.equal(result.days.length, 31);
  assert.equal(result.last7.page_view, 10);
  assert.equal(result.last7.uniques, 4);
  assert.equal(result.last30.film_shot, 1);
  assert.equal(result.today.page_view, 0);
  assert.equal(result.days.filter((d) => d.missing).length, 29);
  assert.deepEqual(result.lifetime, { connectedMinds: 2, budgets: 0, films: 0, subscribers: 1, tickets: 0 });
});
