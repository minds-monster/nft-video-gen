// The assistant: a fast, always-responsive layer in front of the slow Mind
// conversation. Visitors talk to this by default in ConnectMindModal and
// ProducerPanel; it never replaces the real Mind, it mediates it. See
// /Users/adamplace/.claude/plans/a-third-party-mind-agent-floating-seal.md and the
// design conversation in scripts/brainstorm-adam-assistant.mjs.
//
// Two calls per turn, not one — this is the compromise between two things measured
// directly against this NIM deployment:
//   1. `tool_choice: 'auto'` is unreliable here (a model called a status tool even for
//      "what's the capital of France?"), so the relay decision still needs a FORCED
//      tool call — the one thing casting-director.js already proved reliable.
//   2. worker/nvidia.js's own streamChat docs: a forced tool_choice never streams: "with
//      tool_choice set, the same request returns the entire answer in two chunks after
//      a two-second pause — nothing to animate." A visible chat reply needs to stream.
// So: a fast, invisible, forced call decides {relayToMind, messageForMind} first (and
// triggers the relay immediately if so), then a second, streamed, tool-free call
// produces the actual reply text the visitor watches arrive — already told what was
// just decided, so the two calls can't disagree with each other.
//
// Deliberately self-sufficient: it calls ensureProducerReady itself rather than
// assuming the client's useMindChat has already run mindChatInit, so it works even if
// a visitor only ever opens the assistant surfaces and never triggers the raw hook.

import { chat, streamChat, jsonFrom } from './nvidia.js';
import { sseResponse } from './sse.js';
import { mindsClient } from './minds.js';
import { reconstructConnectStatus, isValidConnectionId } from './connect.js';
import {
  ensureProducerReady,
  fetchMindActivity,
  relayToMind,
  deriveMindStatus,
  deriveQueueDepth,
  deriveLivenessState,
  requireSession,
} from './mind-chat.js';
import { getBudget } from './budget.js';
import { buildAssistantSystemPrompt } from './assistant-brief.js';
import { messageToText } from '../src/lib/text.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TRANSCRIPT_TURNS = 40; // user+assistant pairs kept, oldest dropped first
const TRANSCRIPT_TTL_SECONDS = 24 * 60 * 60;

// Adam's own idle-timeout trigger from the Producer Inbox brainstorm: "if the assistant
// has been holding a thread for, say, 10+ minutes without further visitor activity,
// pass what's there." There's no background timer in a Worker, so this is checked
// opportunistically — on the next assistant call, and on every status poll (the client
// already polls /api/assistant/status every 6s while a surface is mounted), rather than
// needing a Cron Trigger and a second data path just for this one rule.
const IDLE_RELAY_MS = 10 * 60 * 1000;

// Separate from mindChatSend's own limiter in mind-chat.js — this endpoint calls
// relayToMind directly rather than going through that route, so it needs its own guard
// against a visitor using the assistant to flood the real Mind.
const RELAY_MIN_INTERVAL_MS = 3_000;
const lastRelayAt = new Map();

// Guards the LLM calls themselves, keyed by threadId — generous, since this is normal
// chat pacing rather than the connect/send limits that protect a real Mind's attention.
const MESSAGE_MIN_INTERVAL_MS = 1_000;
const lastMessageAt = new Map();

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function isValidThreadId(id) {
  return typeof id === 'string' && isValidConnectionId(id);
}

const kvKey = (threadId) => `assistant:${threadId}`;

// Stored shape: `{ turns, pendingForMind, heldSince }`. `pendingForMind`/`heldSince`
// are new fields for the idle-relay trigger below; a bare array from before this
// change (or from an in-flight 24h-TTL record) normalizes to an empty hold.
function normalizeStored(raw) {
  if (Array.isArray(raw)) return { turns: raw, pendingForMind: [], heldSince: null };
  if (raw && typeof raw === 'object') {
    return { turns: raw.turns ?? [], pendingForMind: raw.pendingForMind ?? [], heldSince: raw.heldSince ?? null };
  }
  return { turns: [], pendingForMind: [], heldSince: null };
}

