#!/usr/bin/env node
// Give every dossier already in the store a physical profile.
//
// WHY A BACKFILL AT ALL, when SCHEMA_VERSION exists precisely so old entries are never read
// again. Because the version bump is a correctness mechanism, not a value one: it guarantees
// nothing stale is served, and it also guarantees that every piece anyone has ever cast goes
// cold and costs a fresh call the next time it is used. A half-profiled library is the worst of
// both — some films get correct shot sizes and some do not, and which is which is invisible.
//
// DRY RUN IS THE DEFAULT. Passing no flags reports what a run would do and changes nothing;
// --write is what actually re-casts. That is the wrong way round for a normal CLI and the right
// way round for this one, because the failure mode of an accidental run is a few hundred model
// calls against a rate-limited free tier.
//
// HOW IT WORKS, and why it does not touch KV directly: it re-casts each piece through the
// running Worker's own /api/casting endpoint with refresh:true. The endpoint writes its own KV
// entry, so there is exactly one code path that ever produces a dossier. A script that wrote KV
// itself would be a second implementation of casting, silently drifting from the first.
//
//   node --env-file-if-exists=.env scripts/backfill-profiles.mjs                  # report only
//   node --env-file-if-exists=.env scripts/backfill-profiles.mjs --remote         # against production KV
//   node --env-file-if-exists=.env scripts/backfill-profiles.mjs --write          # actually do it
//   node --env-file-if-exists=.env scripts/backfill-profiles.mjs --write --limit 5
//
// Needs the Worker running (`npm run dev:worker`) unless --base points somewhere else, and
// VITE_ALCHEMY_API_KEY in .env to re-resolve each token's media.

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(`--${flag}`);
const value = (flag, fallback) => {
  const at = argv.indexOf(`--${flag}`);
  return at === -1 ? fallback : argv[at + 1];
};

const WRITE = has('write');
const REMOTE = has('remote');
const BASE = value('base', 'http://localhost:8789');
const LIMIT = Number(value('limit', Infinity));
const TARGET_VERSION = 5;

// The free tier is ~40 RPM shared with everything else on the key, and a cold cast is three
// model calls. Sequential with a pause is not timidity — a burst here would rate-limit the
// visitor-facing site, which is the one thing a maintenance script must never do.
const PAUSE_MS = Number(value('pause', 2000));

const alchemyKey = () => {
  const k = process.env.VITE_ALCHEMY_API_KEY;
  if (!k) throw new Error('VITE_ALCHEMY_API_KEY is not set (it lives in .env)');
  return k;
};

/** Every dossier key in the store, whatever its schema version. */
const listDossierKeys = () => {
  const args = ['wrangler', 'kv', 'key', 'list', '--binding', 'DOSSIERS', REMOTE ? '--remote' : '--local'];
  const out = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // Wrangler prints a banner before the JSON on some versions; take from the first bracket.
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Could not find a key list in wrangler's output:\n${out.slice(0, 400)}`);
  return JSON.parse(out.slice(start)).map((entry) => entry.name);
};

/** `dossier:v4:eth-mainnet:0xabc:123` -> { version: 4, assetKey: 'eth-mainnet:0xabc:123' } */
const parseKey = (key) => {
  const match = /^dossier:v(\d+):(.+)$/.exec(key);
  if (!match) return null;
  return { version: Number(match[1]), assetKey: match[2] };
};

/** `eth-mainnet:0xabc:123` -> the pieces Alchemy needs. Tolerates a token id containing colons. */
const parseAssetKey = (assetKey) => {
  const [chain, address, ...rest] = assetKey.split(':');
  if (!chain || !address || !rest.length) return null;
  return { chain, address, tokenId: rest.join(':') };
};

