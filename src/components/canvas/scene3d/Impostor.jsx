import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Edges } from '@react-three/drei';
import { useCastTexture } from './useCastTexture';

// A cast member standing in the scene, as itself.
//
// TWO THINGS, DRAWN TOGETHER, BECAUSE THEY CARRY DIFFERENT CLAIMS.
//
//   the CARD  — the piece's own pixels, cut out and stood up at its measured height. This is
//               identity, and it is only defined from the front. It is the artwork; it is not a
//               model of the artwork.
//   the PROXY — a proportioned volume from the dossier's physicalProfile. This is what the thing
//               OCCUPIES: how tall, how wide, how deep, which way it faces. It is true from every
//               angle precisely because it claims nothing about appearance.
//
// Orbit the frame and the card stays a card. That is deliberate and it is the honest answer: a
// flat 2D piece has no side view, and generating one would be inventing a fact about someone's
// artwork that their artwork does not contain. The proxy is what carries the volume around the
// turn. Where a piece's medium genuinely admits reconstruction, a mesh is what replaces the card
// — not a fabricated side view of it.

const PURPLE = '#a855f7';
const EDGE = '#c4b5fd';

/** The soft disc under a subject.
 *
 * NOT A SHADOW, and the distinction is load-bearing rather than pedantic. The rule in
 * SceneStage.jsx is that nothing casts a shadow, because in 3D UX a shadow reads as a
 * drag-affordance and everything here is read-only until editing lands. This follows no light,
 * moves with nothing, and exists for one reason: a cut-out with no ground contact reads as
 * floating, which is a lie about where the subject is standing.
 */
const groundTexture = () => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // LIGHT, not dark, and that is a consequence of the set rather than a style choice: the grid is
  // near-black, so a dark pool under a subject is invisible and grounds nothing. A soft light one
  // reads as contact against this background — the job a shadow would do on a bright one.
  gradient.addColorStop(0, 'rgba(196,181,253,0.30)');
  gradient.addColorStop(0.55, 'rgba(168,85,247,0.10)');
  gradient.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
};

let groundMap = null;
const ContactDisc = ({ radius }) => {
  const map = useMemo(() => {
    if (!groundMap) groundMap = groundTexture();
    return groundMap;
  }, []);
  return (
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[radius * 2.4, radius * 2.4]} />
      <meshBasicMaterial map={map} transparent depthWrite={false} />
    </mesh>
  );
};

/**
 * The volume, from the body plan.
 *
 * Every branch is proportioned from real metres, so a quadruped is long rather than tall and a
 * vehicle is a vehicle-shaped box. The one that earns its keep is `biped`: the head is sized from
 * `headRatio`, which is what stops a big-headed cartoon character being drawn with the
 * proportions of an adult human — measured on a real piece, where the profile came back at 4
 * rather than the realistic 7.5.
 */
