import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFeaturedNfts } from './useFeaturedNfts';
import { useCollectionNfts } from './useCollectionNfts';
import { useAnchorRect } from './useAnchorRect';
import { pickDiverseCast } from '../lib/diversity';
import { candidateKey } from '../lib/assetKey';
import { resolveTarget } from '../lib/contractResolve';
import { drawFromCollection, drawManyFromCollection } from '../lib/collectionRoulette';
import { fetchNft, hasAlchemyKey, resolveNftMedia } from '../services/alchemy';

// How many pieces the arc opens with, and how many it will hold before the outermost
// card makes way. Seven is where the arc stops reading as a curve on a laptop.
const CAST_SIZE = 5;
const MAX_CAST = 7;

// How many pieces a pasted collection puts in the picker grid. Matches the picker's
// curated sample, which is three full rows at its widest breakpoint.
const PICKER_PAGE = 18;

const toEntry = (candidate, origin = 'curated', isMock = false) => ({
  key: candidateKey(candidate),
  nft: candidate.nft,
  collection: candidate.collection,
  origin,
  isMock,
});

const hasMedia = (nft) => {
  if (!nft) return false;
  const { image, video } = resolveNftMedia(nft);
  return Boolean(image || video);
};

/**
 * State for the prompt canvas: the prompt itself, the cast of pieces on the holo arc,
 * which one is primary, and the contract-paste resolver.
 *
 * Deliberately owns no submit behaviour — the canvas hands `{ prompt, primary, cast }`
 * to whatever `onLaunch` the caller supplies.
 */
