import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Play, Wand2 } from 'lucide-react';
import {
  mayBeVideoUrl,
  resolveNftMedia,
  resolveNftName,
  resolveNftThumb,
} from '../services/alchemy';
import { DEFAULT_ART_RATIO } from '../data/brands';
import { PAYMENT_STATUS } from '../config/payment';
import { useReportUnavailable } from '../lib/unavailableMedia';
import { cn } from '../lib/cn';

/**
 * One piece of licensable work. The whole card is a button — clicking it opens the
 * Studio, which is the interaction the old gallery was missing.
 *
 * Many brand pieces are films (Nike's CRYPTOKICKS, YSL's Beauty Blocks). We show the
 * still and play the video on hover rather than autoplaying a dozen at once, which
 * would pull tens of megabytes off IPFS on first paint. Tokens with no still play on
 * their own, since otherwise there'd be nothing to see.
 *
 * ARTWORK IS NEVER CROPPED. The media is `object-contain`, so whatever shape a token turns
 * out to be, the whole piece is visible. `ratio` shapes the BOX to match, which is the
 * cosmetic half of the same idea: when the box ratio equals the art ratio, `contain` and
 * `cover` are pixel-identical, so a correctly-declared collection is full-bleed with no bars.
 * Callers pass `artRatio(collection)` from src/data/brands.js; a collection whose tokens vary
 * declares nothing, gets a square box, and its pieces letterbox onto the blurred bed below.
 */
