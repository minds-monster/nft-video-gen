import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectInit,
  connectStatus,
  getStoredSession,
  storeSession,
  clearSession,
} from '../services/mindConnect';

const POLL_INTERVAL_MS = 2_000;
// Matches worker/connect.js's INIT_TTL_SECONDS — a brand-new Mind's first-ever connect
// needs a human to notice, get oriented, and reply, which this session has repeatedly
// seen take well over five minutes. No point polling past the point the backend record
// itself expires, so these two numbers have to move together.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

// Connect-flow state, kept separate from the chat itself (useMindChat) — this owns
// "do we have a session," the chat hook owns "what does that session let us say."
export const useMindConnect = () => {
  const [session, setSession] = useState(() => getStoredSession());
  const [state, setState] = useState('idle'); // idle | pending | denied | expired | error
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Populated once connect() has a response — connectionId/message/mindName let the
  // modal show a concrete "copy approval reply" action instead of just a spinner.
  const [pending, setPending] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const connect = useCallback(async (mindId) => {
    clearTimeout(timeoutRef.current);
    setState('pending');
    setError(null);
    setPending(null);

    try {
      const { connectionId, message, mindName } = await connectInit(mindId);
      setPending({ connectionId, message, mindName });
      const startedAt = Date.now();

      const poll = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setState('expired');
          return;
        }
        try {
          const result = await connectStatus(connectionId);
          if (result.status === 'approved') {
            const newSession = {
              token: result.sessionToken,
              mindId: result.mindId,
              mindName: result.mindName ?? mindName ?? null,
              expiresAt: result.expiresAt,
            };
            storeSession(newSession);
            setSession(newSession);
            setState('approved');
            return;
          }
          if (result.status === 'denied') {
            setState('denied');
            return;
          }
          if (result.status === 'expired') {
            setState('expired');
            return;
          }
        } catch (err) {
          setError(err.message);
          setState('error');
          return;
        }
        timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      };

      poll();
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearSession();
    setSession(null);
    setState('idle');
    setError(null);
    setPending(null);
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    if (state === 'pending') return; // let a pending attempt keep polling in the background
    setState('idle');
  }, [state]);

  return { session, state, error, pending, connect, disconnect, isModalOpen, openModal, closeModal };
};