export const useCanvasComposer = () => {
  const [open, setOpen] = useState(false);
  // The invisible slot the hero reserves for the composer. The composer itself is
  // rendered at root level — it has to be, since <main> (z-10) and the hero <section>
  // (isolate) both create stacking contexts that would trap it under the z-40 header —
  // so it tracks this element to know where to sit when collapsed.
  const [anchor, setAnchor] = useState(null);
  const anchorRect = useAnchorRect(anchor);
  const [prompt, setPrompt] = useState('');
  const [cast, setCast] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [picker, setPicker] = useState(null); // null | { replaceKey: string | null }
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);

  // What the picker is showing instead of the curated grid, after a contract was pasted
  // into it. Lives here rather than in AssetPicker so it survives the picker closing:
  // add a piece, reopen, and the same collection is still on screen.
  // null | { chain, address, tokenId, collection, candidates, isMock, total }
  const [pickerView, setPickerView] = useState(null);
  const [pickerResolving, setPickerResolving] = useState(false);
  const [pickerError, setPickerError] = useState(null);

  // What the viewer is looking at instead of the cast lead. Three shapes:
  //
  //   null                  — nothing previewed; the viewer falls back to the cast lead.
  //   { nft, collection }   — a piece being browsed. Addable to the cast, steppable prev/next.
  //   { takeId }            — a take the Director shot, clicked out of Dailies or Screen Tests.
  //
  // The take is held as an ID rather than the record itself, on purpose: a take is a live thing
  // that finishes rendering and gets judged while it is on screen, and a snapshot taken at click
  // time would sit there stale. Whoever renders it re-resolves the ID against the current takes.
  const [preview, setPreview] = useState(null);

  const seeded = useRef(false);

  // Shares the module-level collection cache with the featured marquee, so opening the
  // canvas costs no extra network on a page that has already loaded.
  const { items: rawPool, loading: poolLoading, isMock } = useFeaturedNfts({
    perCollection: 6,
    max: 90,
  });

  // Keyless installs get the same twelve placeholder tokens back for every collection,
  // so a naive cast is five copies of the same picture under five different brand
  // names. Collapse to one entry per distinct piece and let the DEMO badge explain it.
  const pool = useMemo(() => {
    if (!isMock) return rawPool;
    const bySubject = new Map();
    for (const candidate of rawPool) {
      const subject = String(candidate.nft.tokenId);
      if (!bySubject.has(subject)) bySubject.set(subject, candidate);
    }
    return [...bySubject.values()];
  }, [rawPool, isMock]);



  // Load the collection currently being previewed so the render panel can step prev/next.
  const previewCollection = preview?.collection;
  const {
    nfts: previewNfts,
    loading: previewLoading,
    isMock: previewIsMock,
  } = useCollectionNfts({
    chain: previewCollection?.chain,
    address: previewCollection?.address,
    limit: 50,
  });

  const castKeys = useMemo(() => new Set(cast.map((item) => item.key)), [cast]);

  // Deriving the primary rather than storing it means a stale `primaryKey` (its card was
  // removed) can't produce an empty selection — it falls back to the centre of the arc,
  // which is where the eye already is.
  const primary =
    cast.find((item) => item.key === primaryKey) ?? cast[Math.floor(cast.length / 2)] ?? null;

  const seedCast = useCallback(
    (candidates) => {
      const entries = candidates.map((candidate) => toEntry(candidate, 'curated', isMock));
      setCast(entries);
      setPrimaryKey(entries[Math.floor(entries.length / 2)]?.key ?? null);
    },
    [isMock],
  );

  // No initial random cast selection


  // When the user browses a collection (preview set without a specific NFT), land on the
  // first piece with resolvable media once the collection loads.
  useEffect(() => {
    if (!preview || preview.takeId || preview.nft || !previewNfts.length) return;
    const nft = previewNfts.find(hasMedia) ?? previewNfts[0];
    setPreview({ nft, collection: preview.collection });
  }, [preview, previewNfts]);

  // If the user picked a specific NFT from the pool/directory, replace it with the loaded
  // version from the collection once that arrives (better metadata, consistent navigation).
  // Only replace when the fetched version actually has media, so a working pool candidate
  // is never swapped for a dead collection copy.
  useEffect(() => {
    // A take preview carries no `nft`, so it is already excluded by the guard below.
    if (!preview?.nft || !previewNfts.length) return;
    const match = previewNfts.find(
      (nft) => String(nft.tokenId) === String(preview.nft.tokenId),
    );
    if (match && match !== preview.nft && hasMedia(match)) {
      setPreview((current) =>
        current && String(current.nft.tokenId) === String(match.tokenId)
          ? { ...current, nft: match }
          : current,
      );
    }
  }, [previewNfts, preview?.nft]);

  const openCanvas = useCallback(() => setOpen(true), []);

  const closeCanvas = useCallback(() => {
    setOpen(false);
    setPicker(null);
    setResolveError(null);
    // Closing the whole canvas is the reset; closing just the picker deliberately isn't.
    setPickerView(null);
    setPickerError(null);
  }, []);

  const addAsset = useCallback((candidate, origin = 'curated', mock = false) => {
    const entry = toEntry(candidate, origin, mock);
    setCast((current) => {
      if (current.some((item) => item.key === entry.key)) return current;
      // Land in the middle: the arc's centre is the focal point, and the piece you just
      // chose should be the one you're looking at.
      const at = Math.ceil(current.length / 2);
      const room = current.length >= MAX_CAST ? current.slice(0, -1) : current;
      return [...room.slice(0, at), entry, ...room.slice(at)];
    });
    setPrimaryKey(entry.key);
    return entry.key;
  }, []);

  const setPreviewCandidate = useCallback((candidate) => {
    setPreview(candidate);
  }, []);

  const browseCollection = useCallback((collection) => {
    setPreview({ nft: null, collection });
  }, []);

  // Put one of the Director's takes in the viewer. See the `preview` comment for why this
  // stores an ID and not the take.
  const previewTake = useCallback((takeId) => {
    setPreview(takeId ? { takeId } : null);
  }, []);

  const browseNext = useCallback(() => {
    if (!preview?.nft || !previewNfts.length) return;
    const idx = previewNfts.findIndex(
      (nft) => String(nft.tokenId) === String(preview.nft.tokenId),
    );
    const next = previewNfts[Math.min(idx + 1, previewNfts.length - 1)];
    setPreview({ nft: next, collection: preview.collection });
  }, [preview, previewNfts]);

  const browsePrev = useCallback(() => {
    if (!preview?.nft || !previewNfts.length) return;
    const idx = previewNfts.findIndex(
      (nft) => String(nft.tokenId) === String(preview.nft.tokenId),
    );
    const prev = previewNfts[Math.max(idx - 1, 0)];
    setPreview({ nft: prev, collection: preview.collection });
  }, [preview, previewNfts]);

  const addPreviewToCast = useCallback(() => {
    if (!preview?.nft) return;
    addAsset(preview, 'curated', previewIsMock);
  }, [preview, previewIsMock, addAsset]);

  const clearPreview = useCallback(() => setPreview(null), []);

  /**
   * Put a saved draft back (src/lib/draftStore.js). Opens the canvas too: a visitor whose work
   * has just come back from a page load should be looking at it, not at the marketing page.
   */
  const restore = useCallback(({ prompt: savedPrompt, cast: savedCast, primaryKey: savedPrimary }) => {
    setPrompt(typeof savedPrompt === 'string' ? savedPrompt : '');
    setCast(Array.isArray(savedCast) ? savedCast : []);
    setPrimaryKey(savedPrimary ?? null);
    setPreview(null);
    setOpen(true);
  }, []);

  /** Back to an empty composer — the "New film" action. Leaves the canvas open. */
  const clearComposition = useCallback(() => {
    setPrompt('');
    setCast([]);
    setPrimaryKey(null);
    setPreview(null);
    setPicker(null);
    setPickerView(null);
  }, []);

  const removeAsset = useCallback((key) => {
    setCast((current) => current.filter((item) => item.key !== key));
  }, []);

  const replaceAsset = useCallback((key, candidate, origin = 'curated', mock = false) => {
    const entry = toEntry(candidate, origin, mock);
    setCast((current) => {
      // Choosing something already on the arc collapses the two slots into one.
      if (current.some((item) => item.key === entry.key)) {
        return current.filter((item) => item.key !== key);
      }
      return current.map((item) => (item.key === key ? entry : item));
    });
    setPrimaryKey((current) => (current === key ? entry.key : current));
  }, []);

  const reshuffle = useCallback(() => {
    // A pasted piece was a deliberate choice — re-rolling the suggestions shouldn't
    // throw it away.
    const kept = cast.filter((item) => item.origin === 'pasted');
    const need = Math.max(0, CAST_SIZE - kept.length);
    const keptKeys = new Set(kept.map((item) => item.key));

    let picked = pickDiverseCast(pool, need, { exclude: castKeys });
    // A small pool can't always produce an entirely new cast; allow repeats over an
    // empty arc.
    if (picked.length < need) picked = pickDiverseCast(pool, need, { exclude: keptKeys });

    const entries = [...kept, ...picked.map((c) => toEntry(c, 'curated', isMock))];
    setCast(entries);
    setPrimaryKey(entries[Math.floor(entries.length / 2)]?.key ?? null);
  }, [cast, castKeys, pool, isMock]);

  const openPicker = useCallback((replaceKey = null) => setPicker({ replaceKey }), []);
  const closePicker = useCallback(() => setPicker(null), []);

  const chooseFromPicker = useCallback(
    (candidate, origin = 'curated', mock = isMock) => {
      if (picker?.replaceKey) replaceAsset(picker.replaceKey, candidate, origin, mock);
      else addAsset(candidate, origin, mock);
      setPicker(null);
    },
    [picker, replaceAsset, addAsset, isMock],
  );

  /**
   * Load a pasted contract into the picker grid rather than straight onto the arc.
   *
   * A token id resolves that one piece; a bare contract draws a page of them to browse.
   * Either way nothing joins the cast until the user clicks a card.
   */
  const loadIntoPicker = useCallback(
    async (raw) => {
      setPickerError(null);
      setPickerResolving(true);
      try {
        const target = await resolveTarget(raw);
        if (!target.ok) {
          setPickerError(target.error);
          return false;
        }

        const { chain, address, tokenId, collection } = target;

        if (tokenId != null) {
          const nft = await fetchNft({ chain, address, tokenId });
          if (!nft) {
            setPickerError(`No token #${tokenId} on that contract.`);
            return false;
          }
          setPickerView({
            chain,
            address,
            tokenId,
            collection,
            candidates: [{ nft, collection }],
            isMock: !hasAlchemyKey,
            total: 1,
          });
          return true;
        }

        const drawn = await drawManyFromCollection(chain, address, PICKER_PAGE, {
          exclude: castKeys,
        });
        if (!drawn?.nfts.length) {
          setPickerError('No previewable pieces in that collection.');
          return false;
        }

        setPickerView({
          chain,
          address,
          tokenId: null,
          collection,
          candidates: drawn.nfts.map((nft) => ({ nft, collection })),
          isMock: drawn.isMock,
          total: drawn.total,
        });
        return true;
      } catch (error) {
        // Belt and braces: every service call below swallows its own errors, so reaching
        // here means something unexpected threw — without this the picker spins forever.
        console.error('Failed to load pasted contract into the picker:', error);
        setPickerError('Something went wrong reaching that contract. Try again.');
        return false;
      } finally {
        setPickerResolving(false);
      }
    },
    [castKeys],
  );

  /** Re-draw the pasted collection's grid — the way to see past the first page. */
  const shufflePickerView = useCallback(async () => {
    if (!pickerView || pickerView.tokenId != null) return;
    const { chain, address, collection } = pickerView;

    setPickerResolving(true);
    try {
      const drawn = await drawManyFromCollection(chain, address, PICKER_PAGE, {
        exclude: castKeys,
      });
      if (!drawn?.nfts.length) return;
      setPickerView((current) =>
        // The user may have cleared or replaced the view while this was in flight.
        current?.address === address
          ? {
              ...current,
              candidates: drawn.nfts.map((nft) => ({ nft, collection })),
              isMock: drawn.isMock,
              total: drawn.total,
            }
          : current,
      );
    } finally {
      setPickerResolving(false);
    }
  }, [pickerView, castKeys]);

  const clearPickerView = useCallback(() => {
    setPickerView(null);
    setPickerError(null);
  }, []);

  /**
   * Resolve pasted text into a piece and put it on the arc.
   * A contract with a token id resolves that exact piece; a bare collection contract
   * draws one at random, never repeating a previous draw.
   */
  const resolveContract = useCallback(
    async (raw) => {
      setResolveError(null);
      setResolving(true);
      try {
        const target = await resolveTarget(raw);
        if (!target.ok) {
          setResolveError(target.error);
          return false;
        }

        const { chain, address, tokenId, collection } = target;
        let nft = null;
        let mock = false;

        if (tokenId != null) {
          nft = await fetchNft({ chain, address, tokenId });
          if (!nft) {
            setResolveError(`No token #${tokenId} on that contract.`);
            return false;
          }
        } else {
          const drawn = await drawFromCollection(chain, address, { exclude: castKeys });
          if (!drawn) {
            setResolveError('No previewable pieces in that collection.');
            return false;
          }
          ({ nft } = drawn);
          mock = drawn.isMock;
        }

        addAsset({ nft, collection }, 'pasted', mock);
        return true;
      } catch (error) {
        // Every service call here swallows its own errors, so this is the belt-and-braces
        // path — without it an unexpected throw would surface as an unhandled rejection
        // and leave the dock spinning.
        console.error('Failed to resolve pasted contract:', error);
        setResolveError('Something went wrong reaching that contract. Try again.');
        return false;
      } finally {
        setResolving(false);
      }
    },
    [addAsset, castKeys],
  );

  return {
    open,
    openCanvas,
    closeCanvas,
    setAnchor,
    anchorRect,
    prompt,
    setPrompt,
    cast,
    primary,
    primaryKey: primary?.key ?? null,
    setPrimary: setPrimaryKey,
    addAsset,
    removeAsset,
    reshuffle,
    pool,
    poolLoading,
    castKeys,
    isMock,
    picker,
    openPicker,
    closePicker,
    chooseFromPicker,
    resolveContract,
    resolving,
    resolveError,
    pickerView,
    pickerResolving,
    pickerError,
    loadIntoPicker,
    shufflePickerView,
    clearPickerView,
    preview,
    previewLoading,
    previewNfts,
    setPreviewCandidate,
    previewTake,
    browseCollection,
    browseNext,
    browsePrev,
    addPreviewToCast,
    clearPreview,
    restore,
    clearComposition,
  };
};