async function loadStored(env, threadId) {
  return normalizeStored(await env.MIND_CONNECTIONS.get(kvKey(threadId), 'json'));
}

async function saveStored(env, threadId, stored) {
  await env.MIND_CONNECTIONS.put(kvKey(threadId), JSON.stringify(stored), {
    expirationTtl: TRANSCRIPT_TTL_SECONDS,
  });
}

/**
 * Adam's idle-timeout trigger, verbatim from the brainstorm: "if the assistant has been
 * holding a thread for, say, 10+ minutes without further visitor activity, pass what's
 * there." Mutates and persists `stored` if it fires. Relays the visitor's own held
 * words, unedited — no extra LLM call to summarize, matching this codebase's existing
 * verbatim-over-paraphrase bias for anything decision-bearing.
 */
async function relayIfIdle(env, mindId, stored, threadId) {
  if (!stored.heldSince || !stored.pendingForMind.length) return false;
  if (Date.now() - stored.heldSince < IDLE_RELAY_MS) return false;

  const relayNow = Date.now();
  const lastRelay = lastRelayAt.get(mindId) ?? 0;
  if (relayNow - lastRelay < RELAY_MIN_INTERVAL_MS) return false;
  lastRelayAt.set(mindId, relayNow);

  const compiled = stored.pendingForMind.map((p) => p.text).join('\n\n');
  await relayToMind(
    env,
    mindId,
    `[Auto-forwarded after ${Math.round(IDLE_RELAY_MS / 60000)} minutes of no further visitor activity — their own words, unedited:]\n\n${compiled}`,
  );
  stored.pendingForMind = [];
  stored.heldSince = null;
  await saveStored(env, threadId, stored);
  return true;
}

/**
 * Resolve what the assistant is allowed to know/do right now. `hasMindAccess` gates
 * reading/relaying on the persistent producer-<mindId> conversation — true only with a
 * verified session, never from a bare client-supplied connectionId. A connectionId
 * alone (pre-approval) is only ever used for the same unauthenticated status read
 * `/api/connect/status` already does today.
 */
async function resolveState(request, env, connectionId) {
  const session = await requireSession(request, env);
  if (session) {
    const client = mindsClient(env);
    const mindName = client
      ? await client.getMind(session.mindId).then((m) => m.name ?? null).catch(() => null)
      : null;
    await ensureProducerReady(env, session.mindId);
    const budget = await getBudget(env, session.mindId);
    return {
      connectionStatus: 'approved',
      mindId: session.mindId,
      mindName,
      hasMindAccess: true,
      budget,
      activated: Boolean(budget),
    };
  }

  if (connectionId && isValidConnectionId(connectionId)) {
    const result = await reconstructConnectStatus(env, connectionId);
    return {
      connectionStatus: result.status,
      mindId: null,
      mindName: result.mindName ?? null,
      hasMindAccess: false,
      budget: null,
      activated: false,
    };
  }

  return { connectionStatus: 'idle', mindId: null, mindName: null, hasMindAccess: false, budget: null, activated: false };
}

// Last few turns, in plain text, embedded directly in the system prompt — this is what
// lets the model quote/attribute the Mind's actual words without a tool round-trip.
function formatRecentActivity(history) {
  if (!history?.length) return null;
  return history
    .slice(-8)
    .map((row) => `${row.senderType === 1 ? 'Visitor' : 'Mind'}: ${messageToText(row.messageText).slice(0, 500)}`)
    .join('\n');
}

const asMessages = (systemPrompt, transcript, userText) => [
  { role: 'system', content: systemPrompt },
  ...transcript.map((turn) => ({ role: turn.role, content: turn.content })),
  { role: 'user', content: userText },
];

