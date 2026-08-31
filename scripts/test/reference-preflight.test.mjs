// Guards on worker/reference-preflight.js — the check that runs before money is spent.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is measured and it costs a charge. H3 rejects a
// reference outside aspect 0.4-2.5 or under 256px on its short side, but it does so AFTER the
// task has queued, and a queued task has been billed. scripts/probe-h3.mjs names the exact
// shape: "a 352x1024 cut-out of a standing character is 0.344 and gets rejected."
//
// That is the DEFAULT shape of this product's input — NFT character art is tall figures — so a
// preflight that silently stopped working would show up as visitors paying for nothing, on their
// first render, on their own money. Two directions are asserted throughout, because a check that
// never fires and a check that always fires are the same bug wearing different clothes.
//
// The PNG and WebP fixtures are real tracked files whose dimensions `file(1)` reports
// independently, so this test cannot drift into agreeing with a broken parser about a synthetic
// image it also generated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkReference,
  decodeDataUri,
  measureImage,
  preflightReferences,
  suggestedCrop,
} from '../../worker/reference-preflight.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bytesOf = async (file) => new Uint8Array(await readFile(resolve(root, file)));
const dataUri = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/** A synthetic PNG of a stated size. Only the signature and IHDR are real, which is all the
 * parser reads — and all H3's own preflight would read either. */
const png = (width, height) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

/** A synthetic JPEG with an APP0 segment ahead of the SOF0, so the marker walk has something to
 * skip rather than finding the frame header immediately. */
const jpeg = (width, height) => {
  const bytes = [0xff, 0xd8];
  bytes.push(0xff, 0xe0, 0x00, 0x10);
  bytes.push(...'JFIF'.split('').map((c) => c.charCodeAt(0)), 0);
  while (bytes.length < 4 + 2 + 16) bytes.push(0);
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff);
  bytes.push(0x03, ...new Array(9).fill(0));
  return new Uint8Array(bytes);
};

// ------------------------------------------------------------------------- the parser

test('PNG dimensions match what file(1) independently reports', async () => {
  assert.deepEqual(measureImage(await bytesOf('public/brand/mark-32.png')), { format: 'png', width: 32, height: 32 });
  assert.deepEqual(measureImage(await bytesOf('public/brand/mark-180.png')), { format: 'png', width: 180, height: 180 });
  assert.deepEqual(measureImage(await bytesOf('public/brand/minds-monster-lockup.png')), {
    format: 'png',
    width: 485,
    height: 200,
  });
});

test('WebP dimensions match what file(1) independently reports', async () => {
  assert.deepEqual(measureImage(await bytesOf('public/hero/hero.v3.poster.webp')), {
    format: 'webp',
    width: 1920,
    height: 1080,
  });
});

test('JPEG stores height BEFORE width, and the parser reads them that way round', () => {
  // The one ordering in this file that is opposite to every other format, and therefore the one a
  // transcription gets backwards. A 1024-tall, 352-wide figure read the wrong way round measures
  // as legal and gets billed.
  assert.deepEqual(measureImage(jpeg(352, 1024)), { format: 'jpeg', width: 352, height: 1024 });
});

