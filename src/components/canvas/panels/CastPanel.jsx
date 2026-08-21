import { Users } from 'lucide-react';
import HoloArc from '../HoloArc';
import CanvasPanel from './CanvasPanel';
import { resolveNftName } from '../../../services/alchemy';

/**
 * The selected cast, shown as a compact horizontal strip so it fits in a narrow sidebar.
 */
const CastPanel = ({
  cast,
  primaryKey,
  setPrimary,
  removeAsset,
  openPicker,
  loading,
  full,
  analysis,
  readOnly = false,
}) => {
  const primary = cast.find((entry) => entry.key === primaryKey) ?? cast[Math.floor(cast.length / 2)];

  return (
    <CanvasPanel title="Cast" icon={Users}>
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
    </CanvasPanel>
  );
};

export default CastPanel;
