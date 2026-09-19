// The owner's records: assets used, x402 payments, and the visitor → Mind thread through both.
// Runs worker/records.js against real SQLite loaded with migrations/ (./d1-sqlite.mjs).
//
// Run: npm run test:scene

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  linkVisitor,
  recordMindConnection,
  recordAssetInputs,
  recordPaymentReports,
  checkTransaction,
  verifyPayment,
  verifyPending,
  handleCastRecord,
  handleOwnerRecords,
  queryRecords,
  readRecordsQuery,
  txHashesIn,
  toCsv,
  visitorIdFrom,
  MAX_CHECKS,
  X402_TOKEN_DEFAULT,
} from '../../worker/records.js';
import { guestHashFor } from '../../worker/analytics.js';
import { signSession } from '../../worker/session.js';
import { makeEnv } from './mock-kv.mjs';
import { SqliteD1 } from './d1-sqlite.mjs';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hash = (n) => `0x${String(n).padStart(64, '0')}`;
const word = (address) => `0x${address.slice(2).padStart(64, '0')}`;
const CREATOR = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const PAYER = '0x3333333333333333333333333333333333333333';
const ONE = 10n ** 18n;

const envWith = (over = {}) => makeEnv({ RECORDS: new SqliteD1(), ...over });

const receipt = ({ status = '0x1', token = X402_TOKEN_DEFAULT, to = CREATOR, amount = ONE, logs } = {}) => ({
  status,
  blockNumber: '0x10',
  logs: logs ?? [{ address: token, topics: [TRANSFER, word(PAYER), word(to)], data: `0x${amount.toString(16)}` }],
});

/** A Base JSON-RPC stand-in: receipts by hash, a fixed block time, an 18-decimal token. */
const fakeRpc = (receipts = {}, { fail = false } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push({ url, method });
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    let result = null;
    if (method === 'eth_getTransactionReceipt') result = receipts[params[0]] ?? null;
    if (method === 'eth_getBlockByNumber') result = { timestamp: '0x66f0a000' };
    if (method === 'eth_call') result = `0x${(18).toString(16).padStart(64, '0')}`;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
  return { calls, fetchImpl };
};

