// The browser's guestId: a random UUID in localStorage — the same one useMindConnect.js has
// always kept for guest checkout. Sent raw only as `x-guest-id` and to the analytics beacon; the
// Worker HMACs it before storing anything. Created on first use rather than waiting for
// useMindConnect's effect, so the very first request of a first visit is already attributable.
//
// Its own module with no imports, because both mindConnect.js and visitor.js need it and
// visitor.js already imports mindConnect.js.

const KEY = 'guestId';

const uuid = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const getGuestId = () => {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
};
