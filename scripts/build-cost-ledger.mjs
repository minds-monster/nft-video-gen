// Reconstructs a historical cost ledger from real past render manifests. None of these
// manifests ever had a dollar figure persisted (priceUsd() was only printed to a
// terminal at render time and discarded) — this re-applies the same real rate table to
// the real duration/resolution/model fields that WERE saved, so the Producer briefing
// can cite genuine baseline numbers instead of nothing.
//
// Usage: node scripts/build-cost-ledger.mjs
// Writes: assets/renders/ledger.json

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceUsd } from './minimax.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERS_DIR = join(__dirname, '..', 'assets', 'renders');

const files = (await readdir(RENDERS_DIR)).filter((f) => f.endsWith('.json') && f !== 'ledger.json');

const entries = [];
for (const file of files) {
  const raw = JSON.parse(await readFile(join(RENDERS_DIR, file), 'utf8'));
  const { model, resolution, duration } = raw;
  if (!model || !resolution || !duration) continue;
  const cost = priceUsd({ model, resolution, duration });
  if (cost == null) continue;
  entries.push({ file, model, resolution, duration, costUsd: Math.round(cost * 1000) / 1000 });
}

const count = entries.length;
const totalUsd = Math.round(entries.reduce((sum, e) => sum + e.costUsd, 0) * 100) / 100;
const avgUsd = count ? Math.round((totalUsd / count) * 100) / 100 : 0;

const byModel = {};
for (const e of entries) {
  byModel[e.model] ??= { count: 0, totalUsd: 0 };
  byModel[e.model].count += 1;
  byModel[e.model].totalUsd += e.costUsd;
}
for (const key of Object.keys(byModel)) {
  byModel[key].totalUsd = Math.round(byModel[key].totalUsd * 100) / 100;
}

const ledger = {
  generatedAt: new Date().toISOString(),
  renderedManifestsFound: files.length,
  pricedEntries: count,
  totalUsd,
  avgUsd,
  byModel,
  entries,
};

await writeFile(join(RENDERS_DIR, 'ledger.json'), JSON.stringify(ledger, null, 2));

console.log(`Priced ${count}/${files.length} manifests.`);
console.log(`Total: $${totalUsd} · Average: $${avgUsd}/clip`);
console.log('By model:', JSON.stringify(byModel, null, 2));
console.log('Written to assets/renders/ledger.json');
