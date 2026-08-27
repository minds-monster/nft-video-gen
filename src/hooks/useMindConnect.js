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

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

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

  // Initialize guest ID on mount
  useEffect(() => {
    if (!localStorage.getItem('guestId')) {
      localStorage.setItem('guestId', generateUUID());
    }
  }, []);

  const checkout = useCallback(async (amount = 1) => {
    const guestId = localStorage.getItem('guestId') || generateUUID();
    if (!localStorage.getItem('guestId')) {
      localStorage.setItem('guestId', guestId);
    }

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { 'Authorization': `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({ guestId, amount }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to start checkout. Please try again.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Failed to connect to checkout service.');
    }
  }, [session]);

  // Claim guest budget once Mind connects
  useEffect(() => {
    if (!session?.token) return;
    const guestId = localStorage.getItem('guestId');
    if (!guestId) return;

    const claim = async () => {
      try {
        const response = await fetch('/api/producer/claim-guest-budget', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.token}`,
          },
          body: JSON.stringify({ guestId }),
        });
        const data = await response.json();
        if (data.claimed) {
          console.log(`Successfully claimed guest budget of $${data.budget?.total}`);
          localStorage.setItem('guestId', generateUUID()); // Reset for future actions
        }
      } catch (err) {
        console.error('Failed to claim guest budget:', err);
      }
    };
    claim();
  }, [session?.token]);

  return { session, state, error, pending, connect, disconnect, isModalOpen, openModal, closeModal, checkout };
};
