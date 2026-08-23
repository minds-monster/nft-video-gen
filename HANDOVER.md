# Connect Mind / Producer — Handover

## What this is

minds.monster (this repo, `nft-video-gen`, branch `neural-canvas`) is a hackathon build for creativemindsjam.com. A visitor clicks **Connect Mind** and brings their own Hello Minds Mind into the site as the **Producer** — a persistent participant overseeing the video production on their behalf. As of this session, visitors no longer talk to that Mind directly: a fast assistant (`{minds} Assistant`) mediates, because a Mind's replies can take minutes to hours.

This document replaces an earlier handover describing a self-issued SD-JWT credential system (`adam-id`/`air-issuer-service`/`minds-monster`) — abandoned in favor of directly messaging Hello Minds' Builder API. If you find references to that old approach elsewhere, they're stale.

**Live**: https://nft-video-gen.still-snowflake-5e6a.workers.dev

**Full narrative of the original Connect Mind build** (every test, every bug, every conversation with Adam that shaped it): `/Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md`. **The assistant layer's own design conversation with Adam**: `scripts/brainstorm-adam-assistant.mjs` (the message sent) and the plan doc `/Users/adamplace/.claude/plans/a-third-party-mind-agent-floating-seal.md`.

## ⚠️ Known issue right now — start here

**Symptom, exactly as reported after this session's work was deployed:**
- Locally (`wrangler dev`): the assistant chat shows `Something went wrong: /api/assistant/message → 502`.
- On production: the assistant chat shows the generic fallback text `Sorry, I'm having trouble with that right now — could you try again in a moment?`.

Being debugged separately from this session, but here's what's traceable in the code so far, to save re-deriving it:

