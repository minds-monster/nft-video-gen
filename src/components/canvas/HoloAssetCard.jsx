import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Play, X } from 'lucide-react';
import {
  chainLabel,
  mayBeVideoUrl,
  resolveNftMedia,
  resolveNftName,
  resolveNftThumb,
} from '../../services/alchemy';
import { useReportUnavailable } from '../../lib/unavailableMedia';
import { cn } from '../../lib/cn';

// A collection with no registered brand falls back to the house purple rather than to
// some other off-brand violet. Only used as a caption colour; the glows are brand purple
// unconditionally. Matches --color-brand in index.css.
const FALLBACK_ACCENT = '#951EF5';

/**
 * One piece on the holo arc.
 *
 * Not built on NftCard: that component is a single `motion.button` covering its whole
 * surface, and the remove/swap controls have to be real buttons — nesting them would be
 * invalid HTML and unreachable by keyboard. So the click target here is a full-bleed
 * button *sibling* of the two controls, which stack above it.
 *
 * Only the primary piece plays its film. Autoplaying every card would pull several
 * IPFS videos at once for artwork the user is still choosing between.
 */
const HoloAssetCard = ({ entry, isPrimary, onPromote, onRemove, onSwap, width, height }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef(null);

  const { nft, collection, isMock } = entry;
  const brand = collection.brand;
  const accent = brand?.accent ?? FALLBACK_ACCENT;
  const bed = resolveNftThumb(nft);

  const { image, video } = resolveNftMedia(nft);
  const name = resolveNftName(nft);

  const showStill = Boolean(image) && !imageFailed;
  // An extension-less image URL that fails to load is usually an mp4.
  const candidate = video ?? (imageFailed && mayBeVideoUrl(image) ? image : null);
  const film = videoFailed ? null : candidate;
  const playing = isPrimary && Boolean(film);

  // Same report as NftCard: once a piece has no still and no film, it is registered so the
  // picker and the wall stop offering it. The placeholder below stays for THIS surface only —
  // a piece the visitor deliberately added to the cast shouldn't vanish from under them.
  const report = useReportUnavailable();
  useEffect(() => {
    if (!showStill && !film) report(nft);
  }, [showStill, film, report, nft]);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-slate-900/60 transition-colors',
        isPrimary ? 'border-white/25' : 'border-white/10 hover:border-white/20',
      )}
      style={{ width, height }}
    >
      {/* Accent ring on the primary, breathing so the arc never looks frozen. */}
      {isPrimary && (
        <div
          aria-hidden="true"
          className="hud-pulse pointer-events-none absolute -inset-px rounded-xl"
          // The primary piece's highlight ring is chrome, not identity, so it is brand purple
          // rather than the brand's own accent — a per-brand 1px ring here is exactly what
          // made an orange or red accent fight the purple UI.
          style={{
            boxShadow:
              '0 0 0 1px rgb(var(--brand-rgb)), 0 0 28px rgb(var(--brand-rgb) / 0.42)',
          }}
        />
      )}

      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* The arc keeps a fixed card box (CARD_W/CARD_H in HoloArc drive the arc maths and the
            container height), so artwork that isn't 4:5 letterboxes here rather than matching
            its box. The blurred bed is what stops that reading as a broken crop. */}
        {bed && (
          <div
            className="absolute inset-0 scale-[1.15] bg-cover bg-center opacity-55 blur-2xl saturate-150"
            style={{ backgroundImage: `url("${bed}")` }}
          />
        )}

        {showStill && (
          <>
            {!loaded && (
              <div
                className="absolute inset-0 animate-[shimmer_1.6s_ease-in-out_infinite]"
                style={{
                  background:
                    'linear-gradient(135deg, rgb(var(--brand-rgb) / 0.12), rgb(255 255 255 / 0.04))',
                }}
              />
            )}
            <img
              src={image}
              alt=""
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setImageFailed(true)}
              className={cn(
                'absolute inset-0 h-full w-full object-contain transition-opacity duration-700',
                loaded ? 'opacity-100' : 'opacity-0',
                playing && 'opacity-0',
              )}
            />
          </>
        )}

        {playing && (
          <video
            ref={videoRef}
            src={film}
            onError={() => setVideoFailed(true)}
            onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}

        {!showStill && !film && (
          <div
            className="absolute inset-0 flex items-center justify-center p-3 text-center"
            style={{
              background:
                'radial-gradient(circle at 30% 20%, rgb(var(--brand-rgb) / 0.22), rgb(var(--ground-rgb)) 75%)',
            }}
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-widest"
              style={{ color: accent }}
            >
              {brand?.name ?? 'Artwork'}
            </span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent" />
      </div>

      {/* Click target. Sits above the art, below the controls. */}
      <button
        type="button"
        onClick={() => onPromote?.(entry.key)}
        aria-pressed={isPrimary}
        aria-label={
          isPrimary ? `${name} is the primary piece` : `Make ${name} the primary piece`
        }
        className="absolute inset-0 z-10 cursor-pointer rounded-xl"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-2.5">
        {brand && (
          <p
            className="truncate text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: accent }}
          >
            {brand.name}
          </p>
        )}
        <p className="truncate text-xs font-semibold text-white">{name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-wider text-slate-500">
          {chainLabel(collection.chain)}
          <span aria-hidden="true">·</span>
          <span className="truncate">#{String(nft.tokenId)}</span>
          {film && <Play className="h-2 w-2 shrink-0 fill-current text-slate-400" />}
        </p>
      </div>

      {/*
        Hover-revealed controls, with three things guarding the click:

        - `delay-150` in the resting state (cancelled by `group-hover:delay-0`) keeps them
          on screen for a beat after the pointer slips off, so a near-miss on the way to
          the button doesn't blink it away mid-reach.
        - `p-2` over a 3.5 icon puts the target near 30px square. Still under the 44px
          ideal, but the card is only 148 wide and two of these have to share its top edge.
        - On a device with no hover there is nothing to reveal them, and an invisible
          button is still tappable — so a stray tap near the corner would silently drop a
          piece. Show them outright there instead.
      */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-1.5">
        <button
          type="button"
          onClick={() => onSwap?.(entry.key)}
          aria-label={`Swap ${name} for another piece`}
          className="rounded-full bg-black/60 p-2 text-slate-300 opacity-0 transition delay-150 hover:bg-black/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 group-hover:delay-0 [@media(hover:none)]:opacity-100"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => onRemove?.(entry.key)}
          aria-label={`Remove ${name} from the canvas`}
          className="rounded-full bg-black/60 p-2 text-slate-300 opacity-0 transition delay-150 hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 group-hover:delay-0 [@media(hover:none)]:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {(isMock || isPrimary || entry.origin === 'pasted') && (
        <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex gap-1">
          {isPrimary && (
            <span className="rounded-full bg-white/95 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-slate-950 opacity-100 transition-opacity delay-150 group-hover:opacity-0 group-hover:delay-0">
              Primary
            </span>
          )}
          {entry.origin === 'pasted' && !isPrimary && (
            <span className="rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-slate-300 transition-opacity delay-150 group-hover:opacity-0 group-hover:delay-0">
              Pasted
            </span>
          )}
          {isMock && (
            <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-amber-200 transition-opacity delay-150 group-hover:opacity-0 group-hover:delay-0">
              Demo
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default HoloAssetCard;
