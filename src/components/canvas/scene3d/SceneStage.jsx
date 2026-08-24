import { useMemo, useState } from 'react';
import { Edges, Grid, Line } from '@react-three/drei';
import { cameraBasis, sensorHeightMm } from '../../../../worker/scene.js';

// What one beat's geometry looks like, drawn from the same numbers worker/scene.js validates and
// compiles to H3. Nothing here is decorative: every metre on screen is a metre in the JSON.
//
// READ-ONLY, AND OBVIOUSLY SO. Adam's rule for this pass — every visual element must be either
// interactive or unmistakably read-only, because a thing that looks draggable and isn't is worse
// than a thing that plainly isn't. So, deliberately:
//   - no shadows and no depth cues on subjects. Shadows are drag-affordances in 3D UX; flat,
//     muted volumes read as "schematic" rather than "model".
//   - no grab cursor anywhere. The cursor stays default until editing actually lands.
//   - hovering a subject shows its LABEL, not a handle. "This is the ape", not "drag to move".
// Editing is the next pass, and these are cheap to reverse then. What matters now is that nothing
// on screen lies about what it can do.

const PURPLE = '#a855f7';
const EDGE = '#c4b5fd';
const CAMERA_COLOR = '#38bdf8';
const PATH_COLOR = '#fbbf24';

/** A person is a capsule, a car or a building is a box. Not cosmetic: a viewer has to be able to
 * tell a character from a vehicle at a glance, and the schema already says which is which by its
 * proportions — anything much taller than it is wide is a figure. */
const isFigure = (subject) => subject.heightM > subject.widthM * 1.6;

const Subject = ({ subject, nameOf, onHover }) => {
  const [hovered, setHovered] = useState(false);
  const height = Math.max(subject.heightM ?? 1.8, 0.05);
  const width = Math.max(subject.widthM ?? 0.6, 0.05);
  const y = (subject.groundOffsetM ?? 0) + height / 2;
  const yaw = ((subject.yawDeg ?? 0) * Math.PI) / 180;

  const label = nameOf(subject.subject);
  const enter = () => {
    setHovered(true);
    onHover?.({ label, action: subject.action, tag: subject.subject });
  };
  const leave = () => {
    setHovered(false);
    onHover?.(null);
  };

  // A capsule's `args` are [radius, cylinderLength], and the caps add a radius at each end — so
  // the cylinder has to be shortened by the full diameter or every figure stands taller than its
  // own heightM, which is exactly the kind of quiet lie this whole build exists not to tell.
  const radius = Math.min(width / 2, height / 2);
  const cylinderLength = Math.max(height - radius * 2, 0.01);

  return (
    <group position={[subject.x ?? 0, y, subject.z ?? 0]} rotation={[0, yaw, 0]}>
      <mesh onPointerOver={enter} onPointerOut={leave}>
        {isFigure(subject) ? (
          <capsuleGeometry args={[radius, cylinderLength, 4, 12]} />
        ) : (
          <boxGeometry args={[width, height, Math.max(width * 0.6, 0.2)]} />
        )}
        <meshBasicMaterial color={PURPLE} transparent opacity={hovered ? 0.42 : 0.22} />
        <Edges color={hovered ? '#ffffff' : EDGE} />
      </mesh>
      {/* Which way this subject faces. yaw 0 faces +Z, per the coordinate contract. */}
      <mesh position={[0, -height / 2 + 0.05, Math.max(width * 0.7, 0.35)]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[Math.min(width * 0.28, 0.22), Math.min(width * 0.5, 0.4), 3]} />
        <meshBasicMaterial color={EDGE} transparent opacity={0.5} />
      </mesh>
    </group>
  );
};

/** Where a subject travels within the beat. Drawn only when it actually moves, so a still frame
 * stays still — `endX`/`endZ` equal to `x`/`z` is the schema's own way of saying "does not move". */
