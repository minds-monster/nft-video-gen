#!/usr/bin/env node
// Verify that every contract address in src/data/brands.js actually resolves
// on the chain it claims, and help find addresses for brands that are still pending.
//
//   npm run verify:brands
//   npm run verify:brands -- --search "gucci"
//
// Reads ALCHEMY_API_KEY, or VITE_ALCHEMY_API_KEY from .env (loaded by the npm
// script via --env-file). Never commit an address this script can't confirm.

import { Alchemy, Network } from 'alchemy-sdk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const apiKey = process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
if (!apiKey) {
  console.error(
    'No API key. Set VITE_ALCHEMY_API_KEY in .env (npm run verify:brands loads it) ' +
      'or export ALCHEMY_API_KEY.',
  );
  process.exit(1);
}

// brands.js is plain ESM data with no imports, so it loads directly in node.
const { BRANDS, SECTORS } = await import(resolve(root, 'src/data/brands.js'));

// alchemy.js reads import.meta.env, which node can't evaluate — parse the NETWORKS
// keys out of the source instead so the two files can't drift apart silently.
const alchemySource = readFileSync(resolve(root, 'src/services/alchemy.js'), 'utf8');
const networksBlock = alchemySource.match(/export const NETWORKS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const SUPPORTED_CHAINS = [...networksBlock.matchAll(/"([a-z0-9-]+-mainnet)":\s*Network\.(\w+)/g)]
  .map(([, chain, member]) => ({ chain, member }))
  .filter(({ member }) => member in Network);

const networkFor = (chain) => SUPPORTED_CHAINS.find((n) => n.chain === chain)?.member;

// Same trick for the chains alchemy.js reaches by url override rather than by enum.
const hostsBlock = alchemySource.match(/const CUSTOM_HOSTS = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const CUSTOM_HOSTS = Object.fromEntries(
  [...hostsBlock.matchAll(/"([a-z0-9-]+-mainnet)":\s*"([^"]+)"/g)].map(([, chain, host]) => [
    chain,
    host,
  ]),
);

