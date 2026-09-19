// The owner's records: which assets were used, which x402 payments went through, and by whom —
// the visitor first, and their Mind once they connect one. Schema: migrations/0001_records.sql.
//
// WHY D1 AND NOT ANALYTICS ENGINE OR KV. worker/analytics.js is counts: AE keeps ~90 days and
// cannot look up one event, and KV lists by prefix only. These are records the owner asks
// questions of ("every payment for this asset", "everything this Mind has used"), which is a
// SQL shape. Binding `env.RECORDS`; absent (preview, bare tests) every write is a no-op.
//
// WHO. A visitor is guestHashFor(guestId) — the same stable HMAC the analytics index uses, sent
// by the browser as `x-guest-id` and never stored raw. A Mind is its real mindId. The two are
// joined in `visitor_minds` whenever a connected visitor loads the site (linkVisitor), and at
// that moment every earlier guest row of that visitor is attributed to the Mind.
//
// WHERE EACH RECORD COMES FROM:
//   cast        POST /api/records/cast, from src/services/swarm.js castPiece. Prod casts
//               against the external nft-assets-server, so the browser is the only witness.
//   screenplay  worker/screenwriter.js, which every film goes through on every environment.
//   connection  worker/connect.js, on the poll that first sees the Mind approve.
//   payment     the same cast report — the casting stream's `paid` phase carries the tx hashes
//               and only the browser receives it. Each hash is then checked on Base before it
//               counts; see checkTransaction. A webhook from nft-assets-server is planned and
//               would write the same rows with source 'webhook'.

import { guestHashFor } from './analytics.js';
import { requireSession } from './session.js';
import { requireOwner } from './owner-auth.js';
import { rateLimited, clientIp } from './rate-limit.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const recordsDb = (env) => env?.RECORDS ?? null;

// ───────────────────────────────────────────────────────────────────────────── identity

export const GUEST_HEADER = 'x-guest-id';

/** The visitor behind a request, hashed, or null when the browser sent no guestId. */
export async function visitorIdFrom(request, env) {
  const raw = String(request.headers.get(GUEST_HEADER) ?? '').trim().slice(0, 64);
  return raw ? guestHashFor(env, raw) : null;
}

