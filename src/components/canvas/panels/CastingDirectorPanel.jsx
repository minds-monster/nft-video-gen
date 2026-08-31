import { Eye } from 'lucide-react';
import CastingLog from '../CastingLog';
import CanvasPanel from './CanvasPanel';

/**
 * Persistent log of what the Casting Director saw in each cast member.
 *
 * Cards stream live and then settle in place — they no longer fold themselves shut the moment
 * the reading finishes, which was happening exactly when the text became worth reading.
 */
const CastingDirectorPanel = ({ id, cast, analysis, streams, thoughts, collapsed, onToggle, status }) => (
  <CanvasPanel
    id={id}
    title="Casting Director"
    icon={Eye}
    collapsed={collapsed}
    onToggle={onToggle}
    status={status}
  >
    <CastingLog cast={cast} analysis={analysis} streams={streams} thoughts={thoughts} />
    {cast.length === 0 && (
      <p className="py-6 text-center text-xs text-slate-500">
        Add pieces to the cast to see the Casting Director&rsquo;s readings.
      </p>
    )}
  </CanvasPanel>
);

export default CastingDirectorPanel;
