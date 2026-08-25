import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// One cast member's mesh, when the piece is entitled to one.
//
// LOADED ONLY WHEN IT IS ACTUALLY LOOKED AT. A mesh is ~3.8MB and around 100k triangles, and a
// six-beat storyboard showing five cast members would be 100MB+ of geometry to answer a question
// nobody asked. At tile size the card IS the source pixels and wins anyway, so the mesh is
// fetched at the moment the frame is expanded or orbited — the moment structure starts carrying
// identity and a flat card stops being enough.
//
// A REFUSAL IS A RESULT, NOT AN ERROR. About half the library is `ineligible` by the medium gate,
// and this hook reports that as calmly as it reports success, because the card is the correct and
// final representation for those pieces rather than a fallback from a failure.

const cache = new Map();

const load = (assetKey) => {
  if (!cache.has(assetKey)) {
    cache.set(
      assetKey,
      (async () => {
        const response = await fetch(`/api/cast/mesh?asset=${encodeURIComponent(assetKey)}`);
        const type = response.headers.get('content-type') ?? '';

        if (!type.includes('gltf')) {
          const body = await response.json().catch(() => ({}));
          // 'ineligible' and 'pending' are both ordinary states. Neither is worth a console error.
          return { status: body.status ?? 'absent', reason: body.reason ?? null };
        }

        const buffer = await response.arrayBuffer();
        const gltf = await new Promise((resolve, reject) =>
          new GLTFLoader().parse(buffer, '', resolve, reject),
        );

        // NORMALISED TO THE SCENE'S OWN METRES. A generated mesh arrives in whatever scale the
        // generator felt like; the beat was framed on `heightM`, and hFrac was computed from it.
        // So the mesh is fitted to that height rather than trusted to arrive at it — otherwise
        // turning the mesh on would silently change the shot size.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());

        return {
          status: 'ready',
          scene: gltf.scene,
          unitHeight: size.y || 1,
          // Centre it on its own footprint and stand it on the ground plane.
          offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z),
          sourceUrl: response.headers.get('x-source-url') || null,
          bytes: Number(response.headers.get('x-mesh-bytes') ?? buffer.byteLength),
        };
      })().catch((error) => {
        cache.delete(assetKey);
        return { status: 'error', reason: error.message };
      }),
    );
  }
  return cache.get(assetKey);
};

export const useCastMesh = (assetKey, enabled) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!assetKey || !enabled) return undefined;
    let live = true;
    load(assetKey).then((result) => live && setState(result));
    return () => {
      live = false;
    };
  }, [assetKey, enabled]);
  return state;
};