const upsertVisitor = (db, visitorId, at) =>
  db
    .prepare(
      `INSERT INTO visitors (visitor_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT (visitor_id) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    )
    .bind(visitorId, at, at);

const upsertMind = (db, { mindId, name = null, at, connected = false }) =>
  db
    .prepare(
      `INSERT INTO minds (mind_id, name, first_seen_at, last_seen_at, connections) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (mind_id) DO UPDATE SET
         name = COALESCE(excluded.name, minds.name),
         last_seen_at = MAX(minds.last_seen_at, excluded.last_seen_at),
         connections = minds.connections + excluded.connections`,
    )
    .bind(mindId, name, at, at, connected ? 1 : 0);

/**
 * This visitor is this Mind. Links the two and hands the visitor's earlier guest rows to the
 * Mind — "the individual user, and then their Mind if/when they connect it".
 */
export async function linkVisitor(env, { visitorId, mindId, name = null, at = Date.now() }) {
  const db = recordsDb(env);
  if (!db || !visitorId || !mindId) return false;
  await db.batch([
    upsertVisitor(db, visitorId, at),
    upsertMind(db, { mindId, name, at }),
    db
      .prepare(
        `INSERT INTO visitor_minds (visitor_id, mind_id, first_linked_at, last_linked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (visitor_id, mind_id) DO UPDATE SET last_linked_at = excluded.last_linked_at`,
      )
      .bind(visitorId, mindId, at, at),
    db.prepare('UPDATE asset_inputs SET mind_id = ? WHERE visitor_id = ? AND mind_id IS NULL').bind(mindId, visitorId),
    db.prepare('UPDATE x402_payments SET mind_id = ? WHERE visitor_id = ? AND mind_id IS NULL').bind(mindId, visitorId),
  ]);
  return true;
}

/** One approved connect handshake. */
export async function recordMindConnection(env, { connectionId, mindId, name = null, visitorId = null, at = Date.now() }) {
  const db = recordsDb(env);
  if (!db || !mindId || !connectionId) return false;
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO mind_connections (connection_id, mind_id, visitor_id, approved_at) VALUES (?, ?, ?, ?)')
    .bind(connectionId, mindId, visitorId, at)
    .run();
  // Counted only when the handshake is new: the status poll can see the same approval twice.
  if (inserted.meta?.changes) await upsertMind(db, { mindId, name, at, connected: true }).run();
  if (visitorId) await linkVisitor(env, { visitorId, mindId, name, at });
  return true;
}

// ───────────────────────────────────────────────────────────────────────────── assets

const ASSET_KEY = /^[\w-]{1,32}:[\w.-]{1,128}:[\w.-]{1,128}$/;
export const isAssetKey = (key) => typeof key === 'string' && key.length <= 300 && ASSET_KEY.test(key);
const text = (value, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/**
 * One row per asset. `cast` is [{ key, name, collectionName }] — the wire shape both the
 * screenplay body and the cast report already carry. Entries without a valid key are skipped.
 */
export async function recordAssetInputs(env, { stage, cast, primaryKey = null, submissionId = null, visitorId = null, mindId = null, at = Date.now() }) {
  const db = recordsDb(env);
  if (!db || !Array.isArray(cast)) return 0;
  const rows = cast.filter((entry) => isAssetKey(entry?.key)).slice(0, 50);
  if (!rows.length) return 0;
  const statements = rows.map((entry) => {
    const [chain, contract, ...rest] = entry.key.split(':');
    return db
      .prepare(
        `INSERT INTO asset_inputs (at, stage, asset_key, chain, contract, token_id, name, collection, is_primary, submission_id, visitor_id, mind_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(at, stage, entry.key, chain, contract, rest.join(':'), text(entry.name), text(entry.collectionName), entry.key === primaryKey ? 1 : 0, submissionId, visitorId, mindId);
  });
  if (visitorId) statements.unshift(upsertVisitor(db, visitorId, at));
  if (mindId) statements.unshift(upsertMind(db, { mindId, at }));
  await db.batch(statements);
  return rows.length;
}

// ───────────────────────────────────────────────────────────────────────────── payments

// Base mainnet and the x402 token (TEST402), confirmed by the owner 2026-09-19. Vars so a
// token change or a different RPC is config, not a deploy of new code.
export const X402_TOKEN_DEFAULT = '0x675ae1ca87b2cfe5f50457d4d01da4c60347e30a';
// Tried in order until one answers. mainnet.base.org alone is not enough: it answered 429 to
// every call from a Worker on 2026-09-19 (shared Cloudflare egress) while answering a laptop
// fine. So the keyed endpoint goes first — the `BASE_RPC_URL` secret, the Alchemy Base URL —
// and the public ones are fallbacks. `BASE_RPC_URLS` (comma-separated) replaces the list.
export const BASE_RPC_DEFAULTS = Object.freeze(['https://mainnet.base.org', 'https://base.drpc.org', 'https://1rpc.io/base']);
export const rpcUrls = (env) => [
  ...(env.BASE_RPC_URL ? [env.BASE_RPC_URL] : []),
  ...(env.BASE_RPC_URLS ? String(env.BASE_RPC_URLS).split(',').map((url) => url.trim()).filter(Boolean) : BASE_RPC_DEFAULTS),
];
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DECIMALS_CALL = '0x313ce567';
// Twelve checks, one per */5 cron run: an hour for a reported transaction to appear on-chain.
export const MAX_CHECKS = 12;

const TX_HASH = /0x[0-9a-fA-F]{64}/;
/** The casting stream sends bare hashes or basescan URLs, comma-separated; keep the hashes. */
export const txHashesIn = (values) => {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',');
  const hashes = [];
  for (const value of list) {
    const match = String(value).match(TX_HASH);
    if (match && !hashes.includes(match[0].toLowerCase())) hashes.push(match[0].toLowerCase());
  }
  return hashes.slice(0, 10);
};

