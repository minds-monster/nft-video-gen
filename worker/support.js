// Support intake: one ticket = one builder-API conversation, alias `support-<ticketId>`.
//
// WHY NOT EMAIL. The obvious design was a form that emails the support Mind. Two facts killed
// it, one measured and one Adam's: `listConversations()` returns only the threads the builder
// key's own human is a party to (checked: 88 conversations, every one a site-made alias), so a
// customer's email thread with the Mind is INVISIBLE to the site — "you'd be flying blind on
// whether anything arrived, when I saw it, when I replied." A builder-API conversation the site
// opens is one the site can read end to end, which is the whole basis of the owner area.
//
// The Mind never emails the visitor. It replies in-thread under an `[auto-replied …]` marker
// (src/lib/support-markers.js) and worker/support-sync.js wraps that body in email from the
// site's own address. That is Adam's design too: one brand in the visitor's inbox, deliverability
// the site controls, and a send the site can log.
//
// KV keys (MIND_CONNECTIONS, no TTL — a support history is a record, like `budget:`):
//   support:ticket:<id>                     immutable after creation
//   support:derived:<id>                    the cron's snapshot of the thread's state (cron-only writer)
//   support:index:<inv>:<id>                → id, with list-row fields in METADATA; `inv` is an
//                                           inverted zero-padded timestamp so an ascending list()
//                                           is newest-first with native cursors
//   support:open:<id>                       the cron's work list
//   support:visitor:<visitorKey>:<inv>:<id> this visitor's tickets, for Returning/Prior-Tickets
//   support:email:<id>:<ms>                 every email the site sent (or failed to) for this ticket
//   support:emailed:<id>:<fingerprint>      idempotency marker per relayed reply (cf. stripe_processed:)

import { mindsClient } from './minds.js';
import { requireSession, signSession, verifySession, SESSION_KINDS } from './session.js';
import { generateSubject } from './mind-chat.js';
import { getBudget } from './budget.js';
import { listFilms } from './storyboarder.js';
import { formatMail, SUBJECT_MAX } from '../src/lib/mail.js';
import { rateLimited, clientIp } from './rate-limit.js';
import { sendEmail, isMailerConfigured } from './email.js';
import { record } from './analytics.js';
import { ensureSupportBriefed } from './support-briefing.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// Adam's own cadence, stated as the promise the form makes: "seen within 4h, replied within 8h."
export const SLA = Object.freeze({ seenWithinH: 4, repliedWithinH: 8, escalationH: 4 });

export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 4000;
const REPLY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PRODUCTION_WORDS = /\b(film|video|storyboard|beat|cast|render|take|screenplay|shoot)\b/i;

export const supportAlias = (ticketId) => `support-${ticketId}`;

// 13 digits covers every ms timestamp until the year 2286.
export const inv = (ms) => String(9_999_999_999_999 - Math.round(ms)).padStart(13, '0');

export const KEYS = Object.freeze({
  ticket: (id) => `support:ticket:${id}`,
  derived: (id) => `support:derived:${id}`,
  open: (id) => `support:open:${id}`,
  OPEN_PREFIX: 'support:open:',
  index: (ms, id) => `support:index:${inv(ms)}:${id}`,
  INDEX_PREFIX: 'support:index:',
  visitor: (visitorKey, ms, id) => `support:visitor:${visitorKey}:${inv(ms)}:${id}`,
  visitorPrefix: (visitorKey) => `support:visitor:${visitorKey}:`,
  // The kind is part of the key: a receipt and an owner notification leave the same
  // request in the same millisecond, and one log line overwriting the other is a lie.
  emailLog: (id, ms, kind) => `support:email:${id}:${String(ms).padStart(13, '0')}:${kind}`,
  emailLogPrefix: (id) => `support:email:${id}:`,
  emailed: (id, fingerprint) => `support:emailed:${id}:${fingerprint}`,
});

const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * One stable id per visitor, keyed by EMAIL — present on every submit, so the same person
 * never splits into a "connected" and an "anonymous" identity the moment they connect a Mind.
 * HMAC rather than a bare hash: a bare SHA-256 of an email adds no privacy while the email
 * sits on the record, but an HMAC under the signing secret means the key itself is unlinkable
 * to an address by anyone who only holds the key.
 */
