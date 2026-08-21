import { Eye } from 'lucide-react';
import CastingLog from '../CastingLog';
import CanvasPanel from './CanvasPanel';

/**
 * Persistent log of what the Casting Director saw in each cast member.
 *
 * Live cards stream; settled cards fold but stay in the log so the user can scroll back.
 */
const CastingDirectorPanel = ({ cast, analysis, streams, thoughts }) => (
  <CanvasPanel title="Casting Director" icon={Eye}>
    <CastingLog cast={cast} analysis={analysis} streams={streams} thoughts={thoughts} />
    {cast.length === 0 && (
      <p className="py-6 text-center text-xs text-slate-500">
        Add pieces to the cast to see the Casting Director&rsquo;s readings.
      </p>
    )}
  </CanvasPanel>
);

export default CastingDirectorPanel;