// Custom-host chains talk to the v3 REST endpoints directly, for the same reason
// alchemy.js does: the SDK's `url` override routes NFT calls to the v2 API and its v3
// parser then chokes on the older response shape. Exposed behind a `.nft` facade so the
// call sites below don't care which kind of client they got.
const restClient = (host) => {
  const call = async (method, params) => {
    const url = new URL(`https://${host}/nft/v3/${apiKey}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  };
  return {
    nft: {
      getContractMetadata: (address) => call('getContractMetadata', { contractAddress: address }),
      searchContractMetadata: (query) => call('searchContractMetadata', { query }),
    },
  };
};

const clients = new Map();
const clientFor = (chain) => {
  const member = networkFor(chain);
  const host = CUSTOM_HOSTS[chain];
  if (!member && !host) return null;
  if (!clients.has(chain)) {
    clients.set(
      chain,
      host ? restClient(host) : new Alchemy({ apiKey, network: Network[member] }),
    );
  }
  return clients.get(chain);
};

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
const pad = (value, width) => String(value ?? '').padEnd(width).slice(0, width);

// --------------------------------------------------------------- search mode
const searchIndex = process.argv.indexOf('--search');
if (searchIndex !== -1) {
  const query = process.argv[searchIndex + 1];
  if (!query) {
    console.error('Usage: npm run verify:brands -- --search "brand name"');
    process.exit(1);
  }

  // Only chains enabled on your Alchemy app will answer; the rest return 403.
  // Override with: --chains eth-mainnet,polygon-mainnet
  const chainsArg = process.argv[process.argv.indexOf('--chains') + 1];
  const chains =
    process.argv.includes('--chains') && chainsArg
      ? chainsArg.split(',')
      : ['eth-mainnet', 'base-mainnet'];
  console.log(`\n${c.bold}Searching "${query}" across ${chains.length} chains${c.reset}\n`);

  for (const chain of chains) {
    let contracts = [];
    try {
      ({ contracts = [] } = await clientFor(chain).nft.searchContractMetadata(query));
    } catch (error) {
      console.log(`${c.red}✗${c.reset} ${chain}: ${error.message}`);
      continue;
    }
    if (!contracts.length) {
      console.log(`${c.dim}·${c.reset} ${chain}: no matches`);
      continue;
    }
    console.log(`\n${c.cyan}${chain}${c.reset}`);
    for (const contract of contracts.slice(0, 12)) {
      console.log(
        `  ${pad(contract.name, 40)} ${c.dim}${contract.address}${c.reset} ` +
          `${c.dim}supply ${contract.totalSupply ?? '?'}${c.reset}`,
      );
    }
  }
  console.log(
    `\n${c.yellow}Verify a candidate is the real brand contract before committing it.${c.reset}\n`,
  );
  process.exit(0);
}

// --------------------------------------------------------------- verify mode
console.log(`\n${c.bold}Verifying brand registry${c.reset}`);
console.log(`${c.dim}${BRANDS.length} brands · ${SECTORS.length} sectors${c.reset}\n`);

const results = { pass: [], fail: [], pending: [] };

for (const brand of BRANDS) {
  if (!brand.collections.length) {
    results.pending.push({ brand });
    console.log(
      `${c.dim}·${c.reset} ${pad(brand.slug, 20)} ${c.dim}pending — no contract set${c.reset}`,
    );
    continue;
  }

  for (const collection of brand.collections) {
    const client = clientFor(collection.chain);
    if (!client) {
      results.fail.push({ brand, collection, reason: `unsupported chain ${collection.chain}` });
      console.log(
        `${c.red}✗${c.reset} ${pad(brand.slug, 20)} ${c.red}chain "${collection.chain}" not in NETWORKS${c.reset}`,
      );
      continue;
    }

    try {
      const meta = await client.nft.getContractMetadata(collection.address);
      const onChainName = meta?.name ?? meta?.openSeaMetadata?.collectionName ?? null;
      const supply = Number(meta?.totalSupply ?? 0);

      if (!onChainName && !supply) {
        results.fail.push({ brand, collection, reason: 'no metadata / not an NFT contract' });
        console.log(
          `${c.red}✗${c.reset} ${pad(brand.slug, 20)} ${pad(collection.name, 34)} ` +
            `${c.red}resolved to nothing${c.reset} ${c.dim}${collection.address}${c.reset}`,
        );
        continue;
      }

      results.pass.push({ brand, collection, onChainName, supply, tokenType: meta?.tokenType });
      console.log(
        `${c.green}✓${c.reset} ${pad(brand.slug, 20)} ${pad(collection.name, 34)} ` +
          `${c.bold}${pad(onChainName, 30)}${c.reset} ` +
          `${c.dim}${pad(meta?.tokenType ?? '?', 8)} supply ${supply || '?'}${c.reset}`,
      );
    } catch (error) {
      results.fail.push({ brand, collection, reason: error.message });
      console.log(
        `${c.red}✗${c.reset} ${pad(brand.slug, 20)} ${pad(collection.name, 34)} ` +
          `${c.red}${error.message}${c.reset}`,
      );
    }
  }
}

console.log(
  `\n${c.bold}Summary${c.reset}  ` +
    `${c.green}${results.pass.length} verified${c.reset} · ` +
    `${c.red}${results.fail.length} failed${c.reset} · ` +
    `${c.dim}${results.pending.length} pending${c.reset}\n`,
);

if (results.fail.length) {
  console.log(`${c.yellow}Fix or remove these before committing:${c.reset}`);
  for (const { brand, collection, reason } of results.fail) {
    console.log(`  ${brand.slug} → ${collection.address} (${collection.chain}): ${reason}`);
  }
  console.log('');
  process.exit(1);
}

// A registry where every brand is pending would render an empty wall — worth flagging.
if (!results.pass.length) {
  console.log(`${c.yellow}No live collections at all — the wall will have no artwork.${c.reset}\n`);
  process.exit(1);
}
