// The Connect Mind handshake: a visitor supplies a mindId, the site messages that
// Mind asking it to approve, and polling for the reply mints a session once approved.
// See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.

import { mindsClient, connectionAlias, parseApprovalDecision } from './minds.js';
import { signSession } from './session.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const INIT_TTL_SECONDS = 5 * 60;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT = { count: 5, windowMs: 60_000 };

// Frozen wire contract (also handed to Adam's Skill verbatim) — never change this
// without re-syncing every Mind-side Skill built against it.
const connectMessage = (id) =>
  `minds.monster wants to connect your Mind as a Producer. Reply APPROVE ${id} or DENY ${id}. Connection ID: ${id}`;

const rateLimit = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const stamps = (rateLimit.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (stamps.length >= RATE_LIMIT.count) {
    rateLimit.set(ip, stamps);
    return true;
  }
  stamps.push(now);
  rateLimit.set(ip, stamps);
  return false;
}

function isValidMindId(mindId) {
  return typeof mindId === 'string' && mindId.length > 0 && mindId.length <= 128 && !/[\r\n]/.test(mindId);
}

export async function handleConnectInit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (isRateLimited(ip)) return json({ error: 'rate_limited' }, 429);

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const body = await request.json().catch(() => ({}));
  if (!isValidMindId(body.mindId)) return json({ error: 'invalid_mind_id' }, 400);
  const mindId = body.mindId;

  const connectionId = crypto.randomUUID();
  const alias = connectionAlias(connectionId);
  const message = connectMessage(connectionId);

  // Best-effort — a display name is a nicety, never a reason to fail the connect attempt.
  const mindName = await client.getMind(mindId).then((m) => m.name ?? null).catch(() => null);

  // Exactly one message per connection attempt — never retried automatically. A visitor
  // who wants to try again gets a fresh connectionId, not a resend into the same alias.
  await client.ensureConversation(alias, mindId);
  const before = await client.getLatestHistoryFingerprint(alias);
  await client.sendMessage({ alias, messageText: message });

  await env.MIND_CONNECTIONS.put(
    connectionId,
    JSON.stringify({ mindId, mindName, alias, lastFingerprint: before ?? null, status: 'pending' }),
    { expirationTtl: INIT_TTL_SECONDS },
  );

  return json({ connectionId, expiresInMs: INIT_TTL_SECONDS * 1000, message, mindName });
}

export async function handleConnectStatus(request, env) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId');
  if (!connectionId) return json({ error: 'connectionId required' }, 400);

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const raw = await env.MIND_CONNECTIONS.get(connectionId);
  if (!raw) return json({ status: 'expired' });
  const record = JSON.parse(raw);

  if (record.status !== 'pending') {
    return json({ status: record.status });
  }

  // A server-side read of the conversation's history — this never reaches the Mind as
  // a new message, so it doesn't count against its own per-connection cognition budget.
  const history = await client.getHistory(record.alias, { after: record.lastFingerprint ?? undefined, limit: 20 });
  const reply = history.find((row) => row.senderType !== 1);
  if (!reply) return json({ status: 'pending' });

  const decision = parseApprovalDecision(reply.messageText);
  if (decision === 'approved') {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = await signSession(env, { mindId: record.mindId, connectionId, iat: Date.now(), exp: expiresAt });
    await env.MIND_CONNECTIONS.put(
      connectionId,
      JSON.stringify({ ...record, status: 'approved' }),
      { expirationTtl: INIT_TTL_SECONDS },
    );
    return json({ status: 'approved', sessionToken: token, mindId: record.mindId, mindName: record.mindName ?? null, expiresAt });
  }
  if (decision === 'denied') {
    await env.MIND_CONNECTIONS.put(
      connectionId,
      JSON.stringify({ ...record, status: 'denied' }),
      { expirationTtl: INIT_TTL_SECONDS },
    );
    return json({ status: 'denied' });
  }
  return json({ status: 'pending' });
}
