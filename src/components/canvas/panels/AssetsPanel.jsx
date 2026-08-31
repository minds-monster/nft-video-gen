import { useState } from 'react';
import { Search } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import RandomAssetView from './assets/RandomAssetView';
import DirectoryView from './assets/DirectoryView';
import CollectionListView from './assets/CollectionListView';
import { cn } from '../../../lib/cn';

const VIEWS = {
  RANDOM: 'random',
  DIRECTORY: 'directory',
  COLLECTIONS: 'collections',
};

const TABS = [
  { key: VIEWS.COLLECTIONS, label: 'Collections' },
  { key: VIEWS.DIRECTORY, label: 'Directory' },
  { key: VIEWS.RANDOM, label: 'Random' },
];

/**
 * The persistent asset browser with three alternate views:
 *  - Collections: small-icon list of every collection
 *  - Directory: brand → collection → asset hierarchy
 *  - Random: a shuffled grid of individual pieces
 */
const AssetsPanel = ({ id, pool, castKeys, isMock, onPreview, onBrowseCollection }) => {
  const [view, setView] = useState(VIEWS.COLLECTIONS);

  return (
    <CanvasPanel id={id} title="Assets" icon={Search}>
      <div className="mb-2 flex items-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            className={cn(
              'flex-1 rounded-md px-1.5 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors',
              view === tab.key
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:bg-white/5 hover:text-white',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {view === VIEWS.RANDOM && (
          <RandomAssetView
            pool={pool}
            castKeys={castKeys}
            isMock={isMock}
            onPreview={onPreview}
          />
        )}
        {view === VIEWS.DIRECTORY && (
          <DirectoryView pool={pool} onPreview={onPreview} onBrowseCollection={onBrowseCollection} />
        )}
        {view === VIEWS.COLLECTIONS && (
          <CollectionListView pool={pool} onBrowseCollection={onBrowseCollection} />
        )}
      </div>
    </CanvasPanel>
  );
};

export default AssetsPanel;
