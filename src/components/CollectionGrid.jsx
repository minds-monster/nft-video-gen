import { useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { ChevronRight, Clock } from 'lucide-react';
import { useCollectionNfts } from '../hooks/useCollectionNfts';
import { chainLabel } from '../services/alchemy';
import { DEFAULT_ART_RATIO, artRatio } from '../data/brands';
import { LICENSE_STATUS } from '../config/licensing';
import LicenseBadge from './LicenseBadge';
import NftCard from './NftCard';
import { useAvailableNfts } from '../lib/unavailableMedia';
import { cn } from '../lib/cn';

// `ratio` matches the loaded cards' box, so the grid doesn't jump height when data lands.
const Skeleton = ({ count = 6, ratio = DEFAULT_ART_RATIO, columns }) => (
  <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3', columns)}>
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className="animate-[shimmer_1.6s_ease-in-out_infinite] rounded-2xl bg-white/5"
        style={{ aspectRatio: ratio, animationDelay: `${index * 80}ms` }}
      />
    ))}
  </div>
);

// A brand we can't resolve on-chain yet still belongs on the wall — but it shows a
// deliberate placeholder, never another brand's artwork.
const PendingTile = ({ brand }) => (
  <div
    className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-dashed border-white/10 p-8 md:flex-row md:items-center"
    style={{
      background: 'linear-gradient(120deg, rgb(var(--brand-rgb) / 0.10), transparent 60%)',
    }}
  >
    <div>
      <p className="font-display text-3xl uppercase tracking-tight" style={{ color: brand.accent }}>
        {brand.name}
      </p>
      <p className="mt-2 max-w-xl text-sm text-slate-400">{brand.blurb}</p>
    </div>
    <div className="chip flex items-center gap-2 px-4 py-2 text-xs text-slate-400">
      <Clock className="h-3.5 w-3.5" />
      Collection pending — licensing coming soon
    </div>
  </div>
);

const CollectionGrid = ({ brand, onOpen, limit = 12 }) => {
  const sectionRef = useRef(null);
  // Load a brand's artwork only once its section is near the viewport — 13 brands
  // fetching at once on mount would be a wall of spinners and wasted requests.
  const inView = useInView(sectionRef, { once: true, margin: '400px 0px' });
  const [activeIndex, setActiveIndex] = useState(0);

  const collections = brand.collections ?? [];
  const active = collections[activeIndex];

  const { nfts, loading, settled, isMock } = useCollectionNfts({
    chain: active?.chain,
    address: active?.address,
    limit: 24,
    enabled: Boolean(active) && inView,
  });

  // Filtered BEFORE the slice, so dropping a token with dead artwork pulls the next one
  // up rather than leaving a hole in the row.
  const available = useAvailableNfts(nfts);
  const shown = available.slice(0, limit);

  // The grid shows ONE collection at a time, so a single box ratio is coherent for the whole
  // wall of tiles. Tall artwork drops to five across: six 2:3 portraits in a max-w-7xl row
  // would make the section about half again as tall, and five gives each piece more room.
  const ratio = artRatio(active);
  const columns = ratio < 0.8 ? 'lg:grid-cols-5' : 'lg:grid-cols-6';

  return (
    <section ref={sectionRef} id={`brand-${brand.slug}`} className="scroll-mt-48">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="h-8 w-1 rounded-full" style={{ backgroundColor: brand.accent }} />
            <h3 className="text-3xl uppercase tracking-tight md:text-4xl">{brand.name}</h3>
            {active && (
              <LicenseBadge
                status={isMock ? LICENSE_STATUS.DEMO : LICENSE_STATUS.LICENSABLE}
                className="translate-y-0.5"
              />
            )}
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{brand.blurb}</p>
        </div>

        {collections.length > 1 && (
          <div className="no-scrollbar flex max-w-full gap-2 overflow-x-auto">
            {collections.map((collection, index) => (
              <button
                key={collection.address}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors',
                  index === activeIndex
                    ? 'border-white/25 bg-white/15 text-white'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white',
                )}
              >
                {collection.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!active ? (
        <PendingTile brand={brand} />
      ) : loading || !settled ? (
        <Skeleton count={limit > 6 ? 6 : limit} ratio={ratio} columns={columns} />
      ) : !shown.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">
          {/* Two different empty states. Tokens came back but every one of them had unshowable
              artwork (the whole collection's media has gone offline) — blaming the fetch there
              would send someone to check an Alchemy setting that is working fine. */}
          {nfts.length > 0 ? (
            <>
              {active.name} resolves on-chain, but none of its artwork is reachable right now —
              the collection&apos;s media host isn&apos;t serving. Nothing to show rather than
              empty frames.
            </>
          ) : (
            <>
              Couldn&apos;t load {active.name} right now. It may not be enabled on this Alchemy
              app — try again shortly.
            </>
          )}
        </div>
      ) : (
        <>
          <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3', columns)}>
            {shown.map((nft) => (
              <NftCard
                key={`${active.address}-${nft.tokenId}`}
                nft={nft}
                brand={brand}
                isMock={isMock}
                ratio={ratio}
                onOpen={() =>
                  onOpen?.({
                    chain: active.chain,
                    address: active.address,
                    tokenId: nft.tokenId,
                  })
                }
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              {active.name} · {chainLabel(active.chain)}
            </span>
            {active.note && <span className="text-slate-600">{active.note}</span>}
            {available.length > limit && (
              <button
                type="button"
                onClick={() =>
                  onOpen?.({
                    chain: active.chain,
                    address: active.address,
                    tokenId: shown[0].tokenId,
                  })
                }
                className="flex items-center gap-1 text-purple-300 hover:text-purple-200"
              >
                Open in studio <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default CollectionGrid;
