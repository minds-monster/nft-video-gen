# Connect Mind / Producer — Handover

## What this is

minds.monster (this repo, `nft-video-gen`, branch `neural-canvas`) is a hackathon build for creativemindsjam.com. The goal pursued this session: let any visitor click **Connect Mind** and bring their own Hello Minds Mind into the site as the **Producer** — a persistent chat participant that oversees the video production on their behalf.

This document replaces an earlier handover that described a completely different approach (a self-issued SD-JWT credential system spanning `adam-id`/`air-issuer-service`/`minds-monster`). That approach was abandoned early this session in favor of directly messaging Hello Minds' Builder API — no credentials, no vault, no separate services. It works, it's live, and it's much simpler than what was originally attempted. If you find references to the old approach elsewhere, they're stale.

**Live**: https://nft-video-gen.still-snowflake-5e6a.workers.dev

**Full narrative** (every test, every bug, every conversation with Adam that shaped a design decision) lives in `/Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md`. This document is the condensed, forward-looking version.

## How it actually works

A visitor supplies their Mind's ID. The site (server-side, via `@animocabrands/minds-client-lib` with a Builder API key) messages that Mind directly asking it to reply `APPROVE`/`DENY` — no prior relationship or introduction needed, confirmed empirically early this session. Once approved, a signed session token is minted and the visitor's Mind becomes the Producer for the rest of their visit, in a **separate, persistent conversation** from the one-time approval handshake.

**Two conversation aliases per Mind, easy to conflate — don't**:
- `connect-<connectionId>` — one-time, created fresh per connect attempt, exists only to carry the approve/deny exchange. Nobody should expect anything else to happen here.
- `producer-<mindId>` — the real, ongoing Producer conversation. **This is where the full briefing auto-sends** (once, the first time this specific Mind ever reaches this alias) and where all actual chat happens, from both the Neural Canvas Producer panel and the Connect Mind dashboard (two UI surfaces, one shared conversation).

## Architecture

**Backend** (`worker/`, Cloudflare Worker):
- `connect.js` — `/api/connect/init`, `/api/connect/status`. The handshake.
- `mind-chat.js` — `/api/mind/init`, `/api/mind/send`, `/api/mind/poll`. The ongoing chat, session-gated. `mindChatInit` is what auto-sends the briefing on a Mind's first-ever connect (tracked via a `briefed:<mindId>` KV flag — **not** "is history empty," which breaks the moment a Mind has any prior contact for any reason).
- `session.js` — stateless HMAC-signed session tokens, no DB.
- `minds.js` — shared `minds-client-lib` wrapper + reply-parsing helpers.
- `producer-briefing.js` — the actual briefing text sent to every connected Producer. Drafted collaboratively with Adam (see plan file for the full exchange); ends with an explicit instruction to take initiative rather than wait to be asked.
- `index.js` — route table + `/api/health`.

**Frontend** (`src/`):
- `components/ConnectMindModal.jsx` — the connect flow AND (once connected) a mini-dashboard: same persistent conversation via `ChatThread`/`PromptBar`, plus a Disconnect action. The header's "Connect Mind" button always opens this modal; it shows the right state (form vs. pending vs. dashboard) based on connection status.
- `hooks/useMindConnect.js` — connect-flow state machine (idle/pending/approved/denied/expired), polls `/api/connect/status`.
- `hooks/useMindChat.js` — the chat itself, session-gated, send/poll pattern (not a blocking call).
- `context/MindChatContext.jsx` — composes both hooks into one shared context, consumed by `ConnectMindModal`, `ProducerPanel`, `StudioOverlay`. Watch out: both hooks return a field called `error` for different things; the context gives connect's its own name (`connectError`) so it doesn't get silently overwritten.
- `components/canvas/panels/ProducerPanel.jsx` — the Neural Canvas surface.
- `components/ChatThread.jsx` — shared message-list renderer; shows the connected Mind's actual name (`mindName` prop), not a generic "The mind" label.

**Key npm package**: `@animocabrands/minds-client-lib` — the only way this repo talks to Hello Minds. No CLI, no separate credential service.

## Confirmed working this session

