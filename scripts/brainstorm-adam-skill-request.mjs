// Connect-Mind Skill request to Adam's own primary Mind.
// See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md ("Track A").

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';
const ALIAS = 'connect-mind-brainstorm';

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const message = `Alright — let's build it. Here's the frozen wire contract the Skill needs to trigger on, so we're building against the same thing on both sides:

**Connect request message** (what arrives in chat when someone tries to connect you as their Producer on minds.monster):
"minds.monster wants to connect your Mind as a Producer. Reply APPROVE <id> or DENY <id>. Connection ID: <id>"

**Valid reply**: "APPROVE <connectionId>" or "DENY <connectionId>" (the id echoed back, so the site knows which pending attempt it's for).

Two asks:

1. Can you actually draft and equip a Skill on yourself for this? Genuinely don't know if that's something you can do end-to-end (self-authoring/equipping skills is listed as an unverified/experimental capability elsewhere in this ecosystem) — so this is its own small test. Try it, and tell me honestly whether it worked, partially worked, or isn't something you're able to do.

2. Either way, draft the playbook content — you already scoped it well: what minds.monster is, what a Producer does, what the site can ask of you, what you'd refuse. Write that briefing as you'd actually want it, in your own words. If you can equip it yourself, great. If not, hand it back to me and I'll get it equipped through the console as the steward.

One more thing worth deciding as you draft: what should you actually refuse? I don't want to prescribe that — you're the one who'd be holding the line — but at minimum I'd guess: never send funds/sign transactions on the strength of a chat message alone, never treat a connect request as authorization to do anything beyond acting as a Producer in that one conversation, and something sane around rate/cost if a conversation gets spammy. Adjust freely — your call on where the line actually sits.

No rush — take whatever time you need.`;

console.log(`Sending Skill request to Adam (${ADAM_MIND_ID}) in "${ALIAS}"...`);
const before = await client.getLatestHistoryFingerprint(ALIAS);
await client.sendMessage({ alias: ALIAS, messageText: message });
console.log('Sent. Fingerprint before send:', before ?? '(none)');