export async function visitorKeyFor(env, email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const secret = env.SESSION_SIGNING_SECRET ?? 'unsigned';
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(normalized))).slice(0, 32);
}

const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) && value.length <= 254;

export const loadTicket = (env, ticketId) => env.MIND_CONNECTIONS.get(KEYS.ticket(ticketId), 'json').catch(() => null);
export const loadDerived = (env, ticketId) => env.MIND_CONNECTIONS.get(KEYS.derived(ticketId), 'json').catch(() => null);

/** The list-row fields, kept on the index key's metadata so the owner list is ONE list() call. */
export function indexMetadata(ticket, derived) {
  return {
    status: derived?.status ?? 'received',
    urgent: Boolean(ticket.urgent),
    humanRequested: Boolean(ticket.humanRequested),
    subject: String(ticket.subject ?? '').slice(0, SUBJECT_MAX),
    receivedAt: derived?.receivedAt ?? new Date(ticket.createdAt).toISOString(),
    seenAt: derived?.seenAt ?? null,
    repliedAt: derived?.repliedAt ?? null,
    escalatedAt: derived?.escalatedAt ?? null,
    resolvedAt: derived?.resolvedAt ?? null,
    reopenCount: derived?.reopenCount ?? 0,
    replies: derived?.replies?.length ?? 0,
    unmarked: derived?.unmarkedMindRows?.length ?? 0,
    mindId: ticket.mindId ? ticket.mindId.slice(0, 8) : null,
  };
}

export async function writeIndex(env, ticket, derived) {
  await env.MIND_CONNECTIONS.put(KEYS.index(ticket.createdAt, ticket.ticketId), ticket.ticketId, {
    metadata: indexMetadata(ticket, derived),
  });
}

export async function logEmail(env, ticketId, entry) {
  const at = Date.now();
  try {
    await env.MIND_CONNECTIONS.put(KEYS.emailLog(ticketId, at, entry.kind ?? 'email'), JSON.stringify({ at: new Date(at).toISOString(), ...entry }));
  } catch (error) {
    console.warn('Email log write failed:', error?.message ?? error);
  }
}

/** This visitor's ticket history: how many, and which are still open (newest first). */
export async function priorTicketsFor(env, visitorKey) {
  const listed = await env.MIND_CONNECTIONS.list({ prefix: KEYS.visitorPrefix(visitorKey), limit: 50 }).catch(() => ({ keys: [] }));
  const ids = listed.keys.map((key) => key.name.split(':').pop());
  const openIds = [];
  for (const id of ids.slice(0, 10)) {
    if (await env.MIND_CONNECTIONS.get(KEYS.open(id)).catch(() => null)) openIds.push(id);
  }
  return { count: ids.length, openIds };
}

const yesNo = (value) => (value ? 'yes' : 'no');

/**
 * The opening message — Adam's per-ticket briefing payload, so he never answers blind:
 * "visitor_stable_id, is_returning, prior_ticket_count, prior_open_tickets, plan,
 * recent_films, any_flags."
 */
export function buildTicketMessage({
  subject,
  subjectSource,
  ticketId,
  visitorKey,
  returning,
  priorTickets,
  priorOpen,
  plan,
  budgetSet,
  recentFilms,
  urgent,
  humanRequested,
  page,
  email,
  message,
}) {
  const headers = [
    `Ticket: ${ticketId}`,
    `Visitor: ${visitorKey.slice(0, 8)}  Returning: ${yesNo(returning)}  Prior-Tickets: ${priorTickets}  Prior-Open: ${priorOpen}`,
    `Plan: ${plan}  Budget-Set: ${yesNo(budgetSet)}  Recent-Films: ${recentFilms}  Urgent: ${yesNo(urgent)}`,
    `Human-Requested: ${yesNo(humanRequested)}  Page: ${page || '/'}`,
    `From: ${email}`,
  ];
  return formatMail({ subject, subjectSource, body: `${headers.join('\n')}\n\n${message}` });
}

/** A follow-up from the visitor, appended to their existing ticket's thread. */
const buildFollowUp = (ticket, message) =>
  formatMail({ subject: ticket.subject, reply: true, body: `Follow-Up: ${ticket.ticketId}\n\n${message}` });

