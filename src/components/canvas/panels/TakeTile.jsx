import { useRef } from 'react';
import { AlertTriangle, Loader2, Play } from 'lucide-react';

import { cn } from '../../../lib/cn';
import { TAKE_STATUS } from '../../../lib/takeTone';

/**
 * One take, as a card. Shared by Dailies and Screen Tests so the two views cannot drift apart.
 *
 * THE CARD IS NOT A PLAYER. It used to be — both views were a single column of full-width
 * <video controls>, which meant scrolling a stack of small players and no way to watch any of
 * them large. The card's job now is to say what this take is, what it cost and whether it
 * worked; watching it is the Viewer's job, one click away.
 *
 * THE POSTER FRAME. There is no thumbnail on a take record — the mp4 is the only media we have —
 * so the first frame is fetched with a `#t=0.1` media fragment, which makes the browser paint a
 * real frame instead of a black rectangle. The fragment is resolved client-side, so the signed
 * R2 query string survives it untouched. A browser that ignores it falls back to a black tile
 * with the play badge: degraded, not broken.
 *
 * Hover plays, muted and looping — the same bargain NftCard strikes for film NFTs. `preload` is
 * metadata and there are no controls, because a nine-tile grid must not decode nine videos.
 */

// Where the poster frame is taken from, and where hover playback rewinds to. Not zero: the
// first frame of an H3 render is routinely black, which is exactly the tile we are trying to
// avoid showing.
const POSTER_AT = 0.1;

const TakeTile = ({ take, active, onOpen, children }) => {
  const videoRef = useRef(null);
  const state = TAKE_STATUS[take.status] ?? TAKE_STATUS.pending;
  const shooting = !take.url && take.status !== 'failed' && take.status !== 'unsettled';

  return (
    <button
      type="button"
      onClick={() => onOpen?.(take.takeId)}
      title={take.url ? 'Watch it in the viewer' : (take.reason ?? undefined)}
      className={cn(
        'group min-w-0 rounded-2xl border bg-black/20 p-2 text-left transition-colors',
        active ? 'border-purple-400/50 bg-purple-500/5' : 'border-white/10 hover:border-white/25',
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {take.url ? (
          <video
            ref={videoRef}
            // See the header: the fragment is what makes a frame appear.
            src={`${take.url}#t=${POSTER_AT}`}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={() => videoRef.current?.play().catch(() => {})}
            onMouseLeave={() => {
              const video = videoRef.current;
              if (!video) return;
              video.pause();
              video.currentTime = POSTER_AT;
            }}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-slate-600">
            {shooting ? (
              <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400/70" />
            )}
          </span>
        )}

        {take.url && (
          <span className="pointer-events-none absolute bottom-1 right-1 flex items-center rounded-full bg-black/70 p-1 text-white opacity-80 backdrop-blur transition-opacity group-hover:opacity-0">
            <Play className="h-2.5 w-2.5 fill-current" />
          </span>
        )}

        <span
          className={cn(
            'pointer-events-none absolute left-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider backdrop-blur',
            state.className,
          )}
        >
          {state.label}
        </span>
      </div>

      {children}
    </button>
  );
};

export default TakeTile;