test('an unreadable format is reported as unmeasured, never as legal', () => {
  // HEIC is the real case: H3 accepts it, its dimensions live behind ISO-BMFF box parsing, and
  // refusing it outright would block a good reference for no reason.
  assert.equal(measureImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  const result = checkReference({ key: 'ape', mime: 'image/heic', bytes: new Uint8Array(40) });
  assert.equal(result.unmeasured, true);
  assert.deepEqual(result.violations, [], 'an unmeasured reference is not a violation');
});

test('a dossier hazard still fires on a reference whose pixels could not be measured', () => {
  // The face flag reads the dossier, not the header. Hiding it behind a successful measurement
  // would silence it for exactly the formats the parser understands least.
  const result = checkReference({
    key: 'ape',
    mime: 'image/heic',
    bytes: new Uint8Array(40),
    dossierFraming: 'small-in-frame',
  });
  assert.equal(result.unmeasured, true);
  assert.deepEqual(result.violations.map((v) => v.code), ['reference-face-at-risk']);
});

// --------------------------------------------------------------------- the real failure

test('the 352x1024 figure crop is refused at aspect 0.344, before it can be billed', () => {
  const { violations, measured } = checkReference({ key: 'gmoney', mime: 'image/png', bytes: png(352, 1024) });
  assert.deepEqual(measured, { format: 'png', width: 352, height: 1024 });
  const aspectViolation = violations.find((v) => v.code === 'reference-bad-aspect');
  assert.ok(aspectViolation, 'this exact shape is what probe-h3 measured being rejected');
  assert.equal(aspectViolation.severity, 'floor');
  assert.match(aspectViolation.detail, /0\.344/);
});

test('a legal reference produces no violations at all', () => {
  const { violations, crop } = checkReference({ key: 'courtney', mime: 'image/png', bytes: png(1024, 1024) });
  assert.deepEqual(violations, []);
  assert.equal(crop, null, 'nothing to fix means nothing suggested');
});

test('the aspect window is inclusive at both ends, and one pixel outside it is refused', () => {
  const codes = (w, h) =>
    checkReference({ key: 'k', mime: 'image/png', bytes: png(w, h) }).violations.map((v) => v.code);
  assert.deepEqual(codes(1000, 400), [], 'aspect exactly 2.5 is legal');
  assert.deepEqual(codes(400, 1000), [], 'aspect exactly 0.4 is legal');
  assert.deepEqual(codes(1004, 400), ['reference-bad-aspect'], 'aspect 2.51 is not');
  assert.deepEqual(codes(398, 1000), ['reference-bad-aspect'], 'aspect 0.398 is not');
});

test('a reference under the short-side floor is refused', () => {
  const codes = (w, h) =>
    checkReference({ key: 'k', mime: 'image/png', bytes: png(w, h) }).violations.map((v) => v.code);
  assert.deepEqual(codes(255, 255), ['reference-too-small']);
  assert.deepEqual(codes(256, 256), [], '256 is the floor, not one above it');
});

// ------------------------------------------------------------------------- the crop fix

test('a too-tall reference is cropped from the TOP, because that is where the face is', () => {
  // The convergence this module exists to exploit: the crop that satisfies H3's aspect window and
  // the crop that saves the face under rule 11 are the same crop. Centring would pass the check
  // and cause the failure the check was standing next to.
  const crop = suggestedCrop({ width: 352, height: 1024 });
  assert.equal(crop.gravity, 'top');
  assert.equal(crop.width, 352);
  assert.equal(crop.height, 880, '352 / 0.4 = 880, exactly on the aspect floor');
  assert.ok(crop.width / crop.height >= 0.4);
});

test('a too-wide reference is cropped from the centre, and lands inside the window', () => {
  const crop = suggestedCrop({ width: 3000, height: 400 });
  assert.equal(crop.gravity, 'center');
  assert.ok(crop.width / crop.height <= 2.5);
});

// -------------------------------------------------------------------------- the whole set

test('a tenth reference is refused by naming what does not fit, not by dropping one', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ key: `piece-${i}`, dataUri: dataUri(png(1024, 1024)) }));
  const { ok, violations } = preflightReferences(ten);
  assert.equal(ok, false);
  const violation = violations.find((v) => v.code === 'too-many-references');
  assert.ok(violation);
  // Rule 4's actual instruction, and the reason this is a message rather than a slice().
  assert.match(violation.detail, /dropped asset is the single most common cause of a wrong render/);
});

test('nine references pass, because nine is the cap rather than the limit', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ key: `piece-${i}`, dataUri: dataUri(png(1024, 1024)) }));
  assert.equal(preflightReferences(nine).ok, true);
});

test('a face-at-risk flag is soft: it asks for a Screen Test, it does not block the shoot', () => {
  const { ok, violations } = preflightReferences([
    { key: 'gmoney', dataUri: dataUri(png(1024, 1024)), dossierFraming: 'small-in-frame' },
  ]);
  assert.equal(ok, true, 'a known hazard is something to test, not something to refuse');
  const flag = violations.find((v) => v.code === 'reference-face-at-risk');
  assert.equal(flag.severity, 'soft');
});

test('the face flag fires on the Casting Director\'s real enum values, and only those', () => {
  // THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THE CHECK WAS WRONG. It matched `framing`
  // as free text (/full[- ]?body|wide|distant/), which reads plausibly and would have fired on
  // exactly nothing: DOSSIER_SCHEMA constrains the field to four enum values and none of them
  // contains any of those words. A check that never fires is invisible, so the enum is asserted
  // in both directions here rather than trusted.
  const codes = (framing) =>
    checkReference({ key: 'k', mime: 'image/png', bytes: png(1024, 1024), dossierFraming: framing })
      .violations.map((v) => v.code);

  assert.deepEqual(codes('small-in-frame'), ['reference-face-at-risk']);
  assert.deepEqual(codes('busy-composite'), ['reference-face-at-risk'], 'a card is what gets reproduced');
  assert.deepEqual(codes('full-bleed'), [], 'a subject that fills the frame is not at risk');
  assert.deepEqual(codes('centred-with-margin'), []);
  assert.deepEqual(codes('full-body'), [], 'not a value this field can hold — it must not fire on prose');
  assert.deepEqual(codes(null), []);
});

test('an unreadable data URI is a floor violation rather than a thrown request', () => {
  const { ok, violations } = preflightReferences([{ key: 'broken', dataUri: 'https://example.com/x.png' }]);
  assert.equal(ok, false);
  assert.equal(violations[0].code, 'reference-unreadable');
});

test('decodeDataUri round-trips the bytes it was given', () => {
  const original = png(640, 480);
  const { mime, bytes } = decodeDataUri(dataUri(original));
  assert.equal(mime, 'image/png');
  assert.deepEqual(measureImage(bytes), { format: 'png', width: 640, height: 480 });
});
