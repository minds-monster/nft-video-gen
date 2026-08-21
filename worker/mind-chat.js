// The ongoing chat, once a visitor's session is live. Session-gated; only ever relays
// a real, human-typed message to the connected Mind — never a synthetic ping, per
// Adam's own cognition-budget concern from the brainstorm.

import { mindsClient, chatAlias } from './minds.js';
import { verifySession } from './session.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function requireSession(request, env) {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifySession(env, token);
}

export async function mindChatInit(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const alias = chatAlias(session.mindId);
  await client.ensureConversation(alias, session.mindId);
  const history = await client.getHistory(alias, { limit: 50 });
  return json({ history });
}

// A visitor's own send rate, separate from the connect-time rate limit — protects the
// Mind from a flood of rapid messages just as much as the initial handshake does.
const SEND_MIN_INTERVAL_MS = 3_000;
const lastSendAt = new Map();

export async function mindChatSend(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  const last = lastSendAt.get(session.connectionId) ?? 0;
  if (now - last < SEND_MIN_INTERVAL_MS) return json({ error: 'rate_limited' }, 429);

  const body = await request.json().catch(() => ({}));
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : '';
  if (!messageText) return json({ error: 'messageText required' }, 400);

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const alias = chatAlias(session.mindId);
  await client.ensureConversation(alias, session.mindId);
  const before = await client.getLatestHistoryFingerprint(alias);
  await client.sendMessage({ alias, messageText });
  lastSendAt.set(session.connectionId, now);

  return json({ before: before ?? null });
}

export async function mindChatPoll(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const after = searchParams.get('after') ?? undefined;

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const alias = chatAlias(session.mindId);
  const history = await client.getHistory(alias, { after, limit: 50 });
  return json({ history });
}
