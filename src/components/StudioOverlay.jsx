import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, X } from 'lucide-react';
import {
  chainLabel,
  fetchNft,
  mayBeVideoUrl,
  resolveNftDescription,
  resolveNftMedia,
  resolveNftName,
} from '../services/alchemy';
import { findCollection, artRatio } from '../data/brands';
import { LICENSE_STATUS } from '../config/licensing';
import { useCollectionNfts } from '../hooks/useCollectionNfts';
import { useMindChatContext } from '../context/mindChat';
import { useAvailableNfts } from '../lib/unavailableMedia';
import { LicenseSummary } from './LicenseBadge';
import PromptBar from './PromptBar';
import ChatThread from './ChatThread';
import { PROMPT_IDEAS } from '../data/prompts';

// The prompt sent to the mind names the piece, so the conversation is anchored to
// what is actually being licensed.
// Direction first so the bubble reads as the creator's intent, with the licensing
// provenance beneath it — the mind needs the exact contract, the reader doesn't lead
// with it.
const buildPrompt = (idea, { name, brandName, collectionName, chain, address, tokenId }) =>
  [
    `Make a short video: ${idea}`,
    '',
    `Licensed source: ${[name, brandName, collectionName].filter(Boolean).join(' · ')}`,
    `${address} #${tokenId} on ${chainLabel(chain)}`,
  ].join('\n');

