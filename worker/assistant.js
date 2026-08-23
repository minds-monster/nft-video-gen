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
import { ensureProducerReady, fetchMindActivity, relayToMind, deriveMindStatus, requireSession } from './mind-chat.js';
import { buildAssistantSystemPrompt } from './assistant-brief.js';
import { messageToText } from '../src/lib/text.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TRANSCRIPT_TURNS = 40; // user+assistant pairs kept, oldest dropped first
const TRANSCRIPT_TTL_SECONDS = 24 * 60 * 60;

// Separate from mindChatSend's own limiter in mind-chat.js — this endpoint calls
// relayToMind directly rather than going through that route, so it needs its own guard
// against a visitor using the assistant to flood the real Mind.
const RELAY_MIN_INTERVAL_MS = 3_000;
const lastRelayAt = new Map();

// Guards the LLM calls themselves, keyed by threadId — generous, since this is normal
// chat pacing rather than the connect/send limits that protect a real Mind's attention.
const MESSAGE_MIN_INTERVAL_MS = 1_000;
const lastMessageAt = new Map();

function isValidThreadId(id) {
  return typeof id === 'string' && isValidConnectionId(id);
}

const kvKey = (threadId) => `assistant:${threadId}`;

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
    return { connectionStatus: 'approved', mindId: session.mindId, mindName, hasMindAccess: true };
  }

  if (connectionId && isValidConnectionId(connectionId)) {
    const result = await reconstructConnectStatus(env, connectionId);
    return {
      connectionStatus: result.status,
      mindId: null,
      mindName: result.mindName ?? null,
      hasMindAccess: false,
    };
  }

  return { connectionStatus: 'idle', mindId: null, mindName: null, hasMindAccess: false };
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
        'True only if the visitor gave a clear, actionable message meant FOR the connected ' +
        'Mind specifically — a direction, an answer, an instruction. False for anything ' +
        'about the site itself, small talk, or a question you can just answer yourself.',
    },
    messageForMind: {
      type: 'string',
      description:
        'If relayToMind is true, the message to relay to the Mind, verbatim — the visitor\'s ' +
        'own words, not your rewrite. Empty string otherwise.',
    },
  },
  required: ['relayToMind', 'messageForMind'],
};

/** The fast, invisible, forced call — decides whether to relay, nothing else. */
async function decideRelay(env, systemPrompt, transcript, userText) {
  try {
    return jsonFrom(
      await chat(env, {
        model: env.ASSISTANT_MODEL,
        // This model lives on its own key within the NIM account, separate from
        // env.NVIDIA_API_KEY — confirmed empirically (the shared key 404s for it).
        apiKey: env.ASSISTANT_API_KEY,
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
      }),
    );
  } catch {
    return { relayToMind: false, messageForMind: '' };
  }
}

/** The second, streamed, tool-free call — the actual reply text the visitor watches arrive. */
function replyRequest(env, systemPrompt, transcript, userText, decision) {
  const decisionNote = decision.relayToMind
    ? `\n\nYou already decided to relay this to the Mind, verbatim: "${decision.messageForMind}". Tell the visitor that naturally, in your own voice — say you're passing it along now.`
    : "\n\nYou already decided this doesn't need to go to the Mind. Answer the visitor directly and naturally using the current state above.";

  return {
    model: env.ASSISTANT_MODEL,
    apiKey: env.ASSISTANT_API_KEY,
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

    let mindStatus = null;
    let lastActivityAgeMs = null;
    let recentActivityText = null;
    if (state.hasMindAccess) {
      const history = await fetchMindActivity(env, state.mindId, { limit: 20 });
      ({ mindStatus, lastActivityAgeMs } = deriveMindStatus(history));
      recentActivityText = formatRecentActivity(history);
    }

    const systemPrompt = buildAssistantSystemPrompt({
      connectionStatus: state.connectionStatus,
      mindName: state.mindName,
      mindStatus,
      lastActivityAgeMs,
      recentActivityText,
    });

    const stored = (await env.MIND_CONNECTIONS.get(kvKey(threadId), 'json')) ?? [];

    await emit('phase', { phase: 'deciding' });
    const decision = await decideRelay(env, systemPrompt, stored, text);

    if (decision.relayToMind && state.hasMindAccess && decision.messageForMind?.trim()) {
      const relayNow = Date.now();
      const lastRelay = lastRelayAt.get(state.mindId) ?? 0;
      if (relayNow - lastRelay >= RELAY_MIN_INTERVAL_MS) {
        lastRelayAt.set(state.mindId, relayNow);
        await relayToMind(env, state.mindId, decision.messageForMind.trim());
      } else {
        // Told the truth about it below rather than claiming a handoff that didn't happen.
        decision.relayToMind = false;
      }
    }

    await emit('phase', { phase: 'responding' });

    let reply = '';
    try {
      await streamChat(env, replyRequest(env, systemPrompt, stored, text, decision), (delta) => {
        if (delta.content) {
          reply += delta.content;
          emit('delta', { content: delta.content }).catch(() => {});
        }
      });
    } catch {
      // Fall through — reply may be partially filled from before the failure, or empty.
    }
    if (!reply.trim()) {
      reply = "Sorry, I'm having trouble with that right now — could you try again in a moment?";
      await emit('delta', { content: reply });
    }

    const updated = [
      ...stored,
      { role: 'user', content: text, ts: now },
      { role: 'assistant', content: reply, ts: Date.now() },
    ].slice(-MAX_TRANSCRIPT_TURNS * 2);

    // Adam's own privacy floor from the brainstorm: this transcript is scoped to one
    // thread's own continuity, never aggregated across visitors — a bounded TTL keeps it
    // that way rather than accumulating indefinitely.
    await env.MIND_CONNECTIONS.put(kvKey(threadId), JSON.stringify(updated), {
      expirationTtl: TRANSCRIPT_TTL_SECONDS,
    });

    await emit('result', {
      reply,
      connection: state.connectionStatus,
      mindName: state.mindName,
      mindStatus,
      lastActivityAgeMs,
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

  const stored = (await env.MIND_CONNECTIONS.get(kvKey(threadId), 'json')) ?? [];
  return json({ messages: stored });
}

export async function handleAssistantStatus(request, env) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get('connectionId');

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

  const history = await fetchMindActivity(env, state.mindId, { limit: 20 });
  const { mindStatus, lastActivityAgeMs } = deriveMindStatus(history);
  return json({ connection: state.connectionStatus, mindName: state.mindName, mindStatus, lastActivityAgeMs });
}
