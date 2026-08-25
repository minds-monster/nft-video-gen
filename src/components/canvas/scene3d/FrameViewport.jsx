import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import SceneStage from './SceneStage';
import { fovFromFocal } from './lens';

// The expanded frame's own canvas.
//
// Deliberately NOT a shared <View> like the timeline tiles: the modal sits above the shared
// canvas in z-order, so a view painted by that canvas would be hidden behind the modal it belongs
// to. One extra WebGL context for one modal at a time is well inside the browser's limit, and it
// keeps the modal independent of whatever the timeline behind it is doing.
const FrameViewport = ({ frame, aspect = 16 / 9, nameOf, castAssets, showArt = false }) => {
  const [orbiting, setOrbiting] = useState(false);
  const [hovered, setHovered] = useState(null);
  const scene = frame?.scene;
  const camera = scene?.camera;
  const pose = camera?.start;
  const fov = useMemo(() => fovFromFocal(camera?.focalStartMm ?? 35, aspect), [camera?.focalStartMm, aspect]);

  if (!scene || !pose) return null;

  return (
    <div className="relative h-full w-full">
      <Canvas gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <PerspectiveCamera
          makeDefault
          key={orbiting ? 'orbit' : 'shot'}
          fov={fov}
          position={[pose.position.x, pose.position.y, pose.position.z]}
          rotation={[0, 0, ((camera.rollDeg ?? 0) * Math.PI) / 180]}
          near={0.05}
          far={2000}
        />
        <OrbitControls
          target={[pose.lookAt.x, pose.lookAt.y, pose.lookAt.z]}
          enablePan={false}
          enableDamping
          dampingFactor={0.12}
          makeDefault
          onStart={() => setOrbiting(true)}
        />
        <SceneStage
          scene={scene}
          aspect={aspect}
          showCamera={orbiting}
          nameOf={nameOf}
          onHover={setHovered}
          castAssets={castAssets}
          showArt={showArt}
        />
      </Canvas>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
        View only
      </span>
      {orbiting && (
        <button
          type="button"
          onClick={() => setOrbiting(false)}
          className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-0.5 text-[9px] uppercase tracking-wider text-sky-300 hover:bg-black/90"
        >
          Back to shot
        </button>
      )}
      {hovered && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/80 px-2 py-1 text-[11px] text-slate-200">
          <span className="font-semibold text-purple-200">{hovered.label}</span>
          {hovered.action ? <span className="text-slate-400"> — {hovered.action}</span> : null}
          {hovered.source ? <span className="block text-[10px] text-slate-500">from {hovered.source}</span> : null}
        </div>
      )}
    </div>
  );
};

export default FrameViewport;
