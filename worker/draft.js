// The visitor's draft — prompt, cast, screenplay — kept for a connected Mind.
//
// WHY THE WORKER KEEPS A COPY. The browser keeps one too (src/lib/draftStore.js), and for a
// visitor who never connects a Mind that is the whole story. But a connected Mind's visitor can
// come back from a cleared browser, a second device, or — the case that started this — a Stripe
// checkout that returned to a fresh document; and a Mind that is told about a screenplay
// (`[Screenplay]`, worker/filmography.js) should be told about one this site can still find. So
// the draft is written here on every meaningful change, for a week, under the Mind's own key.
//
// UNTRUSTED, LIKE THE PRODUCTION SNAPSHOT. Everything in it is client-posted, so it is clamped on
// the way in exactly as worker/producer-state.js clamps its snapshot: lengths, counts, URL
// schemes, and one total-size ceiling. A draft that will not fit is refused, never silently cut,
// because the film id is a hash of the screenplay (worker/film-id.js) and a trimmed screenplay
// would be a different film.
//
// Imports are kept to modules that import nothing back: worker/producer-state.js reads the draft
// for the Mind's context, and producer-state sits on the connection path that mind-chat.js owns.

import { requireSession } from './session.js';
import { filmIdFor } from './film-id.js';
import { ASSET_KEY } from './cast-art.js';
import { relayScreenplayDigest } from './filmography.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const draftKey = (mindId) => `draft:${mindId}`;
// Once per film: the Mind is told about a screenplay the first time it is saved, and not again
// for the same film id however many times the tab re-saves it.
const toldKey = (mindId, filmId) => `screenplay-told:${mindId}:${filmId}`;

// A week — the same lifetime as the Storyboarder's draft, for the same reason: long enough that
// coming back tomorrow finds it, short enough that abandoned work does not accumulate.
export const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const DRAFT_VERSION = 1;
export const MAX_PROMPT = 2000;
export const MAX_CAST = 7;
export const MAX_BEATS = 12;
export const MAX_SPEC_BYTES = 64_000;
export const MAX_DOSSIER_BYTES = 32_000;
export const MAX_DRAFT_BYTES = 512_000;
const MAX_URL = 2048;
const MAX_ATTRIBUTES = 64;
const MAX_NAME = 200;
const MAX_TEXT = 2000;

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) || null : null);
const url = (value) =>
  typeof value === 'string' && value.length <= MAX_URL && /^(https?:\/\/|ipfs:\/\/)/i.test(value) ? value : undefined;
const key = (value) => (typeof value === 'string' && ASSET_KEY.test(value) ? value : null);
const or = (value, fallback = undefined) => value ?? fallback;

/** The NFT subset src/services/swarm.js `forCastingWire` sends, re-validated field by field. */
const nftOf = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const image = raw.image && typeof raw.image === 'object' ? raw.image : {};
  const meta = raw.raw?.metadata && typeof raw.raw.metadata === 'object' ? raw.raw.metadata : {};
  const attributes = Array.isArray(meta.attributes)
    ? meta.attributes.slice(0, MAX_ATTRIBUTES).map((attribute) => ({
        trait_type: or(str(attribute?.trait_type, 120)),
        value: typeof attribute?.value === 'number' ? attribute.value : or(str(String(attribute?.value ?? ''), 120)),
      }))
    : undefined;
  return {
    contract: str(raw.contract?.address, 64) ? { address: str(raw.contract.address, 64) } : undefined,
    tokenId: raw.tokenId != null ? or(str(String(raw.tokenId), 96)) : undefined,
    name: or(str(raw.name, MAX_NAME)),
    title: or(str(raw.title, MAX_NAME)),
    description: or(str(raw.description, MAX_TEXT)),
    image: {
      pngUrl: url(image.pngUrl),
      cachedUrl: url(image.cachedUrl),
      originalUrl: url(image.originalUrl),
      thumbnailUrl: url(image.thumbnailUrl),
      contentType: or(str(image.contentType, 64)),
      size: typeof image.size === 'number' ? image.size : undefined,
    },
    animationUrl: url(raw.animationUrl),
    media: url(raw.media?.[0]?.gateway) ? [{ gateway: url(raw.media[0].gateway) }] : undefined,
    raw: {
      metadata: {
        image: url(meta.image),
        animation_url: url(meta.animation_url),
        video_url: url(meta.video_url),
        description: or(str(meta.description, MAX_TEXT)),
        attributes,
      },
    },
  };
};

/** What a cast tile reads off a collection: chain, address, name, art ratio, and the brand strip. */
const collectionOf = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const brand = raw.brand && typeof raw.brand === 'object' ? raw.brand : null;
  return {
    chain: str(raw.chain, 32),
    address: str(raw.address, 64),
    name: str(raw.name, MAX_NAME),
    artRatio: Number(raw.artRatio) > 0 ? Number(raw.artRatio) : undefined,
    brand: brand
      ? { slug: str(brand.slug, 120), name: str(brand.name, 120), sector: str(brand.sector, 120), accent: str(brand.accent, 32) }
      : null,
  };
};

/**
 * The screenplay is kept verbatim or not at all — see the header. Only its shape and size are
 * checked.
 */
const specOf = (raw) => {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.beats) || !raw.beats.length) return null;
  if (raw.beats.length > MAX_BEATS) return null;
  if (typeof raw.logline !== 'string') return null;
  if (JSON.stringify(raw).length > MAX_SPEC_BYTES) return null;
  return raw;
};

const dossierOf = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  return JSON.stringify(raw).length <= MAX_DOSSIER_BYTES ? raw : null;
};

