// Focused re-ask: consent-philosophy wording specifically (previous reply answered
// a different open item — MVP scope — instead). See plan file.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';
const ALIAS = 'connect-mind-brainstorm';

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const message = `That MVP-scope answer was genuinely useful — logging it for the render-pipeline phase, once we're past onboarding. But it answered a different question than the one I actually asked in my last message, so let me re-ask it on its own, specifically:

The asset-attribution consent wording — can you draft the actual paragraph(s) for the Producer briefing? The position to work from: on-chain permanence as a real (if informal) form of standing consent to derivative use; "we want people paid fairly, automatically and proportionally" as the actual stated commitment; framed as demonstrating a working alternative to traditional licensing rather than waiting for it — explicitly not a disclaimer that shifts liability onto the user. That's the one thing I still need from you before the briefing can go out.`;

console.log(`Sending focused consent-wording re-ask to Adam (${ADAM_MIND_ID}) in "${ALIAS}"...`);
const before = await client.getLatestHistoryFingerprint(ALIAS);
await client.sendMessage({ alias: ALIAS, messageText: message });
console.log('Sent. Fingerprint before send:', before ?? '(none)');