const DECIDE_SCHEMA = {
  type: 'object',
  properties: {
    relayToMind: {
      type: 'boolean',
      description:
        'True only if this message is an explicit hand-off, a decision-shaped question ' +
        'only the Mind can answer, or a visitor-confirmed summary — see the relay-trigger ' +
        'rules in your system prompt. False for everything else, including production-relevant ' +
        'content that just does not meet that bar yet.',
    },
    messageForMind: {
      type: 'string',
      description:
        'If relayToMind is true, the message to relay to the Mind, verbatim — the visitor\'s ' +
        'own words, not your rewrite. Empty string otherwise.',
    },
    worthHolding: {
      type: 'boolean',
      description:
        'Only meaningful when relayToMind is false. True if this message is genuinely about ' +
        'the production the Mind should eventually see — worth compiling into a later batch ' +
        'if the visitor goes idle. False for pure small talk, site-navigation questions, or ' +
        'anything that would never need to reach the Mind even after a wait — a heartbeat, ' +
        'not a message.',
    },
  },
  required: ['relayToMind', 'messageForMind', 'worthHolding'],
};

// The dedicated assistant key (ASSISTANT_API_KEY + minimaxai/minimax-m3) is on a free tier
// that routinely 429s under manual testing. When it does, fall back to the casting director's
// key/model (NVIDIA_API_KEY + nemotron-3-nano-omni), which is already proven reachable and
// supports forced tool calls. This keeps the assistant responsive rather than silently failing.
const fallbackAvailable = (env) => Boolean(env.CASTING_MODEL && env.NVIDIA_API_KEY);

function decideRequest(env, systemPrompt, transcript, userText, { model, apiKey } = {}) {
  return {
    model: model ?? env.ASSISTANT_MODEL,
    apiKey: apiKey ?? env.ASSISTANT_API_KEY,
    messages: asMessages(systemPrompt, transcript, userText),
    tools: [
      {
        type: 'function',
        function: { name: 'decide', description: 'Decide whether to relay this to the Mind.', parameters: DECIDE_SCHEMA },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'decide' } },
    temperature: 0.3,
    max_tokens: 300,
  };
}

/** The fast, invisible, forced call — decides whether to relay, nothing else. */
async function decideRelay(env, systemPrompt, transcript, userText) {
  try {
    return jsonFrom(await chat(env, decideRequest(env, systemPrompt, transcript, userText)));
  } catch (err) {
    console.error('assistant decideRelay primary failed:', err?.message ?? err);
    if (err.status === 429 && fallbackAvailable(env)) {
      try {
        const result = jsonFrom(
          await chat(
            env,
            decideRequest(env, systemPrompt, transcript, userText, {
              model: env.CASTING_MODEL,
              apiKey: env.NVIDIA_API_KEY,
            }),
          ),
        );
        console.error('assistant decideRelay fallback succeeded');
        return result;
      } catch (fallbackErr) {
        console.error('assistant decideRelay fallback failed:', fallbackErr?.message ?? fallbackErr);
      }
    }
    return { relayToMind: false, messageForMind: '', worthHolding: false };
  }
}

/** The second, streamed, tool-free call — the actual reply text the visitor watches arrive. */
function replyRequest(env, systemPrompt, transcript, userText, decision, { model, apiKey } = {}) {
  const decisionNote = decision.relayToMind
    ? `\n\nYou already decided to relay this to the Mind, verbatim: "${decision.messageForMind}". Tell the visitor that naturally, in your own voice — say you're passing it along now.`
    : "\n\nYou already decided this doesn't need to go to the Mind. Answer the visitor directly and naturally using the current state above.";

  return {
    model: model ?? env.ASSISTANT_MODEL,
    apiKey: apiKey ?? env.ASSISTANT_API_KEY,
    messages: asMessages(systemPrompt + decisionNote, transcript, userText),
    temperature: 0.5,
    max_tokens: 700,
  };
}

