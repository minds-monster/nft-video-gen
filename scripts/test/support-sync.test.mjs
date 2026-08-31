// The cron: one email per [auto-replied], never two; nothing fetched when nothing changed;
// [resolved] leaves the work list; an unconfigured mailer is remembered and retried once a
// key exists.
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleSupportSubmit, KEYS } from '../../worker/support.js';
import { syncTicket, syncOpenTickets } from '../../worker/support-sync.js';
import { makeEnv } from './mock-kv.mjs';

const ISO = () => new Date().toISOString();

const open = async (env, message = 'My finished film will not download, the button does nothing.') => {
  const res = await handleSupportSubmit(
    new Request('https://minds.monster/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'v@example.com', message }),
    }),
    env,
    { waitUntil: () => {} },
  );
  return (await res.json()).ticketId;
};

const fakeSend = () => {
  const sent = [];
  const send = async (_env, mail) => {
    sent.push(mail);
    return { status: 'sent', providerId: `id-${sent.length}` };
  };
  return { sent, send };
};

test('an [auto-replied] body is emailed to the visitor exactly once across runs', async () => {
  const env = makeEnv();
  const ticketId = await open(env);
  env.RESEND_API_KEY = 'test'; // after open(), so the receipt never reaches a real mailer
  const alias = `support-${ticketId}`;
  const mailer = fakeSend();

  env.__mindsClient.mindSays(alias, `[seen ${ticketId} ${ISO()}]`);
  env.__mindsClient.mindSays(alias, `[auto-replied ${ticketId} ${ISO()}]\nHi,\n\nTry the other button.`);

  let derived = await syncTicket(env, ticketId, { send: mailer.send });
  assert.equal(derived.status, 'replied');
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, 'v@example.com');
  assert.match(mailer.sent[0].subject, new RegExp(`^\\[#${ticketId}\\] RE: `));
  assert.match(mailer.sent[0].text, /^Hi,\n\nTry the other button\.\n\n— Adam, minds\.monster support/);
  assert.doesNotMatch(mailer.sent[0].text, /\[auto-replied/, 'the marker line is stripped');
  assert.match(mailer.sent[0].text, new RegExp(`https://minds.monster/#/support/${ticketId}/`));

  // Same history, second run: the one-row probe says nothing changed, so no full fetch and
  // no second email.
  const calls = env.__mindsClient.fullHistoryCalls;
  derived = await syncTicket(env, ticketId, { send: mailer.send });
  assert.equal(env.__mindsClient.fullHistoryCalls, calls);
  assert.equal(mailer.sent.length, 1);

  // A NEW row after that must be noticed — this is the case the client library's own
  // getLatestHistoryFingerprint gets wrong (it returns the oldest row, forever).
  env.__mindsClient.mindSays(alias, `[resolved ${ticketId} ${ISO()}]`);
  derived = await syncTicket(env, ticketId, { send: mailer.send });
  assert.equal(derived.status, 'resolved');

  // Forced re-derive still does not resend — the emailed marker is what guards it.
  await syncTicket(env, ticketId, { send: mailer.send, force: true });
  assert.equal(mailer.sent.length, 1);
  // Row 1 is the ticket itself, row 2 the [seen], row 3 the reply.
  assert.equal(await env.MIND_CONNECTIONS.get(KEYS.emailed(ticketId, `mind-${alias}-3`)), 'sent');
});

test('the index metadata follows the derived state', async () => {
  const env = makeEnv();
  const ticketId = await open(env);
  env.__mindsClient.mindSays(`support-${ticketId}`, `[escalated ${ticketId} ${ISO()}]\nneeds a refund call`);
  await syncTicket(env, ticketId);
  const [key] = (await env.MIND_CONNECTIONS.list({ prefix: KEYS.INDEX_PREFIX })).keys;
  assert.equal(key.metadata.status, 'escalated');
  assert.ok(key.metadata.escalatedAt);
  assert.ok(key.metadata.seenAt, 'an escalation is a first action');
});

