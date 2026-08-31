import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useFeaturedNfts } from '../hooks/useFeaturedNfts';
import { LIVE_COLLECTIONS, artRatio } from '../data/brands';
import NftCard from './NftCard';
import { useAvailableNfts } from '../lib/unavailableMedia';
import { cn } from '../lib/cn';
import { assetKey } from '../lib/assetKey';

// Widths are derived from the registry's real ratios rather than assumed square, so the
// placeholder strip is the same shape as the loaded one and nothing shifts sideways.
const SKELETON_RATIOS = LIVE_COLLECTIONS.map(artRatio);

// Module scope so the reference is stable and the filter's useMemo isn't invalidated every render.
const selectNft = (item) => item.nft;

const SkeletonRow = () => (
  <div className="flex gap-5 px-6">
    {Array.from({ length: 8 }).map((_, index) => (
      <div
        key={index}
        className="h-44 shrink-0 animate-[shimmer_1.6s_ease-in-out_infinite] rounded-2xl bg-white/5 md:h-52"
        style={{
          aspectRatio: SKELETON_RATIOS[index % SKELETON_RATIOS.length],
          animationDelay: `${index * 90}ms`,
        }}
      />
    ))}
  </div>
);

/**
 * The always-moving wall of licensable work. Replaces the old single-collection
 * gallery: pieces come from every verified brand collection, the track duplicates
 * its contents and translates -50% so the loop is seamless at any width (the old
 * version hardcoded -1000px and visibly jumped), and hovering pauses it so you can
 * actually click something.
 */
const FeaturedMarquee = ({ onToggle, selectedKeys, className }) => {
  const { items, loading, isMock } = useFeaturedNfts({ perCollection: 3, max: 24 });
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const filteredItems = items.filter(
    (item) => item.collection?.brand?.slug !== 'animoca-brands'
  );
  const available = useAvailableNfts(filteredItems, selectNft);

  if (loading) {
    return (
      <div className={cn('overflow-hidden border-y border-white/5 bg-black/30 py-8', className)}>
        <SkeletonRow />
      </div>
    );
  }

  if (!available.length) return null;

  const track = [...available, ...available];

  return (
    <div
      id="explore"
      className={cn('relative border-y border-white/5 bg-black/30 py-8', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="marquee-mask overflow-hidden">
        <div
          className={cn(
            'marquee-track flex w-max gap-5 px-6',
            // Variable-width cards make the track longer than the old all-square one; the duration
            // rises to match so the strip keeps roughly its previous speed.
            !reduceMotion && 'animate-[marquee_110s_linear_infinite]',
          )}
          style={paused ? { animationPlayState: 'paused' } : undefined}
        >
          {track.map(({ nft, collection }, index) => {
            const key = assetKey(collection.chain, collection.address, nft.tokenId);
            const isSelected = selectedKeys?.has(key) ?? false;
            return (
              <NftCard
                key={`${collection.address}-${nft.tokenId}-${index}`}
                nft={nft}
                brand={collection.brand}
                isMock={isMock}
                selected={isSelected}
                onOpen={() => onToggle?.({ nft, collection })}
                ratio={artRatio(collection)}
                // Height is fixed and the width follows the artwork's shape, so the strip reads
                // as a real strip of film: narrow portraits, wide slabs, whatever the piece is.
                className="h-44 w-auto shrink-0 md:h-52"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FeaturedMarquee;