/** Store reported payments as pending. A repeat report fills gaps but never overwrites. */
export async function recordPaymentReports(env, { txHashes, assetKey = null, visitorId = null, mindId = null, source = 'browser', at = Date.now() }) {
  const db = recordsDb(env);
  const hashes = txHashesIn(txHashes);
  if (!db || !hashes.length) return [];
  await db.batch(
    hashes.map((hash, index) =>
      db
        .prepare(
          `INSERT INTO x402_payments (tx_hash, status, source, role, asset_key, visitor_id, mind_id, reported_at)
           VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tx_hash) DO UPDATE SET
             asset_key = COALESCE(x402_payments.asset_key, excluded.asset_key),
             visitor_id = COALESCE(x402_payments.visitor_id, excluded.visitor_id),
             mind_id = COALESCE(x402_payments.mind_id, excluded.mind_id)`,
        )
        .bind(hash, source, hashes.length > 1 ? (index === 0 ? 'creator' : 'owner') : null, assetKey, visitorId, mindId, at),
    ),
  );
  return hashes;
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'rpc';
  }
};

/** One JSON-RPC call, falling through the endpoints. The error names every one that failed. */
async function rpc(env, method, params, fetchImpl) {
  const failures = [];
  for (const url of rpcUrls(env)) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`rpc_${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`rpc: ${body.error.message ?? JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      // Only the host is kept — the keyed URL carries its key in the path.
      failures.push(`${hostOf(url)} ${error?.message ?? error}`);
    }
  }
  throw new Error(failures.join('; ') || 'no_rpc_configured');
}

const decimalsCache = new Map();
async function tokenDecimals(env, token, fetchImpl) {
  if (!decimalsCache.has(token)) {
    const result = await rpc(env, 'eth_call', [{ to: token, data: DECIMALS_CALL }, 'latest'], fetchImpl);
    decimalsCache.set(token, Number(BigInt(result)));
  }
  return decimalsCache.get(token);
}

const topicAddress = (topic) => `0x${String(topic).slice(-40)}`.toLowerCase();
const toUnits = (raw, decimals) => {
  const scale = 10n ** BigInt(decimals);
  return Number(raw / scale) + Number(raw % scale) / Number(scale);
};

/**
 * What Base says about one transaction. `pending` when there is no receipt yet. Verified means
 * it succeeded AND emitted a Transfer from the x402 token contract — a real hash of some other
 * transaction does not count, and neither does a reverted one.
 */
export async function checkTransaction(env, txHash, { fetchImpl = fetch } = {}) {
  const token = String(env.X402_TOKEN_ADDRESS || X402_TOKEN_DEFAULT).toLowerCase();
  const receipt = await rpc(env, 'eth_getTransactionReceipt', [txHash], fetchImpl);
  if (!receipt) return { status: 'pending' };
  const blockNumber = Number(BigInt(receipt.blockNumber));
  const block = await rpc(env, 'eth_getBlockByNumber', [receipt.blockNumber, false], fetchImpl).catch(() => null);
  const paidAt = block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : null;
  if (receipt.status !== '0x1') return { status: 'reverted', blockNumber, paidAt };

  const transfers = (receipt.logs ?? []).filter(
    (log) => String(log.address).toLowerCase() === token && String(log.topics?.[0]).toLowerCase() === TRANSFER_TOPIC,
  );
  if (!transfers.length) return { status: 'not_x402', blockNumber, paidAt };
  const raw = transfers.reduce((sum, log) => sum + BigInt(log.data), 0n);
  const decimals = await tokenDecimals(env, token, fetchImpl);
  return {
    status: 'verified',
    fromAddress: topicAddress(transfers[0].topics[1]),
    toAddress: topicAddress(transfers[0].topics[2]),
    amountRaw: raw.toString(),
    amount: toUnits(raw, decimals),
    transfers: transfers.length,
    blockNumber,
    paidAt,
  };
}

