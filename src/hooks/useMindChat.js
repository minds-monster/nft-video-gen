import { useCallback, useEffect, useRef, useState } from 'react';
import { mindChatInit, mindChatSend, mindChatPoll, putProductionState } from '../services/mindConnect';
import { getProductionState, subscribeProductionState } from '../lib/productionState';

// /histories returns newest-first, but a chat thread reads oldest-first — without
// this the conversation renders backwards, with each reply above its question.
const chronological = (history) =>
  [...(history ?? [])].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));

// Minds can be very slow to reply, especially when a human steward has to notice and
// act. The UI waits this long before showing its own timeout message; the chat keeps
// polling in the background, so a reply that lands later still appears.
const REPLY_TIMEOUT_MS = 15 * 60 * 1000;
const BACKGROUND_POLL_MS = 5 * 1000;
const PRODUCTION_STATE_DEBOUNCE_MS = 4 * 1000;

async function pollForReply(token, after, timeoutMs = REPLY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const { history } = await mindChatPoll(token, after);
    const reply = (history ?? []).find((row) => row.senderType !== 1);
    if (reply) return reply;
  }
  return null;
}

// Session-gated: with no active Connect Mind session there's nothing to chat with, so
// this resolves to an idle, empty state rather than erroring — ProducerPanel/
// StudioOverlay decide what to show for "not connected."
export const useMindChat = (session) => {
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState(null);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!session) {
      setMessages([]);
      setError(null);
      setIsInitializing(false);
      return;
    }

    let active = true;
    setIsInitializing(true);
    // The snapshot goes up WITH the init call — the Worker builds the Producer briefing
    // during that request, so anything sent afterwards is too late for the greeting.
    mindChatInit(session.token, getProductionState()).then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else setMessages(chronological(res.history));
      setIsInitializing(false);
    });

    return () => {
      active = false;
    };
  }, [session]);

  // Background poll so a Mind reply that lands after the initial wait window still
  // appears without the visitor having to send another message. Deduplicates by
  // fingerprint so it never doubles up with the send-time poll.
  useEffect(() => {
    if (!session || isInitializing) return;
    let active = true;
    const knownFingerprints = new Set(messagesRef.current.map((m) => m.fingerprint).filter(Boolean));

    const tick = async () => {
      if (!active) return;
      try {
        const current = messagesRef.current;
        const after = current.length ? new Date(current[current.length - 1].createdAt).getTime() : 0;
        const { history } = await mindChatPoll(session.token, after);
        const newRows = (history ?? []).filter(
          (row) => row.senderType !== 1 && row.fingerprint && !knownFingerprints.has(row.fingerprint),
        );
        if (newRows.length > 0) {
          newRows.forEach((row) => knownFingerprints.add(row.fingerprint));
          // Dedupe against the live `prev`, not just this closure's knownFingerprints —
          // StrictMode's double-effect-invoke (or any overlapping tick) can otherwise
          // race two ticks into both deciding the same row is new, since each computed
          // newRows from its own snapshot before either had applied its update.
          setMessages((prev) => {
            const prevFingerprints = new Set(prev.map((m) => m.fingerprint).filter(Boolean));
            const deduped = newRows.filter((row) => !prevFingerprints.has(row.fingerprint));
            return deduped.length ? chronological([...prev, ...deduped]) : prev;
          });
        }
      } catch {
        // Ignore background poll errors; the next tick will retry.
      }
    };

    const id = setInterval(tick, BACKGROUND_POLL_MS);
    tick();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [session, isInitializing]);

  // Keep the Worker's copy current after the briefing, so the Mind's later replies (and
  // the assistant's system prompt) see the cast and screenplay as they actually are now,
  // not as they were at connect time. Debounced because the snapshot changes on every
  // asset added and every prompt edit.
  useEffect(() => {
    if (!session) return undefined;
    let timer = null;
    const push = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        putProductionState(session.token, getProductionState()).catch(() => {
          // Best-effort: a stale snapshot degrades the Producer's context, it never breaks
          // the conversation, and the next change retries anyway.
        });
      }, PRODUCTION_STATE_DEBOUNCE_MS);
    };
    const unsubscribe = subscribeProductionState(push);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [session]);

  const send = useCallback(
    async (text, { subject = '', isReply = false } = {}) => {
      const userText = text?.trim();
      if (!userText || isSending || !session) return;

      // The optimistic row carries the subject so it threads correctly the instant it is
      // painted, rather than sitting untitled until the server round-trip returns.
      const localId = `local-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          fingerprint: localId,
          senderType: 1,
          messageText: subject ? `Subject: ${isReply ? 'RE: ' : ''}${subject}\n\n${userText}` : userText,
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsSending(true);

      try {
        const { before, messageText } = await mindChatSend(session.token, userText, { subject, isReply });
        // Replace the optimistic row with exactly what went on the wire — otherwise a
        // generated subject shows differently to the visitor than it does to the Mind.
        if (messageText) {
          setMessages((prev) => prev.map((m) => (m.fingerprint === localId ? { ...m, messageText } : m)));
        }
        const reply = await pollForReply(session.token, before);
        if (reply) {
          setMessages((prev) => [...prev, reply]);
        } else {
          setMessages((prev) => [
            ...prev,
            // createdAt is required, not cosmetic: buildThreads sorts on it, and a row
            // without one sorted to epoch zero and surfaced at the wrong end of the inbox.
            { fingerprint: `timeout-${Date.now()}`, senderType: 0, messageText: 'Request timed out while waiting for a reply.', createdAt: new Date().toISOString(), isError: true },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { fingerprint: `err-${Date.now()}`, senderType: 0, messageText: 'Failed to send message: ' + err.message, createdAt: new Date().toISOString(), isError: true },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, session],
  );

  return { messages, isSending, isInitializing, error, send };
};