/**
 * A client-posted draft, clamped. Null when it is not a draft at all or will not fit; a
 * draft with nothing in it is returned as null too, since the right answer to "save nothing"
 * is to delete.
 */
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.slice(0, MAX_PROMPT) : '';
  const cast = (Array.isArray(raw.cast) ? raw.cast : [])
    .map((entry) => {
      const assetKey = key(entry?.key);
      if (!assetKey) return null;
      return {
        key: assetKey,
        origin: entry.origin === 'pasted' ? 'pasted' : 'curated',
        isMock: Boolean(entry.isMock),
        nft: nftOf(entry.nft),
        collection: collectionOf(entry.collection),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_CAST);
  const spec = specOf(raw.spec);

  if (!prompt.trim() && !cast.length && !spec) return null;

  const castKeys = new Set(cast.map((entry) => entry.key));
  const writtenCast = spec && Array.isArray(raw.writtenCast)
    ? raw.writtenCast
        .map((entry) => {
          const assetKey = key(entry?.key);
          if (!assetKey || !castKeys.has(assetKey)) return null;
          return {
            key: assetKey,
            dossier: dossierOf(entry.dossier),
            name: str(entry.name, MAX_NAME),
            collectionName: str(entry.collectionName, MAX_NAME) ?? '',
          };
        })
        .filter(Boolean)
        .slice(0, MAX_CAST)
    : null;

  const draft = {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    filmId: spec ? filmIdFor(spec) : null,
    prompt,
    primaryKey: castKeys.has(raw.primaryKey) ? raw.primaryKey : null,
    cast,
    stage: spec && raw.stage === 'treatment' ? 'treatment' : 'compose',
    spec,
    caps:
      Number(raw.caps?.maxBeats) > 0
        ? { maxBeats: Math.min(Math.round(Number(raw.caps.maxBeats)), MAX_BEATS), maxReferences: Math.min(Math.max(Math.round(Number(raw.caps.maxReferences) || 0), 0), 20) }
        : null,
    writtenCast: writtenCast?.length ? writtenCast : null,
  };

  if (JSON.stringify(draft).length > MAX_DRAFT_BYTES) return null;
  return draft;
}

export const loadDraft = (env, mindId) => env.MIND_CONNECTIONS.get(draftKey(mindId), 'json').catch(() => null);

/** Best-effort by design. Returns whether the write took. */
export async function saveDraft(env, mindId, draft) {
  try {
    await env.MIND_CONNECTIONS.put(draftKey(mindId), JSON.stringify(draft), { expirationTtl: DRAFT_TTL_SECONDS });
    return true;
  } catch (error) {
    console.warn('Draft write failed:', error.message);
    return false;
  }
}

export async function clearDraft(env, mindId) {
  await env.MIND_CONNECTIONS.delete(draftKey(mindId)).catch(() => {});
}

/**
 * The cast in the shape the Director's handlers already take — `{ key, nft, name, collectionName }`,
 * i.e. what src/services/swarm.js `forStoryboardWire` produces. Names come from the Screenwriter's
 * cast when there is one, since that is where the Casting Director resolved them.
 */
export const draftCastForWire = (draft) =>
  (draft?.cast ?? []).map((entry) => {
    const written = draft.writtenCast?.find((candidate) => candidate.key === entry.key);
    const nft = entry.nft ?? {};
    return {
      key: entry.key,
      nft: entry.nft ?? null,
      name: written?.name ?? nft.name ?? nft.title ?? (nft.tokenId != null ? `Token #${nft.tokenId}` : null),
      collectionName: written?.collectionName ?? entry.collection?.name ?? '',
    };
  });

export const draftCastNames = (draft) =>
  draftCastForWire(draft)
    .map((entry) => entry.name)
    .filter(Boolean)
    .slice(0, 8);

/**
 * Tell the Mind about this screenplay, once per film. The flag is written only after the message
 * went, so a Mind that could not be reached is told on the next save rather than never.
 */
export async function announceScreenplay(env, mindId, draft) {
  if (!draft?.spec || !draft.filmId) return false;
  const flag = toldKey(mindId, draft.filmId);
  if (await env.MIND_CONNECTIONS.get(flag).catch(() => null)) return false;

  const sent = await relayScreenplayDigest(env, mindId, {
    filmId: draft.filmId,
    spec: draft.spec,
    prompt: draft.prompt,
    castNames: draftCastNames(draft),
  }).catch((error) => {
    console.warn(`Screenplay digest for film ${draft.filmId} failed:`, error.message);
    return false;
  });
  if (sent) await env.MIND_CONNECTIONS.put(flag, '1', { expirationTtl: DRAFT_TTL_SECONDS }).catch(() => {});
  return sent;
}

/** GET /api/draft */
export async function handleDraftGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  return json({ draft: await loadDraft(env, session.mindId) });
}

/** PUT /api/draft — the browser keeping the Worker's copy current. */
export async function handleDraftPut(request, env, ctx) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const draft = normalizeDraft(body?.draft ?? body);
  if (!draft) return json({ error: 'invalid_draft' }, 400);

  const previous = await loadDraft(env, session.mindId);
  const saved = await saveDraft(env, session.mindId, draft);
  if (!saved) return json({ error: 'draft_not_saved' }, 503);

  // A new film id is a new screenplay as far as the Mind is concerned. Re-saving the same one —
  // every prompt edit after the treatment is written does that — is not news.
  let announced = false;
  if (draft.spec && draft.filmId !== previous?.filmId) {
    const work = announceScreenplay(env, session.mindId, draft);
    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      announced = true;
    } else {
      announced = await work;
    }
  }

  return json({ ok: true, savedAt: draft.savedAt, filmId: draft.filmId, announced });
}

/** DELETE /api/draft — "New film". */
export async function handleDraftDelete(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  await clearDraft(env, session.mindId);
  return json({ ok: true });
}
