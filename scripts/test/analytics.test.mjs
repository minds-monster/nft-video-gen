// The analytics foundation: a closed allowlist, a no-op without the binding, a hashed
// visitor index that is stable across days, counts kept apart from amounts, rollups that
// heal themselves, and an overview that reads them.
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  record,
  guestHashFor,
  handleAnalyticsEvent,
  summarize,
  rollupDay,
  healRollups,
  overview,
  rollupKey,
  countsForWindow,
  ROLLUP_VERSION,
} from '../../worker/analytics.js';
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

test('a zero amount is recorded as zero, not promoted to one', () => {
  const dataset = fakeDataset();
  const env = makeEnv({ ANALYTICS: dataset });
  record(env, 'film_shot', { value: 0 });
  record(env, 'page_view');
  assert.deepEqual(dataset.points.map((point) => point.doubles[0]), [0, 1]);
});

test('the guest hash is the same visitor on every day, and never the raw id', async () => {
  const env = makeEnv();
  const a = await guestHashFor(env, 'guest-1');
  assert.equal(a, await guestHashFor(env, 'guest-1'));
  assert.notEqual(a, await guestHashFor(env, 'guest-2'));
  assert.notEqual(a, 'guest-1');
  assert.equal(await guestHashFor(env, ''), '');
});

test('the event endpoint accepts only the client allowlist', async () => {
  const dataset = fakeDataset();
  const env = makeEnv({ ANALYTICS: dataset });
  const post = (body) =>
    handleAnalyticsEvent(new Request('https://minds.monster/api/analytics/event', { method: 'POST', body: JSON.stringify(body) }), env);
  assert.equal((await post({ name: 'film_shot' })).status, 400, 'a server-only event cannot be sent from a browser');
  assert.equal((await post({ name: 'storyboard_started' })).status, 400, 'recorded by the Worker where the job is queued');
  assert.equal((await post({ name: 'page_view', page: '/', guestId: 'g1' })).status, 204);
  assert.equal(dataset.points.length, 1);
  assert.equal(dataset.points[0].blobs[0], 'page_view');
  assert.notEqual(dataset.points[0].indexes[0], 'g1', 'the raw guestId never reaches the store');
});

test('summarize folds days, keeps amounts apart from counts, and fills every known event with a zero', () => {
  const totals = summarize([
    { counts: { page_view: 10, connect_init: 1, budget_topup: 2 }, amounts: { budget_topup: 15.5 }, uniques: 4 },
    { counts: { page_view: 5, budget_topup: 1 }, amounts: { budget_topup: 0.25 }, uniques: 2 },
  ]);
  assert.equal(totals.page_view, 15);
  assert.equal(totals.connect_init, 1);
  assert.equal(totals.budget_topup, 3, 'three top-ups, whatever they were worth');
  assert.equal(totals.amounts.budget_topup, 15.75);
  assert.equal(totals.amounts.film_shot, 0);
  assert.equal(totals.film_shot, 0);
  assert.equal(totals.uniques, 6);
});

// A stand-in for the AE SQL API: event rows for the GROUP BY name query, visitor rows for
// the uniques query. Records every statement it was sent.
const fakeSql = ({ rows = [], visitors = ['h1', 'h2', 'h3'], fail = null } = {}) => {
  const queries = [];
  const fetchImpl = async (url, init) => {
    queries.push(init.body);
    assert.match(url, /accounts\/acct\/analytics_engine\/sql$/);
    assert.equal(init.headers.authorization, 'Bearer tok');
    if (fail && fail(init.body)) return { ok: false, status: 500, text: async () => 'boom' };
    const data = /GROUP BY name/.test(init.body) ? rows : visitors.map((visitor) => ({ visitor }));
    return { ok: true, text: async () => JSON.stringify({ data }) };
  };
  return { queries, fetchImpl };
};
const readableEnv = () => makeEnv({ CF_ACCOUNT_ID: 'acct', CF_ANALYTICS_TOKEN: 'tok' });

