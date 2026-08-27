// Every token this Worker mints is signed with the same secret. THE FAILURE THIS FILE GUARDS
// is a signature being taken for an authorisation: all 28 visitor handlers do `if (!session)
// return 401` and then use `session.mindId`, so an owner token accepted by requireSession
// would reach `setBudget(env, undefined)`. Kinds are what keep the three token shapes apart.
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import { signSession, requireSession, requireKind, SESSION_KINDS } from '../../worker/session.js';
import { requireOwner } from '../../worker/owner-auth.js';

const env = { SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long' };
const soon = () => Date.now() + 60_000;
const withToken = (token) => new Request('https://minds.monster/api/x', { headers: { authorization: `Bearer ${token}` } });

test('a legacy visitor token with no kind claim is still a visitor session', async () => {
  const token = await signSession(env, { mindId: 'mind-1', exp: soon() });
  const session = await requireSession(withToken(token), env);
  assert.equal(session?.mindId, 'mind-1');
});

test('an explicit mind token is a visitor session', async () => {
  const token = await signSession(env, { kind: 'mind', mindId: 'mind-1', exp: soon() });
  assert.equal((await requireSession(withToken(token), env))?.mindId, 'mind-1');
});

test('an owner token is REFUSED by requireSession — it has no mindId to write budgets under', async () => {
  const token = await signSession(env, { kind: SESSION_KINDS.owner, owner: true, exp: soon() });
  assert.equal(await requireSession(withToken(token), env), null);
});

test('a mind-kind token with no mindId is refused too', async () => {
  const token = await signSession(env, { kind: 'mind', exp: soon() });
  assert.equal(await requireSession(withToken(token), env), null);
});

test('a support-reply token is refused by both the visitor gate and the owner gate', async () => {
  const token = await signSession(env, { kind: SESSION_KINDS.supportReply, ticket: 'abc', visitorKey: 'v', exp: soon() });
  assert.equal(await requireSession(withToken(token), env), null);
  assert.equal(await requireOwner(withToken(token), env), null);
  assert.equal((await requireKind(withToken(token), env, SESSION_KINDS.supportReply))?.ticket, 'abc');
});

test('a visitor token is refused by the owner gate', async () => {
  const token = await signSession(env, { kind: 'mind', mindId: 'mind-1', exp: soon() });
  assert.equal(await requireOwner(withToken(token), env), null);
});

test('the owner gate accepts an owner token', async () => {
  const token = await signSession(env, { kind: SESSION_KINDS.owner, owner: true, exp: soon() });
  assert.equal((await requireOwner(withToken(token), env))?.owner, true);
});

test('a forged payload claiming owner without a valid signature is refused everywhere', async () => {
  const real = await signSession(env, { kind: 'mind', mindId: 'mind-1', exp: soon() });
  const [, signature] = real.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ kind: 'owner', owner: true, exp: soon() })).toString('base64url');
  const forged = `${forgedBody}.${signature}`;
  assert.equal(await requireOwner(withToken(forged), env), null);
  assert.equal(await requireSession(withToken(forged), env), null);
});

test('an expired token of any kind is refused', async () => {
  const token = await signSession(env, { kind: SESSION_KINDS.owner, owner: true, exp: Date.now() - 1 });
  assert.equal(await requireOwner(withToken(token), env), null);
});
