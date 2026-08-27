import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, Plus } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import TakeView from './TakeView';
import {
  mayBeVideoUrl,
  resolveNftDescription,
  resolveNftMedia,
  resolveNftName,
} from '../../../services/alchemy';
import { artRatio } from '../../../data/brands';
import { useReportUnavailable } from '../../../lib/unavailableMedia';

const PreviewEmpty = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-slate-500">
      <Film className="h-5 w-5" />
    </span>
    <p className="text-xs text-slate-500">Select a piece or a take to watch it here.</p>
  </div>
);

/**
 * The viewer. The one surface in the canvas built for looking at something large.
 *
 * IT SHOWS ANY VISUAL ASSET, whichever end of the pipeline it came from: a piece being browsed,
 * the cast lead, or a take the Director shot and the visitor clicked out of the timeline. It was
 * NFTs only for a while, which had the perverse result that the one thing this app actually
 * produces was the one thing its viewer could not play.
 *
 * TITLED "VIEWER", NOT "MOVIE RENDER". It renders no movie and performs no render. Naming it
 * after the output of the entire pipeline meant the panel promised the finished film and
 * delivered a thumbnail, which is the kind of mismatch that makes somebody distrust every other
 * label on the screen.
 *
 * A take arrives as the resolved record rather than an id, so this stays a dumb display: the
 * lookup lives in PromptCanvas, which is the only place holding both the composer and the
 * Director.
 */
const MovieRenderPanel = ({
  id,
  primary,
  preview,
  previewLoading,
  previewNfts,
  take,
  takeIndex,
  onJudge,
  onAdd,
  onNext,
  onPrev,
  onClear,
  collapsed,
  onToggle,
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const reportUnavailable = useReportUnavailable();

  // A take preview is `{ takeId }` and holds no NFT, so it must not fall through to the NFT
  // branch — every hook below is keyed off `candidate` and each one bails on a candidate with
  // no `.nft`, but the render path has to be explicit about which of the two it is showing.
  const candidate = take ? null : (preview ?? primary);
  const isPreview = Boolean(preview) && !take;

  // Reset failed state when the viewed piece changes, and report it if no media is left.
  useEffect(() => {
    setImageFailed(false);
    setVideoFailed(false);
  }, [candidate?.key, candidate?.nft?.tokenId, candidate?.collection?.address]);

  const { image, video } = useMemo(
    () => (candidate?.nft ? resolveNftMedia(candidate.nft) : { image: null, video: null }),
    [candidate],
  );

  const film = videoFailed
    ? null
    : (video ?? (imageFailed && mayBeVideoUrl(image) ? image : null));

  // Report a token whose media is genuinely exhausted so it gets filtered out of grids,
  // the marquee and future prev/next navigation.
  useEffect(() => {
    if (!candidate?.nft) return;
    const hasStill = Boolean(image) && !imageFailed;
    const hasFilm = Boolean(film);
    if (!hasStill && !hasFilm) {
      reportUnavailable(candidate.nft);
    }
  }, [candidate?.nft, image, imageFailed, film, reportUnavailable]);
  const name = candidate?.nft ? resolveNftName(candidate.nft) : 'No piece selected';
  const description = candidate?.nft ? resolveNftDescription(candidate.nft) : '';
  const ratio = useMemo(
    () => (candidate?.collection ? artRatio(candidate.collection) : '1/1'),
    [candidate],
  );

  const hasNav = isPreview && preview?.nft && previewNfts.length > 1;
  const currentIndex = hasNav
    ? previewNfts.findIndex((nft) => nft && String(nft.tokenId) === String(preview.nft.tokenId))
    : -1;

  return (
    <CanvasPanel
      id={id}
      title="Viewer"
      icon={Film}
      bodyClassName="flex flex-col gap-3"
      collapsed={collapsed}
      onToggle={onToggle}
      status={
        take
          ? { tone: 'idle', text: take.kind === 'screen-test' ? 'screen test' : 'daily' }
          : candidate
            ? { tone: 'idle', text: isPreview ? 'preview' : 'cast lead' }
            : undefined
      }
    >
      {take ? (
        <TakeView take={take} index={takeIndex} onJudge={onJudge} onClear={onClear} />
      ) : !candidate ? (
        <PreviewEmpty />
      ) : (
        <>
          <div className="relative mx-auto flex min-h-0 w-full max-w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            <div
              className="relative max-h-full max-w-full"
              style={{ aspectRatio: ratio }}
            >
              {previewLoading && !candidate.nft ? (
                <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                  Loading…
                </div>
              ) : film ? (
                <video
                  src={film}
                  poster={imageFailed ? undefined : (image ?? undefined)}
                  onError={() => setVideoFailed(true)}
                  onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="block h-full w-full object-contain"
                />
              ) : image && !imageFailed ? (
                <img
                  src={image}
                  alt={name}
                  onError={() => setImageFailed(true)}
                  className="block h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                  No image for this token
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
                  {isPreview ? 'Preview' : 'Cast lead'}
                </p>
                <h3 className="mt-0.5 truncate text-lg uppercase tracking-tight text-white">{name}</h3>
                {description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                    {description}
                  </p>
                )}
              </div>
              {isPreview && (
                <button
                  type="button"
                  onClick={onAdd}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add to cast
                </button>
              )}
            </div>

            {hasNav && (
              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={currentIndex <= 0}
                  aria-label="Previous piece"
                  className="chip p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {currentIndex + 1} / {previewNfts.length}
                </span>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={currentIndex >= previewNfts.length - 1}
                  aria-label="Next piece"
                  className="chip p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  className="ml-2 text-[10px] text-slate-500 transition-colors hover:text-white"
                >
                  Back to lead
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </CanvasPanel>
  );
};

export default MovieRenderPanel;
