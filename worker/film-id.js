// A stable identity for one film, derived from the film itself.
//
// WHY THIS EXISTS. Storyboards used to live at `storyboard:<mindId>` — ONE slot per Mind, for
// every film that Mind ever produced. That was harmless while nothing read them back, and became
// two bugs the moment something did (2026-08-25, reported by a visitor):
//
//   1. Connecting a Mind in a tab working on film B displayed film A's storyboard, because there
//      was only ever one storyboard to fetch.
//   2. Worse and quieter: generating a storyboard for film B **overwrote film A's**, permanently.
//      A visitor working on two films kept exactly one, and was never told.
//
// The id is a hash of the film's own text rather than a generated token, so it needs no client
// bookkeeping and survives reloads, new tabs and reconnects: the same logline and beats always
// resolve to the same storyboard, and a different film always resolves to a different one.
//
// Deliberately NOT cryptographic. This is a storage slot key, not a security boundary — every
// read is already scoped to the caller's own mindId, so a collision would at worst show a visitor
// their own other film. FNV-1a is sync, dependency-free, and identical in workerd and the browser,
// which matters because both sides compute it.

/** FNV-1a, 32-bit, as 8 hex characters. */
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The classic 16777619 multiply, expressed as shifts and kept unsigned at every step: a plain
    // multiply at this width silently loses precision in a JS number.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * The film's identity: its logline and its beats, in order.
 *
 * Cast is deliberately excluded. Re-casting a film — swapping which NFT plays the hero — is
 * editing the same film, not starting a new one, and it should land back on the same storyboard
 * rather than silently starting a second one beside it.
 */
export const filmIdFor = (spec) => {
  if (!spec) return 'unknown';
  const beats = Array.isArray(spec.beats) ? spec.beats : [];
  return fnv1a([spec.logline ?? '', ...beats].join(' '));
};