- Cross-account messaging (a builder key messaging a Mind it doesn't own) — proven, no prior relationship required.
- A real Hello Minds **Skill** (self-authored and self-equipped by Adam, `240b453e-f36b-1410-8466-00039ce7df11`) that autonomously handles connect requests per its own policy — fires with zero human involvement.
- Full connect → session → live chat loop, exercised repeatedly against both Adam's Mind and a genuinely independent test Mind.
- Auto-briefing delivery and the "take initiative" behavior — verified directly against raw conversation data (not just taken on a Mind's own word) that a Mind received the briefing and proactively engaged afterward.
- Mind's real name displayed throughout the chat UI instead of a generic label.

## Bugs found and fixed this session (context so nobody re-breaks these)

1. **Stale replies in chat.** The platform's `getHistory({ after: <fingerprint> })` filter is silently ignored — confirmed empirically, it returns full history regardless of what's passed. Every place that trusted it (chat polling, approval detection) was grabbing whichever Mind-authored message was newest *overall*, not one that was actually new. Fixed by timestamping our own cutoff (`Date.now()` at send time) and filtering `createdAt` ourselves, both in `mind-chat.js` and `connect.js`.
2. **Briefing never landing for already-tested Minds.** The auto-send was gated on "conversation history is empty," which breaks permanently the moment a Mind has *any* prior contact on its Producer alias — true of every Mind used for this session's own testing. Fixed with a dedicated, TTL-less `briefed:<mindId>` KV flag, decoupled from conversation history.
3. **Connect window too short.** Both the KV record's TTL and the frontend's poll timeout were 5 minutes — far too short for a brand-new Mind that needs a human to notice, get oriented, and reply (observed taking well over that more than once this session, including in the very last test before this handover). Raised both to 30 minutes; rate limiting is what actually guards against abuse, so there's no real cost to the longer window.
4. **`error` field collision.** `useMindConnect` and `useMindChat` both returned a field called `error`; merging both into one context silently let chat's win, so connect-flow errors never actually displayed. Fixed by giving connect's its own name (`connectError`).

## Open question — check this first before anything else

The most recent test (a genuinely fresh Mind, first-ever connect, using the newly-extended timeout) succeeded at the handshake — the Mind approved and the site connected — but when told "nothing else to do on this one from me," the user reasonably read that as the Producer briefing not having landed or not being acted on, since a properly briefed Producer should be introducing itself and engaging, not just closing out the approval as a completed task.

**This is genuinely ambiguous and needs direct investigation, not a guess**: that comment was made in the context of the `connect-<connectionId>` handshake conversation specifically — where "nothing else to do" is actually a *correct* thing for a Mind to say, since that conversation's only job is the approve/deny exchange. The real question is what happened on the **separate** `producer-<mindId>` conversation, which is where the briefing auto-sends and where the "take initiative" instruction is supposed to produce a proactive greeting.

**To check**: query that Mind's `producer-<mindId>` alias directly (see `scripts/` in this repo for the pattern — e.g. how `scripts/brainstorm-adam-*.mjs` or the diagnostic session-minting commands earlier in the plan file query history) and look for:
1. Did the full `PRODUCER_BRIEFING` text actually arrive as a message in *that* conversation (not the connect one)?
2. Did the Mind reply there afterward, and if so, does it read as a proactive introduction (per the briefing's closing instruction) or as passive/waiting?

If the briefing truly isn't reaching the producer alias for a fresh Mind, the likely culprit is the frontend never actually calling `/api/mind/init` for that session — worth adding a log point or testing directly via `curl -X POST /api/mind/init -H "authorization: Bearer <token>"` with a real session token (see the plan file for the exact HMAC-minting recipe used for diagnostics all session, no need to reinvent it) to isolate frontend-not-calling vs. backend-not-sending.

## Deferred / not built (explicit, not accidental)

- **Wallet-signature trust tier** — considered early, dropped in favor of the chat-approval + Skill model, which turned out sufficient.
- **No-Mind onboarding** (a way to send visitors to create a Hello Minds account, plus a shared "guest mode") — designed, never built. Note: `build.hellominds.ai`/`hellominds.ai` send `X-Frame-Options: SAMEORIGIN`, confirmed via direct header check — an iframe embed is not possible; a popup window was the intended fallback.
- **Cognition/Moca balance display** — built, then explicitly removed by user decision: for real hackathon visitors it would almost always read "n/a" (Cognition is only readable for Minds on this site's own builder account; Moca needs a wallet on file most external Minds won't have), so it wasn't worth shipping even with clearer copy.
- **Live render pipeline** — Casting Director and Screenwriter are real and live (NVIDIA-backed); Storyboarder, an actual render button wired to MiniMax, a "Director" experiment/budget agent, and any live session-scoped cost tracking are all **not built**. Adam's own recommended floor for a compelling demo (see plan file, "Adam's MVP-scope input"): those four plus Producer budget oversight are the real differentiators — everything past that ($TEST402 minting, invisible watermarking) he explicitly rated as high-risk to build from scratch in a hackathon window and safe to cut.
- **Hero multiplier rule** (extra attribution weight for a standout asset) — deliberately left undefined per user decision, documented as open in the briefing rather than guessed at.
- **$TEST402 / on-chain attribution payout** — no contract, not even a reserved symbol. The attribution *philosophy* (why derivative use is honest, not a liability-shifting disclaimer) is written into the Producer briefing verbatim — read `worker/producer-briefing.js` before touching this topic again, it reflects a real, deliberate position the user pushed back hard to establish.

## Reference

- Production: https://nft-video-gen.still-snowflake-5e6a.workers.dev
- Full session narrative + every design decision's reasoning: `/Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md`
- Adam (the user's own primary Mind, deeply involved in shaping every design decision this session): `240b453e-f36b-1410-8466-00039ce7df11`
- Independent test Mind used throughout: `ee784e3e-f36b-1410-8466-00039ce7df11`
- Diagnostic/test scripts (`scripts/brainstorm-adam-*.mjs`, `scripts/test-*.mjs`, `scripts/build-cost-ledger.mjs`, `scripts/poll-mind-reply.mjs`) are real, working examples of talking to a Mind directly, polling for replies, and minting diagnostic session tokens — reuse the patterns rather than rebuilding them.