/** Check one stored payment and write down what Base said. */
export async function verifyPayment(env, txHash, { now = Date.now(), fetchImpl } = {}) {
  const db = recordsDb(env);
  if (!db) return null;
  const row = await db.prepare('SELECT check_attempts FROM x402_payments WHERE tx_hash = ?').bind(txHash).first();
  if (!row) return null;
  const attempts = (row.check_attempts ?? 0) + 1;
  let result;
  try {
    result = await checkTransaction(env, txHash, { fetchImpl });
  } catch (error) {
    // An RPC failure is not evidence about the transaction; it stays pending for the next check.
    result = { status: 'pending', note: String(error?.message ?? error).slice(0, 200) };
  }
  if (result.status === 'pending' && attempts >= MAX_CHECKS) result = { ...result, status: 'not_found' };
  await db
    .prepare(
      `UPDATE x402_payments SET status = ?, from_address = ?, to_address = ?, amount_raw = ?, amount = ?, transfers = ?,
         block_number = ?, paid_at = ?, checked_at = ?, check_attempts = ?, note = ? WHERE tx_hash = ?`,
    )
    .bind(
      result.status,
      result.fromAddress ?? null,
      result.toAddress ?? null,
      result.amountRaw ?? null,
      result.amount ?? null,
      result.transfers ?? null,
      result.blockNumber ?? null,
      result.paidAt ?? null,
      now,
      attempts,
      result.note ?? null,
      txHash,
    )
    .run();
  return result;
}

/** The five-minute cron's share: re-check payments that had no receipt yet. */
export async function verifyPending(env, { limit = 10, fetchImpl } = {}) {
  const db = recordsDb(env);
  if (!db) return { checked: 0 };
  const { results } = await db
    .prepare("SELECT tx_hash FROM x402_payments WHERE status = 'pending' ORDER BY reported_at LIMIT ?")
    .bind(limit)
    .all();
  const outcomes = {};
  for (const { tx_hash: hash } of results) {
    const result = await verifyPayment(env, hash, { fetchImpl });
    outcomes[result?.status ?? 'missing'] = (outcomes[result?.status ?? 'missing'] ?? 0) + 1;
  }
  return { checked: results.length, ...outcomes };
}

// ───────────────────────────────────────────────────────────────────────────── the cast report

/**
 * POST /api/records/cast { asset: { key, name, collectionName }, txHashes: [] }
 * Sent by castPiece once a cast settles. Always 204 to the browser — a record failing to write
 * must never be something the visitor sees.
 */
export async function handleCastRecord(request, env, ctx) {
  if (!recordsDb(env)) return new Response(null, { status: 204 });
  if (await rateLimited(env, 'records', clientIp(request), { limit: 240, windowSec: 3600 })) return json({ error: 'rate_limited' }, 429);
  const body = await request.json().catch(() => ({}));
  const asset = body?.asset ?? {};
  if (!isAssetKey(asset.key)) return json({ error: 'invalid_asset' }, 400);

  const [visitorId, session] = await Promise.all([visitorIdFrom(request, env), requireSession(request, env)]);
  const mindId = session?.mindId ?? null;
  const at = Date.now();
  const work = (async () => {
    await recordAssetInputs(env, { stage: 'cast', cast: [asset], primaryKey: null, visitorId, mindId, at });
    const hashes = await recordPaymentReports(env, { txHashes: body.txHashes, assetKey: asset.key, visitorId, mindId, at });
    for (const hash of hashes) await verifyPayment(env, hash);
  })().catch((error) => console.warn('records: cast report failed:', error?.message ?? error));
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
  return new Response(null, { status: 204 });
}

// ───────────────────────────────────────────────────────────────────────────── the owner's view

export const RECORD_VIEWS = Object.freeze(['assets', 'uses', 'payments', 'minds', 'visitors']);
const PAGE_MAX = 200;
const CSV_MAX = 5000;

/**
 * Filters shared by every view: one visitor, one Mind, one asset. Each view says how a filter
 * applies to its own rows; the params are returned in the order their `?` appear.
 */
