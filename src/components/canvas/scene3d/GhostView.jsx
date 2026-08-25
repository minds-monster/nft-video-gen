import { useMemo } from 'react';
import { OrbitControls, PerspectiveCamera, View } from '@react-three/drei';
import GhostStage from './GhostStage';
import { fovFromFocal } from './lens';

// A beat as it is being thought about.
//
// The viewpoint is NOT the beat's own camera, even once the model has proposed one. A provisional
// camera moves every few seconds while it reconsiders, and slaving the viewpoint to it would swing
// the whole picture around each time — motion sickness in service of nothing. So this watches the
// set from a fixed three-quarter angle, and the proposed lens appears IN the scene as a dashed
// frustum, which is also the only way to see the camera being placed at all.
//
// It becomes a real BeatView the moment the validated geometry arrives.

/** Frame the whole proposal, whatever scale it turns out to be. A salt flat at 80 metres and a
 * face at 30 centimetres are both normal here, so the viewpoint is derived rather than fixed. */
const viewpointFor = (beat) => {
  const points = [];
  for (const s of beat?.subjects ?? []) points.push([s.x ?? 0, s.z ?? 0]);
  if (beat?.camera) points.push([beat.camera.position.x, beat.camera.position.z]);
  if (!points.length) return { position: [8, 6, 12], target: [0, 1, 0] };

  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 4);
  const back = span * 1.1 + 6;
  return { position: [cx + back * 0.55, Math.max(span * 0.5, 3), cz + back], target: [cx, 1, cz] };
};

const GhostView = ({ beat, aspect = 16 / 9, active = true, castAssets = null }) => {
  const view = useMemo(() => viewpointFor(beat), [beat]);
  const hasAnything = Boolean(beat?.camera || beat?.subjects?.length);

  return (
    <>
      {active && hasAnything && (
        <View className="h-full w-full">
          <PerspectiveCamera makeDefault fov={fovFromFocal(28, aspect)} position={view.position} near={0.05} far={4000} />
          <OrbitControls target={view.target} enablePan={false} enableZoom={false} enableDamping autoRotate autoRotateSpeed={0.35} />
          <GhostStage beat={beat} aspect={aspect} castAssets={castAssets} />
        </View>
      )}
      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">
        <span className="h-1 w-1 animate-pulse rounded-full bg-sky-400" />
        Thinking
      </span>
      {beat?.framing && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] uppercase tracking-wider text-sky-300/80">
          {beat.framing}
          {beat.focalMm ? ` · ${beat.focalMm}mm` : ''}
        </span>
      )}
    </>
  );
};

export default GhostView;
