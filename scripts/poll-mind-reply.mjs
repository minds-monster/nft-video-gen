// Throwaway diagnostic script — polls the test conversation from
// scripts/test-mind-connect.mjs until the independent Mind replies, or a long
// timeout elapses. See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ALIAS = process.argv[2];
const TOTAL_TIMEOUT_MS = Number(process.argv[3] ?? 45 * 60 * 1000); // default 45 min
const AFTER_FINGERPRINT = process.argv[4]; // only report a reply strictly newer than this
const CHUNK_MS = 60_000;

if (!ALIAS) {
  console.error('Usage: node poll-mind-reply.mjs <alias> [totalTimeoutMs] [afterFingerprint]');
  process.exit(1);
}

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });
const startedAt = Date.now();

console.log(`Polling alias "${ALIAS}" for a reply, up to ${Math.round(TOTAL_TIMEOUT_MS / 60000)} min...`);

while (Date.now() - startedAt < TOTAL_TIMEOUT_MS) {
  const remaining = TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
  const chunk = Math.min(CHUNK_MS, remaining);
  if (chunk <= 0) break;

  try {
    const outcome = await client.waitForReply({
      alias: ALIAS,
      timeoutMs: chunk,
      afterFingerprint: AFTER_FINGERPRINT,
    });
    if (!outcome.timedOut && outcome.reply) {
      console.log('\n✅ REPLY RECEIVED');
      console.log(JSON.stringify(outcome.reply, null, 2));
      process.exit(0);
    }
  } catch (err) {
    console.error('Poll error (continuing):', err?.message ?? err);
  }
  console.log(`... still waiting (${Math.round((Date.now() - startedAt) / 60000)} min elapsed)`);
}

console.log('\n⏳ TIMED OUT — no reply within the polling window.');
const history = await client.getHistory(ALIAS, { limit: 20 });
console.log('Final history:', JSON.stringify(history, null, 2));
process.exit(2);
