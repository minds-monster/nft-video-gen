// Golden fixtures for the provisional-geometry parser, against a REAL captured trace
// (scripts/fixtures/reasoning-trace.txt — 8,121 characters of Nemotron planning a 3-beat film).
//
// A synthetic trace would only prove the parser handles prose I wrote to be handled. Every case
// below is something the model actually did: coining its own shorthand, naming a beat inline,
// musing about a car's seat height, and changing its mind.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseReasoningGeometry, learnAliases, makeTagResolver } from '../../worker/reasoning-geometry.js';

const trace = readFileSync(fileURLToPath(new URL('../fixtures/reasoning-trace.txt', import.meta.url)), 'utf8');
const names = {
  '<Subject 1>': 'a weathered ape in a cracked leather jacket',
  '<Subject 2>': 'a battered sand-coloured sedan',
};
const parsed = parseReasoningGeometry(trace, { names, maxBeats: 3 });
const beat = (i) => parsed.beats.find((b) => b.beatIndex === i);
const subject = (i, tag) => beat(i)?.subjects.find((s) => s.subject === tag);

test('the model\'s own shorthand is learned from the trace, not assumed from the cast', () => {
  // "car" appears nowhere in "a battered sand-coloured sedan", so without this the sedan's
  // dimensions land on the ape and it becomes two metres wide.
  assert.deepEqual(learnAliases(trace), { ape: '<Subject 1>', car: '<Subject 2>' });
});

test('task vocabulary is never mistaken for a name', () => {
  // "- Shot size: EWS" under a subject line taught "shot" as an alias, which then resolved every
  // later mention of a shot to that subject.
  const aliases = learnAliases('<Subject 1>\n- Shot size: EWS\n- Camera: wide');
  assert.equal(aliases.shot, undefined);
  assert.equal(aliases.camera, undefined);
});

test('a resolver maps tags, dossier words and learned aliases alike', () => {
  const resolve = makeTagResolver(names, { car: '<Subject 2>' });
  assert.equal(resolve('<Subject 1>'), '<Subject 1>');
  assert.equal(resolve('the ape'), '<Subject 1>');
  assert.equal(resolve('sedan'), '<Subject 2>');
  assert.equal(resolve('Car'), '<Subject 2>');
  assert.equal(resolve('something unrelated'), null);
});

test('every beat gets a camera pose, a shot size and a lens from the prose alone', () => {
  assert.equal(parsed.hasGeometry, true);
  assert.equal(parsed.beats.length, 3);
  for (const b of parsed.beats) {
    assert.ok(b.camera, `beat ${b.beatIndex + 1} should have a provisional camera`);
    assert.ok(b.camera.position.y > 0, 'a camera is never underground, even provisionally');
    assert.ok(b.framing, `beat ${b.beatIndex + 1} should have a provisional shot size`);
    assert.ok(b.focalMm >= 8 && b.focalMm <= 300);
  }
  // The film opens wide and goes close — read entirely out of the model thinking aloud.
  assert.equal(beat(0).framing, 'EWS');
  assert.equal(beat(0).focalMm, 24);
  assert.equal(beat(0).camera.position.z, 80);
  assert.equal(beat(1).framing, 'CU');
  assert.equal(beat(1).focalMm, 85);
});

test('dimensions attach to the right subject and never change between beats', () => {
  assert.equal(subject(0, '<Subject 1>').heightM, 1.8);
  assert.equal(subject(0, '<Subject 1>').widthM, 0.6);
  // The sedan is 1.3m tall. The trace also muses "car seat height ~0.5m?" — a fact about
  // upholstery, question mark and all — which must not overwrite the car's own height.
  assert.equal(subject(0, '<Subject 2>').heightM, 1.3);
  assert.equal(subject(0, '<Subject 2>').widthM, 2);
  for (const i of [0, 1, 2]) {
    assert.equal(subject(i, '<Subject 1>').heightM, 1.8, 'a subject is the same height in every beat');
  }
});

test('containment belongs to the beat it happens in, not to every beat after it', () => {
  // The ape climbs into the car in beat 3 and is beside it before. The trace states this INLINE
  // ("Containment: beat 3, ape inside car"), under a section about a different beat — attributing
  // it by position alone put the ape in the car a beat early.
  assert.equal(subject(2, '<Subject 1>').containerId, '<Subject 2>');
  assert.equal(subject(0, '<Subject 1>').containerId, undefined);
  assert.equal(subject(1, '<Subject 1>').containerId, undefined);
});

test('nonsense in the prose never becomes geometry', () => {
  const junk = 'Beat 1: camera at (0, -50, 8) looking at (0, 1, 0). Ape height ~9000m. Lens 5mm.';
  const out = parseReasoningGeometry(junk, { names, maxBeats: 1 });
  // A camera below ground, an impossible height and an impossible lens are all simply not adopted.
  assert.equal(out.beats[0]?.camera, undefined);
  assert.equal(out.beats[0]?.focalMm, undefined);
  assert.notEqual(subject(0, '<Subject 1>')?.heightM, 9000);
});

test('an empty or geometry-free trace degrades quietly rather than inventing anything', () => {
  assert.deepEqual(parseReasoningGeometry('', { names }).beats, []);
  assert.equal(parseReasoningGeometry('I am thinking about the mood.', { names }).hasGeometry, false);
});
