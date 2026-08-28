// The visitor's draft — prompt, cast, screenplay — kept somewhere a page load cannot lose it.
//
// WHY THIS EXISTS. Everything that describes a film before the Director shoots it was React state
// and nothing else: the prompt and cast in useCanvasComposer, the screenplay and its dossiers in
// useScreenwriter. worker/director-job.js says so outright — "the spec is pure client state —
// nothing server-side stores it." That held until the one flow that MUST leave the page: a visitor
// who had already run the Screenwriter hit the Director's budget gate, clicked "Add & Pay", paid
// at Stripe, and came back to an empty canvas (2026-08-27). Stripe returns to a fresh document;
// there was nowhere for the work to come back from.
//
// So the draft is written here, debounced, on every meaningful change, and flushed synchronously
// the instant before the browser navigates away. A returning tab reads it back before anything
// else runs. The server keeps its own copy for connected Minds (worker/draft.js); this module is
// the one that works for everyone, including a visitor who has never connected anything.
//
// WHAT IS KEPT, AND WHAT IS NOT. A raw Alchemy NFT object runs to tens of KB and most of it is
// never read. `forCastingWire` in src/services/swarm.js already names the subset every consumer
// actually reads — the cast tiles, the treatment's <Subject N> chips, the Casting Director, and
// the Storyboarder's wire shape — so the draft keeps exactly that. Dossiers are kept because they
// are the expensive half of a run and they are what lets `rewrite` work without a network call;
// they are also the first thing dropped when the draft would not fit, because the Worker caches
// them permanently by asset key and the next launch gets them back for free.
//
// Module-level registry, like src/lib/productionState.js: the hooks that own the state live in
// App.jsx, the checkout that needs to flush it lives inside MindChatProvider, and threading one
// object through that tree for a single flush is not worth restructuring the provider.

import { forCastingWire } from '../services/swarm.js';
import { filmIdFor } from '../../worker/film-id.js';

export const DRAFT_VERSION = 1;
export const DRAFT_KEY = 'canvas-draft';

// Long enough to coalesce a burst of keystrokes in the prompt box, short enough that a tab closed
// a second after the last edit has still been written.
const WRITE_DEBOUNCE_MS = 800;

// localStorage quotas start at 5MB; this leaves room for everything else the site keeps there.
// The cap is what `serializeDraft` trims to, never a reason to refuse a write outright.
export const MAX_BYTES = 1_500_000;

/** The subset of an NFT the whole app reads. Same shape the Casting Director is sent. */
export const slimNft = (key, nft) => forCastingWire({ key, nft }).nft;

/**
 * A collection descriptor minus the one thing that makes it large: `brand.collections`, which
 * LIVE_COLLECTIONS attaches to every entry and which nothing downstream of a cast reads.
 */
export const slimCollection = (collection) => {
  if (!collection || typeof collection !== 'object') return null;
  const { brand, ...rest } = collection;
  const slim = {};
  for (const [field, value] of Object.entries(rest)) {
    if (value == null || typeof value !== 'object') slim[field] = value;
  }
  slim.brand = brand
    ? { slug: brand.slug ?? null, name: brand.name ?? null, sector: brand.sector ?? null, accent: brand.accent ?? null }
    : null;
  return slim;
};

/**
 * Build a snapshot from live hook state. Pure. Null when there is nothing worth keeping — an
 * empty prompt and an empty cast is the state a fresh visitor already has.
 */
export function buildDraft({ prompt = '', cast = [], primaryKey = null, stage = 'compose', spec = null, writtenCast = null, caps = null } = {}) {
  const text = typeof prompt === 'string' ? prompt : '';
  const entries = Array.isArray(cast) ? cast : [];
  const hasSpec = Boolean(spec?.beats?.length);
  if (!text.trim() && !entries.length && !hasSpec) return null;

  return {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    filmId: hasSpec ? filmIdFor(spec) : null,
    prompt: text,
    primaryKey: primaryKey ?? null,
    cast: entries.map((entry) => ({
      key: entry.key,
      origin: entry.origin ?? 'curated',
      isMock: Boolean(entry.isMock),
      nft: slimNft(entry.key, entry.nft),
      collection: slimCollection(entry.collection),
    })),
    // A run in flight cannot be resumed from a snapshot, so it is saved as the state it will fall
    // back to. `treatment` is only meaningful with a spec to show.
    stage: hasSpec && stage === 'treatment' ? 'treatment' : 'compose',
    spec: hasSpec ? spec : null,
    caps: caps?.maxBeats ? { maxBeats: caps.maxBeats, maxReferences: caps.maxReferences } : null,
    // The nft/collection the treatment needs are re-joined from `cast` by key on restore — no
    // reason to store the same artwork twice.
    writtenCast: Array.isArray(writtenCast) && writtenCast.length
      ? writtenCast.map(({ key, dossier, name, collectionName }) => ({ key, dossier: dossier ?? null, name: name ?? null, collectionName: collectionName ?? '' }))
      : null,
  };
}

