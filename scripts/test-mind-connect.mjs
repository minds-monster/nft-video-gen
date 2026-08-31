// Throwaway diagnostic script — NOT part of the production app.
// Tests whether this site's own Builder API key can open a conversation with a
// second, independent Mind ID (not on this account) and exchange messages with it.
// See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const TEST_MIND_ID = 'ee784e3e-f36b-1410-8466-00039ce7df11';
const ALIAS = `test-connect-${Date.now()}`;

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const log = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);

try {
  console.log('Step 1: listMinds() — confirming test mind is NOT already on this account...');
  const minds = await client.listMinds();
  log('Minds on this account', minds.map((m) => ({ mindId: m.mindId, name: m.name })));
  const alreadyOwned = minds.some((m) => m.mindId === TEST_MIND_ID);
  console.log(`\nTest mind already on this account? ${alreadyOwned}`);

  console.log(`\nStep 2: ensureConversation("${ALIAS}", "${TEST_MIND_ID}")...`);
  const conversation = await client.ensureConversation(ALIAS, TEST_MIND_ID);
  log('ensureConversation result', conversation);

  const testMessage = `Automated connectivity test from nft-video-gen at ${new Date().toISOString()}. If you receive this, please reply "received" — we're testing whether an external builder account can message your Mind directly. Alias: ${ALIAS}`;

  console.log('\nStep 3: sendMessage()...');
  const sendResult = await client.sendMessage({ alias: ALIAS, messageText: testMessage });
  log('sendMessage result', sendResult);

  console.log('\nStep 4: waitForReply() — waiting up to 60s for a reply...');
  const outcome = await client.waitForReply({ alias: ALIAS, timeoutMs: 60_000 });
  log('waitForReply outcome', outcome);

  if (!outcome.timedOut && outcome.reply) {
    console.log('\n✅ SUCCESS: received a reply from the independent Mind.');
  } else {
    console.log('\n⏳ No reply within 60s. The message may still have been delivered — check history below.');
  }

  console.log('\nStep 5: getHistory() — full transcript so far...');
  const history = await client.getHistory(ALIAS, { limit: 20 });
  log('History', history);

  console.log(`\nAlias for manual follow-up checks: ${ALIAS}`);
} catch (err) {
  console.error('\n❌ FAILED');
  console.error('Error name:', err?.name);
  console.error('Error message:', err?.message);
  if (err?.status) console.error('HTTP status:', err.status);
  if (err?.code) console.error('Error code:', err.code);
  console.error('\nFull error:', err);
  process.exit(1);
}
