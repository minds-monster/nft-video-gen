// The one query string this site ever lands on: Stripe's `?checkout=success|cancel`
// (worker/stripe.js). Routing here is hash-only (src/hooks/useHashRoute.js), so the query is
// read once, on load, and removed from the address bar so a reload or a shared link does not
// replay the notice.

/** `'success' | 'cancel' | null`, and the query is gone from the URL by the time it returns. */
export function consumeCheckoutReturn() {
  if (typeof window === 'undefined') return null;
  try {
    const outcome = new URLSearchParams(window.location.search).get('checkout');
    if (outcome !== 'success' && outcome !== 'cancel') return null;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return outcome;
  } catch {
    return null;
  }
}
