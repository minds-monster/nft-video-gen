import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectInit,
  connectStatus,
  getStoredSession,
  storeSession,
  clearSession,
} from '../services/mindConnect';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Connect-flow state, kept separate from the chat itself (useMindChat) — this owns
// "do we have a session," the chat hook owns "what does that session let us say."
export const useMindConnect = () => {
  const [session, setSession] = useState(() => getStoredSession());
  const [state, setState] = useState('idle'); // idle | pending | denied | expired | error
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const connect = useCallback(async (mindId) => {
    clearTimeout(timeoutRef.current);
    setState('pending');
    setError(null);

    try {
      const { connectionId } = await connectInit(mindId);
      const startedAt = Date.now();

      const poll = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          setState('expired');
          return;
        }
        try {
          const result = await connectStatus(connectionId);
          if (result.status === 'approved') {
            const newSession = { token: result.sessionToken, mindId: result.mindId, expiresAt: result.expiresAt };
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
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    if (state === 'pending') return; // let a pending attempt keep polling in the background
    setState('idle');
  }, [state]);

  return { session, state, error, connect, disconnect, isModalOpen, openModal, closeModal };
};
