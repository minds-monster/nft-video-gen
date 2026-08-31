// Throwaway diagnostic script — polls connect-mind-brainstorm for Adam's reply to the
// assistant-layer discussion, filtering by createdAt rather than trusting
// waitForReply's afterFingerprint matching. That matching is unreliable here for the
// same reason documented in worker/mind-chat.js and worker/connect.js: the platform's
// own fingerprint-based "after" filtering has been confirmed empirically broken
// elsewhere in this project, and it produced a stale ~34-hour-old reply as a false
// positive when tried via scripts/poll-mind-reply.mjs on this same alias.
// See /Users/adamplace/.claude/plans/a-third-party-mind-agent-floating-seal.md.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ALIAS = 'connect-mind-brainstorm';
const AFTER_ISO = process.argv[2];
const TOTAL_TIMEOUT_MS = Number(process.argv[3] ?? 45 * 60 * 1000);
const CHUNK_MS = 60_000;

if (!AFTER_ISO) {
  console.error('Usage: node poll-adam-assistant-reply.mjs <afterIsoTimestamp> [totalTimeoutMs]');
  process.exit(1);
}

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });
const cutoffMs = new Date(AFTER_ISO).getTime() - 2000;
const startedAt = Date.now();

console.log(`Polling "${ALIAS}" for a reply after ${AFTER_ISO}, up to ${Math.round(TOTAL_TIMEOUT_MS / 60000)} min...`);

while (Date.now() - startedAt < TOTAL_TIMEOUT_MS) {
  try {
    const history = await client.getHistory(ALIAS, { limit: 10 });
    const reply = history.find(
      (row) => row.senderType !== 1 && new Date(row.createdAt).getTime() > cutoffMs,
    );
    if (reply) {
      console.log('\n✅ REPLY RECEIVED');
      console.log(JSON.stringify(reply, null, 2));
      process.exit(0);
    }
  } catch (err) {
    console.error('Poll error (continuing):', err?.message ?? err);
  }
  console.log(`... still waiting (${Math.round((Date.now() - startedAt) / 60000)} min elapsed)`);
  await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
}

console.log('\n⏳ TIMED OUT — no reply within the polling window.');
process.exit(2);