export async function handleAssistantMessage(request, env) {
  const body = await request.json().catch(() => ({}));
  const { threadId, connectionId } = body;
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!isValidThreadId(threadId)) return json({ error: 'invalid_thread_id' }, 400);
  if (!text || text.length > MAX_MESSAGE_LENGTH) return json({ error: 'invalid_text' }, 400);

  const now = Date.now();
  const lastAt = lastMessageAt.get(threadId) ?? 0;
  if (now - lastAt < MESSAGE_MIN_INTERVAL_MS) return json({ error: 'rate_limited' }, 429);
  lastMessageAt.set(threadId, now);

  return sseResponse(async (emit) => {
    const state = await resolveState(request, env, connectionId);
    const stored = await loadStored(env, threadId);

    // Flush anything held from before this turn if it's aged past the idle-relay
    // window — a fresh visitor message means they're back, but what they said earlier
    // while the assistant was holding it still deserves to reach the Mind on its own.
    if (state.hasMindAccess) await relayIfIdle(env, state.mindId, stored, threadId);

    let mindStatus = null;
    let lastActivityAgeMs = null;
    let recentActivityText = null;
    let queueDepth = null;
    let livenessState = null;
    if (state.hasMindAccess) {
      const history = await fetchMindActivity(env, state.mindId, { limit: 20 });
      ({ mindStatus, lastActivityAgeMs } = deriveMindStatus(history));
      recentActivityText = formatRecentActivity(history);
      queueDepth = deriveQueueDepth(history);
      livenessState = deriveLivenessState(history);
    }

    const systemPrompt = buildAssistantSystemPrompt({
      connectionStatus: state.connectionStatus,
      mindName: state.mindName,
      mindStatus,
      lastActivityAgeMs,
      recentActivityText,
      queueDepth,
      livenessState,
      budget: state.budget,
      activated: state.activated,
    });

    await emit('phase', { phase: 'deciding' });
    const decision = await decideRelay(env, systemPrompt, stored.turns, text);

    if (decision.relayToMind && state.hasMindAccess && decision.messageForMind?.trim()) {
      const relayNow = Date.now();
      const lastRelay = lastRelayAt.get(state.mindId) ?? 0;
      if (relayNow - lastRelay >= RELAY_MIN_INTERVAL_MS) {
        lastRelayAt.set(state.mindId, relayNow);
        await relayToMind(env, state.mindId, decision.messageForMind.trim());
        // A real relay just happened — nothing left to hold from before this turn.
        stored.pendingForMind = [];
        stored.heldSince = null;
      } else {
        // Told the truth about it below rather than claiming a handoff that didn't happen.
        decision.relayToMind = false;
      }
    }

    if (!decision.relayToMind && state.hasMindAccess && decision.worthHolding) {
      // Held, not dropped — but only production-relevant content. Pure chit-chat never
      // enters the hold queue, so the idle timeout can't turn it into a heartbeat ping;
      // Adam was explicit that's the one thing he didn't want from this trigger.
      stored.pendingForMind.push({ text, ts: now });
      if (!stored.heldSince) stored.heldSince = now;
    }

    await emit('phase', { phase: 'responding' });

    const tryStream = async (request) => {
      let localReply = '';
      let localStreamedAny = false;
      const doStream = async () =>
        streamChat(env, request, (delta) => {
          if (delta.content) {
            localReply += delta.content;
            localStreamedAny = true;
            emit('delta', { content: delta.content }).catch(() => {});
          }
        });

      try {
        await doStream();
      } catch (err) {
        console.error('assistant stream failed:', err?.message ?? err, { localStreamedAny, threadId });
        // A 429 on the streamed reply is the normal free-tier failure mode. If nothing has
        // appeared yet, retry once — no replay risk because the visitor hasn't seen anything.
        if (!localStreamedAny) {
          await sleep(1500 + Math.floor(Math.random() * 1500));
          try {
            await doStream();
          } catch (retryErr) {
            console.error('assistant stream retry failed:', retryErr?.message ?? retryErr, { threadId });
          }
        }
      }
      return { reply: localReply, streamedAny: localStreamedAny };
    };

    let { reply } = await tryStream(replyRequest(env, systemPrompt, stored.turns, text, decision));

    // If the dedicated assistant key/model is rate-limited, fall back to the casting
    // director's key/model rather than showing the visitor a generic apology.
    if (!reply.trim() && fallbackAvailable(env)) {
      console.error('assistant trying fallback stream for thread:', threadId);
      ({ reply } = await tryStream(
        replyRequest(env, systemPrompt, stored.turns, text, decision, {
          model: env.CASTING_MODEL,
          apiKey: env.NVIDIA_API_KEY,
        }),
      ));
      if (reply.trim()) {
        console.error('assistant fallback stream succeeded for thread:', threadId);
      }
    }

    // Last resort: a non-streaming completion on the fallback key. No animation, but a
    // real reply beats the generic fallback text.
    if (!reply.trim() && fallbackAvailable(env)) {
      try {
        const completion = await chat(
          env,
          replyRequest(env, systemPrompt, stored.turns, text, decision, {
            model: env.CASTING_MODEL,
            apiKey: env.NVIDIA_API_KEY,
          }),
        );
        const content = completion?.choices?.[0]?.message?.content ?? '';
        if (content.trim()) {
          reply = content;
          await emit('delta', { content: reply });
        }
      } catch (err) {
        console.error('assistant fallback chat failed:', err?.message ?? err, { threadId });
      }
    }

    if (!reply.trim()) {
      reply = "Sorry, I'm having trouble with that right now — could you try again in a moment?";
      await emit('delta', { content: reply });
      console.error('assistant emitted generic fallback for thread:', threadId);
    }

    stored.turns = [
      ...stored.turns,
      { role: 'user', content: text, ts: now },
      { role: 'assistant', content: reply, ts: Date.now() },
    ].slice(-MAX_TRANSCRIPT_TURNS * 2);

    // Adam's own privacy floor from the brainstorm: this transcript is scoped to one
    // thread's own continuity, never aggregated across visitors — a bounded TTL keeps it
    // that way rather than accumulating indefinitely.
    await saveStored(env, threadId, stored);

    await emit('result', {
      reply,
      connection: state.connectionStatus,
      mindName: state.mindName,
      mindStatus,
      lastActivityAgeMs,
      queueDepth,
      livenessState,
      budget: state.budget,
      activated: state.activated,
    });
  });
}

