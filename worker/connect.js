// The Connect Mind handshake: a visitor supplies a mindId, the site messages that
// Mind asking it to approve, and polling for the reply mints a session once approved.
// See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.
//
// IMPORTANT: we do NOT store pending handshake state in KV. Cloudflare KV is
// eventually consistent, and in production a write is not guaranteed to be visible
// to the next read — which caused /api/connect/status to immediately return
// "expired" even though the handshake was still live. The handshake state is
// instead reconstructed from the conversation alias, which is the authoritative
// record: a fresh `connect-<connectionId>` alias is created on init, and status
// polls the history of that same alias.

import { mindsClient, connectionAlias, parseApprovalDecision } from './minds.js';
import { signSession } from './session.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// A brand-new Mind's first-ever connect needs a human to actually notice the message,
// get oriented, and reply — this session's own testing has seen that take well over
// five minutes more than once. Rate limiting (below) is what actually guards against
// abuse, so there's no real cost to giving a real first-time connection room to land.
const INIT_TTL_MS = 30 * 60 * 1000;
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

export function isValidConnectionId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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

  // Exactly one message per connection attempt — never retried automatically. A visitor
  // who wants to try again gets a fresh connectionId, not a resend into the same alias.
  //
  // The conversation itself is the source of truth for the handshake; see the file header.
  const conversation = await client.ensureConversation(alias, mindId);
  const mindParticipant = conversation.participants?.find((p) => p.partyType === 0);
  // Best-effort — a display name is a nicety, never a reason to fail the connect attempt.
  const mindName = mindParticipant?.name ?? await client.getMind(mindId).then((m) => m.name ?? null).catch(() => null);
  await client.sendMessage({ alias, messageText: message });

  return json({ connectionId, expiresInMs: INIT_TTL_MS, message, mindName });
}

/**
 * Reconstruct the state of a connect handshake purely from the conversation alias,
 * without minting a session. Exported so `worker/assistant.js` can answer "are we
 * connected yet?" using exactly this logic, rather than re-implementing the
 * KV-eventual-consistency workaround described at the top of this file.
 *
 * Returns `{ status: 'pending' | 'approved' | 'denied' | 'expired', mindId?, mindName? }`.
 * Throws (rather than returning an error shape) on real failures — `not_configured` for a
 * missing Builder key, or whatever the underlying client call raises — so every caller
 * gets the same failure behavior as the rest of this file: let it bubble to the
 * route-level catch-all.
 */
export async function reconstructConnectStatus(env, connectionId) {
  const client = mindsClient(env);
  if (!client) throw new Error('not_configured');

  const alias = connectionAlias(connectionId);

  // If the alias does not exist yet, the init write may still be replicating or the
  // request is ahead of the init; treat it as pending rather than expired.
  let conversation;
  try {
    conversation = await client.getConversation(alias);
  } catch (err) {
    if (err?.status === 404) return { status: 'pending' };
    throw err;
  }

  const mindParticipant = conversation.participants?.find((p) => p.partyType === 0);
  const mindId = mindParticipant?.partyId;
  if (!mindId) return { status: 'pending' };

  const createdAtMs = conversation.createdAt ? new Date(conversation.createdAt).getTime() : 0;
  if (createdAtMs && Date.now() - createdAtMs > INIT_TTL_MS) return { status: 'expired' };

  // A server-side read of the conversation's history — this never reaches the Mind as
  // a new message, so it doesn't count against its own per-connection cognition budget.
  // We locate our own connect message to establish the cutoff, rather than relying on
  // a worker-side timestamp that may drift from the platform's clock.
  const history = await client.getHistory(alias, { limit: 20 });
  const sentMessage = history.find((row) => row.senderType === 1 && row.messageText?.includes(connectionId));
  if (!sentMessage) return { status: 'pending' };

  const cutoffMs = new Date(sentMessage.createdAt).getTime() - 2000;
  const reply = history.find((row) => row.senderType !== 1 && new Date(row.createdAt).getTime() > cutoffMs);
  if (!reply) return { status: 'pending' };

  const decision = parseApprovalDecision(reply.messageText);
  if (decision === 'approved') {
    const mindName = mindParticipant?.name ?? await client.getMind(mindId).then((m) => m.name ?? null).catch(() => null);
    return { status: 'approved', mindId, mindName };
  }
  if (decision === 'denied') return { status: 'denied', mindId };
  return { status: 'pending', mindId };
}

export async function handleConnectStatus(request, env) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId');
  if (!connectionId || !isValidConnectionId(connectionId)) return json({ error: 'connectionId required' }, 400);

  let result;
  try {
    result = await reconstructConnectStatus(env, connectionId);
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    throw err;
  }

  if (result.status === 'approved') {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = await signSession(env, { mindId: result.mindId, connectionId, iat: Date.now(), exp: expiresAt });
    return json({ status: 'approved', sessionToken: token, mindId: result.mindId, mindName: result.mindName, expiresAt });
  }
  return json({ status: result.status });
}