const SubjectPath = ({ subject }) => {
  const moved = Math.hypot((subject.endX ?? subject.x) - subject.x, (subject.endZ ?? subject.z) - subject.z);
  if (moved < 0.05) return null;
  const y = (subject.groundOffsetM ?? 0) + 0.05;
  return (
    <Line
      points={[[subject.x, y, subject.z], [subject.endX, y, subject.endZ]]}
      color={PATH_COLOR}
      lineWidth={1.5}
      dashed
      dashSize={0.3}
      gapSize={0.2}
    />
  );
};

/** The lens, drawn as the volume it actually sees.
 *
 * FRUSTUM AS TRUTH, not as decoration (Adam's round-7 hazard note). The half-angles come from the
 * same sensor arithmetic worker/scene.js projects with — 36mm wide, frame height 36/aspect — so a
 * subject inside this wireframe is a subject inside the shot, and one outside it is not. If these
 * two ever disagree, the visitor is editing something that will not exist in the render. */
const Frustum = ({ pose, focalMm, rollDeg = 0, aspect, color = CAMERA_COLOR, opacity = 0.5, depth = 6 }) => {
  const points = useMemo(() => {
    const { forward, right, up } = cameraBasis(pose, rollDeg);
    const halfH = (sensorHeightMm(aspect) / 2 / focalMm) * depth;
    const halfW = (36 / 2 / focalMm) * depth;
    const apex = [pose.position.x, pose.position.y, pose.position.z];
    const corner = (sx, sy) => [
      pose.position.x + forward.x * depth + right.x * halfW * sx + up.x * halfH * sy,
      pose.position.y + forward.y * depth + right.y * halfW * sx + up.y * halfH * sy,
      pose.position.z + forward.z * depth + right.z * halfW * sx + up.z * halfH * sy,
    ];
    const tl = corner(-1, 1);
    const tr = corner(1, 1);
    const br = corner(1, -1);
    const bl = corner(-1, -1);
    return [apex, tl, tr, apex, br, bl, apex, tl, bl, br, tr];
  }, [pose, focalMm, rollDeg, aspect, depth]);

  return <Line points={points} color={color} lineWidth={1} transparent opacity={opacity} />;
};

/**
 * One beat, in world space.
 *
 * `showCamera` is off in the beat's own camera view — you do not draw the lens you are looking
 * through — and on when the visitor orbits away from it, which is the moment the camera becomes
 * a thing in the scene rather than the point of view on it.
 */
const SceneStage = ({ scene, aspect = 16 / 9, showCamera = true, nameOf = (tag) => tag, onHover }) => {
  const subjects = scene?.subjects ?? [];
  const camera = scene?.camera;
  const cameraMoved =
    camera &&
    Math.hypot(
      camera.end.position.x - camera.start.position.x,
      camera.end.position.y - camera.start.position.y,
      camera.end.position.z - camera.start.position.z,
    ) > 0.05;

  return (
    <>
      {/* Flat, even light. Nothing casts a shadow, on purpose — see the header. */}
      <ambientLight intensity={1.4} />
      <Grid
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#312e5f"
        sectionSize={5}
        sectionThickness={0.8}
        sectionColor="#4c1d95"
        fadeDistance={60}
        fadeStrength={1.5}
        infiniteGrid
        followCamera={false}
      />
      {subjects.map((subject) => (
        <group key={subject.subject}>
          <Subject subject={subject} nameOf={nameOf} onHover={onHover} />
          <SubjectPath subject={subject} />
        </group>
      ))}
      {showCamera && camera && (
        <>
          <Frustum pose={camera.start} focalMm={camera.focalStartMm} rollDeg={camera.rollDeg} aspect={aspect} />
          {cameraMoved && (
            <>
              {/* Where the lens ends up, and the line it travels — this is the channel the old
                  2D schematic never drew, and the reason beats 2-4 all looked identical. */}
              <Frustum
                pose={camera.end}
                focalMm={camera.focalEndMm}
                rollDeg={camera.rollDeg}
                aspect={aspect}
                opacity={0.22}
              />
              <Line
                points={[
                  [camera.start.position.x, camera.start.position.y, camera.start.position.z],
                  [camera.end.position.x, camera.end.position.y, camera.end.position.z],
                ]}
                color={PATH_COLOR}
                lineWidth={2}
              />
            </>
          )}
        </>
      )}
    </>
  );
};

export default SceneStage;
