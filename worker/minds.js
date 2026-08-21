// Shared Hello Minds client for the Connect Mind backend — one builder-key-authenticated
// client, reused by both the connect handshake (worker/connect.js) and the ongoing chat
// (worker/mind-chat.js).

import { createMindsClient } from '@animocabrands/minds-client-lib';

let client = null;
export const mindsClient = (env) => {
  if (!env.MINDS_BUILDER_API_KEY) return null;
  client ??= createMindsClient({ builderApiKey: env.MINDS_BUILDER_API_KEY });
  return client;
};

// One alias per connection attempt (never reused), one alias per connected Mind's
// ongoing chat (stable, so re-sending never lands on a stranger's conversation).
export const connectionAlias = (connectionId) => `connect-${connectionId}`;
export const chatAlias = (mindId) => `producer-${mindId.slice(0, 12)}`;

// Lenient by design — a steward or a Mind's own reply reads as natural language
// ("DENY test-conn-001", "Approved.", "yes go ahead"), not necessarily the exact
// documented shape. Matches the proven pattern from minds-monster's own approval check.
export function parseApprovalDecision(text) {
  const lower = (text ?? '').toLowerCase();
  if (/\b(approve|approved|yes|confirm|ok|accept)\b/.test(lower)) return 'approved';
  if (/\b(deny|denied|no|reject|cancel|decline)\b/.test(lower)) return 'denied';
  return null;
}