const withFetch = async (fetchImpl, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

const castRequest = (env, body, { guestId = 'guest-1', token } = {}) =>
  new Request('https://minds.monster/api/records/cast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(guestId ? { 'x-guest-id': guestId } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

// ───────────────────────────────────────────────────────────────────────────── identity

test('the visitor id is the stable analytics hash of the guestId, never the raw id', async () => {
  const env = envWith();
  const request = new Request('https://x/', { headers: { 'x-guest-id': 'guest-1' } });
  assert.equal(await visitorIdFrom(request, env), await guestHashFor(env, 'guest-1'));
  assert.equal(await visitorIdFrom(new Request('https://x/'), env), null);
});

test('a guest’s earlier uses and payments are handed to their Mind when they connect', async () => {
  const env = envWith();
  await recordAssetInputs(env, { stage: 'cast', cast: [{ key: 'eth:0xabc:1', name: 'Ape #1' }], visitorId: 'v1' });
  await recordPaymentReports(env, { txHashes: [hash(1)], assetKey: 'eth:0xabc:1', visitorId: 'v1' });
  await recordAssetInputs(env, { stage: 'cast', cast: [{ key: 'eth:0xabc:2' }], visitorId: 'v2' });

  await recordMindConnection(env, { connectionId: 'c1', mindId: 'mind-a', name: 'Alpha', visitorId: 'v1' });

  const uses = env.RECORDS.rows('SELECT visitor_id, mind_id FROM asset_inputs ORDER BY id');
  assert.deepEqual(uses, [
    { visitor_id: 'v1', mind_id: 'mind-a' },
    { visitor_id: 'v2', mind_id: null },
  ]);
  assert.equal(env.RECORDS.rows('x402_payments')[0].mind_id, 'mind-a');
  assert.deepEqual(env.RECORDS.rows('SELECT visitor_id, mind_id FROM visitor_minds'), [{ visitor_id: 'v1', mind_id: 'mind-a' }]);
});

test('a connection is counted once per handshake, however often the approval is polled', async () => {
  const env = envWith();
  await recordMindConnection(env, { connectionId: 'c1', mindId: 'mind-a', name: 'Alpha', visitorId: 'v1' });
  await recordMindConnection(env, { connectionId: 'c1', mindId: 'mind-a', name: 'Alpha', visitorId: 'v1' });
  await recordMindConnection(env, { connectionId: 'c2', mindId: 'mind-a', visitorId: 'v2' });
  const [mind] = env.RECORDS.rows('minds');
  assert.equal(mind.connections, 2);
  assert.equal(mind.name, 'Alpha', 'a later connection without a name keeps the one we had');
  assert.equal(env.RECORDS.rows('mind_connections').length, 2);
  assert.equal(env.RECORDS.rows('visitor_minds').length, 2, 'one Mind, two browsers');
});

test('linking a returning visitor does not re-count a connection and keeps every earlier link', async () => {
  const env = envWith();
  await linkVisitor(env, { visitorId: 'v1', mindId: 'mind-a' });
  await linkVisitor(env, { visitorId: 'v1', mindId: 'mind-b' });
  assert.equal(env.RECORDS.rows('SELECT SUM(connections) AS n FROM minds')[0].n, 0);
  assert.equal(env.RECORDS.rows('visitor_minds').length, 2, 'one browser, two Minds in turn');
});

// ───────────────────────────────────────────────────────────────────────────── assets

test('a screenplay records one row per cast member under one submission, marking the primary', async () => {
  const env = envWith();
  const n = await recordAssetInputs(env, {
    stage: 'screenplay',
    cast: [{ key: 'eth:0xabc:1', name: 'Ape', collectionName: 'Apes' }, { key: 'base:0xdef:77' }, { key: 'not a key' }],
    primaryKey: 'base:0xdef:77',
    submissionId: 's1',
    visitorId: 'v1',
  });
  assert.equal(n, 2, 'the malformed entry is skipped, not stored');
  const rows = env.RECORDS.rows('SELECT asset_key, chain, contract, token_id, name, collection, is_primary, submission_id FROM asset_inputs ORDER BY id');
  assert.deepEqual(rows, [
    { asset_key: 'eth:0xabc:1', chain: 'eth', contract: '0xabc', token_id: '1', name: 'Ape', collection: 'Apes', is_primary: 0, submission_id: 's1' },
    { asset_key: 'base:0xdef:77', chain: 'base', contract: '0xdef', token_id: '77', name: null, collection: null, is_primary: 1, submission_id: 's1' },
  ]);
  assert.equal(env.RECORDS.rows('visitors').length, 1);
});

// ───────────────────────────────────────────────────────────────────────────── payments

test('tx hashes are pulled out of bare hashes and basescan URLs, lower-cased and de-duplicated', () => {
  const upper = `0x${'AB'.repeat(32)}`;
  assert.deepEqual(txHashesIn(`${upper},https://basescan.org/tx/${upper.toLowerCase()}, junk`), [upper.toLowerCase()]);
  assert.deepEqual(txHashesIn(['nope', hash(2)]), [hash(2)]);
  assert.deepEqual(txHashesIn(undefined), []);
});

test('two hashes are the creator’s then the owner’s; a repeat report fills gaps but never overwrites', async () => {
  const env = envWith();
  await recordPaymentReports(env, { txHashes: [hash(1), hash(2)], assetKey: 'eth:0xabc:1', visitorId: 'v1' });
  await recordPaymentReports(env, { txHashes: [hash(1)], assetKey: 'eth:0xother:9', visitorId: 'v9', mindId: 'mind-a' });
  const rows = env.RECORDS.rows('SELECT tx_hash, role, asset_key, visitor_id, mind_id, status FROM x402_payments ORDER BY tx_hash');
  assert.deepEqual(rows, [
    { tx_hash: hash(1), role: 'creator', asset_key: 'eth:0xabc:1', visitor_id: 'v1', mind_id: 'mind-a', status: 'pending' },
    { tx_hash: hash(2), role: 'owner', asset_key: 'eth:0xabc:1', visitor_id: 'v1', mind_id: null, status: 'pending' },
  ]);
});

test('a payment is verified only if it succeeded and moved the x402 token', async () => {
  const env = envWith();
  const other = '0x9999999999999999999999999999999999999999';
  const { fetchImpl } = fakeRpc({
    [hash(1)]: receipt({ amount: ONE * 3n / 2n }),
    [hash(2)]: receipt({ status: '0x0' }),
    [hash(3)]: receipt({ token: other }),
  });
  const verified = await checkTransaction(env, hash(1), { fetchImpl });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.fromAddress, PAYER);
  assert.equal(verified.toAddress, CREATOR);
  assert.equal(verified.amount, 1.5);
  assert.equal(verified.amountRaw, (ONE * 3n / 2n).toString());
  assert.equal(verified.paidAt, 0x66f0a000 * 1000);
  assert.equal((await checkTransaction(env, hash(2), { fetchImpl })).status, 'reverted');
  assert.equal((await checkTransaction(env, hash(3), { fetchImpl })).status, 'not_x402', 'a real transaction of some other token');
  assert.equal((await checkTransaction(env, hash(4), { fetchImpl })).status, 'pending', 'no receipt yet');
});

test('an unseen transaction stays pending through RPC failures and is given up on after the last check', async () => {
  const env = envWith();
  await recordPaymentReports(env, { txHashes: [hash(5)], visitorId: 'v1' });
  const down = fakeRpc({}, { fail: true });
  assert.equal((await verifyPayment(env, hash(5), { fetchImpl: down.fetchImpl })).status, 'pending');
  assert.match(env.RECORDS.rows('x402_payments')[0].note, /rpc_503/);

  const empty = fakeRpc({});
  for (let i = 2; i < MAX_CHECKS; i += 1) await verifyPayment(env, hash(5), { fetchImpl: empty.fetchImpl });
  assert.equal(env.RECORDS.rows('x402_payments')[0].status, 'pending');
  await verifyPayment(env, hash(5), { fetchImpl: empty.fetchImpl });
  const [row] = env.RECORDS.rows('x402_payments');
  assert.equal(row.status, 'not_found');
  assert.equal(row.check_attempts, MAX_CHECKS);
});

test('a rate-limited RPC falls through to the next, and a failure never records the keyed URL', async () => {
  const env = envWith({ BASE_RPC_URL: 'https://base-mainnet.g.alchemy.com/v2/SECRETKEY' });
  const good = fakeRpc({ [hash(1)]: receipt() });
  const tried = [];
  const fetchImpl = async (url, init) => {
    tried.push(new URL(url).host);
    if (!url.includes('drpc')) return { ok: false, status: 429, json: async () => ({}) };
    return good.fetchImpl(url, init);
  };
  assert.equal((await checkTransaction(env, hash(1), { fetchImpl })).status, 'verified');
  assert.deepEqual(tried.slice(0, 3), ['base-mainnet.g.alchemy.com', 'mainnet.base.org', 'base.drpc.org'], 'the keyed endpoint first');

  await recordPaymentReports(env, { txHashes: [hash(9)] });
  await verifyPayment(env, hash(9), { fetchImpl: fakeRpc({}, { fail: true }).fetchImpl });
  const [row] = env.RECORDS.rows("SELECT note FROM x402_payments WHERE tx_hash = '" + hash(9) + "'");
  assert.match(row.note, /base-mainnet\.g\.alchemy\.com rpc_503/);
  assert.doesNotMatch(row.note, /SECRETKEY/);
});

test('the cron re-checks only pending payments', async () => {
  const env = envWith();
  await recordPaymentReports(env, { txHashes: [hash(1), hash(2)] });
  const { fetchImpl } = fakeRpc({ [hash(1)]: receipt() });
  assert.deepEqual(await verifyPending(env, { fetchImpl }), { checked: 2, verified: 1, pending: 1 });
  assert.deepEqual(await verifyPending(env, { fetchImpl }), { checked: 1, pending: 1 });
});

// ───────────────────────────────────────────────────────────────────────────── the cast report

test('the cast report records the asset and its payments against the visitor and their Mind', async () => {
  const env = envWith();
  const token = await signSession(env, { kind: 'mind', mindId: 'mind-a', exp: Date.now() + 60_000 });
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const { fetchImpl } = fakeRpc({ [hash(1)]: receipt({ to: CREATOR }), [hash(2)]: receipt({ to: OWNER, amount: 2n * ONE }) });

  const response = await withFetch(fetchImpl, async () => {
    const res = await handleCastRecord(
      castRequest(env, { asset: { key: 'eth:0xabc:1', name: 'Ape #1', collectionName: 'Apes' }, txHashes: [hash(1), `https://basescan.org/tx/${hash(2)}`] }, { token }),
      env,
      ctx,
    );
    await Promise.all(pending);
    return res;
  });
  assert.equal(response.status, 204);

  const visitor = await guestHashFor(env, 'guest-1');
  const [use] = env.RECORDS.rows('asset_inputs');
  assert.equal(use.stage, 'cast');
  assert.equal(use.name, 'Ape #1');
  assert.equal(use.visitor_id, visitor);
  assert.equal(use.mind_id, 'mind-a');
  const payments = env.RECORDS.rows('SELECT tx_hash, status, role, to_address, amount, mind_id FROM x402_payments ORDER BY tx_hash');
  assert.deepEqual(payments, [
    { tx_hash: hash(1), status: 'verified', role: 'creator', to_address: CREATOR, amount: 1, mind_id: 'mind-a' },
    { tx_hash: hash(2), status: 'verified', role: 'owner', to_address: OWNER, amount: 2, mind_id: 'mind-a' },
  ]);
});

test('the cast report refuses a malformed asset and is a silent no-op without the database', async () => {
  const env = envWith();
  assert.equal((await handleCastRecord(castRequest(env, { asset: { key: '../../etc' } }), env)).status, 400);
  const bare = makeEnv();
  assert.equal((await handleCastRecord(castRequest(bare, { asset: { key: 'eth:0xabc:1' } }), bare)).status, 204);
});

// ───────────────────────────────────────────────────────────────────────────── the owner's view

const seed = async () => {
  const env = envWith();
  await recordAssetInputs(env, { stage: 'cast', cast: [{ key: 'eth:0xabc:1', name: 'Ape' }], visitorId: 'v1', at: 1000 });
  await recordAssetInputs(env, { stage: 'screenplay', cast: [{ key: 'eth:0xabc:1', name: 'Ape' }, { key: 'eth:0xabc:2', name: 'Other' }], visitorId: 'v1', submissionId: 's1', at: 2000 });
  await recordAssetInputs(env, { stage: 'cast', cast: [{ key: 'eth:0xabc:1', name: 'Ape' }], visitorId: 'v2', at: 3000 });
  await recordPaymentReports(env, { txHashes: [hash(1)], assetKey: 'eth:0xabc:1', visitorId: 'v1', at: 1000 });
  await recordPaymentReports(env, { txHashes: [hash(2)], assetKey: 'eth:0xabc:1', visitorId: 'v2', at: 3000 });
  const { fetchImpl } = fakeRpc({ [hash(1)]: receipt({ amount: ONE }), [hash(2)]: receipt({ amount: 2n * ONE }) });
  await verifyPending(env, { fetchImpl });
  await recordMindConnection(env, { connectionId: 'c1', mindId: 'mind-a', name: 'Alpha', visitorId: 'v1' });
  return env;
};
const query = (params) => readRecordsQuery(new URLSearchParams(params));

test('the assets view is one row per asset with its uses, people and verified payments', async () => {
  const env = await seed();
  const rows = await queryRecords(env, query({ view: 'assets' }));
  const ape = rows.find((row) => row.asset_key === 'eth:0xabc:1');
  assert.deepEqual(
    { casts: ape.casts, screenplays: ape.screenplays, visitors: ape.visitors, minds: ape.minds, payments: ape.payments, paid: ape.paid },
    { casts: 2, screenplays: 1, visitors: 2, minds: 1, payments: 2, paid: 3 },
  );
  assert.equal(rows[0].asset_key, 'eth:0xabc:1', 'most recently used first');

  const [forMind] = await queryRecords(env, query({ view: 'assets', mind: 'mind-a', asset: 'eth:0xabc:1' }));
  assert.equal(forMind.casts, 1, 'filtered to the Mind, only its own uses');
  assert.equal(forMind.paid, 1, 'and only its own payments');
});

test('the uses, payments, minds and visitors views each answer "who"', async () => {
  const env = await seed();
  const uses = await queryRecords(env, query({ view: 'uses', mind: 'mind-a' }));
  assert.equal(uses.length, 3);
  assert.ok(uses.every((row) => row.mind_name === 'Alpha'));

  const payments = await queryRecords(env, query({ view: 'payments' }));
  assert.equal(payments.length, 2);
  assert.equal(payments[0].asset_name, 'Ape');
  assert.equal(payments.find((row) => row.visitor_id === 'v1').mind_name, 'Alpha');

  const [mind] = await queryRecords(env, query({ view: 'minds' }));
  assert.deepEqual(
    { name: mind.name, visitors: mind.visitors, assets: mind.assets, uses: mind.uses, payments: mind.payments, paid: mind.paid, connections: mind.connections },
    { name: 'Alpha', visitors: 1, assets: 2, uses: 3, payments: 1, paid: 1, connections: 1 },
  );

  const visitors = await queryRecords(env, query({ view: 'visitors', asset: 'eth:0xabc:2' }));
  assert.equal(visitors.length, 1);
  assert.equal(visitors[0].minds, 'Alpha');
});

test('the query string is bounded, and anything unrecognised is no filter rather than an error', () => {
  const q = query({ view: 'drop table', visitor: 'x', mind: 'a\nb', asset: 'nope', limit: '99999', offset: '-3' });
  assert.equal(q.view, 'assets');
  assert.deepEqual(q.filters, { visitor: null, mind: null, asset: null });
  assert.equal(q.limit, 200);
  assert.equal(q.offset, 0);
  assert.equal(query({ format: 'csv', limit: '99999' }).limit, 5000);
});

test('CSV quotes what needs quoting and writes times as ISO', () => {
  const csv = toCsv([{ at: null, name: 'Ape, "the one"', mind_id: null }]);
  assert.equal(csv, 'at,name,mind_id\n,"Ape, ""the one""",\n');
  assert.equal(toCsv([{ reported_at: 1000 }]), 'reported_at\n1970-01-01T00:00:01.000Z\n');
});

test('the owner route needs the owner, and answers JSON or CSV', async () => {
  const env = await seed();
  const get = (path, token) => handleOwnerRecords(new Request(`https://minds.monster${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
  assert.equal((await get('/api/owner/records')).status, 401);
  const mindToken = await signSession(env, { kind: 'mind', mindId: 'mind-a', exp: Date.now() + 60_000 });
  assert.equal((await get('/api/owner/records', mindToken)).status, 401, 'a visitor session is not the owner');

  const owner = await signSession(env, { kind: 'owner', exp: Date.now() + 60_000 });
  const body = await (await get('/api/owner/records?view=payments', owner)).json();
  assert.equal(body.rows.length, 2);
  assert.equal(body.summary.payments, 2);
  assert.equal(body.summary.paid, 3);

  const csv = await get('/api/owner/records?view=uses&format=csv', owner);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /minds-monster-uses-/);
  assert.equal((await csv.text()).trim().split('\n').length, 5, 'a header and four uses');
});