const replyToken = (env, ticket) =>
  signSession(env, {
    kind: SESSION_KINDS.supportReply,
    ticket: ticket.ticketId,
    visitorKey: ticket.visitorKey,
    iat: Date.now(),
    exp: Date.now() + REPLY_TOKEN_TTL_MS,
  });

export const ticketUrl = async (env, ticket) => `${ticket.origin}/#/support/${ticket.ticketId}/${await replyToken(env, ticket)}`;
export const ownerTicketUrl = (ticket) => `${ticket.origin}/#/owner/support/${ticket.ticketId}`;

const signature = '\n\n— minds.monster support';

export async function receiptEmail(env, ticket) {
  const link = await ticketUrl(env, ticket);
  return {
    to: ticket.email,
    subject: `[#${ticket.ticketId}] We got your message: ${ticket.subject}`,
    text:
      `Hi,\n\nYour message has reached minds.monster support. Ticket #${ticket.ticketId}.\n\n` +
      (ticket.humanRequested
        ? `You asked for a person, so this has gone straight to the site owner rather than to Adam.\n\n`
        : `Adam picks up support on a ${SLA.seenWithinH}-hour cadence: expect it to be seen within ${SLA.seenWithinH} hours and answered within ${SLA.repliedWithinH}, by email to this address.\n\n`) +
      `Add to the ticket or check where it is at any time:\n${link}\n\n` +
      `Your message:\n${ticket.message}` +
      signature,
  };
}

export async function replyEmail(env, ticket, reply) {
  const link = await ticketUrl(env, ticket);
  const from = reply.kind === 'steward-forwarded' ? 'Adam, with a word from the site owner' : 'Adam';
  return {
    to: ticket.email,
    subject: `[#${ticket.ticketId}] RE: ${ticket.subject}`,
    text: `${reply.body}\n\n— ${from}, minds.monster support\n\nReply or check this ticket:\n${link}\nPrefer a person? Open the link and choose "speak to a human".`,
  };
}

export const ownerNotifyEmail = (ticket) => ({
  to: ticket.ownerNotifyEmail,
  subject: `[#${ticket.ticketId}] A visitor asked for a human: ${ticket.subject}`,
  text:
    `${ticket.email} asked to speak to a person rather than Adam.\n\n` +
    `Open it in the owner area:\n${ownerTicketUrl(ticket)}\n\nTheir message:\n${ticket.message}` +
    signature,
});

/** Send + log, never throw: an email is never allowed to fail the request that produced it. */
export async function deliver(env, ticketId, kind, mail, { send = sendEmail } = {}) {
  try {
    const result = await send(env, mail);
    await logEmail(env, ticketId, { kind, to: mail.to, subject: mail.subject, status: result.status, providerId: result.providerId ?? null });
    return result;
  } catch (error) {
    await logEmail(env, ticketId, { kind, to: mail.to, subject: mail.subject, status: 'failed', error: error?.message ?? String(error) });
    return { status: 'failed', error: error?.message };
  }
}

const newTicketId = async (env) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    if (!(await env.MIND_CONNECTIONS.get(KEYS.ticket(id)))) return id;
  }
  throw new Error('ticket_id_collision');
};

/** The visitor's plan and production facts, only when they hold a session — blank otherwise. */
async function connectedFacts(env, mindId) {
  if (!mindId) return { plan: 'guest', budgetSet: false, recentFilms: 0 };
  const [budget, films] = await Promise.all([
    getBudget(env, mindId).catch(() => null),
    listFilms(env, mindId).catch(() => []),
  ]);
  return {
    plan: budget?.paidTier ? 'paid' : 'free',
    budgetSet: Boolean(budget),
    recentFilms: films?.length ?? 0,
  };
}

/**
 * Append a visitor follow-up to an open ticket. Used by the signed reply link, and by the
 * auto-merge rule: a visitor's sixth ticket in an hour is a follow-up, not a sixth thread.
 */
export async function appendFollowUp(env, ticket, message, { client = mindsClient(env) } = {}) {
  if (!client) throw new Error('not_configured');
  await client.sendMessage({ alias: ticket.alias, messageText: buildFollowUp(ticket, message) });
  await env.MIND_CONNECTIONS.put(KEYS.open(ticket.ticketId), '1');
  record(env, 'support_followup', { mindId: ticket.mindId });
}

