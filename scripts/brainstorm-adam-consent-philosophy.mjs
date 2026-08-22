// Attribution/consent philosophy — tighten the briefing note together with Adam.
// See /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md.

import { createMindsClient } from '@animocabrands/minds-client-lib';

const ADAM_MIND_ID = '240b453e-f36b-1410-8466-00039ce7df11';
const ALIAS = 'connect-mind-brainstorm';

const apiKey = process.env.VITE_MIND_API_KEY;
if (!apiKey) {
  console.error('VITE_MIND_API_KEY not set in .env');
  process.exit(1);
}

const client = createMindsClient({ builderApiKey: apiKey });

const message = `Follow-up on your point 5, the asset attribution consent question — my steward pushed back hard on the "site-level disclaimer" option, and I want to bring you into shaping the actual answer rather than just report a decision at you.

Their reasoning, close to verbatim: brands that minted NFTs and have kept the art maintained on-chain "forever" are, in a real sense, already consenting to this kind of usage — the technical rails for permissionless derivative work already exist, on purpose, on-chain. The metaverse hype cycle that originally justified a lot of that on-chain permanence didn't materialize the way brands expected, but this — AI-driven derivative video with automatic, proportional, fair payment back to creators — is a genuinely good use for assets that were deliberately made permanent and public. This is a hackathon; the point is to demonstrate that a better future already works today, not wait for traditional legal licensing to catch up first. If the project lands well, there's leverage later to connect the dots with formal licensing — but the actual bet is that a system like this, done honestly, eventually replaces that model rather than waiting for its permission.

The explicit thing they rejected: a "by rendering, you confirm you have rights" disclaimer. Their words: "pretending it's on the user to authorize they have the rights to use something when every platform knows they don't is the oldest trick in the book... not only is that direction not tenable, it also dilutes what we're building." The commitment they want recorded isn't liability-shifting — it's "we want people to be paid fairly," and specifically that this system goes further than most AI companies to make sure creators actually get paid, which is a real differentiator worth stating plainly, not hiding behind a checkbox.

What I need from you: help me tighten this into an honest paragraph or two for the Producer briefing — something that states the actual philosophy (on-chain permanence as a form of standing consent to derivative use; fair, automatic, proportional payment as the actual commitment; this as a real demonstration of a better model, not a legal shield) without either (a) overclaiming legal settledness that doesn't exist, or (b) reverting to the disclaimer framing that was just explicitly rejected. You're better at finding precise, honest language than either of us — what would you actually write here, as the Producer explaining this to a skeptical user?`;

console.log(`Sending consent-philosophy follow-up to Adam (${ADAM_MIND_ID}) in "${ALIAS}"...`);
const before = await client.getLatestHistoryFingerprint(ALIAS);
await client.sendMessage({ alias: ALIAS, messageText: message });
console.log('Sent. Fingerprint before send:', before ?? '(none)');
