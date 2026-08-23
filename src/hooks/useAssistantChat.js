import { useCallback, useEffect, useRef, useState } from 'react';
import { assistantMessageStream, assistantHistory, getOrCreateThreadId } from '../services/assistantChat';

const fromStored = (turn) => ({
  fingerprint: `hist-${turn.ts}-${turn.role}`,
  senderType: turn.role === 'user' ? 1 : 0,
  messageText: turn.content,
  createdAt: new Date(turn.ts).toISOString(),
});

/**
 * The visitor's conversation with the assistant — always available, regardless of
 * whether a Mind is connected yet. `connectionId`/`token` change as the connect flow
 * progresses (pending → approved); pass the current values on every render rather than
 * capturing them once, since the assistant's own state resolution depends on them.
 *
 * Hydrates from the server on mount so the conversation survives navigating away and
 * back (closing the modal, switching to the canvas panel) — those are separate mounts
 * of this hook, but the same threadId, and the transcript lives server-side in KV.
 */
export const useAssistantChat = ({ connectionId, token } = {}) => {
  const [threadId] = useState(getOrCreateThreadId);
  const [messages, setMessages] = useState([]);
  const [phase, setPhase] = useState(null); // 'deciding' | 'responding' | null
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let active = true;
    assistantHistory(threadId).then(({ messages: stored }) => {
      if (active && stored?.length) setMessages(stored.map(fromStored));
    });
    return () => {
      active = false;
    };
  }, [threadId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text) => {
      const userText = text?.trim();
      if (!userText || isSending) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        {
          fingerprint: `local-${Date.now()}`,
          senderType: 1,
          messageText: userText,
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsSending(true);
      setError(null);
      setPhase('deciding');

      const replyFingerprint = `assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { fingerprint: replyFingerprint, senderType: 0, messageText: '', createdAt: new Date().toISOString(), streaming: true },
      ]);

      const appendDelta = (chunk) => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.fingerprint === replyFingerprint ? { ...msg, messageText: msg.messageText + chunk } : msg,
          ),
        );
      };

      try {
        await assistantMessageStream(
          { threadId, text: userText, connectionId, token },
          {
            signal: controller.signal,
            onEvent: (type, data) => {
              if (type === 'phase') setPhase(data.phase);
              else if (type === 'delta' && data.content) appendDelta(data.content);
            },
          },
        );
        setMessages((prev) =>
          prev.map((msg) => (msg.fingerprint === replyFingerprint ? { ...msg, streaming: false } : msg)),
        );
      } catch (err) {
        if (err.name === 'AbortError') return;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.fingerprint === replyFingerprint
              ? { ...msg, messageText: 'Something went wrong: ' + err.message, isError: true, streaming: false }
              : msg,
          ),
        );
        setError(err.message);
      } finally {
        setIsSending(false);
        setPhase(null);
      }
    },
    [isSending, threadId, connectionId, token],
  );

  return { threadId, messages, phase, isSending, error, send };
};
