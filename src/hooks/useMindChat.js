import { useCallback, useEffect, useState } from 'react';
import { mindChatInit, mindChatSend, mindChatPoll } from '../services/mindConnect';

// /histories returns newest-first, but a chat thread reads oldest-first — without
// this the conversation renders backwards, with each reply above its question.
const chronological = (history) =>
  [...(history ?? [])].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));

async function pollForReply(token, after, timeoutMs = 120_000) {
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

  useEffect(() => {
    if (!session) {
      setMessages([]);
      setError(null);
      setIsInitializing(false);
      return;
    }

    let active = true;
    setIsInitializing(true);
    mindChatInit(session.token).then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else setMessages(chronological(res.history));
      setIsInitializing(false);
    });

    return () => {
      active = false;
    };
  }, [session?.token]);

  const send = useCallback(
    async (text) => {
      const userText = text?.trim();
      if (!userText || isSending || !session) return;

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

      try {
        const { before } = await mindChatSend(session.token, userText);
        const reply = await pollForReply(session.token, before);
        if (reply) {
          setMessages((prev) => [...prev, reply]);
        } else {
          setMessages((prev) => [
            ...prev,
            { fingerprint: `timeout-${Date.now()}`, senderType: 0, messageText: 'Request timed out while waiting for a reply.', isError: true },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { fingerprint: `err-${Date.now()}`, senderType: 0, messageText: 'Failed to send message: ' + err.message, isError: true },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, session],
  );

  return { messages, isSending, isInitializing, error, send };
};
