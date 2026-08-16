import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import HoloAssetCard from './HoloAssetCard';
import { useElementSize } from '../../hooks/useElementSize';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/cn';

const CARD_W = 148;
const CARD_H = 186;
const ARC_DEPTH = 52; // how far the ends of the arc dip
const TILT = 26; // degrees each end turns to face the centre

/**
 * Place `count` nodes along a shallow, perspective-tilted arc.
 *
 * `t` runs -1 → 1 across the row, so y is a parabola (ends dip), rotateY turns each card
 * toward the middle, and scale falls off from the centre. The centre node paints on top.
 */
const arcLayout = (count, width) => {
  // Keep the spread from outrunning the container on narrow viewports, and from
  // scattering the cards when there are only two or three.
  const spread = Math.min(width * 0.34, (count * CARD_W) / 2.1);

  return Array.from({ length: count }, (_, index) => {
    const t = count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
    return {
      x: t * spread,
      y: t * t * ARC_DEPTH,
      rotateY: -t * TILT,
      rotateZ: t * 4,
      scale: 1 - Math.abs(t) * 0.12,
      zIndex: Math.round(100 - Math.abs(t) * 50),
    };
  });
};

const AddNode = ({ onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label="Add another piece to the canvas"
    className={cn(
      'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-slate-500 transition-colors',
      disabled
        ? 'cursor-not-allowed opacity-40'
        : 'hover:border-purple-400/60 hover:bg-purple-500/5 hover:text-purple-300',
    )}
    style={{ width: CARD_W, height: CARD_H }}
  >
    <Plus className="h-5 w-5" />
    <span className="font-mono text-[9px] uppercase tracking-widest">Add piece</span>
  </button>
);

const Skeleton = ({ index }) => (
  <div
    className="animate-[shimmer_1.6s_ease-in-out_infinite] rounded-xl border border-white/10 bg-white/[0.04]"
    style={{ width: CARD_W, height: CARD_H, animationDelay: `${index * 90}ms` }}
  />
);

/**
 * The holo table. Cast pieces rise into a curved rank; the primary lifts out of it.
 *
 * Falls back to a horizontal snap rail below `md` and under reduced motion — the arc is
 * built from inline 3D transforms, so neither can be expressed as a Tailwind breakpoint.
 */
const HoloArc = ({
  cast,
  primaryKey,
  onPromote,
  onRemove,
  onSwap,
  onAdd,
  loading,
  full,
}) => {
  const [container, setContainer] = useState(null);
  const { width } = useElementSize(container);
  const reduceMotion = useReducedMotion();
  const isWide = useMediaQuery('(min-width: 768px)');

  // Which card the pointer is on, so it can be raised above its neighbours.
  //
  // The rank overlaps — at a 800px container five cards sit ~30px into each other, seven
  // more like 55px — and zIndex rises toward the centre. That buries the top-right corner
  // of every card left of the middle, which is exactly where the remove button lives:
  // reaching for it crossed onto the neighbour, group-hover ended, the button faded, and
  // the click promoted the wrong piece. Raising the hovered card fixes the cause; the
  // fade-out grace in HoloAssetCard covers the rest.
  const [hoveredKey, setHoveredKey] = useState(null);

  // The add node rides the arc as its last position, so the curve stays continuous.
  const nodeCount = cast.length + 1;
  const layout = useMemo(() => arcLayout(nodeCount, width), [nodeCount, width]);

  const flat = !isWide || reduceMotion;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-4 py-6">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} index={index} />
        ))}
      </div>
    );
  }

  if (flat) {
    return (
      <div className="no-scrollbar overscroll-contain-y -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4">
        {cast.map((entry) => (
          <div key={entry.key} className="snap-center">
            <HoloAssetCard
              entry={entry}
              isPrimary={entry.key === primaryKey}
              onPromote={onPromote}
              onRemove={onRemove}
              onSwap={onSwap}
              width={CARD_W}
              height={CARD_H}
            />
          </div>
        ))}
        <div className="snap-center">
          <AddNode onClick={() => onAdd?.()} disabled={full} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setContainer}
      className="relative w-full"
      style={{ height: CARD_H + ARC_DEPTH + 40, perspective: 1200 }}
    >
      <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        {/* `initial` stays on: HoloArc remounts with the canvas, and the cards rising
            into the rank is the moment the whole surface is built around. */}
        <AnimatePresence>
          {cast.map((entry, index) => {
            const spot = layout[index];
            const isPrimary = entry.key === primaryKey;

            return (
              <motion.div
                key={entry.key}
                className="absolute left-1/2 top-0"
                // Above the primary's 200 too: the primary is scaled up, so it overlaps
                // its neighbours harder than anything else on the arc.
                onHoverStart={() => setHoveredKey(entry.key)}
                onHoverEnd={() => setHoveredKey((current) => (current === entry.key ? null : current))}
                style={{
                  marginLeft: -CARD_W / 2,
                  zIndex:
                    hoveredKey === entry.key ? 300 : isPrimary ? 200 : spot.zIndex,
                }}
                initial={{ opacity: 0, y: 110, rotateX: 42, scale: 0.78, x: spot.x }}
                animate={{
                  opacity: 1,
                  x: spot.x,
                  // The primary lifts clear of the rank it came from.
                  y: spot.y - (isPrimary ? 20 : 0),
                  rotateX: 0,
                  rotateY: spot.rotateY,
                  rotateZ: spot.rotateZ,
                  scale: spot.scale * (isPrimary ? 1.16 : 1),
                }}
                exit={{ opacity: 0, y: 60, scale: 0.7, transition: { duration: 0.2 } }}
                transition={{
                  type: 'spring',
                  stiffness: 280,
                  damping: 30,
                  delay: index * 0.06,
                }}
              >
                <HoloAssetCard
                  entry={entry}
                  isPrimary={isPrimary}
                  onPromote={onPromote}
                  onRemove={onRemove}
                  onSwap={onSwap}
                  width={CARD_W}
                  height={CARD_H}
                />
              </motion.div>
            );
          })}

          <motion.div
            key="add-node"
            className="absolute left-1/2 top-0"
            style={{ marginLeft: -CARD_W / 2, zIndex: 1 }}
            initial={{ opacity: 0, y: 110, scale: 0.78 }}
            animate={{
              opacity: 1,
              x: layout[nodeCount - 1].x,
              y: layout[nodeCount - 1].y,
              rotateY: layout[nodeCount - 1].rotateY,
              rotateZ: layout[nodeCount - 1].rotateZ,
              scale: layout[nodeCount - 1].scale,
            }}
            transition={{
              type: 'spring',
              stiffness: 280,
              damping: 30,
              delay: cast.length * 0.06,
            }}
          >
            <AddNode onClick={() => onAdd?.()} disabled={full} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default HoloArc;
