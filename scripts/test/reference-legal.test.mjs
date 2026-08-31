// worker/reference-legal.js — the first still H3 will ACCEPT, found before spending.
//
// THE FAILURE THIS FILE EXISTS TO PREVENT: three renders billed and failed on a 140x250 thumbnail
// (2026-08-28) while a 3072x5472 copy of the same piece sat one candidate further down the list.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchLegalReference, REFERENCE_PROXY_BYTES } from '../../worker/reference-legal.js';

const png = (width, height) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

/** A routing table of hosts → responses; `init.cf` marks a resize request. */
const serve = (table) => {
  globalThis.fetch = async (url, init) => {
    const entry = table[String(url)];
    if (!entry) return new Response('nope', { status: 404 });
    const pick = init?.cf?.image && entry.resized ? entry.resized : entry;
    const headers = { 'content-type': pick.type ?? 'image/png' };
    if (pick.declared) headers['content-length'] = String(pick.declared);
    return new Response(pick.bytes ?? png(pick.w, pick.h), { status: 200, headers });
  };
};
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('a too-small first still falls through to a legal one, and the refusal is remembered', async () => {
  serve({ 'https://a/thumb.png': { w: 140, h: 250 }, 'https://a/big.png': { w: 1024, h: 1024 } });
  const legal = await fetchLegalReference(['https://a/thumb.png', 'https://a/big.png'], { key: 'piece' });
  assert.equal(legal.url, 'https://a/big.png');
  assert.equal(legal.measured.width, 1024);
  assert.match(legal.tried[0].reason, /140x250/);
  assert.match(legal.dataUri, /^data:image\/png;base64,/);
});

test('when nothing is legal it throws with every reason, marked fatal, before anything is spent', async () => {
  serve({ 'https://a/thumb.png': { w: 140, h: 250 }, 'https://a/tall.png': { w: 300, h: 1200 } });
  await assert.rejects(
    fetchLegalReference(['https://a/thumb.png', 'https://a/tall.png', 'https://a/gone.png'], { key: 'piece' }),
    (error) => {
      assert.equal(error.code, 'reference_illegal');
      assert.equal(error.fatal, true);
      assert.match(error.message, /140x250/);
      assert.match(error.message, /aspect 0\.250/);
      assert.match(error.message, /HTTP 404/);
      return true;
    },
  );
});

test('a still too big to hold is asked for resized rather than written off', async () => {
  serve({
    'https://a/huge.png': { w: 3072, h: 5472, declared: 27_555_809, resized: { w: 1150, h: 2048 } },
  });
  const legal = await fetchLegalReference(['https://a/huge.png'], { key: 'piece' });
  assert.equal(legal.measured.height, 2048, 'the resized copy is what gets used');
  assert.ok(REFERENCE_PROXY_BYTES < 27_555_809);
});

test('a still too big to hold, with no resizing available, is refused with a reason that says so', async () => {
  serve({ 'https://a/huge.png': { w: 3072, h: 5472, declared: 27_555_809 } });
  await assert.rejects(fetchLegalReference(['https://a/huge.png'], { key: 'piece' }), /Image Resizing is not enabled/);
});

test('an unmeasurable format passes — "could not be measured" is not "illegal"', async () => {
  serve({ 'https://a/photo.heic': { bytes: new Uint8Array([1, 2, 3, 4]), type: 'image/heic' } });
  const legal = await fetchLegalReference(['https://a/photo.heic'], { key: 'piece' });
  assert.equal(legal.measured, null);
});
