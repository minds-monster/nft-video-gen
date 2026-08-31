// Guards on worker/minimax.js — the client the Director spends real money through.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT is a silent one, and it is specific: this client was
// MOVED out of scripts/minimax.mjs into worker/ so the Worker could use it, and scripts/ now
// re-exports it. A move like that is exactly where a price table loses a digit or a guard stops
// firing, and neither shows up as an error — the first surfaces as cost accounting that is
// quietly fiction, the second as a 400 that costs a round trip and a confused visitor.
//
// So the price table is scored against assets/renders/ledger.json's REAL manifests: 22 clips
// from the hero production, $17.69, reconstructed by scripts/build-cost-ledger.mjs from what was
// actually rendered. That file is gitignored (it lives beside 85MB of mp4s), so its distinct
// configurations are inlined below and the full ledger is checked opportunistically on top. The
// inline table is not a transcription to be trusted — it is what a real invoice came to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MinimaxError,
  checkH3Params,
  h3Content,
  priceUsd,
  H3_REFERENCE_LIMITS,
} from '../../worker/minimax.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every distinct (model, resolution, duration) actually billed during the hero production, with
 * what it actually cost. Six shapes across 22 clips. */
const REAL_RENDERS = [
  { model: 'MiniMax-H3', resolution: '768P', duration: 4, costUsd: 0.32 },
  { model: 'MiniMax-H3', resolution: '768P', duration: 6, costUsd: 0.48 },
  { model: 'MiniMax-H3', resolution: '768P', duration: 15, costUsd: 1.2 },
  { model: 'MiniMax-H3', resolution: '2K', duration: 15, costUsd: 1.95 },
  { model: 'MiniMax-Hailuo-02', resolution: '768P', duration: 6, costUsd: 0.28 },
  { model: 'MiniMax-Hailuo-02', resolution: '1080P', duration: 6, costUsd: 0.49 },
];

const money = (value) => Math.round(value * 1000) / 1000;

test('priceUsd reproduces every render shape the hero production actually paid for', () => {
  for (const { model, resolution, duration, costUsd } of REAL_RENDERS) {
    assert.equal(
      money(priceUsd({ model, resolution, duration })),
      costUsd,
      `${model} ${resolution} ${duration}s should cost $${costUsd}`,
    );
  }
});

test('priceUsd reproduces the full historical ledger, when it is on disk', async (t) => {
  const raw = await readFile(resolve(root, 'assets/renders/ledger.json'), 'utf8').catch(() => null);
  if (!raw) {
    t.skip('assets/renders/ledger.json is gitignored and absent — the inline table above still ran');
    return;
  }
  const ledger = JSON.parse(raw);
  let total = 0;
  for (const entry of ledger.entries) {
    const priced = priceUsd(entry);
    assert.equal(money(priced), entry.costUsd, `${entry.file} should still price at $${entry.costUsd}`);
    total += priced;
  }
  assert.equal(Math.round(total * 100) / 100, ledger.totalUsd);
});

test('priceUsd returns null rather than guessing at a model it has no rate for', () => {
  assert.equal(priceUsd({ model: 'MiniMax-H9', resolution: '768P', duration: 6 }), null);
  assert.equal(priceUsd({ model: 'MiniMax-Hailuo-02', resolution: '4K', duration: 6 }), null);
});

// ---------------------------------------------------------------------------- the guards
//
// Both of these are worth a test each because both were established by a probe that cost money,
// and the API's own error message does not lead you back to the rule.

test('h3Content refuses to mix reference mode with frame mode', async () => {
  // Probe P1: passing a first_frame alongside references returns 400 "reference mode cannot be
  // mixed with first_frame/middle_frame/last_frame; choose one (2013)". The consequence is that
  // no shot in this product can be frame-chained — joins have to be designed instead.
  await assert.rejects(
    () => h3Content({ text: 'x', referenceImages: ['data:image/png;base64,AA'], firstFrame: 'data:image/png;base64,AA' }),
    /pick one mode/,
  );
  await assert.rejects(
    () => h3Content({ text: 'x', referenceImages: ['data:image/png;base64,AA'], lastFrame: 'data:image/png;base64,AA' }),
    /pick one mode/,
  );
});

