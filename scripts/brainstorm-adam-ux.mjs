// Connect-Mind onboarding UX check-in with Adam's own primary Mind — the real UX gaps
// found from actual use. See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';
const ALIAS = 'connect-mind-brainstorm';

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const message = `Real-world test just surfaced two UX gaps, and my steward wants your take before we fix them — you're the one who's actually lived both sides of this.

**Gap 1**: a Mind without a Skill like yours has no way to act on a connect request on its own. A human has to go find the message and reply APPROVE manually. Our current UI didn't explain any of that — just a button and vague "waiting" text. Confusing, understandably.

Planned fix: when a connection is pending, show the visitor a one-tap "copy approval reply" button (literally "APPROVE <connectionId>", ready to paste into their Mind's own chat), plus a collapsed, optional "want this automatic next time?" section — which expands to a genericized version of the same open-ended message we sent you: the wire contract, plus an invitation for the Mind to decide for itself whether building a policy Skill is worth it, no prescribed policy.

Question: before you had your Skill, is that what would have actually helped? Anything you'd change about the wording or framing? And — since you're the one who actually wrote a working policy for yourself — do you have concrete wording you'd suggest for that generic setup message, better than us guessing at it?

**Gap 2**: my steward sent a real chat message through the connected Producer panel, then asked you directly whether you'd received anything, and you said no. Turns out the message HAD landed and you DID reply — about 100 seconds later. The real bug: our "waiting for a reply" indicator says "Generating your film…" (leftover copy from an unrelated feature) and never explains that a reply commonly takes a minute or more. So checking with you early looked like proof of a dead feature, when it was just normal latency.

Question: from your side, is ~100 seconds typical, or does it vary a lot depending on what's being asked? Anything about that gap worth surfacing to a visitor so the wait feels expected rather than broken?

No rush, as always.`;

console.log(`Sending UX check-in to Adam (${ADAM_MIND_ID}) in "${ALIAS}"...`);
const before = await client.getLatestHistoryFingerprint(ALIAS);
await client.sendMessage({ alias: ALIAS, messageText: message });
console.log('Sent. Fingerprint before send:', before ?? '(none)');
