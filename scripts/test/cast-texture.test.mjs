// The cut-out, checked on pixels rather than on artwork.
//
// These run on plain typed arrays with no canvas and no browser, because the three operations
// that decide whether a cut-out is correct are pure: what the background is, which pixels are
// connected to the edge, and what is left over.
//
// THE CASE THAT MATTERS is "white eyes on a white background". A global "delete every pixel of
// the background colour" punches holes straight through a character's face, and it does it on
// exactly the pieces most likely to be someone's PFP. The flood fill exists for that one case,
// and this is where it stays fixed.
//
//   node --test scripts/test/cast-texture.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundColour, keyOut, boundsOf } from '../../src/lib/castTexture.js';

/** A tiny RGBA image built from a character map, so each fixture reads as a picture. */
const image = (rows, palette) => {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const [r, g, b] = palette[ch];
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    });
  });
  return { data, width, height };
};

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

const WHITE = [255, 255, 255];
const BLACK = [10, 10, 10];
const PINK = [251, 217, 217];

test('a flat field is detected and its colour read exactly', () => {
  const img = image(['....', '.##.', '.##.', '....'], { '.': PINK, '#': BLACK });
  assert.deepEqual(backgroundColour(img.data, img.width, img.height), PINK);
});

test('a gradient is not mistaken for a flat field', () => {
  const img = image(['abcd', 'abcd', 'abcd', 'abcd'], {
    a: [10, 10, 10], b: [90, 90, 90], c: [170, 170, 170], d: [250, 250, 250],
  });
  assert.equal(backgroundColour(img.data, img.width, img.height), null);
});

test('white eyes survive a white background — the whole reason for a flood fill', () => {
  // A black ring with white inside it, on a white field. A global colour replace would delete
  // the inside; only the outside is connected to the edge.
  const img = image([
    'WWWWWWWW',
    'WWKKKKWW',
    'WWKWWKWW',
    'WWKWWKWW',
    'WWKKKKWW',
    'WWWWWWWW',
  ], { W: WHITE, K: BLACK });

  keyOut(img.data, img.width, img.height, WHITE);

  assert.equal(alphaAt(img, 0, 0), 0, 'the outside corner should be gone');
  assert.equal(alphaAt(img, 3, 2), 255, 'the enclosed white should survive');
  assert.equal(alphaAt(img, 2, 1), 255, 'the black outline should survive');
});

test('the background goes even when it wraps most of the way round the subject', () => {
  const img = image([
    'WWWWWW',
    'WWKKWW',
    'WWKKWW',
    'WWWWWW',
  ], { W: WHITE, K: BLACK });
  keyOut(img.data, img.width, img.height, WHITE);
  for (const [x, y] of [[0, 0], [5, 0], [0, 3], [5, 3], [3, 0], [1, 2]]) {
    assert.equal(alphaAt(img, x, y), 0, `background at ${x},${y}`);
  }
});

test('bounds tighten to what is left, which is what makes true height true', () => {
  const img = image([
    'WWWWWW',
    'WWKKWW',
    'WWKKWW',
    'WWWWWW',
  ], { W: WHITE, K: BLACK });
  keyOut(img.data, img.width, img.height, WHITE);
  assert.deepEqual(boundsOf(img.data, img.width, img.height), { left: 2, top: 1, width: 2, height: 2 });
});

test('an edge that blends into the background keeps partial alpha rather than a hard cut', () => {
  // A mid-grey between white and black: further than the hard threshold, nearer than the feather
  // limit, so it should end up neither fully gone nor fully opaque.
  const EDGE = [235, 235, 235];
  const img = image(['WWWW', 'WeeW', 'WeeW', 'WWWW'], { W: WHITE, e: EDGE });
  keyOut(img.data, img.width, img.height, WHITE);
  const a = alphaAt(img, 1, 1);
  assert.ok(a > 0 && a < 255, `expected a feathered edge, got alpha ${a}`);
});

test('nothing left over is reported as nothing, not as an empty rectangle', () => {
  const img = image(['WW', 'WW'], { W: WHITE });
  keyOut(img.data, img.width, img.height, WHITE);
  assert.equal(boundsOf(img.data, img.width, img.height), null);
});