const clauses = (filters, forms) => {
  const where = [];
  const params = [];
  for (const [name, value] of Object.entries(filters)) {
    if (!value || !forms[name]) continue;
    where.push(forms[name]);
    params.push(value);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

const VIEWS = {
  assets: (filters) => {
    const inputs = clauses(filters, { visitor: 'a.visitor_id = ?', mind: 'a.mind_id = ?', asset: 'a.asset_key = ?' });
    const paid = clauses(filters, { visitor: 'p.visitor_id = ?', mind: 'p.mind_id = ?' });
    const paidWhere = paid.sql ? `AND ${paid.sql.slice(6)}` : '';
    return {
      sql: `SELECT a.asset_key, MAX(a.name) AS name, MAX(a.collection) AS collection, a.chain, a.contract, a.token_id,
              SUM(a.stage = 'cast') AS casts, SUM(a.stage IN ('screenplay', 'rewrite')) AS screenplays,
              COUNT(DISTINCT a.visitor_id) AS visitors, COUNT(DISTINCT a.mind_id) AS minds,
              MIN(a.at) AS first_used_at, MAX(a.at) AS last_used_at,
              (SELECT COUNT(*) FROM x402_payments p WHERE p.asset_key = a.asset_key AND p.status = 'verified' ${paidWhere}) AS payments,
              (SELECT COALESCE(SUM(p.amount), 0) FROM x402_payments p WHERE p.asset_key = a.asset_key AND p.status = 'verified' ${paidWhere}) AS paid
            FROM asset_inputs a ${inputs.sql} GROUP BY a.asset_key ORDER BY last_used_at DESC`,
      params: [...paid.params, ...paid.params, ...inputs.params],
    };
  },
  uses: (filters) => {
    const where = clauses(filters, { visitor: 'a.visitor_id = ?', mind: 'a.mind_id = ?', asset: 'a.asset_key = ?' });
    return {
      sql: `SELECT a.at, a.stage, a.asset_key, a.name, a.collection, a.is_primary, a.submission_id, a.visitor_id, a.mind_id, m.name AS mind_name
            FROM asset_inputs a LEFT JOIN minds m ON m.mind_id = a.mind_id ${where.sql} ORDER BY a.at DESC, a.id DESC`,
      params: where.params,
    };
  },
  payments: (filters) => {
    const where = clauses(filters, { visitor: 'p.visitor_id = ?', mind: 'p.mind_id = ?', asset: 'p.asset_key = ?' });
    return {
      sql: `SELECT p.reported_at, p.paid_at, p.status, p.role, p.tx_hash, p.asset_key,
              (SELECT a.name FROM asset_inputs a WHERE a.asset_key = p.asset_key ORDER BY a.at DESC LIMIT 1) AS asset_name,
              p.from_address, p.to_address, p.amount, p.visitor_id, p.mind_id, m.name AS mind_name, p.source, p.note
            FROM x402_payments p LEFT JOIN minds m ON m.mind_id = p.mind_id ${where.sql} ORDER BY p.reported_at DESC`,
      params: where.params,
    };
  },
  minds: (filters) => {
    const where = clauses(filters, {
      mind: 'm.mind_id = ?',
      visitor: 'm.mind_id IN (SELECT mind_id FROM visitor_minds WHERE visitor_id = ?)',
      asset: 'm.mind_id IN (SELECT mind_id FROM asset_inputs WHERE asset_key = ?)',
    });
    return {
      sql: `SELECT m.mind_id, m.name, m.first_seen_at, m.last_seen_at, m.connections,
              (SELECT COUNT(*) FROM visitor_minds vm WHERE vm.mind_id = m.mind_id) AS visitors,
              (SELECT COUNT(DISTINCT a.asset_key) FROM asset_inputs a WHERE a.mind_id = m.mind_id) AS assets,
              (SELECT COUNT(*) FROM asset_inputs a WHERE a.mind_id = m.mind_id) AS uses,
              (SELECT COUNT(*) FROM x402_payments p WHERE p.mind_id = m.mind_id AND p.status = 'verified') AS payments,
              (SELECT COALESCE(SUM(p.amount), 0) FROM x402_payments p WHERE p.mind_id = m.mind_id AND p.status = 'verified') AS paid
            FROM minds m ${where.sql} ORDER BY m.last_seen_at DESC`,
      params: where.params,
    };
  },
  visitors: (filters) => {
    const where = clauses(filters, {
      visitor: 'v.visitor_id = ?',
      mind: 'v.visitor_id IN (SELECT visitor_id FROM visitor_minds WHERE mind_id = ?)',
      asset: 'v.visitor_id IN (SELECT visitor_id FROM asset_inputs WHERE asset_key = ?)',
    });
    return {
      sql: `SELECT v.visitor_id, v.first_seen_at, v.last_seen_at,
              (SELECT GROUP_CONCAT(vm.mind_id) FROM visitor_minds vm WHERE vm.visitor_id = v.visitor_id) AS mind_ids,
              (SELECT GROUP_CONCAT(COALESCE(m.name, vm.mind_id), ', ') FROM visitor_minds vm LEFT JOIN minds m ON m.mind_id = vm.mind_id WHERE vm.visitor_id = v.visitor_id) AS minds,
              (SELECT COUNT(DISTINCT a.asset_key) FROM asset_inputs a WHERE a.visitor_id = v.visitor_id) AS assets,
              (SELECT COUNT(*) FROM asset_inputs a WHERE a.visitor_id = v.visitor_id) AS uses,
              (SELECT COUNT(*) FROM x402_payments p WHERE p.visitor_id = v.visitor_id AND p.status = 'verified') AS payments,
              (SELECT COALESCE(SUM(p.amount), 0) FROM x402_payments p WHERE p.visitor_id = v.visitor_id AND p.status = 'verified') AS paid
            FROM visitors v ${where.sql} ORDER BY v.last_seen_at DESC`,
      params: where.params,
    };
  },
};

/** Headline numbers for the tab, unfiltered. */
export async function recordsSummary(env) {
  const db = recordsDb(env);
  if (!db) return null;
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT asset_key) FROM asset_inputs) AS assets,
         (SELECT COUNT(*) FROM asset_inputs) AS uses,
         (SELECT COUNT(*) FROM visitors) AS visitors,
         (SELECT COUNT(*) FROM minds) AS minds,
         (SELECT COUNT(*) FROM x402_payments WHERE status = 'verified') AS payments,
         (SELECT COALESCE(SUM(amount), 0) FROM x402_payments WHERE status = 'verified') AS paid,
         (SELECT COUNT(*) FROM x402_payments WHERE status = 'pending') AS pending_payments`,
    )
    .first();
}

/** Pure: read and bound the query string. Unknown values become "no filter", never an error. */
export function readRecordsQuery(searchParams) {
  const view = RECORD_VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'assets';
  const visitor = /^[0-9a-f]{32}$/.test(searchParams.get('visitor') ?? '') ? searchParams.get('visitor') : null;
  const mindRaw = searchParams.get('mind') ?? '';
  const mind = mindRaw && mindRaw.length <= 128 && !/[\r\n]/.test(mindRaw) ? mindRaw : null;
  const asset = isAssetKey(searchParams.get('asset')) ? searchParams.get('asset') : null;
  const format = searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const limit = Math.max(1, Math.min(format === 'csv' ? CSV_MAX : PAGE_MAX, Number(searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0);
  return { view, filters: { visitor, mind, asset }, format, limit, offset };
}

export async function queryRecords(env, { view, filters, limit, offset }) {
  const db = recordsDb(env);
  if (!db) return [];
  const { sql, params } = VIEWS[view](filters);
  const { results } = await db.prepare(`${sql} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
  return results;
}

const csvCell = (value) => {
  if (value == null) return '';
  const cell = String(value);
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};
const TIME_COLUMNS = /(_at|^at)$/;
/** Pure: rows to CSV, with epoch-millisecond columns written as ISO times. */
export function toCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(TIME_COLUMNS.test(column) && row[column] ? new Date(row[column]).toISOString() : row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** GET /api/owner/records?view=&visitor=&mind=&asset=&limit=&offset=&format=csv */
export async function handleOwnerRecords(request, env) {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!recordsDb(env)) return json({ error: 'records_not_configured' }, 409);
  const query = readRecordsQuery(new URL(request.url).searchParams);
  const rows = await queryRecords(env, query);
  if (query.format === 'csv') {
    return new Response(toCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="minds-monster-${query.view}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  const summary = query.offset === 0 ? await recordsSummary(env) : null;
  return json({ view: query.view, filters: query.filters, rows, summary, hasMore: rows.length === query.limit });
}
