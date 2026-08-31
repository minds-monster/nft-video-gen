import { useMemo, useState } from 'react';
import { OrbitControls, PerspectiveCamera, View } from '@react-three/drei';
import SceneStage from './SceneStage';
import { fovFromFocal } from './lens';

// One beat as an interactive 3D frame.
//
// IT OPENS ON THE BEAT'S OWN CAMERA. Not a three-quarter overview with the camera drawn in it —
// the actual shot, through the actual lens, at the actual focal length the JSON specifies. That
// is what makes the tile a storyboard FRAME rather than a diagram of one, and it is the property
// that makes the picture change between beats: a push-in genuinely looks closer, because it is.
//
// Orbiting away from it is one drag, and the shot is one click back. The camera appears in the
// scene the moment you leave its point of view, which is the moment it stops being the viewpoint
// and starts being an object.

// Attribution where the visitor actually meets the work, not in stored metadata. Hovering a
// subject says which piece it is, and — once the cast is on the record — which artwork it comes
// from. That is the difference between attribution as a product surface and attribution as a
// compliance checkbox.
const HoverLabel = ({ hovered }) =>
  hovered ? (
    <div className="pointer-events-none absolute bottom-2 left-2 max-w-[85%] rounded-lg bg-black/80 px-2 py-1 text-[10px] leading-snug text-slate-200">
      <span className="font-semibold text-purple-200">{hovered.label}</span>
      {hovered.action ? <span className="text-slate-400"> — {hovered.action}</span> : null}
      {hovered.source ? <span className="block text-[9px] text-slate-500">from {hovered.source}</span> : null}
    </div>
  ) : null;

/**
 * The 3D half of a beat card. The View paints into its own element, sized to fill the card's
 * aspect box; the actual WebGL context is shared across every tile on the page (see ViewCanvas)
 * because browsers cap contexts at roughly 8-16 and a six-beat storyboard with a canvas per card
 * would sit right on that limit.
 */
const BeatView = ({ frame, aspect = 16 / 9, active = true, nameOf, castAssets, showArt = false }) => {
  const [orbiting, setOrbiting] = useState(false);
  const [hovered, setHovered] = useState(null);
  const scene = frame?.scene;
  const camera = scene?.camera;

  const pose = camera?.start;
  const fov = useMemo(() => fovFromFocal(camera?.focalStartMm ?? 35, aspect), [camera?.focalStartMm, aspect]);
  const target = useMemo(
    () => (pose ? [pose.lookAt.x, pose.lookAt.y, pose.lookAt.z] : [0, 1, 0]),
    [pose],
  );

  if (!scene || !pose) return null;

  return (
    <>
      {active && (
        // MEASURED THE HARD WAY, 2026-08-24: outside a <Canvas>, drei's View renders its OWN
        // element and tracks that one — the `track` prop is only honoured by the in-canvas
        // variant, and passing it here is silently ignored. The first build did exactly that, and
        // the result was a row of black rectangles: an unsized div means a zero-height viewport,
        // so the canvas dutifully rendered nothing, with no error anywhere to explain it.
        // Sizing View's own element is the whole fix.
        <View className="h-full w-full">
          <PerspectiveCamera
            makeDefault
            fov={fov}
            // Remounting on reset is what restores the shot exactly — OrbitControls owns the
            // camera once it has been dragged, so the only reliable way back is a fresh one.
            key={orbiting ? 'orbit' : 'shot'}
            position={[pose.position.x, pose.position.y, pose.position.z]}
            // A dutch angle is a real roll about the view axis, not a label, so the frame is
            // canted here exactly as the render will be.
            rotation={[0, 0, ((camera.rollDeg ?? 0) * Math.PI) / 180]}
            near={0.05}
            far={2000}
          />
          <OrbitControls
            target={target}
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
            // Orbiting IS the close inspection — it is the moment a flat card stops being enough.
            detail={orbiting}
          />
        </View>
      )}

      {/* Chrome. Lives in the DOM rather than in the scene so it stays crisp and legible at tile
          size, and so the 3D never has to render text. */}
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
        View only
      </span>
      {orbiting && (
        <button
          type="button"
          onClick={() => setOrbiting(false)}
          className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-0.5 text-[9px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-black/90 hover:text-sky-200"
        >
          Back to shot
        </button>
      )}
      <HoverLabel hovered={hovered} />
    </>
  );
};

export default BeatView;
