// POST /api/director/plan — the dry run, and the two ways a script gets compiled.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a preview that stops describing the request.
// src/lib/h3Script.js's own header names it: the browser and the renderer have to produce the
// SAME string, or "the preview would become a lie the moment the two drifted — and the whole
// point of showing it is to catch format regressions early."
//
// This endpoint raises the stakes on that, because it is also where a visitor decides to spend.
// A quoted price against a script that is not what gets sent is worse than no price at all.
//
// The second thing guarded here is the one that makes the Storyboarder optional: a spec alone
// and a spec plus blocked geometry must BOTH produce a legal H3 script, and the endpoint must
// say which one it used and why.

import test from 'node:test';
import assert from 'node:assert/strict';

import { signSession } from '../../worker/session.js';
import { handleDirectorPlan, compileScript } from '../../worker/director.js';
import { filmIdFor } from '../../worker/film-id.js';
import { FIXTURES } from '../lib/storyboard-fixtures.mjs';

class MockKV {
  store = new Map();
  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const makeEnv = (over = {}) => ({
  SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  MIND_CONNECTIONS: new MockKV(),
  MINIMAX_API_KEY: 'test-key',
  ...over,
});

const planRequest = async (env, body) => {
  const token = await signSession(env, { mindId: 'mind-test', exp: Date.now() + 3600000 });
  return new Request('https://minds.monster/api/director/plan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

const fixture = FIXTURES.find((f) => f.id === 'grid-launch');
const plan = async (env, body) => (await handleDirectorPlan(await planRequest(env, body), env)).json();

// ------------------------------------------------------------------------------- the gate

test('the plan endpoint refuses an unauthenticated caller', async () => {
  const env = makeEnv();
  const response = await handleDirectorPlan(
    new Request('https://minds.monster/api/director/plan', { method: 'POST', body: '{}' }),
    env,
  );
  assert.equal(response.status, 401);
});

test('a spec with no beats is refused before anything is priced', async () => {
  const env = makeEnv();
  const response = await handleDirectorPlan(await planRequest(env, { spec: { beats: [] } }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'no_spec');
});

// ------------------------------------------------------------------------- the dry run

test('the dry run prices a real film and quotes the exact script that would be sent', async () => {
  const env = makeEnv();
  const result = await plan(env, { spec: fixture.spec, cast: fixture.cast });

  assert.equal(result.filmId, filmIdFor(fixture.spec));
  assert.equal(result.script.source, 'screenplay', 'no storyboard stored, so it shoots the screenplay');
  assert.match(result.script.text, /^<Subject 1>/, 'subject definitions lead, unlabelled, as probe P8 sent them');
  assert.match(result.script.text, /integrated_multimodal_description: /);
  assert.match(result.script.text, /overall_soundscape: /);
  assert.match(result.script.text, /non_diegetic_music: /);

  // H3's own ceiling is 7000 characters per field; a script that overran it would be truncated
  // upstream rather than rejected, which is the worst of both.
  assert.ok(result.script.characters < 7000);

  assert.equal(result.params.model, 'MiniMax-H3');
  assert.ok(result.estimate.finalUsd > 0, 'the Director can never be free — this is the point');
  assert.equal(
    result.estimate.totalCeilingUsd,
    Math.round((result.estimate.finalUsd + result.estimate.testsCeilingUsd) * 100) / 100,
  );
  assert.ok(result.estimate.seconds.p50 > 0 && result.estimate.seconds.max > result.estimate.seconds.p50);
});

test('the dry run spends nothing and queues nothing — there is no queue binding at all', async () => {
  // The strongest available statement of "this costs nothing": the env handed to it has no queue,
  // no R2 and a key that would fail on first use. If it tried to render, it would throw.
  const env = makeEnv({ MINIMAX_API_KEY: undefined });
  const result = await plan(env, { spec: fixture.spec, cast: fixture.cast });
  assert.ok(result.estimate.finalUsd > 0);
  assert.equal(result.hasKey, false, 'and it reports the missing key rather than pretending');
});

test('an illegal duration is reported as a parameter violation, not left to 400 upstream', async () => {
  const env = makeEnv();
  const result = await plan(env, { spec: { ...fixture.spec, duration: 30 }, cast: fixture.cast });
  assert.equal(result.paramViolations[0].code, 'bad-duration');
  assert.equal(result.ready, false);
});

test('a script naming a brand is not ready, however legal its parameters', async () => {
  const captured = FIXTURES.find((f) => f.id === 'captured');
  const env = makeEnv();
  const result = await plan(env, { spec: captured.spec, cast: captured.cast });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blocking.map((r) => r.id), ['brand-name-in-script']);
});

// --------------------------------------------------------- the two compilers, one wire format

test('a complete storyboard compiles the script from geometry instead of the screenplay', () => {
  const spec = { beats: ['a', 'b'], staging: '<Subject 1> is the ape.', sound: 'rain', music: 'N/A', world: 'Night.' };
  const storyboard = {
    subjectNames: { '<Subject 1>': 'the ape' },
    frames: [
      { beatIndex: 0, scene: scene(0) },
      { beatIndex: 1, scene: scene(1) },
    ],
  };
  const result = compileScript(spec, storyboard);
  assert.equal(result.source, 'storyboard');
  assert.equal(result.incomplete, null);
  assert.match(result.text, /^<Subject 1> is the ape\./, 'same wire format, whichever compiler ran');
  assert.match(result.text, /Beat 1: /, 'numbered, because ordering is what H3 shuffles');
  assert.match(result.text, /Beat 2: /);
});

test('a HALF-blocked storyboard falls back to the screenplay rather than rendering a shorter film', () => {
  // The silent-narrowing failure this codebase keeps finding. Compiling only the beats that
  // survived would produce a legal script for a film the visitor did not write.
  const spec = { beats: ['a', 'b', 'c'], staging: '', sound: 'rain', music: 'N/A', world: 'Night.' };
  const storyboard = {
    frames: [{ beatIndex: 0, scene: scene(0) }, { beatIndex: 1, scene: null }, { beatIndex: 2, scene: null }],
  };
  const result = compileScript(spec, storyboard);
  assert.equal(result.source, 'screenplay');
  assert.equal(result.incomplete.blocked, 1);
  assert.equal(result.incomplete.beats, 3);
  assert.match(result.incomplete.detail, /shorter film/);
});

test('no storyboard at all is not an error — it is the other supported path', () => {
  const spec = { beats: ['a'], staging: '', sound: '', music: '', world: 'Night.' };
  const result = compileScript(spec, null);
  assert.equal(result.source, 'screenplay');
  assert.equal(result.incomplete, null, 'nothing is missing when nothing was expected');
  assert.match(result.text, /non_diegetic_music: N\/A/, 'an empty score is "N/A", a legal value');
});

/** A minimal blocked beat: one subject, one camera, enough for compileBeatToH3 to derive from. */
function scene(beatIndex) {
  return {
    beatIndex,
    kind: 'shot',
    principalSubject: '<Subject 1>',
    camera: {
      start: { position: { x: 0, y: 1.6, z: -6 }, lookAt: { x: 0, y: 1.2, z: 0 } },
      end: { position: { x: 0, y: 1.6, z: -5 }, lookAt: { x: 0, y: 1.2, z: 0 } },
      focalStartMm: 35,
      focalEndMm: 35,
      rollDeg: 0,
      motion: 'Push In',
      amplitude: 'small',
      speed: 'slow',
    },
    subjects: [
      {
        subject: '<Subject 1>',
        x: 0,
        z: 0,
        endX: 0,
        endZ: 0,
        groundOffsetM: 0,
        heightM: 1.6,
        widthM: 0.6,
        yawDeg: 0,
        containerId: '',
        action: 'stands still and turns to the lens',
        screenPosition: 'center',
        depth: 'midground',
      },
    ],
  };
}