test('countsForWindow counts events and sums amounts as separate columns', async () => {
  const env = readableEnv();
  const { queries, fetchImpl } = fakeSql({
    rows: [
      { name: 'page_view', events: 12.0, amount: 12.0 },
      { name: 'budget_topup', events: 2, amount: 25 },
      { name: 'film_shot', events: 1, amount: 0 },
    ],
  });
  const result = await countsForWindow(env, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z', { fetchImpl });
  assert.deepEqual(result, {
    counts: { page_view: 12, budget_topup: 2, film_shot: 1 },
    amounts: { budget_topup: 25, film_shot: 0 },
    uniques: 3,
  });
  assert.match(queries[0], /SUM\(_sample_interval\) AS events/, 'the count never reads double1');
  assert.match(queries[0], /timestamp >= toDateTime\('2026-08-26 00:00:00'\)/);
});

test('rollupDay stores one versioned key per day', async () => {
  const env = readableEnv();
  const { fetchImpl } = fakeSql({ rows: [{ name: 'page_view', events: 12, amount: 12 }] });
  const rollup = await rollupDay(env, '2026-08-26', { fetchImpl });
  assert.equal(rollup.uniques, 3);
  const stored = await env.MIND_CONNECTIONS.get(rollupKey('2026-08-26'), 'json');
  assert.equal(stored.counts.page_view, 12);
  assert.equal(stored.version, ROLLUP_VERSION);
});

test('healRollups rewrites missing and old-version days, newest first, and skips current ones', async () => {
  const env = readableEnv();
  const now = new Date('2026-09-19T12:00:00Z');
  // 09-18: missing. 09-17: an old rollup, dollars counted as events. 09-16: already current.
  await env.MIND_CONNECTIONS.put(rollupKey('2026-09-17'), JSON.stringify({ day: '2026-09-17', counts: { budget_topup: 25 }, uniques: 1 }));
  await env.MIND_CONNECTIONS.put(rollupKey('2026-09-16'), JSON.stringify({ day: '2026-09-16', version: ROLLUP_VERSION, counts: {}, uniques: 0 }));
  const { fetchImpl } = fakeSql({ rows: [{ name: 'budget_topup', events: 2, amount: 25 }] });

  const result = await healRollups(env, { now, window: 3, deps: { fetchImpl } });
  assert.deepEqual(result, { healed: ['2026-09-18', '2026-09-17'], failed: [], remaining: 0 });
  const rewritten = await env.MIND_CONNECTIONS.get(rollupKey('2026-09-17'), 'json');
  assert.equal(rewritten.counts.budget_topup, 2);
  assert.equal(rewritten.amounts.budget_topup, 25);
});

test('healRollups stops at its batch size and reports what is left and what failed', async () => {
  const env = readableEnv();
  const now = new Date('2026-09-19T12:00:00Z');
  const { fetchImpl } = fakeSql({ fail: (sql) => sql.includes("timestamp >= toDateTime('2026-09-17 00:00:00')") });
  const result = await healRollups(env, { now, window: 5, max: 3, deps: { fetchImpl } });
  assert.deepEqual(result.healed, ['2026-09-18', '2026-09-16']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].day, '2026-09-17');
  assert.equal(result.remaining, 2);
});

test('overview reads rollups, zero-fills missing days, and seeds lifetime totals from existing keys', async () => {
  const env = makeEnv();
  const now = new Date('2026-08-27T12:00:00Z');
  await env.MIND_CONNECTIONS.put(rollupKey('2026-08-26'), JSON.stringify({ day: '2026-08-26', counts: { page_view: 7, film_shot: 1 }, uniques: 3 }));
  await env.MIND_CONNECTIONS.put(rollupKey('2026-08-25'), JSON.stringify({ day: '2026-08-25', counts: { page_view: 3 }, uniques: 1 }));
  await env.MIND_CONNECTIONS.put('connects:mind-a', '{}');
  await env.MIND_CONNECTIONS.put('connects:mind-b', '{}');
  await env.MIND_CONNECTIONS.put('budget:mind-a', '{}');
  await env.MIND_CONNECTIONS.put('budget:guest-1', '{}');
  // Two films for one Mind: two envelopes, one index. Films are the envelopes.
  await env.MIND_CONNECTIONS.put('production:mind-a:film-1', '{}');
  await env.MIND_CONNECTIONS.put('production:mind-a:film-2', '{}');
  await env.MIND_CONNECTIONS.put('productions:mind-a', '[]');
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
  assert.equal(result.days.filter((d) => d.stale).length, 2, 'both stored rollups predate the version');
  assert.equal(result.uniquesDistinct, false);
  assert.deepEqual(result.lifetime, { connectedMinds: 2, budgets: 1, guestBudgets: 1, films: 2, subscribers: 1, tickets: 0 });
});

test('overview replaces summed daily uniques with a distinct count when AE is readable', async () => {
  const env = readableEnv();
  const now = new Date('2026-08-27T12:00:00Z');
  await env.MIND_CONNECTIONS.put(
    rollupKey('2026-08-26'),
    JSON.stringify({ day: '2026-08-26', version: ROLLUP_VERSION, counts: { page_view: 7 }, amounts: {}, uniques: 3 }),
  );
  const { queries, fetchImpl } = fakeSql({ rows: [{ name: 'page_view', events: 2, amount: 2 }], visitors: ['h1', 'h2'] });
  const result = await overview(env, { now, deps: { fetchImpl } });
  assert.equal(result.liveError, null);
  assert.equal(result.uniquesDistinct, true);
  assert.equal(result.last7.uniques, 2, 'the same two visitors on both days are two visitors, not five');
  assert.equal(result.last7.page_view, 9);
  assert.ok(queries.some((sql) => sql.includes("toDateTime('2026-08-21 00:00:00')")), 'the 7-day window starts six days back');
});