const NftCard = ({
  nft,
  brand,
  onOpen,
  isMock = false,
  className,
  // Sizing classes for the art box specifically — the marquee uses this to fix the HEIGHT
  // and let `aspectRatio` derive the width, which is what makes it a film strip.
  artClassName,
  ratio = DEFAULT_ART_RATIO,
  // The canvas picker reuses this card for "choose a piece", where "Make video" would
  // be the wrong promise and a ring is needed to show what's already on the arc.
  actionLabel = 'Add to cast',
  actionIcon: ActionIcon = Wand2,
  selected = false,
}) => {
  const [failed, setFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef(null);

  const { image, video } = resolveNftMedia(nft);
  const bed = resolveNftThumb(nft);
  const name = resolveNftName(nft);
  const status = isMock ? PAYMENT_STATUS.DEMO : PAYMENT_STATUS.PAYABLE;

  const showStill = Boolean(image) && !failed;
  // If the still failed to load and its URL could be a video, it probably IS one —
  // play it rather than showing a broken frame.
  const candidate = video ?? (failed && mayBeVideoUrl(image) ? image : null);
  const film = videoFailed ? null : candidate;
  const autoPlays = Boolean(film) && !showStill;

  // A token with nothing left to show is reported here and dropped from every surface, rather
  // than sitting in the wall as a tile with a brand name and no artwork.
  //
  // This waits for real `error` events and does NOT race a timer, which took two wrong turns
  // to establish. Measured in the browser: YSL's dead arianee host errors at 2.2s and the
  // unpinned Red Pill CID errors at 30s via ipfs.io — so both failures DO surface on their
  // own, and a deadline only ever bought speed. It cost far too much for it: a 9s deadline
  // suppressed 124 tokens including 10 of Gucci's, because a dozen large stills from one host
  // queue behind each other and legitimately take longer than that to arrive.
  const report = useReportUnavailable();
  const exhausted = !showStill && !film;

  useEffect(() => {
    if (exhausted) report(nft);
  }, [exhausted, report, nft]);

  const play = () => {
    if (!film || autoPlays) return;
    const el = videoRef.current;
    if (el) el.play().catch(() => {});
  };

  const pause = () => {
    if (!film || autoPlays) return;
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  };

  return (
    <motion.button
      type="button"
      onClick={() => onOpen?.(nft)}
      onMouseEnter={play}
      onMouseLeave={pause}
      onFocus={play}
      onBlur={pause}
      // The card lifts AND tilts a fraction of a degree — the wordmark's lean, applied to
      // motion. Stiffer and less damped than before so it arrives fast and overshoots
      // slightly instead of gliding; that snap is the brand's energy. The tilt returns to
      // 0 on tap so the pressed state reads as flat-to-the-page.
      whileHover={{ y: -6, rotate: -0.8 }}
      whileTap={{ scale: 0.97, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26, mass: 0.6 }}
      aria-label={`${actionLabel} — ${name}`}
      aria-pressed={selected || undefined}
      className={cn(
        'group relative block w-full overflow-hidden rounded-2xl glass-panel text-left',
        selected && 'ring-2 ring-purple-400 ring-offset-2 ring-offset-slate-950',
        artClassName,
        className,
      )}
      // Inline rather than an `aspect-[…]` class: Tailwind compiles arbitrary values at build
      // time from the source text, so a runtime number in a class name generates no rule at all.
      style={{ aspectRatio: ratio }}
    >
      {/* The blurred bed. Only ever visible where the art doesn't fill the box — i.e. on a
          collection whose tokens vary in shape, or on an outlier in an otherwise uniform one.
          A soft enlargement of the piece itself reads as deliberate, where flat bars read as
          a broken crop. Sourced from the thumbnail, so it costs a few KB rather than a second
          decode of the full image. */}
      {bed && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 scale-[1.15] bg-cover bg-center opacity-55',
            'blur-2xl saturate-150 transition-transform duration-700',
            // The hover zoom lives HERE, not on the artwork. Scaling `object-contain` media
            // pushes it past the box and `overflow-hidden` clips it — which would crop the
            // piece on hover, reintroducing the very bug this change removes.
            'group-hover:scale-[1.25] motion-reduce:group-hover:scale-[1.15]',
          )}
          style={{ backgroundImage: `url("${bed}")` }}
        />
      )}

      {/* A video-only token has no still, so there is no thumbnail to build a bed from — a
          non-square film would letterbox onto bare panel. The brand wash stands in behind it.
          Must precede the <video> below: these are absolute siblings, so DOM order is paint
          order and a later sibling would cover the film. */}
      {!bed && !showStill && film && (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 30% 20%, rgb(var(--brand-rgb) / 0.22), rgb(var(--ground-rgb)) 75%)',
          }}
        />
      )}

      {showStill && (
        <>
          {/* Brand-tinted placeholder so a card streaming its image isn't a black hole. */}
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
            alt={name}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'absolute inset-0 h-full w-full object-contain transition-all duration-700',
              loaded ? 'opacity-100' : 'opacity-0',
              // The still fades out under the playing video on hover. Where there's no film,
              // the hover response is brightness — the zoom moved to the bed, above.
              film ? 'group-hover:opacity-0' : 'group-hover:brightness-110',
            )}
          />
        </>
      )}

      {film && (
        <video
          ref={videoRef}
          src={film}
          onError={() => setVideoFailed(true)}
          // The autoPlay attribute alone is unreliable (browsers apply it before the
          // media is ready, and some block it outright), so kick it off once playable.
          onCanPlay={(event) => {
            if (autoPlays) event.currentTarget.play().catch(() => {});
          }}
          muted
          loop
          playsInline
          autoPlay={autoPlays}
          // Don't prefetch a video that only plays on hover.
          preload={autoPlays ? 'metadata' : 'none'}
          className={cn(
            'absolute inset-0 h-full w-full object-contain transition-opacity duration-500',
            autoPlays ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
      )}


      {/* Legible scrim, always present at the bottom so the caption never floats on art. */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className="min-w-0">
          {brand && (
            <p
              className="truncate text-[11px] font-semibold uppercase tracking-widest"
              style={{ color: brand.accent }}
            >
              {brand.name}
            </p>
          )}
          <p className="truncate text-sm font-semibold text-white">{name}</p>
        </div>
        {film && (
          <span
            title="This piece is a film"
            className="mb-0.5 flex shrink-0 items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur"
          >
            <Play className="h-2.5 w-2.5 fill-current" /> Film
          </span>
        )}
      </div>

      <div className="absolute inset-x-0 top-0 flex items-start justify-end p-3">
        {selected ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_12px_rgb(var(--brand-rgb)/0.5)] border border-purple-400">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
          </span>
        ) : (
          <span
            className={cn(
              'keyline flex items-center gap-1 rounded-full bg-purple-600 px-2 py-1 text-[11px] font-semibold text-white transition-opacity duration-300 group-hover:opacity-100',
              'opacity-0',
            )}
          >
            <ActionIcon className="w-3 h-3" /> {actionLabel}
          </span>
        )}
      </div>
    </motion.button>
  );
};

export default NftCard;
