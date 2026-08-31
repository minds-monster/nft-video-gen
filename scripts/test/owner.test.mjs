// The owner's login and the aggregates the Support panel shows.
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleOwnerLogin, requireOwner, constantTimeEqual } from '../../worker/owner-auth.js';
import { supportStats, slaBreach, handleOwnerSupportList, handleOwnerSupportGet, handleOwnerSupportNote, buildMindSnapshot } from '../../worker/owner.js';
import { handleSupportSubmit } from '../../worker/support.js';
import { signSession, SESSION_KINDS } from '../../worker/session.js';
import { makeEnv } from './mock-kv.mjs';

const login = (env, passphrase, ip = '9.9.9.9') =>
  handleOwnerLogin(
    new Request('https://minds.monster/api/owner/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ passphrase }),
    }),
    env,
  );

const ownerToken = (env) => signSession(env, { kind: SESSION_KINDS.owner, owner: true, exp: Date.now() + 60_000 });
const authed = (token, path, init = {}) =>
  new Request(`https://minds.monster${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

test('constantTimeEqual compares bytes, not lengths, and never throws on odd input', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual(undefined, ''), true);
});

test('login: unconfigured, wrong, right, and rate-limited', async () => {
  const env = makeEnv();
  assert.equal((await login(env, 'x')).status, 500);
  env.OWNER_PASSPHRASE = 'correct horse battery staple';
  assert.equal((await login(env, 'wrong')).status, 401);
  const ok = await login(env, 'correct horse battery staple');
  assert.equal(ok.status, 200);
  const { token } = await ok.json();
  assert.equal((await requireOwner(authed(token, '/api/owner/support'), env))?.owner, true);
  for (let i = 0; i < 3; i += 1) await login(env, 'wrong');
  assert.equal((await login(env, 'wrong')).status, 429, 'the sixth attempt in a minute is refused');
});

test('slaBreach names which promise is broken', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  const iso = (h) => new Date(now - h * 3_600_000).toISOString();
  assert.equal(slaBreach({ status: 'received', receivedAt: iso(3) }, now), null);
  assert.equal(slaBreach({ status: 'received', receivedAt: iso(5) }, now), 'seen');
  assert.equal(slaBreach({ status: 'seen', receivedAt: iso(9), seenAt: iso(8) }, now), 'replied');
  assert.equal(slaBreach({ status: 'escalated', receivedAt: iso(9), seenAt: iso(8), escalatedAt: iso(5) }, now), 'escalation');
  assert.equal(slaBreach({ status: 'escalated', receivedAt: iso(9), seenAt: iso(8), escalatedAt: iso(1) }, now), null);
  assert.equal(slaBreach({ status: 'resolved', receivedAt: iso(50) }, now), null);
});

test('supportStats: state breakdown, first-action histogram, rates, and a cost BAND', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  const iso = (h) => new Date(now - h * 3_600_000).toISOString();
  const rows = [
    { status: 'resolved', receivedAt: iso(30), seenAt: iso(29.5), repliedAt: iso(28), resolvedAt: iso(27), reopenCount: 0 },
    { status: 'resolved', receivedAt: iso(20), seenAt: iso(17), repliedAt: iso(16), resolvedAt: iso(15), reopenCount: 1 },
    { status: 'escalated', receivedAt: iso(10), seenAt: iso(5), escalatedAt: iso(5) },
    { status: 'received', receivedAt: iso(1) },
    { status: 'seen', receivedAt: iso(48 * 8), seenAt: iso(48 * 8 - 10), humanRequested: true },
  ];
  const stats = supportStats(rows, { now, cognition30d: 50 });
  assert.equal(stats.open, 3);
  assert.deepEqual(stats.byState, { resolved: 2, escalated: 1, received: 1, seen: 1 });
  assert.deepEqual(stats.last30.histogram.map((b) => b.count), [1, 1, 1, 1]);
  assert.equal(stats.last7.tickets, 4);
  assert.equal(stats.last7.escalated, 1);
  assert.equal(stats.last30.reopenRate, 0.5);
  assert.equal(stats.last30.humanRequested, 1);
  assert.equal(stats.costBand.low, 6);
  assert.equal(stats.costBand.high, 14);
  assert.match(stats.costBand.basis, /upper bound/);
  assert.equal(supportStats(rows.slice(0, 4), { now, cognition30d: 50 }).costBand, null, 'no band under five tickets');
  assert.equal(stats.breaches.escalation, 1, 'the escalated ticket has waited on the steward past 4h');
  assert.equal(stats.breaches.replied, 1, 'the old seen-but-unanswered ticket');
  assert.equal(stats.breaches.total, 2);
});

test('the owner list carries states and no message text; the ticket view carries the thread', async () => {
  const env = makeEnv();
  await handleSupportSubmit(
    new Request('https://minds.monster/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'v@example.com', subject: 'Blank storyboard', message: 'The storyboard page is blank in Firefox since this morning.' }),
    }),
    env,
    { waitUntil: () => {} },
  );
  const token = await ownerToken(env);

  const list = await (await handleOwnerSupportList(authed(token, '/api/owner/support?status=open'), env)).json();
  assert.equal(list.tickets.length, 1);
  const [row] = list.tickets;
  assert.equal(row.subject, 'Blank storyboard');
  assert.equal(row.status, 'received');
  assert.equal(row.message, undefined, 'no body text on the list');
  assert.equal(row.email, undefined, 'no email on the list');

  env.__mindsClient.mindSays(`support-${row.ticketId}`, `[seen ${row.ticketId} ${new Date().toISOString()}] On it.`);
  const view = await (await handleOwnerSupportGet(authed(token, `/api/owner/support/${row.ticketId}`), env, row.ticketId)).json();
  assert.equal(view.derived.status, 'seen', 'opening a ticket refreshes it');
  assert.deepEqual(view.thread.map((r) => r.role), ['ticket', 'marker']);
  assert.equal(view.thread[1].marker.kind, 'seen');
  assert.equal(view.ticket.email, 'v@example.com', 'the click-into-full does show the routing email');
  assert.equal(view.ticket.ownerNotifyEmail, undefined);

  const note = await handleOwnerSupportNote(
    authed(token, `/api/owner/support/${row.ticketId}/note`, { method: 'POST', body: JSON.stringify({ note: 'Tell them to clear the cache.' }) }),
    env,
    row.ticketId,
  );
  assert.equal(note.status, 200);
  assert.equal(env.__mindsClient.sent.at(-1).messageText, '[steward-note] Tell them to clear the cache.');
});

test('every owner route refuses a visitor token', async () => {
  const env = makeEnv();
  const visitor = await signSession(env, { kind: 'mind', mindId: 'mind-1', exp: Date.now() + 60_000 });
  assert.equal((await handleOwnerSupportList(authed(visitor, '/api/owner/support'), env)).status, 401);
  assert.equal((await handleOwnerSupportGet(authed(visitor, '/api/owner/support/abc'), env, 'abc')).status, 401);
});

test('the Mind snapshot sums 30-day cognition and survives a failing call', async () => {
  const env = makeEnv();
  env.__mindsClient.listEquippedSkills = async () => {
    throw new Error('503');
  };
  const snapshot = await buildMindSnapshot(env);
  assert.equal(snapshot.name, 'Adam');
  assert.equal(snapshot.cognition30d, 50);
  assert.equal(snapshot.cognitionBalance, 1200);
  assert.deepEqual(snapshot.skills, []);
});
