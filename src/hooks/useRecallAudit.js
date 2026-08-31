import { useCallback, useEffect, useRef, useState } from 'react';

import { mindChatPoll, mindChatSend } from '../services/mindConnect';
import { messageToText } from '../lib/text';
import { SEEN_ACK_PREFIX } from '../lib/mail';
import { auditRecall, RECALL_SUBJECT, recallRequest } from '../lib/recallAudit';

/**
 * Ask the connected Mind what it remembers producing, wait for its answer, and check it.
 *
 * Polls for the reply itself rather than leaning on the Inbox: a Mind answers in its own time
 * (a minute is normal, longer is not unusual), and the thing this exists to show — the Mind
 * recalling its filmography from its own memory — should land on the panel that holds the
 * footage, not somewhere the visitor has to go looking.
 */
const POLL_EVERY_MS = 5_000;
const GIVE_UP_AFTER_MS = 15 * 60_000;

export function useRecallAudit({ token, films }) {
  const [status, setStatus] = useState('idle'); // idle | asking | waiting | done | timeout | error
  const [askedAt, setAskedAt] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const filmsRef = useRef(films);
  const cancelRef = useRef(null);

  useEffect(() => {
    filmsRef.current = films;
  }, [films]);

  useEffect(() => () => cancelRef.current?.(), []);

  const ask = useCallback(async () => {
    if (!token || status === 'asking' || status === 'waiting') return;
    cancelRef.current?.();
    setError(null);
    setResult(null);
    setStatus('asking');

    let before;
    try {
      ({ before } = await mindChatSend(token, recallRequest(), { subject: RECALL_SUBJECT }));
    } catch (failure) {
      setError(failure.message);
      setStatus('error');
      return;
    }

    const startedAt = Date.now();
    setAskedAt(startedAt);
    setStatus('waiting');

    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };

    while (!cancelled && Date.now() - startedAt < GIVE_UP_AFTER_MS) {
      await new Promise((done) => setTimeout(done, POLL_EVERY_MS));
      if (cancelled) return;
      let history = [];
      try {
        ({ history = [] } = await mindChatPoll(token, before));
      } catch {
        continue;
      }
      // The Mind's first substantive word after our question. A `[seen]` receipt is the Mind
      // saying it is working, which is worth showing but is not the answer.
      const reply = history
        .filter((row) => row.senderType !== 1)
        .filter((row) => new Date(row.createdAt).getTime() >= before - 2000)
        .map((row) => ({ ...row, text: messageToText(row.messageText) }))
        .find((row) => !SEEN_ACK_PREFIX.test(row.text) && row.text.length > 0);
      if (reply) {
        setResult({ reply, audit: auditRecall(reply.messageText, filmsRef.current ?? []) });
        setStatus('done');
        return;
      }
    }
    if (!cancelled) setStatus('timeout');
  }, [status, token]);

  const reset = useCallback(() => {
    cancelRef.current?.();
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  return { status, askedAt, result, error, ask, reset };
}
