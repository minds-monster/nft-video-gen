import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { buildCastTexture, castArtUrl } from '../../../lib/castTexture';

// One piece's artwork, decoded and keyed once for the whole page.
//
// Its own module rather than a second export from Impostor.jsx: a file that exports both a
// component and a hook silently disables React Fast Refresh for that file, which in a 3D scene
// means every edit re-mounts the canvas and loses the camera you were looking through.

/** One decode per piece, shared by every tile on the page. Six beat cards showing the same ape
 * would otherwise each fetch, key and upload their own copy of it. */
const cache = new Map();

const loadTexture = (assetKey) => {
  if (!cache.has(assetKey)) {
    cache.set(
      assetKey,
      buildCastTexture(castArtUrl(assetKey)).then((built) => {
        const texture = new THREE.CanvasTexture(built.canvas);
        // The artwork's colours are an identity claim, so they are not tone-mapped, not
        // colour-graded, and not touched. sRGB in, sRGB out.
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return { ...built, texture };
      }),
    );
  }
  return cache.get(assetKey);
};

/** null until the artwork is ready, and null forever if it never is — the proxy is a complete
 * representation on its own, so a failed texture degrades rather than breaks. */
export const useCastTexture = (assetKey) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!assetKey) return undefined;
    let live = true;
    loadTexture(assetKey)
      .then((built) => live && setState(built))
      .catch((error) => {
        // Worth one line in the console: the message names the actual cause, and the most common
        // one is a piece whose dossier predates the physical profile.
        console.warn(`No card for ${assetKey}: ${error.message}`);
        cache.delete(assetKey);
      });
    return () => {
      live = false;
    };
  }, [assetKey]);
  return state;
};