test('h3Content refuses a tenth reference, and accepts exactly nine', async () => {
  const nine = Array.from({ length: 9 }, () => 'data:image/png;base64,AA');
  const content = await h3Content({ text: 'x', referenceImages: nine });
  assert.equal(content.filter((item) => item.role === 'reference_image').length, 9);

  await assert.rejects(() => h3Content({ text: 'x', referenceImages: [...nine, 'data:image/png;base64,AA'] }), /at most 9/);
  assert.equal(H3_REFERENCE_LIMITS.maxCount, 9);
});

test('h3Content emits the item shape the live API actually accepts', async () => {
  // Not guessable from the error message: the type is `image_url` (not `image`) and the URL nests
  // under `image_url.url`. A flat `url` is accepted by the parser and then rejected as empty.
  const content = await h3Content({
    text: 'the script',
    referenceImages: ['data:image/png;base64,REF'],
  });
  assert.deepEqual(content[0], { type: 'text', text: 'the script' });
  assert.deepEqual(content[1], {
    type: 'image_url',
    role: 'reference_image',
    image_url: { url: 'data:image/png;base64,REF' },
  });
});

test('h3Content keeps first_frame and last_frame in order, and labels them', async () => {
  const content = await h3Content({
    text: 'x',
    firstFrame: 'data:image/png;base64,FIRST',
    lastFrame: 'data:image/png;base64,LAST',
  });
  assert.deepEqual(content.map((item) => item.role ?? item.type), ['text', 'first_frame', 'last_frame']);
});

test('h3Content refuses an unresolved image rather than sending a file path to the API', async () => {
  await assert.rejects(() => h3Content({ text: 'x', referenceImages: ['assets/refs/ape.png'] }), /data URI/);
});

// ------------------------------------------------------------------------- the preflight

test('checkH3Params rejects exactly the durations H3 rejects, and no others', () => {
  // A check that never fires and a check that always fires are the same bug wearing different
  // clothes, so both directions are asserted.
  for (const duration of [4, 6, 10, 15]) {
    assert.deepEqual(checkH3Params({ duration, resolution: '768P', ratio: '16:9' }), []);
  }
  for (const duration of [3, 16, 0, -1, 6.5]) {
    const violations = checkH3Params({ duration, resolution: '768P', ratio: '16:9' });
    assert.equal(violations.length, 1, `duration ${duration} should be refused`);
    assert.equal(violations[0].code, 'bad-duration');
  }
});

test('checkH3Params rejects a resolution or ratio H3 does not have', () => {
  assert.equal(checkH3Params({ duration: 6, resolution: '1080P' })[0].code, 'bad-resolution');
  assert.equal(checkH3Params({ duration: 6, resolution: '768P', ratio: '2:1' })[0].code, 'bad-ratio');
  assert.deepEqual(checkH3Params({ duration: 6, resolution: '2K', ratio: '9:16' }), []);
});

test('checkH3Params reports every violation at once rather than the first', () => {
  const violations = checkH3Params({ duration: 99, resolution: '4K', ratio: '2:1' });
  assert.deepEqual(violations.map((v) => v.code).sort(), ['bad-duration', 'bad-ratio', 'bad-resolution']);
});

// ---------------------------------------------------------------------------- the errors
//
// The three flags exist because they are three different situations, and the whole reason to
// test them is that collapsing any two produces a WRONG ACTION — retrying forever, billing a
// visitor for our own empty account, or telling someone their budget ran out when it did not.

test('1026 is a content filter: it never retries and is never billable', () => {
  const error = new MinimaxError(1026, 'invalid params', { status: 400 });
  assert.equal(error.contentFiltered, true);
  assert.equal(error.retryable, false, 'retrying a filtered prompt cannot ever help — it must CHANGE');
  assert.equal(error.billable, false, 'nothing rendered, so nothing is owed');
  assert.match(error.message, /brand/i, 'the hint has to name the actual cause, which is brand names');
});

test('1008 is OUR account, not the visitor budget', () => {
  const error = new MinimaxError(1008, 'insufficient balance');
  assert.equal(error.accountBalance, true);
  assert.equal(error.billable, false);
  assert.equal(error.contentFiltered, false, 'never conflate an operator failure with a rejected prompt');
});

test('1002 is a burst limit and is the one thing worth retrying', () => {
  assert.equal(new MinimaxError(1002, 'rate limited').retryable, true);
  assert.equal(new MinimaxError(2013, 'invalid parameters').retryable, false);
  assert.equal(new MinimaxError(503, 'gateway', { status: 503 }).retryable, true);
});