export const isEmptyDraft = (draft) =>
  !draft || (!draft.prompt?.trim() && !draft.cast?.length && !draft.spec?.beats?.length);

/**
 * The snapshot as text, trimmed to fit. Dossiers go first — they are the largest part and the
 * cheapest to get back — then trait lists, which only the Casting Director reads and it has
 * already read them.
 */
export function serializeDraft(draft) {
  let text = JSON.stringify(draft);
  if (text.length <= MAX_BYTES) return text;

  const withoutDossiers = draft.writtenCast
    ? { ...draft, writtenCast: draft.writtenCast.map((entry) => ({ ...entry, dossier: null })) }
    : draft;
  text = JSON.stringify(withoutDossiers);
  if (text.length <= MAX_BYTES) return text;

  const withoutTraits = {
    ...withoutDossiers,
    cast: withoutDossiers.cast.map((entry) => ({
      ...entry,
      nft: entry.nft?.raw?.metadata
        ? { ...entry.nft, raw: { metadata: { ...entry.nft.raw.metadata, attributes: undefined } } }
        : entry.nft,
    })),
  };
  return JSON.stringify(withoutTraits);
}

/** Text back to a snapshot, or null on anything that is not one of ours. */
export function parseDraft(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const draft = JSON.parse(text);
    if (!draft || typeof draft !== 'object' || draft.v !== DRAFT_VERSION) return null;
    if (typeof draft.prompt !== 'string' || !Array.isArray(draft.cast)) return null;
    if (draft.cast.some((entry) => typeof entry?.key !== 'string')) return null;
    if (draft.spec != null && !Array.isArray(draft.spec.beats)) return null;
    return draft;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────── the registry

let latest = null;
let timer = null;
const listeners = new Set();

const writeLocal = (draft) => {
  try {
    if (!draft || isEmptyDraft(draft)) globalThis.localStorage?.removeItem(DRAFT_KEY);
    else globalThis.localStorage?.setItem(DRAFT_KEY, serializeDraft(draft));
  } catch {
    // Quota or private mode. The in-memory copy is still what a same-document restore reads,
    // and the server copy (when there is a session) does not depend on this succeeding.
  }
};

/** The most recent snapshot published this document, whether or not it has been written yet. */
export const currentDraft = () => latest;

/**
 * Publish a snapshot. The local write is debounced; subscribers (the server sync) hear about it
 * immediately and apply their own cadence.
 */
export function setDraft(draft) {
  latest = draft;
  if (typeof clearTimeout === 'function') clearTimeout(timer);
  timer = setTimeout(() => writeLocal(latest), WRITE_DEBOUNCE_MS);
  for (const listener of listeners) listener(latest);
}

/** Write whatever is pending right now. Called the instant before the page navigates away. */
export function flushDraft() {
  if (typeof clearTimeout === 'function') clearTimeout(timer);
  timer = null;
  writeLocal(latest);
}

export function readLocalDraft() {
  try {
    return parseDraft(globalThis.localStorage?.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

export function clearLocalDraft() {
  latest = null;
  if (typeof clearTimeout === 'function') clearTimeout(timer);
  timer = null;
  try {
    globalThis.localStorage?.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do — the in-memory reset above is what matters.
  }
}

export function subscribeDraft(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Turn a snapshot back into what the two hooks' `restore` methods take. The treatment's cast
 * gets its artwork back from the composer's cast by key.
 */
export function draftToHookState(draft) {
  if (!draft) return null;
  const byKey = new Map(draft.cast.map((entry) => [entry.key, entry]));
  const writtenCast = draft.writtenCast
    ? draft.writtenCast.map((entry) => ({
        ...entry,
        nft: byKey.get(entry.key)?.nft ?? null,
        collection: byKey.get(entry.key)?.collection ?? null,
      }))
    : null;
  return {
    composer: { prompt: draft.prompt, cast: draft.cast, primaryKey: draft.primaryKey ?? null },
    screenwriter: {
      prompt: draft.prompt,
      primaryKey: draft.primaryKey ?? null,
      spec: draft.spec ?? null,
      writtenCast,
      caps: draft.caps ?? null,
      stage: draft.stage ?? 'compose',
    },
  };
}
