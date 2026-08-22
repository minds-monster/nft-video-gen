// Directly test whether this Builder API key can deliver the Producer briefing
// to a third-party Mind (one not on this account), using the same alias scheme
// the worker uses. This isolates cross-account message delivery from the
// Connect Mind handshake and session logic.

import { createMindsClient } from '@animocabrands/minds-client-lib';
import { PRODUCER_BRIEFING } from '../worker/producer-briefing.js';

const TEST_MIND_ID = 'ee784e3e-f36b-1410-8466-00039ce7df11';
const ALIAS = `producer-${TEST_MIND_ID.slice(0, 12)}`;

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const log = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);

try {
  console.log(`Ensuring conversation "${ALIAS}" for third-party Mind ${TEST_MIND_ID}...`);
  const conversation = await client.ensureConversation(ALIAS, TEST_MIND_ID);
  log('ensureConversation result', conversation);

  console.log('Sending Producer briefing...');
  const sendResult = await client.sendMessage({ alias: ALIAS, messageText: PRODUCER_BRIEFING });
  log('sendMessage result', sendResult);

  console.log('Fetching history...');
  const history = await client.getHistory(ALIAS, { limit: 10 });
  log('History', history.map((h) => ({
    senderType: h.senderType,
    senderName: h.senderName,
    createdAt: h.createdAt,
    textPreview: h.messageText?.slice(0, 80),
  })));

  const briefingPresent = history.some((h) => h.senderType === 1 && h.messageText?.includes('Producer briefing'));
  console.log('\n✅ Briefing delivered:', briefingPresent);
} catch (err) {
  console.error('\n❌ FAILED');
  console.error('Error name:', err?.name);
  console.error('Error message:', err?.message);
  if (err?.status) console.error('HTTP status:', err.status);
  if (err?.code) console.error('Error code:', err.code);
  console.error('\nFull error:', err);
  process.exit(1);
}
