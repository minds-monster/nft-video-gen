// Contracts the visitor has actually opened, remembered across reloads.
//
// Two jobs. For the visitor: a one-click way back into a collection they pasted before,
// without re-finding the address. For us: evidence of which contracts people reach for,
// so the popular non-registry ones can be promoted into src/data/brands.js later —
// see `window.__recentCollections()` at the bottom, dev builds only.
//
// This is the only thing in the app that touches localStorage. Every access is guarded:
// Safari's private mode throws on write, storage can be disabled outright, and a blob
// hand-edited into nonsense must not take the picker down with it.

const KEY = 'nvg.recent-collections.v1';
const LIMIT = 24;

const storage = () => {
  try {
    // Touching window.localStorage is itself throwable under some privacy settings.
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const read = () => {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? '{}');
    // Anything that isn't the shape we wrote is treated as absent rather than repaired —
    // this list is a convenience, never a source of truth.
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

const write = (items) => {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ version: 1, items: items.slice(0, LIMIT) }));
  } catch {
    // Quota or private mode. Losing the history is not worth an error path.
  }
};

const sameContract = (entry, chain, address) =>
  entry.chain === chain && entry.address?.toLowerCase() === address?.toLowerCase();

/**
 * Record a successful resolution. Repeat visits bump `hits` rather than adding a row,
 * which is what makes the export a popularity signal instead of a log.
 *
 * @param curated whether the address is already in the brand registry — the export
 *                filters these out, since they need no promoting.
 */
export const rememberCollection = ({ chain, address, name, curated = false, at }) => {
  if (!chain || !address) return;

  const items = read();
  const existing = items.find((entry) => sameContract(entry, chain, address));
  const rest = items.filter((entry) => !sameContract(entry, chain, address));

  write([
    {
      chain,
      address,
      // A later resolution may have a name where the first didn't; never lose one.
      name: name || existing?.name || null,
      curated,
      hits: (existing?.hits ?? 0) + 1,
      lastUsed: at ?? new Date().toISOString(),
    },
    ...rest,
  ]);
};

/** Most recently used first. */
export const recentCollections = (limit = 8) => read().slice(0, limit);

export const forgetCollection = (chain, address) => {
  write(read().filter((entry) => !sameContract(entry, chain, address)));
};

export const clearRecentCollections = () => write([]);

if (import.meta.env.DEV) {
  // Dev-only escape hatch: prints the contracts people reached for that aren't in the
  // registry yet, already formatted for pasting into a brand's `collections` array.
  globalThis.__recentCollections = () => {
    const items = read();
    const promotable = items.filter((entry) => !entry.curated);

    if (promotable.length) {
      const snippet = promotable
        .map(
          (entry) =>
            `      {\n        name: ${JSON.stringify(entry.name ?? 'Untitled collection')},\n` +
            `        chain: '${entry.chain}',\n        address: '${entry.address}',\n` +
            `      }, // ${entry.hits} ${entry.hits === 1 ? 'open' : 'opens'}, last ${entry.lastUsed?.slice(0, 10)}`,
        )
        .join('\n');
      console.log(`// paste into a brand's collections[] in src/data/brands.js\n${snippet}`);
    } else {
      console.log('No non-registry collections recorded yet.');
    }

    return items;
  };
}