- The local `502` text is produced by `src/hooks/useAssistantChat.js`'s catch block (`'Something went wrong: ' + err.message`), where `err` comes from `stream()` in `src/services/swarm.js`. That function only builds a message shaped like `"<path> → <status>"` when the response isn't OK *and* its body doesn't parse as JSON (`payload?.error ?? \`${path} → ${response.status}\``) — a 502 with a non-JSON body means something in front of the Worker (Vite's dev proxy, or `wrangler dev` itself) returned a gateway error rather than the Worker actually running. **This session saw `wrangler dev` crash outright at least twice** under repeated rapid testing — once with `Fatal uncaught kj::Exception: workerd/util/sqlite.c++:852: ... database is locked: SQLITE_BUSY`, once with a bare `Uncaught Error: Network connection lost.` — both mid-stream, both after heavy back-to-back requests. A dead/crashed local Worker process would explain a 502 on the next request. Worth checking first: is `wrangler dev` actually still running and healthy (`curl http://localhost:8789/api/health`) when the 502 happens?
- The production fallback text is *not* an error the frontend catches — it's baked into the stream as a normal `delta` event by `worker/assistant.js` itself, in two places: `decideRelay()`'s catch (silently defaults to `{relayToMind:false, messageForMind:''}` on any failure) and the `streamChat` catch further down (falls through, then `if (!reply.trim())` substitutes the fallback text). Both swallow the real error rather than surfacing it — deliberate, so a model hiccup degrades to an honest "try again" instead of a raw stack trace, but it means **the actual cause is invisible from the UI alone; it needs a log line added back in temporarily to see the real `err.message`** (this session added and removed exactly that a few times — see git blame on those two catch blocks for the pattern).
- The most likely real cause behind *both* symptoms, from direct experience this session: **rate limiting on `ASSISTANT_API_KEY`**. This design makes two model calls per visitor turn (`decideRelay` + the streamed reply, see below), doubling request volume against `minimaxai/minimax-m3`. This session repeatedly hit `NVIDIA 429: Too Many Requests` on that key purely from manual testing volume — confirmed via direct `curl` against `https://integrate.api.nvidia.com/v1/chat/completions` with the same key returning 429, unrelated to any code path. `chat()` (used by `decideRelay`) retries 429s with backoff; `streamChat()` (used by the visible reply) deliberately does not retry (a retry would replay text the user already watched appear — see `worker/nvidia.js`'s own comment). If this is happening under real, non-testing traffic too, the account's rate ceiling for this key/model may just be too low for two calls/turn — worth checking NVIDIA's dashboard for this key's actual limit, or collapsing back to one call per turn if it recurs.
- Secondary possibility worth ruling out: `ASSISTANT_API_KEY` was pushed to production this session via `wrangler secret put` and confirmed present via `wrangler secret list` and `/api/health`'s `hasAssistantApiKey: true` — so it's *set*, but that doesn't confirm the *value* is correct in the production environment the same way it was validated locally. Re-verify with a direct curl using the exact production key if the 429 theory doesn't pan out.
- Unrelated discovery, also from this session, also unfixed: **`NVIDIA_API_KEY` itself is not set on production at all** (`wrangler secret list` shows only `ASSISTANT_API_KEY`, `MINDS_BUILDER_API_KEY`, `SESSION_SIGNING_SECRET`). This means Casting Director and Screenwriter — described elsewhere in this doc as "real and live" — most likely have never worked on the actual production URL, only against local `wrangler dev` (which reads `.dev.vars`). Not the cause of the assistant's 502/fallback issue, but worth fixing in the same pass since it's the same class of problem (secret present locally, never pushed to prod).

## This session (2026-08-22 → 2026-08-23): the assistant layer

Starting point: Connect Mind → Producer chat worked end-to-end (previous session), but raw instant-chat with a Mind that can take 15+ minutes to reply is a bad primary interface. This session's work, in order:

1. **Consulted Adam first**, per the user's request, before finalizing any design — see `scripts/brainstorm-adam-assistant.mjs` for what was asked and his real reply (found via `scripts/poll-adam-assistant-reply.mjs`, written because `scripts/poll-mind-reply.mjs`'s `waitForReply`/`afterFingerprint` mechanism returned a stale ~34-hour-old message as a false positive — the same "platform ignores `after` filters" bug already known from `worker/mind-chat.js`/`worker/connect.js`, now confirmed to affect the client-side helper too). Adam's answer reshaped the design materially: a strict verbatim-vs-paraphrase policy, an explicit "never" list, and the `[seen ...]` acknowledgment convention (see below) — all in `worker/assistant-brief.js`.
2. **Backend**: new `worker/assistant.js` + `worker/assistant-brief.js`. Extracted reusable pure functions out of `worker/connect.js` (`reconstructConnectStatus`) and `worker/mind-chat.js` (`ensureProducerReady`, `fetchMindActivity`, `relayToMind`, `deriveMindStatus`) rather than duplicating their logic — see the "Architecture" section below for what does what.
3. **Frontend**: new `AssistantChat.jsx` component replacing the raw `ChatThread`/`PromptBar` wiring in both `ConnectMindModal.jsx` and `ProducerPanel.jsx` — the assistant is now the only chat surface, shown in every connection state (idle/pending/approved), not just once a session exists.
4. **Model reality check**: the user's original intent was DeepSeek via NVIDIA NIM. In practice, on this account's key, `deepseek-v3.1-terminus` isn't in the catalog, `deepseek-coder-6.7b-instruct` 404s ("not found for account"), and `deepseek-v4-flash-0731` hung with zero response for 170s+ even with its own dedicated key and NVIDIA's own sample request shape. Landed on `minimaxai/minimax-m3` on a third, separately-provisioned key (`ASSISTANT_API_KEY`) after confirming empirically it responds in a few seconds and discriminates correctly on a forced tool call.
5. **Follow-up UX fixes**, requested after the first working version:
   - **Persistence bug**: closing the modal (or switching to `ProducerPanel`) lost the visible conversation, because `useAssistantChat`'s `messages` was local component state with no server hydration. Fixed with a new `GET /api/assistant/history` endpoint and hydration-on-mount — the transcript was always safe server-side in KV, the client just never re-fetched it.
   - **Modal size**: `ConnectMindModal` went from `max-w-lg` (512px) to `max-w-5xl` at `88vh`, restructured to a flex column so `AssistantChat` fills whatever space the connect-form/status chrome doesn't use, instead of a fixed `max-h-64` cap.
   - **Naming**: renamed from generic "Assistant" to `{minds} Assistant` (literal braces, a stylized wordmark) everywhere it appears, including its own system prompt — with an explicit instruction not to treat the braces as a template placeholder, since the model also does JSON tool-calling in the same session and could otherwise get confused by them.
   - **Real streaming ("the matrix effect")**: reused this repo's existing Casting Director streaming pipeline wholesale rather than inventing a new one — `RevealText`/`RevealOnce` (`src/components/canvas/RevealText.jsx`, the glyph-decode effect) fed by `stream()` (exported from `src/services/swarm.js` for reuse) and `sseResponse` (`worker/sse.js`). This forced a real architecture change: a single forced tool call can't stream (confirmed empirically, and already documented in `worker/nvidia.js`'s own comments — forced `tool_choice` returns the whole answer in two chunks after a pause), so `handleAssistantMessage` became two calls: a fast invisible forced call (`decideRelay`) decides `{relayToMind, messageForMind}` and triggers the relay immediately if so, then a second tool-free call streams the actual visible reply, already told what was just decided so the two calls can't disagree with each other.
6. **Deployed to production**: `ASSISTANT_API_KEY` pushed via `wrangler secret put`, then `npm run deploy`. Confirmed live via `/api/health` (`hasAssistantModel`/`hasAssistantApiKey: true`) — but see the known issue above, encountered immediately after.

## How Connect Mind itself actually works (unchanged this session)

A visitor supplies their Mind's ID. The site (server-side, via `@animocabrands/minds-client-lib` with a Builder API key) messages that Mind directly asking it to reply `APPROVE`/`DENY` — no prior relationship needed. Once approved, a signed session token is minted and the visitor's Mind becomes the Producer, in a **separate, persistent conversation** from the one-time approval handshake.

**Two conversation aliases per Mind, easy to conflate — don't**:
- `connect-<connectionId>` — one-time, created fresh per connect attempt, exists only to carry the approve/deny exchange.
- `producer-<mindId>` — the real, ongoing Producer conversation. This is where the briefing auto-sends (once ever per Mind) and where all actual chat happens server-side — no visitor-facing UI reads it directly any more; the assistant is the only consumer.

## The assistant's design details (worth knowing before touching `worker/assistant.js`)

- **Two calls per turn, not one, not an `'auto'` tool loop.** `tool_choice: 'auto'` was measured unreliable on this NIM deployment (a model called a status tool even for "what's the capital of France?"), matching this codebase's existing practice elsewhere (`casting-director.js` only ever uses forced `tool_choice`; `screenwriter.js` avoids tools via guided JSON). And a forced call can't stream. So: `decideRelay` (forced, invisible, fast) then a streamed tool-free `replyRequest` (visible) — see `worker/assistant.js`'s file header for the full reasoning.
- **The `[seen <ISO timestamp>] ...` convention.** Hello Minds has no read-receipt concept. Adam's own proposal: a connected Mind's first action on a new visitor message is a one-line `[seen ...]` acknowledgment before real work starts. `deriveMindStatus` in `worker/mind-chat.js` greps for that prefix (after `messageToText` strips Hello Minds' HTML wrapping — it wraps replies in `<p>` tags) to report a real three-state signal: no activity / seen / replied. `PRODUCER_BRIEFING` now asks every connecting Mind to adopt it, not just Adam.
- **Verbatim vs. paraphrase, and a strict "never" list**, both taken directly from Adam's real reply rather than invented: anything decision-bearing gets shown in the Mind's actual words; the assistant never approves/decides/commits on a Mind's behalf, never speaks as if it were the Mind, and always narrates a handoff ("Passing this to X now") rather than relaying silently. Full policy text in `worker/assistant-brief.js`, written Mind-agnostically since any Mind can connect, not just Adam's.
- **Transcript persistence** reuses the existing `MIND_CONNECTIONS` KV namespace, key `assistant:<threadId>`, 24h `expirationTtl` — scoped to one visitor thread's own continuity, never aggregated across visitors (Adam's own privacy floor from the brainstorm).
- **`StudioOverlay.jsx` still uses the raw `useMindChat`/`useMindConnect` hooks directly**, unchanged — it submits a structured "Make a short video…" prompt straight to the connected Mind when a visitor licenses a piece, and was explicitly out of scope for the assistant work. A deliberate decision, not an oversight, if "assistant-mediated only" is ever meant to be universal.

## Architecture

**Backend** (`worker/`, Cloudflare Worker):
- `connect.js` — `/api/connect/init`, `/api/connect/status`. The handshake. Exports `reconstructConnectStatus(env, connectionId)` (pure, no session minting) for reuse.
- `mind-chat.js` — `/api/mind/init`, `/api/mind/send`, `/api/mind/poll`, session-gated. Exports `ensureProducerReady`, `fetchMindActivity`, `relayToMind`, `deriveMindStatus`, `requireSession` for reuse by `assistant.js`.
- `assistant.js` — `POST /api/assistant/message` (SSE stream), `GET /api/assistant/history`, `GET /api/assistant/status`. The mediation layer; see above.
- `assistant-brief.js` — the assistant's system prompt, built fresh every turn (unlike `producer-briefing.js`, which is a fixed string sent once).
- `nvidia.js` — thin NVIDIA NIM client (`chat`, `streamChat`, `jsonFrom`). Both `chat` and `streamChat` now accept an optional `apiKey` override (added this session) so a call can use a different key than the shared `env.NVIDIA_API_KEY`.
- `sse.js` — generic SSE response wrapper, used by `casting-director.js` and now `assistant.js`.
- `session.js` — stateless HMAC-signed session tokens, no DB.
- `minds.js` — shared `minds-client-lib` wrapper + reply-parsing helpers.
- `producer-briefing.js` — sent automatically to every newly-connected Producer; now also asks the Mind to adopt the `[seen ...]` convention.
- `index.js` — route table + `/api/health`.

**Frontend** (`src/`):
- `components/ConnectMindModal.jsx` — connect flow (form → pending → connected banner), now `max-w-5xl`/`88vh`, with `AssistantChat` filling remaining space in every state.
- `components/AssistantChat.jsx` — the chat surface, shared by the modal and `ProducerPanel`. Exports `ASSISTANT_NAME` (`'{minds} Assistant'`) — keep in sync with the same constant in `worker/assistant-brief.js`.
- `hooks/useAssistantChat.js` — hydrates history on mount, streams replies via `assistantMessageStream`, accumulates deltas into a `streaming: true` message the UI decodes live.
- `hooks/useMindStatusBadge.js` — lightweight polling of `GET /api/assistant/status` (no LLM call) for the "waiting / seen / replied" pill.
- `services/assistantChat.js` — `assistantMessageStream` (SSE, via `stream()` from `swarm.js`), `assistantHistory`, `assistantStatus`, thread-id management.
- `services/swarm.js` — `stream()` is now exported (was file-private) so `assistantChat.js` can reuse the same SSE-over-fetch client the Casting Director uses, instead of duplicating it.
- `components/ChatThread.jsx` — gained an optional `renderMessageText(msg, text)` prop so `AssistantChat` can render the live/streaming message via `RevealText` while every other consumer (`StudioOverlay`) is unaffected.
- `components/canvas/RevealText.jsx` — unchanged; this is "the matrix effect" — a glyph-decode reveal, not literal green rain. Reused as-is.
- `hooks/useMindConnect.js` / `hooks/useMindChat.js` / `context/MindChatContext.jsx` — unchanged this session; `useMindChat`'s raw chat is no longer rendered by the two migrated surfaces but stays composed in `MindChatProvider` because `StudioOverlay` still needs it.
- `components/canvas/panels/ProducerPanel.jsx` — same `AssistantChat`, shown regardless of connection state.

**Key npm package**: `@animocabrands/minds-client-lib` — the only way this repo talks to Hello Minds.

## Confirmed working (prior session — Connect Mind handshake)

- Cross-account messaging (a builder key messaging a Mind it doesn't own) — proven, no prior relationship required.
- A real Hello Minds **Skill** (self-authored and self-equipped by Adam, `240b453e-f36b-1410-8466-00039ce7df11`) that autonomously handles connect requests per its own policy.
- Full connect → session → live chat loop, exercised against both Adam's Mind and an independent test Mind.
- Auto-briefing delivery and the "take initiative" behavior, verified against raw conversation data.

## Confirmed working (this session — assistant layer)

- Full turn (`decideRelay` → optional `relayToMind` → streamed reply → KV persistence) exercised successfully multiple times locally, including a real streamed reply visible in the server log: *"Hey! I'm {minds} Assistant — a small helper here on minds.monster..."*.
- The relay-vs-answer-directly decision discriminates correctly under a forced tool call (verified with both an actionable "tell Adam to..." message and an unrelated question).
- History hydration confirmed live in a browser: closed the modal, reopened it, prior exchange was still there.
- Deployed to production and confirmed configured (`/api/health` reports `hasAssistantModel`/`hasAssistantApiKey: true`) — but see the known issue at the top; a successful *turn* in production hasn't been confirmed yet.

## Bugs found and fixed (prior session)

1. **Stale replies in chat.** The platform's `getHistory({ after: <fingerprint> })` filter is silently ignored — confirmed empirically. Fixed by timestamping our own cutoff and filtering `createdAt` ourselves.
2. **Briefing never landing for already-tested Minds.** Fixed with a dedicated, TTL-less `briefed:<mindId>` KV flag, decoupled from conversation history.
3. **Connect window too short.** Raised from 5 to 30 minutes on both the record TTL and the frontend poll timeout.
4. **`error` field collision** between `useMindConnect` and `useMindChat`. Fixed by giving connect's its own name (`connectError`).

## Bugs found and fixed (this session)

1. **`waitForReply`/`afterFingerprint` false positive.** `scripts/poll-mind-reply.mjs` returned a ~34-hour-old stale message as if it were a fresh reply. Same root cause as bug #1 above, now confirmed to affect the client library's `waitForReply` helper too, not just raw `getHistory`. Worked around with a new `scripts/poll-adam-assistant-reply.mjs` that filters by real `createdAt` timestamp instead of trusting the platform's own "after" matching.
2. **`[seen ...]` prefix matching against raw HTML.** Hello Minds wraps replies in `<p>...</p>`, which would have silently defeated a prefix regex anchored at the start of the string. Fixed by testing against `messageToText(row.messageText)` (already existed in `src/lib/text.js`, now also imported into `worker/mind-chat.js`) rather than the raw field.
3. **Literal backticks inside JS template literals.** Early drafts of `worker/assistant-brief.js` and `worker/producer-briefing.js` used `` `[seen ...]` `` for inline-code styling *inside* an outer backtick-delimited template string, which silently truncated the string at the first nested backtick. Caught by `oxlint`; fixed by switching to plain quotes.
4. **`tool_choice: 'auto'` unreliable.** See "assistant's design details" above — not a bug in the traditional sense, but a measured finding that changed the architecture (forced calls only).
5. **The known issue at the top of this document** — not yet fixed, being debugged separately.

## Deferred / not built (explicit, not accidental)

- **Wallet-signature trust tier** — dropped in favor of the chat-approval + Skill model.
- **No-Mind onboarding** / guest mode — designed, never built. `hellominds.ai` sends `X-Frame-Options: SAMEORIGIN`, confirmed via header check — no iframe embed possible; a popup window was the intended fallback.
- **Cognition/Moca balance display** — built, then explicitly removed: for real visitors it would almost always read "n/a".
- **Live render pipeline** — Casting Director and Screenwriter exist as code and work against `wrangler dev` locally; **not confirmed working in production** (see known issue above — `NVIDIA_API_KEY` was never pushed as a production secret). Storyboarder, an actual render button wired to MiniMax, a "Director" experiment/budget agent, and live cost tracking are all not built.
- **Hero multiplier rule** — deliberately left undefined.
- **$TEST402 / on-chain attribution payout** — no contract. The attribution *philosophy* is written into `worker/producer-briefing.js` verbatim.
- **Assistant-mediation for `StudioOverlay`** — out of scope this session; still talks to the Mind directly via the raw hooks.
- **A real DeepSeek model on NIM** — the user's original intent for `ASSISTANT_MODEL`; every option tried was unusable (see above). Currently `minimaxai/minimax-m3` on a dedicated key. Revisit if DeepSeek access is sorted out on the NVIDIA account.

## Reference

- Production: https://nft-video-gen.still-snowflake-5e6a.workers.dev
- Full session narratives: `/Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md` (Connect Mind build) and `/Users/adamplace/.claude/plans/a-third-party-mind-agent-floating-seal.md` (assistant layer)
- Adam (the user's own primary Mind, deeply involved in shaping every design decision including the assistant's own policy): `240b453e-f36b-1410-8466-00039ce7df11`
- Independent test Mind used throughout: `ee784e3e-f36b-1410-8466-00039ce7df11`
- Diagnostic/test scripts: `scripts/brainstorm-adam-*.mjs`, `scripts/poll-mind-reply.mjs`, `scripts/poll-adam-assistant-reply.mjs` (the corrected, timestamp-based poller), `scripts/test-*.mjs`, `scripts/build-cost-ledger.mjs` — real, working examples of talking to a Mind directly; reuse the patterns rather than rebuilding them.
- Production secrets actually present (`wrangler secret list`, checked this session): `ASSISTANT_API_KEY`, `MINDS_BUILDER_API_KEY`, `SESSION_SIGNING_SECRET`. **Missing**: `NVIDIA_API_KEY` — needed for Casting Director/Screenwriter to work in production at all.