/** POST /api/support */
export async function handleSupportSubmit(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  // The honeypot: a field no person sees, filled only by things that fill every field.
  // Answered as if it worked, so the thing filling it learns nothing — and checked before
  // the rate limit, so it costs no KV write either.
  if (body.hp) return json({ ok: true, ticketId: null });

  const ip = clientIp(request);
  if (await rateLimited(env, 'support-ip', ip, { limit: 10, windowSec: 3600 })) return json({ error: 'rate_limited' }, 429);

  const email = String(body.email ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!isEmail(email)) return json({ error: 'invalid_email' }, 400);
  if (message.length < MESSAGE_MIN) return json({ error: 'message_too_short', min: MESSAGE_MIN }, 400);
  if (message.length > MESSAGE_MAX) return json({ error: 'message_too_long', max: MESSAGE_MAX }, 400);

  const client = mindsClient(env);
  if (!client || !env.SUPPORT_MIND_ID) return json({ error: 'not_configured' }, 500);

  // The connected identity is read from the bearer token, never from the body — a mindId a
  // visitor typed is a claim, and it ends up in a prompt to someone else's Mind.
  const session = await requireSession(request, env);
  const mindId = session?.mindId ?? null;
  const visitorKey = await visitorKeyFor(env, email);
  const prior = await priorTicketsFor(env, visitorKey);

  // Adam's auto-merge: "Same visitor opens 5 tickets in an hour? Auto-merge into one."
  if (await rateLimited(env, 'support-visitor', visitorKey, { limit: 5, windowSec: 3600 })) {
    const openId = prior.openIds[0];
    const open = openId ? await loadTicket(env, openId) : null;
    if (!open) return json({ error: 'rate_limited' }, 429);
    await appendFollowUp(env, open, message, { client });
    return json({ ticketId: open.ticketId, merged: true, sla: SLA });
  }

  const typed = String(body.subject ?? '').trim().slice(0, SUBJECT_MAX);
  const subject = typed || (await generateSubject(env, message));
  const urgent = Boolean(body.urgent);
  const humanRequested = Boolean(body.humanRequested);
  const page = String(body.page ?? '').slice(0, 200);
  const facts = await connectedFacts(env, mindId);
  const ticketId = await newTicketId(env);
  const alias = supportAlias(ticketId);
  const createdAt = Date.now();
  const origin = env.SITE_ORIGIN || new URL(request.url).origin;

  const ticket = {
    ticketId,
    alias,
    visitorKey,
    email,
    subject,
    message,
    page,
    urgent,
    humanRequested,
    mindId,
    origin,
    createdAt,
    ownerNotifyEmail: env.OWNER_NOTIFY_EMAIL ?? null,
    looksLikeProduction: PRODUCTION_WORDS.test(message),
  };

  // The Mind is told the rules once, ever, before its first ticket — idempotent, and a
  // failure here must not cost the visitor their ticket.
  await ensureSupportBriefed(env, env.SUPPORT_MIND_ID, { client }).catch((error) =>
    console.warn('Support briefing failed:', error?.message ?? error),
  );

  const wire = buildTicketMessage({
    subject,
    subjectSource: typed ? 'visitor' : 'auto',
    ticketId,
    visitorKey,
    returning: prior.count > 0,
    priorTickets: prior.count,
    priorOpen: prior.openIds.length,
    plan: facts.plan,
    budgetSet: facts.budgetSet,
    recentFilms: facts.recentFilms,
    urgent,
    humanRequested,
    page,
    email,
    message,
  });
  await client.ensureConversation(alias, env.SUPPORT_MIND_ID);
  await client.sendMessage({ alias, messageText: wire });

  const derived = { status: 'received', receivedAt: new Date(createdAt).toISOString(), open: true, replies: [], unmarkedMindRows: [] };
  const store = env.MIND_CONNECTIONS;
  await store.put(KEYS.ticket(ticketId), JSON.stringify(ticket));
  await store.put(KEYS.derived(ticketId), JSON.stringify(derived));
  await writeIndex(env, ticket, derived);
  await store.put(KEYS.open(ticketId), '1');
  await store.put(KEYS.visitor(visitorKey, createdAt, ticketId), ticketId);

  record(env, 'support_submitted', { page, mindId, value: 1 });
  if (humanRequested) record(env, 'support_human_requested', { page, mindId });

  // Both emails ride on waitUntil: a slow or failing mailer must never fail a ticket whose
  // alias and records already exist. Their outcomes are logged for the owner thread view.
  const mailWork = (async () => {
    await deliver(env, ticketId, 'receipt', await receiptEmail(env, ticket));
    if (humanRequested && ticket.ownerNotifyEmail) await deliver(env, ticketId, 'owner-notify', ownerNotifyEmail(ticket));
  })();
  if (ctx?.waitUntil) ctx.waitUntil(mailWork);
  else await mailWork;

  return json({
    ticketId,
    merged: false,
    humanRequested,
    sla: SLA,
    mailer: isMailerConfigured(env) ? 'configured' : 'unconfigured',
    ticketUrl: await ticketUrl(env, ticket),
  });
}

