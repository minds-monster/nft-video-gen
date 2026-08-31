import { Users } from 'lucide-react';
import HoloArc from '../HoloArc';
import CanvasPanel from './CanvasPanel';
import { resolveNftName } from '../../../services/alchemy';

/**
 * The selected cast, shown as a compact horizontal strip so it fits in a narrow sidebar.
 */
const CastPanel = ({
  id,
  cast,
  primaryKey,
  setPrimary,
  removeAsset,
  openPicker,
  loading,
  full,
  analysis,
  readOnly = false,
  status,
}) => {
  const primary = cast.find((entry) => entry.key === primaryKey) ?? cast[Math.floor(cast.length / 2)];

  return (
    <CanvasPanel id={id} title="Cast" icon={Users} status={status}>
      <HoloArc
        cast={cast}
        primaryKey={primaryKey}
        onPromote={setPrimary}
        onRemove={removeAsset}
        onSwap={(key) => openPicker(key)}
        onAdd={() => openPicker(null)}
        loading={loading && cast.length === 0}
        full={full}
        analysis={analysis}
        readOnly={readOnly}
        compact
      />
      <p
        aria-live="polite"
        className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-slate-600"
      >
        {cast.length === 0
          ? 'Add a piece to begin'
          : primary
            ? `${resolveNftName(primary.nft)} leads · ${cast.length} ${cast.length === 1 ? 'piece' : 'pieces'}`
            : `${cast.length} pieces`}
      </p>

      {/* The cast locks the moment the crew starts work, and used to do it in total silence —
          you could click a card, drag it, try to swap it, and simply get nothing back. */}
      {readOnly && cast.length > 0 && (
        <p className="mt-1 text-center text-[10px] leading-relaxed text-slate-600">
          Locked while the crew works.
        </p>
      )}
    </CanvasPanel>
  );
};

export default CastPanel;
