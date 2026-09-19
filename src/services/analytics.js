// The browser half of worker/analytics.js: a handful of named events, sent with
// `sendBeacon` so they never delay navigation and never need a response. The guestId is the
// same localStorage UUID useMindConnect.js already keeps; the Worker HMACs it before storing
// anything, so what leaves this file is the only place it exists raw. The hash is stable, so a
// returning visitor is recognisable across days (worker/analytics.js explains why).

import { getGuestId } from './guest.js';

const ENDPOINT = '/api/analytics/event';

export const track = (name, props = {}) => {
  try {
    const payload = JSON.stringify({ name, page: window.location.hash || '/', guestId: getGuestId(), ...props });
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Analytics is never allowed to be the reason something else failed.
  }
};