const Proxy = ({ profile, heightM, widthM, depthM, opacity }) => {
  const plan = profile?.bodyPlan ?? (heightM > widthM * 1.6 ? 'biped' : 'object');
  const material = <meshBasicMaterial color={PURPLE} transparent opacity={opacity} depthWrite={false} />;

  if (plan === 'biped' || plan === 'creature-other') {
    const headRatio = profile?.headRatio && profile.headRatio >= 2 ? profile.headRatio : 7.5;
    const headHeight = heightM / headRatio;
    const headRadius = headHeight / 2;
    const bodyHeight = Math.max(heightM - headHeight, 0.02);
    const bodyRadius = Math.min(widthM / 2, bodyHeight / 2);
    return (
      <>
        <mesh position={[0, bodyHeight / 2, 0]}>
          <capsuleGeometry args={[bodyRadius, Math.max(bodyHeight - bodyRadius * 2, 0.01), 4, 12]} />
          {material}
        </mesh>
        <mesh position={[0, bodyHeight + headRadius, 0]}>
          <sphereGeometry args={[headRadius, 12, 10]} />
          {material}
        </mesh>
      </>
    );
  }

  if (plan === 'quadruped') {
    // Long rather than tall: the body is the depth axis, with the height going to legs.
    const bodyHeight = heightM * 0.45;
    return (
      <mesh position={[0, heightM - bodyHeight / 2, 0]}>
        <boxGeometry args={[widthM, bodyHeight, depthM]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh position={[0, heightM / 2, 0]}>
      <boxGeometry args={[widthM, heightM, depthM]} />
      {material}
    </mesh>
  );
};

/**
 * One cast member, at the position and facing the beat's geometry gives it.
 *
 * `heightM` comes from the SCENE, not from the profile, and deliberately: the scene's height is
 * what hFrac was computed from, so it is the height this shot was framed on. Drawing the card at
 * any other size would show a frame the render will not produce. Where the two disagree badly,
 * worker/scene.js has already refused the beat.
 */
const Impostor = ({ subject, asset, nameOf, onHover, showArt = true }) => {
  const [hovered, setHovered] = useState(false);
  const group = useRef();
  const built = useCastTexture(showArt ? asset?.assetKey : null);

  const heightM = Math.max(subject.heightM ?? 1.8, 0.05);
  const widthM = Math.max(subject.widthM ?? 0.6, 0.05);
  const profile = asset?.profile ?? null;
  // Depth is the one dimension the scene schema never carried, so before the physical profile it
  // was a guess (width * 0.6). A real measurement is the whole reason a vehicle now reads as a
  // vehicle from above.
  const depthM = Math.max(profile?.depthM ?? widthM * 0.6, 0.05);

  const y = subject.groundOffsetM ?? 0;
  const yaw = ((subject.yawDeg ?? 0) * Math.PI) / 180;

  const label = nameOf(subject.subject);
  const enter = () => {
    setHovered(true);
    onHover?.({ label, action: subject.action, tag: subject.subject, source: asset?.name ?? null });
  };
  const leave = () => {
    setHovered(false);
    onHover?.(null);
  };

  // The card is as wide as its own artwork says, at the height the scene says. Forcing it to
  // widthM instead would stretch the piece, and a stretched ape is a different ape.
  const cardWidth = built ? heightM * built.aspect : widthM;

  return (
    <group ref={group} position={[subject.x ?? 0, y, subject.z ?? 0]} rotation={[0, yaw, 0]}>
      {built && <ContactDisc radius={Math.max(cardWidth, depthM) / 2} />}

      {/* Faint when the artwork is up — the card is the subject then, and the volume is a
          reference behind it. Solid when there is no card, because then it is all there is. */}
      <Proxy
        profile={profile}
        heightM={heightM}
        widthM={widthM}
        depthM={depthM}
        opacity={built ? 0.1 : hovered ? 0.42 : 0.22}
      />
      {!built && (
        <mesh position={[0, heightM / 2, 0]} onPointerOver={enter} onPointerOut={leave}>
          <boxGeometry args={[widthM, heightM, depthM]} />
          <meshBasicMaterial visible={false} />
          <Edges color={hovered ? '#ffffff' : EDGE} />
        </mesh>
      )}

      {/* Which way this subject faces. yaw 0 faces +Z, per the coordinate contract — and it stays
          drawn with the card up, because a billboarded card turns to face the viewer and would
          otherwise be the one thing on screen that says nothing about facing. */}
      <mesh position={[0, 0.02, Math.max(depthM * 0.6, 0.3)]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* Flat on the ground, pointing the way the subject faces. Kept small and lying down: at
            the size the schematic used to draw it, a cone standing proud of the floor reads as a
            spike through the figure rather than as a direction. */}
        <coneGeometry args={[Math.min(widthM * 0.2, 0.14), Math.min(widthM * 0.42, 0.3), 3]} />
        <meshBasicMaterial color={EDGE} transparent opacity={built ? 0.35 : 0.55} depthWrite={false} />
      </mesh>

      {built && (
        // Turns about +Y only, so the card is never seen edge-on and never tips. It faces the
        // camera; it does not pretend to have been photographed from there.
        <Billboard follow lockX lockZ position={[0, heightM / 2, 0]}>
          <mesh onPointerOver={enter} onPointerOut={leave}>
            <planeGeometry args={[cardWidth, heightM]} />
            <meshBasicMaterial
              map={built.texture}
              transparent
              // Low rather than the usual 0.5: the keying feathers anti-aliased edges instead of
              // cutting them off, and a high alphaTest would throw that feather away and hand
              // every cut-out the hard sticker outline it was written to avoid.
              alphaTest={0.1}
              toneMapped={false}
              side={THREE.DoubleSide}
              opacity={hovered ? 1 : 0.95}
            />
          </mesh>
        </Billboard>
      )}
    </group>
  );
};

export default Impostor;