/** The same stripped NFT shape src/services/swarm.js sends from the browser. */
const resolveNft = async ({ chain, address, tokenId }) => {
  const url = `https://${chain}.g.alchemy.com/nft/v3/${alchemyKey()}/getNFTMetadata?contractAddress=${address}&tokenId=${tokenId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Alchemy ${response.status}`);
  const nft = await response.json();
  const rawMetadata = nft?.raw?.metadata ?? {};
  return {
    contract: { address },
    tokenId,
    name: nft?.name,
    description: nft?.description,
    image: nft?.image
      ? {
          pngUrl: nft.image.pngUrl,
          cachedUrl: nft.image.cachedUrl,
          originalUrl: nft.image.originalUrl,
          thumbnailUrl: nft.image.thumbnailUrl,
          contentType: nft.image.contentType,
        }
      : undefined,
    animationUrl: nft?.animationUrl,
    raw: {
      metadata: {
        image: rawMetadata.image,
        animation_url: rawMetadata.animation_url,
        video_url: rawMetadata.video_url,
        description: rawMetadata.description,
        attributes: rawMetadata.attributes,
      },
    },
  };
};

/** Drive /api/casting and return its terminal `result`, or throw whatever it reported. */
const recast = async (key, nft) => {
  const response = await fetch(`${BASE}/api/casting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, nft, refresh: true }),
  });
  if (!response.ok) throw new Error(`/api/casting returned ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = null;
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (!line.startsWith('data: ')) continue;
      const payload = JSON.parse(line.slice(6));
      if (event === 'error') throw new Error(payload.error ?? 'casting failed');
      if (event === 'result') return payload;
    }
  }
  throw new Error('the casting stream ended without a result');
};

// ─────────────────────────────────────────────────────────────────────────────── main

const keys = listDossierKeys().map(parseKey).filter(Boolean);

// Highest version held per asset. An asset already at the target needs nothing, whatever else
// is lying around under older versions.
const best = new Map();
for (const { version, assetKey } of keys) {
  best.set(assetKey, Math.max(best.get(assetKey) ?? 0, version));
}

const stale = [...best.entries()]
  .filter(([, version]) => version < TARGET_VERSION)
  .map(([assetKey]) => assetKey);

console.log(`Store: ${keys.length} dossier entr${keys.length === 1 ? 'y' : 'ies'} across ${best.size} piece(s), ${REMOTE ? 'remote' : 'local'}.`);
console.log(`At v${TARGET_VERSION} already: ${best.size - stale.length}. Needing a profile: ${stale.length}.`);

if (!stale.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

const planned = stale.slice(0, Number.isFinite(LIMIT) ? LIMIT : stale.length);

if (!WRITE) {
  console.log(`\n--dry-run is the default: nothing has been written. ${planned.length} piece(s) would be re-cast:\n`);
  for (const assetKey of planned.slice(0, 20)) console.log(`  ${assetKey}`);
  if (planned.length > 20) console.log(`  ... and ${planned.length - 20} more`);
  console.log(
    `\nCost: $0 — casting runs on the free vision tier. Time: roughly ${Math.ceil((planned.length * (60_000 + PAUSE_MS)) / 60_000)} min at ~60s per cold cast.`,
  );
  console.log(`\nRun it with:  node --env-file-if-exists=.env scripts/backfill-profiles.mjs --write${REMOTE ? ' --remote' : ''}`);
  process.exit(0);
}

console.log(`\nRe-casting ${planned.length} piece(s) through ${BASE} ...\n`);

let done = 0;
const failures = [];

for (const assetKey of planned) {
  const parts = parseAssetKey(assetKey);
  if (!parts) {
    failures.push([assetKey, 'unparseable asset key']);
    continue;
  }
  try {
    const nft = await resolveNft(parts);
    const record = await recast(assetKey, nft);
    const profile = record?.physicalProfile;
    if (!profile?.bodyPlan) throw new Error('came back without a physicalProfile');
    done += 1;
    console.log(`  ✔ ${assetKey}  ${profile.bodyPlan}, ${profile.heightM}m [${profile.heightConfidence}]`);
  } catch (error) {
    failures.push([assetKey, error.message]);
    console.log(`  ✘ ${assetKey}  ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
}

console.log(`\nProfiled ${done} of ${planned.length}.`);
if (failures.length) {
  console.log(`\n${failures.length} failed — their old dossiers are untouched and still readable:`);
  for (const [assetKey, reason] of failures) console.log(`  ${assetKey}: ${reason}`);
  // A partial backfill is a real outcome worth a non-zero exit, so a wrapper can notice.
  process.exit(1);
}
