// POST /api/support and the visitor's signed reply path, driven with real Request objects
// against a fake minds client and a KV double with list().
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleSupportSubmit, handleSupportTicket, handleSupportReply, KEYS, visitorKeyFor, SLA } from '../../worker/support.js';
import { signSession } from '../../worker/session.js';
import { makeEnv } from './mock-kv.mjs';

const submit = (env, body, { token, ip = '1.2.3.4' } = {}) =>
  handleSupportSubmit(
    new Request('https://minds.monster/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: () => {} },
  );

const GOOD = { email: 'visitor@example.com', message: 'The download button on my finished film does nothing at all.', page: '/#dailies' };

test('an invalid email is refused before anything is written', async () => {
  const env = makeEnv();
  const res = await submit(env, { ...GOOD, email: 'nope' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_email');
  assert.equal(env.__mindsClient.sent.length, 0);
});

test('a message shorter than the floor is refused', async () => {
  const res = await submit(makeEnv(), { ...GOOD, message: 'help' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'message_too_short');
});

test('the honeypot answers 200 and writes nothing', async () => {
  const env = makeEnv();
  const res = await submit(env, { ...GOOD, hp: 'http://spam' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ticketId, null);
  assert.equal(env.MIND_CONNECTIONS.store.size, 0);
  assert.equal(env.__mindsClient.sent.length, 0);
});

test('a good ticket opens its alias, briefs the Mind once, and writes every key', async () => {
  const env = makeEnv();
  const res = await submit(env, GOOD);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.ticketId, /^[0-9a-f]{8}$/);
  assert.deepEqual(data.sla, SLA);
  assert.equal(data.mailer, 'unconfigured');
  assert.match(data.ticketUrl, new RegExp(`^https://minds.monster/#/support/${data.ticketId}/`));

  const client = env.__mindsClient;
  // The briefing goes first, once, into its own alias; then the ticket.
  assert.equal(client.sent[0].alias, 'support-briefing');
  assert.match(client.sent[0].messageText, /^\[briefing\]/);
  assert.equal(client.sent[1].alias, `support-${data.ticketId}`);
  const wire = client.sent[1].messageText;
  assert.match(wire, /^Subject: .+\nSubject-Source: auto\n\nTicket: /);
  assert.match(wire, new RegExp(`Ticket: ${data.ticketId}`));
  assert.match(wire, /Returning: no  Prior-Tickets: 0  Prior-Open: 0/);
  assert.match(wire, /Plan: guest  Budget-Set: no  Recent-Films: 0  Urgent: no/);
  assert.match(wire, /Human-Requested: no  Page: \/#dailies/);
  assert.match(wire, /From: visitor@example.com\n\nThe download button/);

  const kv = env.MIND_CONNECTIONS;
  const ticket = await kv.get(KEYS.ticket(data.ticketId), 'json');
  assert.equal(ticket.email, GOOD.email);
  assert.equal(ticket.looksLikeProduction, true, 'the word "film" flags it for the owner');
  assert.equal(await kv.get(KEYS.open(data.ticketId)), '1');
  assert.equal(kv.keysWithPrefix(KEYS.INDEX_PREFIX).length, 1);
  const [indexKey] = await kv.list({ prefix: KEYS.INDEX_PREFIX }).then((page) => page.keys);
  assert.equal(indexKey.metadata.status, 'received');
  assert.equal(indexKey.metadata.subject, ticket.subject);
  const visitorKey = await visitorKeyFor(env, GOOD.email);
  assert.equal(kv.keysWithPrefix(KEYS.visitorPrefix(visitorKey)).length, 1);
  // The receipt was logged even though no mailer is configured — honest, not silent.
  const emails = kv.keysWithPrefix(KEYS.emailLogPrefix(data.ticketId));
  assert.equal(emails.length, 1);
  assert.equal((await kv.get(emails[0], 'json')).status, 'unconfigured');
});

test('a second ticket from the same email is a returning visitor with one prior open ticket', async () => {
  const env = makeEnv();
  await submit(env, GOOD);
  await submit(env, { ...GOOD, message: 'Another thing: the storyboard page is blank for me today.' });
  const wire = env.__mindsClient.sent.at(-1).messageText;
  assert.match(wire, /Returning: yes  Prior-Tickets: 1  Prior-Open: 1/);
  // The briefing was not re-sent.
  assert.equal(env.__mindsClient.sent.filter((m) => m.alias === 'support-briefing').length, 1);
});

test('the index lists newest first', async () => {
  const env = makeEnv();
  const first = await (await submit(env, GOOD)).json();
  await new Promise((r) => setTimeout(r, 2));
  const second = await (await submit(env, { ...GOOD, message: 'Second ticket, a bit later, about something else entirely.' })).json();
  const page = await env.MIND_CONNECTIONS.list({ prefix: KEYS.INDEX_PREFIX });
  assert.deepEqual(
    page.keys.map((k) => k.name.split(':').pop()),
    [second.ticketId, first.ticketId],
  );
});

test('a connected visitor is identified from the bearer token, never from the body', async () => {
  const env = makeEnv();
  const token = await signSession(env, { kind: 'mind', mindId: 'mind-visitor', exp: Date.now() + 60_000 });
  await submit(env, { ...GOOD, mindId: 'mind-forged' }, { token });
  const ticket = await env.MIND_CONNECTIONS.get(KEYS.ticket((await env.MIND_CONNECTIONS.list({ prefix: KEYS.OPEN_PREFIX })).keys[0].name.slice(KEYS.OPEN_PREFIX.length)), 'json');
  assert.equal(ticket.mindId, 'mind-visitor');
  assert.match(env.__mindsClient.sent.at(-1).messageText, /Plan: free  Budget-Set: no/);
});

test('the sixth ticket in an hour from one visitor merges into their open ticket', async () => {
  const env = makeEnv();
  let first;
  for (let i = 0; i < 5; i += 1) {
    const res = await submit(env, { ...GOOD, message: `Ticket number ${i + 1}, each one long enough to pass the floor.` }, { ip: `10.0.0.${i}` });
    assert.equal(res.status, 200, `ticket ${i + 1}`);
    first ??= (await res.json()).ticketId;
  }
  const res = await submit(env, { ...GOOD, message: 'Sixth one — did anyone get my earlier messages at all?' }, { ip: '10.0.0.9' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.merged, true);
  const last = env.__mindsClient.sent.at(-1);
  assert.match(last.messageText, /^Subject: RE: /);
  assert.match(last.messageText, new RegExp(`Follow-Up: ${data.ticketId}`));
  assert.equal(env.MIND_CONNECTIONS.keysWithPrefix(KEYS.INDEX_PREFIX).length, 5, 'no sixth thread');
});

test('"speak to a human" is tagged on the wire and emailed to the owner', async () => {
  const env = makeEnv({ OWNER_NOTIFY_EMAIL: 'owner@example.com' });
  const res = await submit(env, { ...GOOD, humanRequested: true });
  const data = await res.json();
  assert.equal(data.humanRequested, true);
  assert.match(env.__mindsClient.sent.at(-1).messageText, /Human-Requested: yes/);
  const logs = await Promise.all(
    env.MIND_CONNECTIONS.keysWithPrefix(KEYS.emailLogPrefix(data.ticketId)).map((k) => env.MIND_CONNECTIONS.get(k, 'json')),
  );
  assert.deepEqual(logs.map((l) => l.kind).sort(), ['owner-notify', 'receipt']);
  assert.equal(logs.find((l) => l.kind === 'owner-notify').to, 'owner@example.com');
});

test('the signed link shows the visitor their ticket, and a reply appends a follow-up', async () => {
  const env = makeEnv();
  const { ticketId, ticketUrl } = await (await submit(env, GOOD)).json();
  const token = ticketUrl.split('/').pop();

  const view = await handleSupportTicket(new Request(`https://minds.monster/api/support/ticket?ticketId=${ticketId}&token=${token}`), env);
  assert.equal(view.status, 200);
  const shown = await view.json();
  assert.equal(shown.status, 'received');
  assert.equal(new Date(shown.expectSeenBy) - new Date(shown.receivedAt), SLA.seenWithinH * 3_600_000);

  const reply = await handleSupportReply(
    new Request('https://minds.monster/api/support/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticketId, token, message: 'Still nothing, tried Safari too.' }),
    }),
    env,
    { waitUntil: () => {} },
  );
  assert.equal(reply.status, 200);
  assert.match(env.__mindsClient.sent.at(-1).messageText, new RegExp(`Follow-Up: ${ticketId}\\n\\nStill nothing`));
});

test('a reply token for one ticket cannot open another', async () => {
  const env = makeEnv();
  const a = await (await submit(env, GOOD)).json();
  const b = await (await submit(env, { ...GOOD, email: 'other@example.com' })).json();
  const tokenA = a.ticketUrl.split('/').pop();
  const res = await handleSupportTicket(new Request(`https://minds.monster/api/support/ticket?ticketId=${b.ticketId}&token=${tokenA}`), env);
  assert.equal(res.status, 404);
});