test('[resolved] takes the ticket off the work list; a visitor follow-up puts it back', async () => {
  const env = makeEnv();
  const ticketId = await open(env);
  const alias = `support-${ticketId}`;
  env.__mindsClient.mindSays(alias, `[resolved ${ticketId} ${ISO()}]`);
  await syncTicket(env, ticketId);
  assert.equal(await env.MIND_CONNECTIONS.get(KEYS.open(ticketId)), null);

  await env.__mindsClient.sendMessage({ alias, messageText: `Subject: RE: x\n\nFollow-Up: ${ticketId}\n\nNot fixed.` });
  await env.MIND_CONNECTIONS.put(KEYS.open(ticketId), '1'); // what appendFollowUp does
  const derived = await syncTicket(env, ticketId);
  assert.equal(derived.status, 'reopened');
  assert.equal(await env.MIND_CONNECTIONS.get(KEYS.open(ticketId)), '1');
});

test('with no mailer the reply is logged as unconfigured, then sent once a key exists', async () => {
  const env = makeEnv();
  const ticketId = await open(env);
  env.__mindsClient.mindSays(`support-${ticketId}`, `[auto-replied ${ticketId} ${ISO()}]\nDone.`);
  await syncTicket(env, ticketId);
  const marker = env.MIND_CONNECTIONS.keysWithPrefix(`support:emailed:${ticketId}:`);
  assert.equal(marker.length, 1);
  assert.equal(await env.MIND_CONNECTIONS.get(marker[0]), 'unconfigured');

  // Nothing happens again while still unconfigured, even when forced.
  const before = env.MIND_CONNECTIONS.keysWithPrefix(KEYS.emailLogPrefix(ticketId)).length;
  await syncTicket(env, ticketId, { force: true });
  assert.equal(env.MIND_CONNECTIONS.keysWithPrefix(KEYS.emailLogPrefix(ticketId)).length, before);

  env.RESEND_API_KEY = 'now-set';
  const mailer = fakeSend();
  await syncTicket(env, ticketId, { force: true, send: mailer.send });
  assert.equal(mailer.sent.length, 1);
  assert.equal(await env.MIND_CONNECTIONS.get(marker[0]), 'sent');
});

test('a failed send leaves no marker so the next run retries, and the failure is logged', async () => {
  const env = makeEnv();
  const ticketId = await open(env);
  env.RESEND_API_KEY = 'test';
  env.__mindsClient.mindSays(`support-${ticketId}`, `[auto-replied ${ticketId} ${ISO()}]\nDone.`);
  const failing = async () => {
    throw new Error('resend_500: boom');
  };
  await syncTicket(env, ticketId, { send: failing });
  assert.equal(env.MIND_CONNECTIONS.keysWithPrefix(`support:emailed:${ticketId}:`).length, 0);
  const logs = await Promise.all(env.MIND_CONNECTIONS.keysWithPrefix(KEYS.emailLogPrefix(ticketId)).map((k) => env.MIND_CONNECTIONS.get(k, 'json')));
  assert.ok(logs.some((l) => l.status === 'failed' && /boom/.test(l.error)));
  const mailer = fakeSend();
  await syncTicket(env, ticketId, { send: mailer.send, force: true });
  assert.equal(mailer.sent.length, 1);
});

test('syncOpenTickets walks the work list, stops at its time budget, and survives one bad ticket', async () => {
  const env = makeEnv();
  const a = await open(env);
  const b = await open(env, 'A second, different problem that is also long enough.');
  env.__mindsClient.mindSays(`support-${a}`, `[seen ${a} ${ISO()}]`);
  // Orphan: an open marker with no ticket record behind it.
  await env.MIND_CONNECTIONS.put(KEYS.open('orphan01'), '1');

  const summary = await syncOpenTickets(env);
  assert.equal(summary.scanned, 3);
  assert.equal(summary.errors.length, 0);
  assert.equal(await env.MIND_CONNECTIONS.get(KEYS.open('orphan01')), null, 'the orphan is cleaned up');
  assert.equal((await env.MIND_CONNECTIONS.get(KEYS.derived(a), 'json')).status, 'seen');
  assert.equal((await env.MIND_CONNECTIONS.get(KEYS.derived(b), 'json')).status, 'received');

  let t = 0;
  const early = await syncOpenTickets(env, { budgetMs: 10, now: () => (t += 20) });
  assert.equal(early.stoppedEarly, true);
});
