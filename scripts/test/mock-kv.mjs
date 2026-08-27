// A KV double faithful to the three things the support and owner code lean on that the
// older per-file mocks did not model: `list()` in LEXICOGRAPHIC order with a cursor,
// `metadata` on put/list, and `expirationTtl` being accepted (and ignored).

export class MockKV {
  store = new Map();
  meta = new Map();

  async get(key, type = 'text') {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value, options = {}) {
    this.store.set(key, typeof value === 'string' ? value : String(value));
    if (options.metadata) this.meta.set(key, options.metadata);
    else this.meta.delete(key);
  }

  async delete(key) {
    this.store.delete(key);
    this.meta.delete(key);
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const names = [...this.store.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return {
      keys: page.map((name) => ({ name, metadata: this.meta.get(name) })),
      list_complete: done,
      cursor: done ? undefined : String(start + limit),
    };
  }

  keysWithPrefix(prefix) {
    return [...this.store.keys()].filter((name) => name.startsWith(prefix)).sort();
  }
}

/** A minds-client-lib double: records sends, serves scripted histories per alias. */
export class FakeMindsClient {
  conversations = new Map();
  sent = [];
  histories = new Map();
  historyCalls = 0;
  fullHistoryCalls = 0;
  // A monotonic clock: the platform stamps rows with sub-millisecond precision, so two rows
  // never tie on createdAt in production and must not tie here either.
  clock = Date.now();
  tick() {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }

  async ensureConversation(alias, mindId) {
    if (!this.conversations.has(alias)) this.conversations.set(alias, { alias, mindId, createdAt: new Date().toISOString() });
    return this.conversations.get(alias);
  }

  async sendMessage({ alias, messageText }) {
    const row = {
      fingerprint: `fp-${this.sent.length + 1}`,
      senderType: 1,
      messageText,
      createdAt: this.tick(),
    };
    this.sent.push({ alias, messageText });
    this.histories.set(alias, [...(this.histories.get(alias) ?? []), row]);
    return { ok: true };
  }

  /** Script a Mind row into an alias, as the platform would return it. */
  mindSays(alias, text, { at = this.tick(), fingerprint } = {}) {
    const rows = this.histories.get(alias) ?? [];
    const row = { fingerprint: fingerprint ?? `mind-${alias}-${rows.length + 1}`, senderType: 0, messageText: text, createdAt: at };
    this.histories.set(alias, [...rows, row]);
    return row;
  }

  /** Newest-first, honouring `limit`, exactly as /histories does. */
  async getHistory(alias, { limit = 200 } = {}) {
    this.historyCalls += 1;
    if (limit > 1) this.fullHistoryCalls += 1;
    return [...(this.histories.get(alias) ?? [])].reverse().slice(0, limit);
  }

  /** Reproduces the client library's bug: the LAST row of a newest-first page is the OLDEST. */
  async getLatestHistoryFingerprint(alias) {
    const rows = this.histories.get(alias) ?? [];
    return rows[0]?.fingerprint;
  }

  async getMind() {
    return { name: 'Adam', email: 'adam@hellominds.ai', isEnabled: true };
  }
  async getCognitionBalance() {
    return { cognition: 1200 };
  }
  async getCognitionUsage() {
    return { items: [{ bucket: '2026-08-26', value: 30 }, { bucket: '2026-08-27', value: 20 }] };
  }
  async getCognitionUsageByTool() {
    return { summary: [{ tool: 'email', callCount: 4, creditsUsed: 12 }], timeline: [] };
  }
  async listEquippedSkills() {
    return [{ skillId: 's1', name: 'minds.monster connect', source: 'mind' }];
  }
}

export const makeEnv = (over = {}) => ({
  SESSION_SIGNING_SECRET: 'test-secret-must-be-at-least-32-bytes-long',
  SUPPORT_MIND_ID: 'mind-adam',
  SITE_ORIGIN: 'https://minds.monster',
  MIND_CONNECTIONS: new MockKV(),
  __mindsClient: new FakeMindsClient(),
  ...over,
});
