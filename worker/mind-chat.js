// The ongoing chat, once a visitor's session is live. Session-gated; only ever relays
// a real, human-typed message to the connected Mind — never a synthetic ping, per
// Adam's own cognition-budget concern from the brainstorm.

import { mindsClient, chatAlias } from './minds.js';
import { verifySession } from './session.js';
import { PRODUCER_BRIEFING } from './producer-briefing.js';

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
  console.log('[chat] init', { mindId: session.mindId, alias, connectionId: session.connectionId });

  await client.ensureConversation(alias, session.mindId);
  let history = await client.getHistory(alias, { limit: 50 });

  // First time this Mind has ever connected as a Producer — brief it automatically so
  // every connected Mind gets real context, not just ones sophisticated enough to have
  // equipped a Skill. Tracked via a dedicated per-Mind flag, not "is history empty" —
  // that heuristic silently breaks the moment a Mind has *any* prior contact on this
  // alias for any reason (every Mind used for dev/testing already does), permanently
  // blocking the briefing for it. The flag has no TTL: this is a permanent "have we
  // ever briefed this Mind" record, not an expiring one.
  const briefedKey = `briefed:${session.mindId}`;
  let alreadyBriefed = await env.MIND_CONNECTIONS.get(briefedKey);
  // The KV flag can be slow to replicate; the conversation history is authoritative.
  // If a previous briefing is already in the thread, treat this Mind as briefed and
  // repair the flag so the next init doesn't re-send.
  const briefingInHistory = history.some(
    (row) => row.senderType === 1 && row.messageText?.includes('Producer briefing'),
  );
  if (!alreadyBriefed && briefingInHistory) {
    alreadyBriefed = '1';
    await env.MIND_CONNECTIONS.put(briefedKey, '1');
  }
  console.log('[chat] briefed check', { mindId: session.mindId, alreadyBriefed: Boolean(alreadyBriefed), historyRows: history.length, briefingInHistory });

  if (!alreadyBriefed) {
    try {
      await client.sendMessage({ alias, messageText: PRODUCER_BRIEFING });
      await env.MIND_CONNECTIONS.put(briefedKey, '1');
      console.log('[chat] briefing sent', { mindId: session.mindId, alias, briefingLength: PRODUCER_BRIEFING.length });
      history = await client.getHistory(alias, { limit: 50 });
    } catch (err) {
      console.error('[chat] briefing send failed', { mindId: session.mindId, alias, error: err?.message, status: err?.status, code: err?.code });
      return json({ error: 'briefing_failed', detail: err?.message }, 500);
    }
  }

  console.log('[chat] init done', { mindId: session.mindId, historyRows: history.length });
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
  // A timestamp, not a fingerprint: getHistory's `after` fingerprint filter is silently
  // ignored by the platform — confirmed empirically (a call with `after` set to a recent
  // message's fingerprint still returned the entire conversation from the start). Filtering
  // by createdAt ourselves, in mindChatPoll below, is what actually works.
  const before = Date.now();
  try {
    await client.sendMessage({ alias, messageText });
    console.log('[chat] send', { mindId: session.mindId, alias, before });
  } catch (err) {
    console.error('[chat] send failed', { mindId: session.mindId, alias, error: err?.message, status: err?.status, code: err?.code });
    throw err;
  }
  lastSendAt.set(session.connectionId, now);

  return json({ before });
}

export async function mindChatPoll(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const afterMs = Number(searchParams.get('after')) || 0;

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);

  const alias = chatAlias(session.mindId);
  const raw = await client.getHistory(alias, { limit: 50 });
  // Small buffer for clock skew between this Worker and the platform's own timestamps.
  const cutoffMs = afterMs - 2000;
  const history = raw.filter((row) => new Date(row.createdAt).getTime() > cutoffMs);
  return json({ history });
}