const StudioBody = ({ selection, onSelect, initialPrompt }) => {
  const { chain, address, tokenId } = selection;
  const collection = findCollection(chain, address);
  const brand = collection?.brand ?? null;
  // Shapes the loading/empty frames to the collection's real artwork ratio, so the frame
  // doesn't sit square and then snap to a portrait once the image arrives.
  const ratio = artRatio(collection);

  const [nft, setNft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  // Open by default: the thread is where results appear, and a collapsed panel
  // leaves the right column looking empty.
  const [threadOpen, setThreadOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const { session, openModal, messages, isSending, isInitializing, error, send } = useMindChatContext();

  // Sibling tokens power prev/next; served from the same cache the grid filled.
  const { nfts: allSiblings, isMock } = useCollectionNfts({ chain, address, limit: 24 });
  // Prev/next walks this list, so a piece with dead artwork must not be reachable by paging
  // through the collection either.
  const siblings = useAvailableNfts(allSiblings);
  const index = useMemo(
    () => siblings.findIndex((item) => String(item.tokenId) === String(tokenId)),
    [siblings, tokenId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    // Prefer the already-loaded token so opening the Studio from the grid is instant.
    const local = siblings.find((item) => String(item.tokenId) === String(tokenId));
    if (local) {
      setNft(local);
      setLoading(false);
      return;
    }

    fetchNft({ chain, address, tokenId }).then((result) => {
      if (!active) return;
      setNft(result);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [chain, address, tokenId, siblings]);

  useEffect(() => {
    if (messages.length > 0) setThreadOpen(true);
  }, [messages.length]);

  // An idea typed in the hero follows the visitor into the Studio.
  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  const name = nft ? resolveNftName(nft) : `Token #${tokenId}`;
  const { image, video } = nft ? resolveNftMedia(nft) : { image: null, video: null };
  // Same fallback as the cards: an extension-less URL in the image slot is often an
  // mp4 (adidas Phase 1), and a video that won't play falls back to the still.
  const film = videoFailed ? null : (video ?? (imageFailed && mayBeVideoUrl(image) ? image : null));
  const description = nft ? resolveNftDescription(nft) : '';
  const status = isMock ? LICENSE_STATUS.DEMO : LICENSE_STATUS.LICENSABLE;

  const step = (delta) => {
    if (index < 0 || !siblings.length) return;
    const next = siblings[(index + delta + siblings.length) % siblings.length];
    if (next) onSelect({ chain, address, tokenId: next.tokenId });
  };

  const submit = (idea) => {
    setThreadOpen(true);
    send(
      buildPrompt(idea, {
        name,
        brandName: brand?.name,
        collectionName: collection?.name,
        chain,
        address,
        tokenId,
      }),
    );
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:overflow-hidden">
      {/* The work */}
      <div className="flex flex-col gap-5 border-b border-white/10 p-6 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        {/* Three classes here are each load-bearing, and it took getting them wrong to see why.
            `w-fit`  — the frame HUGS the artwork instead of filling the column. The media used
                       to be `w-full` with a fixed `max-h`, so a 2:3 portrait sat small between
                       two large empty side bars. Now a portrait has no side bars at all.
            `min-h-0` — this is a flex item in a height-constrained column (the panel is 88vh and
                       the title/licence block sit below it), so flexbox shrinks it. Without
                       min-h-0 the media kept its own larger height and `overflow-hidden` sliced
                       it — which cropped the very artwork this change exists to protect.
            `max-h`  — the cap lives on the FRAME, not on the media, so the media's `max-h-full`
                       can scale the art down to whatever height the column actually leaves. */}
        <div className="relative mx-auto flex min-h-0 w-fit max-h-[72vh] max-w-full items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-black/40">
          {loading ? (
            <div
              className="flex w-full items-center justify-center"
              style={{ aspectRatio: ratio }}
            >
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            </div>
          ) : film ? (
            // A film gets real controls here; the still doubles as its poster.
            <video
              src={film}
              poster={imageFailed ? undefined : (image ?? undefined)}
              onError={() => setVideoFailed(true)}
              // As on the cards: don't trust the autoPlay attribute alone.
              onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="block max-h-full w-auto max-w-full object-contain"
            />
          ) : image && !imageFailed ? (
            <img
              src={image}
              alt={name}
              onError={() => setImageFailed(true)}
              className="block max-h-full w-auto max-w-full object-contain"
            />
          ) : (
            <div
              className="flex w-full items-center justify-center text-sm text-slate-500"
              style={{ aspectRatio: ratio }}
            >
              No image for this token
            </div>
          )}
        </div>

        {/* The prev/next controls used to be pinned inside the frame, which was tolerable only
            because the frame was full-width and they landed on empty bars. Now that the frame
            hugs the art they would sit on the piece itself — over a portrait's face — so they
            live beneath it. */}
        {siblings.length > 1 && index >= 0 && (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous piece"
              className="chip p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs text-slate-500">
              {index + 1} / {siblings.length}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next piece"
              className="chip p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {brand && (
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: brand.accent }}
              >
                {brand.name}
              </span>
            )}
            <span className="chip px-2 py-0.5 text-[11px] text-slate-400">
              {chainLabel(chain)}
            </span>
            {collection && (
              <span className="text-[11px] text-slate-500">{collection.name}</span>
            )}
          </div>
          <h2 className="mt-2 text-2xl uppercase tracking-tight md:text-3xl">{name}</h2>
          {description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400 line-clamp-4">
              {description}
            </p>
          )}
        </div>

        <LicenseSummary status={status} />

        <button
          type="button"
          onClick={copyLink}
          className="inline-flex w-fit items-center gap-2 text-xs text-slate-500 hover:text-slate-300"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Link copied' : 'Copy link to this piece'}
        </button>
      </div>

      {/* The making */}
      <div className="flex min-h-0 flex-col gap-4 p-6 lg:overflow-hidden">
        {/* pr leaves room for the floating close button. */}
        <div className="pr-12">
          <p className="text-xs uppercase tracking-widest text-slate-500">Direct the film</p>
          <p className="mt-1 text-sm text-slate-400">
            Describe the shot. The mind generates it from this piece, licensed as it goes.
          </p>
        </div>

        {!session && (
          <button
            type="button"
            onClick={openModal}
            className="chip w-fit px-4 py-2 text-xs font-semibold text-purple-300 hover:text-purple-200"
          >
            Connect Mind to direct the film
          </button>
        )}

        {session && !isInitializing && messages.length === 0 && (
          <p className="text-xs text-slate-500">
            Connected to <span className="text-slate-300">{session.mindName || 'your Mind'}</span> ·
            typical reply ~1 min
          </p>
        )}

        <PromptBar
          value={prompt}
          onValueChange={setPrompt}
          onSubmit={submit}
          suggestions={PROMPT_IDEAS}
          busy={isSending}
          disabled={!session || isInitializing || Boolean(error)}
          autoFocus
          size="md"
          placeholder="A slow dolly, neon rain…"
        />

        <button
          type="button"
          onClick={() => setThreadOpen((open) => !open)}
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${threadOpen ? '' : '-rotate-90'}`}
          />
          Conversation{messages.length > 0 ? ` (${messages.length})` : ''}
        </button>

        {threadOpen && (
          <ChatThread
            messages={messages}
            isSending={isSending}
            isInitializing={isInitializing}
            error={error}
            emptyHint="Send your first direction and the film appears here."
            className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-black/20 p-4 lg:max-h-none"
          />
        )}
      </div>
    </div>
  );
};

/**
 * Full-screen Studio. Opened from any card, deep-linkable via the URL hash, closed
 * with Esc, the backdrop, or the browser Back button.
 */
const StudioOverlay = ({ selection, onSelect, onClose, initialPrompt }) => {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, onClose]);

  useEffect(() => {
    if (selection) panelRef.current?.focus();
  }, [selection]);

  return (
    <AnimatePresence>
      {selection && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-0 backdrop-blur-md md:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Studio"
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="relative h-full w-full max-w-6xl overflow-hidden rounded-none border border-white/10 bg-slate-950/95 shadow-2xl outline-none md:h-[88vh] md:rounded-3xl"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close studio"
              className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>

            <StudioBody
              // Remounting per token keeps token-scoped state (image, prompt) clean.
              key={`${selection.chain}:${selection.address}:${selection.tokenId}`}
              selection={selection}
              onSelect={onSelect}
              initialPrompt={initialPrompt}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default StudioOverlay;
