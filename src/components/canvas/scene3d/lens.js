import { sensorHeightMm } from '../../../../worker/scene.js';

/**
 * three's PerspectiveCamera takes a VERTICAL field of view in degrees. Deriving it from the same
 * 36mm sensor worker/scene.js projects with is what keeps the viewport honest: this is literally
 * the inverse of the hFrac arithmetic the framing bands are computed from, so a beat the grader
 * calls a close-up looks like a close-up on screen.
 *
 * Any other fov formula would be a second, quietly different opinion about what the camera sees —
 * and the visitor would be editing a frame that does not match the one H3 renders.
 */
export const fovFromFocal = (focalMm, aspect = 16 / 9) =>
  (2 * Math.atan(sensorHeightMm(aspect) / (2 * Math.max(focalMm, 1))) * 180) / Math.PI;