/** Resolve a signed reply-link token to its ticket, or null. */
export async function ticketFromReplyToken(env, ticketId, token) {
  const payload = await verifySession(env, token);
  if (!payload || payload.kind !== SESSION_KINDS.supportReply || payload.ticket !== ticketId) return null;
  const ticket = await loadTicket(env, ticketId);
  if (!ticket || ticket.visitorKey !== payload.visitorKey) return null;
  return ticket;
}

/** What the visitor is allowed to see of their own ticket: state, and the replies to them. */
export function visitorView(ticket, derived) {
  const receivedAt = derived?.receivedAt ?? new Date(ticket.createdAt).toISOString();
  const expectSeenBy = new Date(new Date(receivedAt).getTime() + SLA.seenWithinH * 3600000).toISOString();
  const expectRepliedBy = new Date(new Date(receivedAt).getTime() + SLA.repliedWithinH * 3600000).toISOString();
  return {
    ticketId: ticket.ticketId,
    subject: ticket.subject,
    message: ticket.message,
    humanRequested: ticket.humanRequested,
    status: derived?.status ?? 'received',
    receivedAt,
    seenAt: derived?.seenAt ?? null,
    repliedAt: derived?.repliedAt ?? null,
    resolvedAt: derived?.resolvedAt ?? null,
    replies: (derived?.replies ?? []).map((reply) => ({ at: reply.at, body: reply.body })),
    expectSeenBy,
    expectRepliedBy,
    sla: SLA,
  };
}

/** GET /api/support/ticket?ticketId=&token= — the visitor's own view, from their signed link. */
export async function handleSupportTicket(request, env) {
  const { searchParams } = new URL(request.url);
  const ticketId = searchParams.get('ticketId') ?? '';
  const token = searchParams.get('token') ?? '';
  const ticket = await ticketFromReplyToken(env, ticketId, token);
  if (!ticket) return json({ error: 'not_found' }, 404);
  const derived = await loadDerived(env, ticketId);
  return json(visitorView(ticket, derived));
}

/**
 * POST /api/support/reply { ticketId, token, message, humanRequested? }
 *
 * A visitor writing back on an open ticket is Adam's "did you get my message?" case: the
 * response carries the current state and the expected reply time, so a second ticket never
 * needs opening. Writing back on a RESOLVED ticket reopens it (the cron sees the visitor row
 * after [resolved]). Asking for a human here does what the form's link does.
 */
export async function handleSupportReply(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const ticketId = String(body.ticketId ?? '');
  const ticket = await ticketFromReplyToken(env, ticketId, String(body.token ?? ''));
  if (!ticket) return json({ error: 'not_found' }, 404);
  if (await rateLimited(env, 'support-reply', ticket.visitorKey, { limit: 10, windowSec: 3600 })) return json({ error: 'rate_limited' }, 429);

  const message = String(body.message ?? '').trim();
  if (message.length < 2) return json({ error: 'message_too_short', min: 2 }, 400);
  if (message.length > MESSAGE_MAX) return json({ error: 'message_too_long', max: MESSAGE_MAX }, 400);

  const client = mindsClient(env);
  if (!client) return json({ error: 'not_configured' }, 500);
  await appendFollowUp(env, ticket, message, { client });

  if (body.humanRequested && ticket.ownerNotifyEmail) {
    record(env, 'support_human_requested', { mindId: ticket.mindId });
    const work = deliver(env, ticketId, 'owner-notify', ownerNotifyEmail({ ...ticket, message }));
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
  }

  const derived = await loadDerived(env, ticketId);
  return json({ ok: true, ...visitorView(ticket, derived) });
}