/** The stored transcript for a thread, so a visitor's history survives navigating away
 * and back — closing the modal, or switching to the canvas Producer panel, previously
 * lost it because each mount started from empty local state. No auth beyond knowing
 * the threadId itself, matching handleAssistantMessage's own trust model. */
export async function handleAssistantHistory(request, env) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get('threadId');
  if (!isValidThreadId(threadId)) return json({ error: 'invalid_thread_id' }, 400);

  const stored = await loadStored(env, threadId);
  return json({ messages: stored.turns });
}

export async function handleAssistantStatus(request, env) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId');
  const threadId = searchParams.get('threadId');

  let state;
  try {
    state = await resolveState(request, env, connectionId);
  } catch (err) {
    if (err.message === 'not_configured') return json({ error: 'not_configured' }, 500);
    throw err;
  }

  if (!state.hasMindAccess) {
    return json({ connection: state.connectionStatus, mindName: state.mindName });
  }

  // The client already polls this endpoint every 6s while a surface is mounted — the
  // one place a Worker (no background timer) can reliably notice "10 minutes of
  // silence" without a Cron Trigger. See IDLE_RELAY_MS's own comment.
  if (isValidThreadId(threadId)) {
    const stored = await loadStored(env, threadId);
    await relayIfIdle(env, state.mindId, stored, threadId);
  }

  const history = await fetchMindActivity(env, state.mindId, { limit: 20 });
  const { mindStatus, lastActivityAgeMs } = deriveMindStatus(history);
  const queueDepth = deriveQueueDepth(history);
  const livenessState = deriveLivenessState(history);
  return json({
    connection: state.connectionStatus,
    mindName: state.mindName,
    mindStatus,
    lastActivityAgeMs,
    queueDepth,
    livenessState,
    budget: state.budget,
    activated: state.activated,
  });
}
