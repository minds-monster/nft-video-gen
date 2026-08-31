// A snapshot of how far the visitor has actually got, published for the Producer briefing.
//
// WHY A MODULE-LEVEL REGISTRY AND NOT CONTEXT. The three things that describe a visitor's
// progress — the prompt, the cast, and the screenplay — are React state owned in App.jsx
// (useCanvasComposer, useScreenwriter) and are never persisted server-side; a screenplay
// that has not been sent to the Storyboarder leaves no trace on the Worker at all. But the
// hook that needs to send them, useMindChat, lives INSIDE MindChatProvider, which wraps the
// components that own them. Threading one payload up through that tree would mean
// restructuring the provider for a single object, so the snapshot is published to a tiny
// registry instead and read at the moment of use.
//
// Kept deliberately small and derived: this is a description of visible work, not a mirror
// of app state. It is also read by someone else's Mind, so it carries counts and names,
// never anything a visitor would be surprised to see quoted back at them.

let snapshot = {
  hasPrompt: false,
  castCount: 0,
  castNames: [],
  primaryName: null,
  screenplayStage: 'compose',
  beatCount: 0,
  logline: null,
  timezone: null,
};

const listeners = new Set();

/** Read the current snapshot. Always returns an object, never null. */
export const getProductionState = () => snapshot;

/**
 * Publish a new snapshot. No-ops when nothing meaningful changed, so the debounced POST
 * this drives doesn't fire on every keystroke in the prompt box.
 */
export function setProductionState(next) {
  const merged = {
    ...snapshot,
    ...next,
    timezone: next?.timezone ?? snapshot.timezone ?? resolveTimezone(),
  };
  if (JSON.stringify(merged) === JSON.stringify(snapshot)) return snapshot;
  snapshot = merged;
  listeners.forEach((fn) => fn(snapshot));
  return snapshot;
}

export function subscribeProductionState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Adam asked for the visitor's timezone so his timestamps and his sense of "how long have
// they been waiting" are in their frame rather than his. Best-effort — an environment that
// won't tell us simply omits the field.
function resolveTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
