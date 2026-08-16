import { useCallback, useEffect, useState } from 'react';
import { initializeChat, sendChatMessage } from '../services/mind';

// Memoised so StrictMode's double-invoked effect (and any remount) reuses the same
// initialisation instead of fetching history twice — or, worse, having the first
// run's cleanup cancel the only request in flight.
let initPromise = null;
const initOnce = () => {
  initPromise ??= initializeChat();
  return initPromise;
};

// /histories returns newest-first, but a chat thread reads oldest-first — without
// this the conversation renders backwards, with each reply above its question.
const chronological = (history) =>
  [...(history ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );

// The Minds conversation is a single global thread (alias "main" in mind.js), so
// this hook is initialised once and shared through MindChatProvider rather than
// being called per component — otherwise every mount re-fetches history.
export const useMindChat = () => {
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;

    initOnce().then((res) => {
      if (!active) return;
      if (res.error) setError(res.error);
      else if (res.history) setMessages(chronological(res.history));
      setIsInitializing(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const send = useCallback(
    async (text) => {
      const userText = text?.trim();
      if (!userText || isSending) return;

      // Optimistically add user message
      setMessages((prev) => [
        ...prev,
        {
          fingerprint: `local-${Date.now()}`,
          senderType: 1, // 1 = human
          messageText: userText,
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsSending(true);

      const reply = await sendChatMessage(userText);
      if (reply) setMessages((prev) => [...prev, reply]);
      setIsSending(false);
      return reply;
    },
    [isSending],
  );

  return { messages, isSending, isInitializing, error, send };
};
