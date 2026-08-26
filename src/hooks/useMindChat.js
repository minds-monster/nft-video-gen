import { useCallback, useEffect, useRef, useState } from 'react';
import { mindChatInit, mindChatSend, putProductionState } from '../services/mindConnect';
import { getProductionState, subscribeProductionState } from '../lib/productionState';

// /histories returns newest-first, but a chat thread reads oldest-first — without
// this the conversation renders backwards, with each reply above its question.
const chronological = (history) =>
  [...(history ?? [])].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));

const PRODUCTION_STATE_DEBOUNCE_MS = 4 * 1000;

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
        const { messageText } = await mindChatSend(session.token, userText, { subject, isReply });
        // Replace the optimistic row with exactly what went on the wire — otherwise a
        // generated subject shows differently to the visitor than it does to the Mind.
        if (messageText) {
          setMessages((prev) => prev.map((m) => (m.fingerprint === localId ? { ...m, messageText } : m)));
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
