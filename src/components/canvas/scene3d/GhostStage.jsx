import { useMemo } from 'react';
import * as THREE from 'three';
import { Billboard, Grid, Line } from '@react-three/drei';
import { cameraBasis, sensorHeightMm } from '../../../../worker/scene.js';
import { useCastTexture } from './useCastTexture';

// The model's thinking, drawn.
//
// These are shapes it has talked itself into and has not committed to — parsed out of its own
// prose while it works (worker/reasoning-geometry.js). They appear, move, and get corrected as it
// changes its mind, and they are thrown away entirely the moment the real geometry arrives.
//
// SO THEY MUST NOT LOOK LIKE THE ANSWER. Everything here is deliberately unfinished: wireframe
// only, no surfaces, dashed camera, and a slow pulse so it reads as alive rather than settled. The
// same discipline as the "View only" chip on a real frame — a thing that looks authoritative and
// isn't is worse than showing nothing.
//
// ROUND 9 PUTS THE REAL CAST IN HERE, AND THE RULE HAD TO BE RESTATED TO ALLOW IT: positions are
// provisional, identity is not. The cast is known before generation starts — it is per cast
// member, not per beat — so there is nothing speculative about WHICH ape this is, only about
// where it ends up standing. Drawing it means the visitor watches the model work out where their
// ape goes, rather than watching a capsule move.
//
// It still must not look settled, so the ghost card is held at low opacity, keeps its wireframe
// box drawn around it, and gets no ground-contact disc — the three things that separate it from
// the finished frame it will become.

const GHOST = '#7dd3fc';
const GHOST_DIM = '#38bdf8';

/** A subject as a wire box: the volume it would occupy if the model means what it currently says. */
const GhostSubject = ({ subject, asset }) => {
  const height = Math.max(subject.heightM ?? 1.8, 0.05);
  const width = Math.max(subject.widthM ?? 0.6, 0.05);
  const depth = Math.max(width * 0.6, 0.2);
  const y = (subject.groundOffsetM ?? 0) + height / 2;
  // Rebuilt only when the model changes its mind about the size, not on every frame.
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)), [width, height, depth]);
  const built = useCastTexture(asset?.assetKey ?? null);

  return (
    <group position={[subject.x ?? 0, y, subject.z ?? 0]}>
      {built && (
        <Billboard follow lockX lockZ>
          <mesh>
            <planeGeometry args={[height * built.aspect, height]} />
            {/* Half-there on purpose. The piece is certain; this position is not. */}
            <meshBasicMaterial map={built.texture} transparent opacity={0.38} alphaTest={0.1} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </Billboard>
      )}
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={subject.containerId ? GHOST_DIM : GHOST} transparent opacity={0.85} />
      </lineSegments>
      {/* A footprint, so a figure standing on the plane reads as standing rather than floating. */}
      <Line
        points={[
          [-width / 2, -height / 2, -depth / 2], [width / 2, -height / 2, -depth / 2],
          [width / 2, -height / 2, depth / 2], [-width / 2, -height / 2, depth / 2],
          [-width / 2, -height / 2, -depth / 2],
        ]}
        color={GHOST_DIM}
        lineWidth={1}
        transparent
        opacity={0.35}
      />
    </group>
  );
};

/** The lens as the model currently imagines it — dashed, because it is still a proposal. */
const GhostFrustum = ({ camera, focalMm = 35, aspect }) => {
  const points = useMemo(() => {
    const { forward, right, up } = cameraBasis(camera, 0);
    const depth = 6;
    const halfH = (sensorHeightMm(aspect) / 2 / focalMm) * depth;
    const halfW = (36 / 2 / focalMm) * depth;
    const apex = [camera.position.x, camera.position.y, camera.position.z];
    const corner = (sx, sy) => [
      camera.position.x + forward.x * depth + right.x * halfW * sx + up.x * halfH * sy,
      camera.position.y + forward.y * depth + right.y * halfW * sx + up.y * halfH * sy,
      camera.position.z + forward.z * depth + right.z * halfW * sx + up.z * halfH * sy,
    ];
    const tl = corner(-1, 1);
    const tr = corner(1, 1);
    const br = corner(1, -1);
    const bl = corner(-1, -1);
    return [apex, tl, tr, apex, br, bl, apex, tl, bl, br, tr];
  }, [camera, focalMm, aspect]);

  return <Line points={points} color={GHOST} lineWidth={1} dashed dashSize={0.35} gapSize={0.25} transparent opacity={0.7} />;
};

const GhostStage = ({ beat, aspect = 16 / 9, castAssets = null }) => (
  <>
    <ambientLight intensity={1.2} />
    <Grid
      args={[40, 40]}
      cellSize={1}
      cellThickness={0.5}
      cellColor="#1e3a5f"
      sectionSize={5}
      sectionThickness={0.8}
      sectionColor="#1d4ed8"
      fadeDistance={70}
      fadeStrength={1.5}
      infiniteGrid
      followCamera={false}
    />
    {(beat?.subjects ?? []).map((subject) => (
      <GhostSubject key={subject.subject} subject={subject} asset={castAssets?.[subject.subject] ?? null} />
    ))}
    {beat?.camera && <GhostFrustum camera={beat.camera} focalMm={beat.focalMm} aspect={aspect} />}
  </>
);

export default GhostStage;
