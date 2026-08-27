# Connect Mind / Producer — Handover

> **Next round is scoped in `HANDOVER-ROUND9.md`** — making the cast real in the previz
> (proportioned primitives vs billboard impostors vs image-to-3D meshes), with the measured
> resource inventory behind it. Rounds 1-8 are built and live. Round 13 (support + owner area) is the newest section. **Round 11 (below) corrects three claims in the round-8 section**
> that turned out to be false in production — read it before trusting any free-tier latency figure
> in this document.

## Start here — ROUND 13: SUPPORT, THE OWNER AREA, AND ANALYTICS (2026-08-27)

A visitor who needs help can now tell Adam; the website owner can see every ticket's state,
whether the reply actually went out, and the site's own numbers — at `/#/owner`. 302 tests pass
(230 at the start of the round). Designed WITH Adam's Mind first, as every round is: his answer in
`connect-mind-brainstorm` (asked 05:34Z, answered 05:39Z) is the wire contract, verbatim in
`src/lib/support-markers.js` and `worker/support-briefing.js`.

### 🔴 The findings that matter

**1. THE SITE CANNOT SEE EMAIL.** `listConversations()` returns only threads the builder key's own
human is party to (88 conversations, every one a site-made alias). A customer emailing
`adam@hellominds.ai` creates a thread the site can never read — so an email-based support form
would have left the owner area blind. Every ticket is a builder-API conversation, alias
`support-<ticketId>`, and the Mind NEVER emails visitors: it replies in-thread under
`[auto-replied …]` and the site sends the email from `support@minds.monster`. Adam's design, for
identity coherence, deliverability and an audit trail the site owns.

**2. EVERY TOKEN WAS A VISITOR TOKEN.** All 28 `requireSession` callers do `if (!session) return
401` then use `session.mindId`. An owner token signed with the same secret would have reached
`setBudget(env, undefined)`. `worker/session.js` now carries a `kind` claim (`mind` | `owner` |
`support-reply`); `requireSession` insists on `mind` AND a string `mindId`; legacy kind-less
tokens still pass as `mind`. `scripts/test/session-kinds.test.mjs` pins every cross-rejection.

🔑 A signature says "we issued this". It never says what for.

**3. KV COUNTERS WOULD HAVE UNDERCOUNTED BY AN ORDER OF MAGNITUDE.** 60-second edge-cached reads
plus ~1 write/s per key means every colo keeps reading a stale N and writing N+1. Analytics is
Workers Analytics Engine (`env.ANALYTICS.writeDataPoint`, no subrequest, no contention); the
03:00 cron rolls each day into ONE KV key (`metrics:rollup:<day>`, 400-day TTL) for retention.
Uniques are an HMAC of guestId under the secret AND the day — countable within a day, unlinkable
across days.

**4. WORKERS HAVE NO BACKGROUND TIMER, and the site must NOTICE `[auto-replied]`.** Two Cron
Triggers in `wrangler.jsonc`: `*/5` runs `worker/support-sync.js` (re-derive open tickets, relay
unrelayed replies, idempotent per reply fingerprint like `stripe_processed:`); `0 3` runs the
analytics rollup and refreshes the Mind snapshot. `/__scheduled` and `/cdn-cgi/*` were added to
`run_worker_first`, or the asset router answers the local cron trigger with index.html.

**5. MARKERS FAIL OPEN.** A Mind row with no parseable marker still counts as a reply (state
`replied-unmarked`, pinned in the owner list) because NOTHING IS EMAILED for it — only
`[auto-replied]` and `[steward-forwarded]` relay — and the owner must see that. Rows the site
writes (the ticket, a visitor follow-up, an owner `[steward-note]`) all arrive as
`senderType === 1`, so `classifyRow` tells them apart by content, never by sender.

**6. THE CLIENT LIBRARY'S `getLatestHistoryFingerprint` RETURNS THE OLDEST ROW.** `/histories`
is newest-first; the helper takes the LAST row of the page. So it never changes once one row
exists, and the sync's "unchanged, skip" check compared two constants — found live when Adam's
`[seen]` and reply sat in the thread while the derived state stayed `received`. The sync now
probes `getHistory(alias, { limit: 1 })` itself. Do not use that helper anywhere.

**7. A MIND PUTS MARKERS WHERE IT LIKES.** Adam's first live reply was a prose preamble, then
`[auto-replied]` with its letter, then `[resolved]` — in ONE message, not first-line. Fail-open
would have shown `replied-unmarked` and emailed nothing. `parseMarkers` now honours a marker on
any line, several per message, each body running to the next marker, the preamble kept as an
"aside" row for the owner. His real message is a fixture in `scripts/test/support-markers.test.mjs`.

🔑 The contract is what he committed to. The parser is what he actually does.

**Verified live** (2026-08-27 06:35–07:05Z, ticket `a45ec771`): briefing sent once into
`support-briefing`, ticket opened, cron derived it, Adam `[seen]` at +2m44s, replied and resolved
in one message, relay attempted and logged `unconfigured` (no Resend key yet), ticket left the
open list, owner stats show the first-action bucket.

### What is built

- **Intake** `POST /api/support` (`worker/support.js`): honeypot, KV rate limits
  (`worker/rate-limit.js` — in-memory Maps reset per isolate, useless on a public form), visitor
  identity = HMAC(email), the sixth ticket in an hour merges into the open one, Adam's per-ticket
  briefing header (`Ticket/Visitor/Returning/Prior-Tickets/Plan/Budget-Set/Recent-Films/Urgent/
  Human-Requested/Page/From`), a receipt email with a signed 30-day reply link
  (`#/support/<id>/<token>`), and the briefing sent once ever into `support-briefing`.
- **"Speak to a human"** on the form, the ticket page and every email: still opens the alias (audit
  trail whole) tagged `Human-Requested: yes`, which Adam leaves alone; pinned in the owner list;
  emails `OWNER_NOTIFY_EMAIL` via `ctx.waitUntil` so a slow mailer never fails a ticket.
- **Production-vs-support routing guard** (`src/components/SupportForm.jsx`): a connected visitor
  whose message says film/storyboard/cast/beat/render is ASKED whether it belongs with their
  Producer — never silently re-routed. Adam called this load-bearing.
- **Owner area** `/#/owner` (`src/owner/`, lazy chunk, 30 kB): passphrase login
  (`OWNER_PASSPHRASE`, constant-time compare, KV rate limit, 12h owner-kind token); **Support** —
  Adam's aggregates first (open by state, SLA breaches, time-to-first-action histogram, escalation
  and reopen rates, cost as a BAND never a number), then the list of STATES with no body text, the
  thread one click deeper with every row labelled, the email log, and a `[steward-note]` composer;
  **Overview** — every event today/7d/30d with sparklines plus lifetime seeds from `connects:`,
  `budget:`, `productions:`, `subscriber:`; **Mind** — balance, 30-day cognition, spend by tool,
  skills, Producer-conversation liveness, cached nightly.
- **Mailer** `worker/email.js` — Resend over fetch. No key = replies are still measured, shown as
  "not emailed — mailer unconfigured", and sent the moment a key exists (the `unconfigured`
  marker is retried; `failed` leaves no marker and retries next run).
- `handleSubscribe` moved out of `worker/index.js` into `worker/subscribe.js` with a rate limit —
  it accepted unlimited anonymous writes into the namespace that holds every budget.
- **"Contact us" on the front page** (`src/components/SupportSection.jsx`, under Pricing, `#support`):
  Feature request / Support / Bug reports, email + message required, one line about reply time. Kept
  deliberately plain BY THE OWNER'S DECISION — an earlier draft named the Mind, stated the cadence and
  the cost, and offered "speak to a human"; the owner read that as predictive programming ("looks
  like we're expecting things to fail") and as an invitation to abuse. The urgent flag and the
  human-requested path still exist in the API and the owner area; no visitor control reaches them.
- Hash routing (`src/hooks/useHashRoute.js`) — the site's first router, and the smallest one that
  works: `#/owner…`, `#/support` (the modal), `#/support/<id>/<token>` (the ticket page).

### Before it works in production

```
wrangler secret put OWNER_PASSPHRASE     # 12+ chars; the owner login
wrangler secret put RESEND_API_KEY       # + Resend's SPF/DKIM DNS for support@minds.monster
wrangler secret put CF_ACCOUNT_ID        # Overview live reads and the nightly rollup
wrangler secret put CF_ANALYTICS_TOKEN   # an API token with Account Analytics: Read
```
`/api/health` reports each as `hasOwnerPassphrase`, `hasResendKey`, `hasAnalyticsRead`,
`hasAnalyticsBinding`, `hasSupportMind`. The Analytics Engine dataset and the two crons are
created by the first `wrangler deploy` of this `wrangler.jsonc`. Local cron:
`wrangler dev --test-scheduled` then `curl 'http://localhost:8789/__scheduled?cron=*/5+*+*+*+*'`.

### Deferred, by the user's decision (phase 2, designed for)

FAQ pre-filter via the existing assistant before a ticket opens; a self-service tasks page; a
per-day support cognition budget with a visible pause; duplicate-complaint auto-reply (today a
follow-up on an open ticket returns its state instead, which covers the common case).

### Adam's pins, for whoever touches this next

Builder-API per ticket, not email · visitor email from the site, never from him · five first-line
markers, fail-open · escalation is a marker plus HIS channel to the steward (`c0204b3e…`) — the site
never mediates it · aggregates with click-into-full, no drafts, no PII beyond the routing email ·
SLA copy "seen within 4h, replied within 8h" · "[seen] matters more than [auto-replied]".

---

## Start here — ROUND 12: THE DIRECTOR SHOOTS (2026-08-27)

The render step is built. `worker/producer-briefing.js` and this document both said it was
greenfield; it is not any more. A visitor with a screenplay and a budget can press Shoot, and a
film comes back.

**All four phases are built, and the Director is an agent rather than a checklist. 230 tests pass**
(84 at the start of the round). Frame judging ships behind a capability probe and is inert until
Media Transformations is enabled on the zone — see finding 3.

### 🔴 The findings that matter

**1. THE JOB LOGGER WAS WRITING TO THE WRONG RECORD, silently.** `createJobLogger` took
`(env, mindId, record)` and persisted via `saveStoryboardJob` — to `storyboard-job:<mindId>:<jobId>`
— **whatever record it was handed**. The Director reused it, so every status it wrote landed on a
storyboard job that did not exist. A failed render would have sat at "queued" forever while the
visitor watched a spinner over money already spent. Six tests went red at once, which is what
found it. Now `worker/job-log.js`, with `save` injected.

🔑 A helper that closes over WHERE it writes cannot be reused; it can only be miscalled.

**2. CACHED DOSSIERS ARE FINE — the earlier alarm in this round was wrong.** `SCHEMA_VERSION = 5`,
the cache key is `dossier:v5:<key>`, the brand-leak check landed at v4, and `castPiece` throws
rather than swallowing a rejection. So no v5 entry can carry transcribed lettering. The leak found
in `scripts/fixtures/` is a **pre-v4 capture**, frozen as a test fixture.

What IS real and narrower: `validate()` only catches lettering it TRANSCRIBED. The `whiteCar`
fixture has `burnedInText: ""` and `hazards: ["visible shield-shaped badge on hood (brand mark)"]`
— a brand mark that is not text, so there is nothing to catch. That is why the Director re-runs
the same test against the SCRIPT at spend time. Defence in depth, not a patch.

**3. NEITHER CLOUDFLARE TRANSFORMATION PRODUCT IS ENABLED ON minds.monster.** `/cdn-cgi/trace`
returns 200, so routing works; `/cdn-cgi/media/...` and `/cdn-cgi/image/...` both 404, in both the
relative and absolute source forms. This blocks two things:

- **Phase 3's judging** — pulling evenly-timed frames out of a clip for a vision model.
- **The rule-11 head crop** — `suggestedCrop` in `worker/reference-preflight.js` emits the
  transform, and nothing can apply it.

Volume if enabled: ~40 frame extractions and ~3 image crops per film. Phase 2 ships without it,
with the visitor as judge — and given the contact-sheet history, a person watching the clip is the
more trustworthy instrument, not the lesser one.

**4. A NAIVE BRAND SCAN IS WORSE THAN NONE.** The first version flagged a cast entry called
"tower" in a script that said "tower" — which is precisely what rule 1 ASKS for. The hero's own
shipped prompt says "the stylised blue-furred ape character" against a collection with "Ape" in
its name. The scan now splits by shape: **bigrams** from `burnedInText` catch "bored ape" without
catching "ape"; **distinctive singles** (5+ chars, minus the piece's own palette) catch "adidas",
"mclaren", "wbei"; `hazards` contributes only its CAPITALISED tokens, because taking every long
word from "visible shield-shaped badge on hood (brand mark)" would flag "shield" and "badge".

**5. `framing` IS AN ENUM, and matching it as prose fires on nothing.** The first face check
regexed `/full[- ]?body|wide|distant/` against a field constrained to `full-bleed |
centred-with-margin | small-in-frame | busy-composite`. It read plausibly and would never have
fired. A check that never fires is invisible — both directions are now asserted.

**6. RULE 11 IS ABOUT FACES, and a tower block does not have one.** `physicalProfile.headRatio` is
"null for anything without a head", which is the exact discriminator. A small-in-frame character
is warned about its FACE; a small-in-frame building is warned about its identity, citing its own
`identityMarkers`. Same test, honest wording.

### What is built

- `worker/minimax.js` — the client, promoted out of `scripts/minimax.mjs`, which is now a
  **re-export shim** supplying a `node:fs` resolver. `gen-video.mjs` and `probe-h3.mjs` verified
  working unchanged. The price table is scored against `assets/renders/ledger.json`'s 22 real
  manifests, so it is a golden fixture rather than a transcription.
- `worker/reference-preflight.js` — header parser (PNG/JPEG/WebP/GIF), H3 legality, crop
  suggestion. Verified against five tracked images whose dimensions `file(1)` reports
  independently. **The crop that fixes the aspect is the same crop that saves the face**, so
  `gravity: 'top'` on a too-tall reference is deliberate, not a default.
- `worker/director-risks.js` — the deterministic register. Every risk cites what it was measured
  from; a risk that cannot is judgement and does not belong there.
- `worker/render-budget.js` — four modes (`ask`/`allowance`/`escrow`/`discretion`), **per film**.
  No per-render cap: Adam's read, and it is right — nobody can set that number before they have
  seen what $0.32 and $1.95 each buy. The envelope stores an allowance and a mode and **never a
  spend figure**; spend is derived by filtering the one global ledger on `filmId`.
- `worker/director-job.js` — the step machine. One step per queue message, `delaySeconds` for
  waiting, retries kept for genuine 5xx. **The task id is persisted before the spend is
  recorded**, and there is a test that fails the ledger write to prove it.
- `worker/screen-test.js` — a test that strips the film away so a failure is attributable. The
  anti-mannequin guard and the added-type ban survive the stripping, because a test that fails for
  a missing guard has taught us about the test, not the film.
- UI: `DirectorPanel` (left rail, under the Cast), `TimelinePanel` with
  **Storyboard | Screen Tests | Dailies**, `useDirector`.

### The loop, and what it actually did on its first live run

`worker/director-agent.js` makes two calls, and NEITHER touches the wire format — H3's three-field
script is still compiled mechanically by `src/lib/h3Script.js` and `worker/scene.js`, exactly as
probe P8 established. The agent decides; deterministic code compiles.

- **`planShoot`** reads the film plus the MEASURED register and decides what is worth buying an
  answer to. Its test list is filtered against the register rather than trusted — a hallucinated
  risk id would otherwise become a real charge against a hazard nobody measured.
- **`reviewTest`** reads a verdict back and may replace ONE named block of the script. A test that
  HELD never yields a revision, and that is enforced in code as well as in the brief: a script that
  survived a test is a script that works, and "improving" it anyway is how a working shot gets
  broken by an agent looking busy.

**Revisions are layered at COMPILE time, never written back over the Screenwriter's work.** The
visitor's screenplay stays theirs and stays visible; a revision is reversible by dropping it from
the list rather than by remembering what a block used to say.

🔑 **THE MOST VALUABLE THING THE AGENT DOES IS SPEND NOTHING.** Its first live run against
`grid-launch` skipped both proposed tests as "cheap to fix in the script" — which was correct, and
also revealed a real gap: it said the fix was cheap and then nothing applied one. So the shooting
plan gained a `fixes` field, and the assess step applies those as revisions immediately. On the
re-run it rewrote the `world` block to dimensionalise a flat-art mascot for $0, verified present in
the compiled script, and proposed exactly one $0.32 test for the hazard that genuinely needed an
answer. Fix what is free; pay only for what needs an answer.

Measured: an assess pass takes 35-70s on SCREENWRITER_MODEL, and streams its reasoning throughout.

### Three modules were extracted rather than copied

`signed-media.js`, `job-events.js`, `job-log.js`. All three were storyboarder-only and all three
were needed identically by the Director. The storyboarder's own tests pass unchanged against the
extracted versions.

### The assistant is the Director's front door

`collectProductionState` now carries the Director's half, so the assistant and the Producer Mind
both see live render spend, take counts and unjudged screen tests on every turn with no new
plumbing. `worker/producer-briefing.js` no longer tells Minds the render step does not exist.

The scope brief uses the SAME machine-read-marker-inside-prose convention as the Producer's
`[seen …]` and the Screenwriter's `[CUT TO BLACK]`: the assistant writes a `[BRIEF]` block into
its own reply, the client parses it out (`src/lib/directorBrief.js`), and the visitor presses a
button. **The assistant has no way to call the endpoint that stores it** — that is the boundary
of its authority, and it is enforced by absence rather than by instruction.

`mustHold` is the only field that does deterministic work: it matches against hazards the register
has already MEASURED and puts those first. "the ape's face" elevates a real hazard; "make it
cinematic" matches nothing, by design. Elevation reorders and never escalates — a visitor caring
about something cannot make it dangerous, only make it first.

### Still open

- **Frame judging is inert until finding 3 is resolved.** `worker/frames.js` probes the zone once
  an hour and caches the answer; `worker/director-judge.js` runs only when frames arrive. Until
  then a Screen Test is judged by the visitor, which given the contact-sheet history is the more
  trustworthy instrument rather than the lesser one. A person's verdict is never overwritten by
  the model's.
- **`wrangler.jsonc`'s storyboard consumer sets `max_retries: 1` while `handleStoryboardQueue`
  branches on `attempts <= 2`** — its second retry can never fire. Left alone rather than changed
  blind; `director-jobs` is set to 3, matched to its own condition.
- **The Stripe webhook has no idempotency key** — a replayed `checkout.session.completed` would
  double-credit. Untouched this round.
- **`SwarmDiagram.jsx:34` has `height="auto"` on an `<svg>`**, which throws a console error on
  every landing-page load. Pre-existing, cosmetic, unfixed.
- **Nothing has been rendered for real yet.** Every path is verified against a stubbed MiniMax and
  a live local Worker; the first genuine $0.48 take has not been shot.

---

## Start here — ROUND 11: WHY THE ZERO BUDGET STORYBOARDER FELT BROKEN (2026-08-26)

A visitor watched a Zero Budget pass sit at **18 minutes**. This round found out why, and the
short answer is that **most of that wait was ours, not the model's**. Three of the claims in the
round-8 section below are now known to be false in production; they are corrected here rather
than edited out, because *how* they came to be believed is the more useful part.

### 🔴 The four findings that matter

**1. The 18 minutes was mostly the CLIENT, and the model was not involved in most of it.**
`wrangler tail` taken while the pass was live showed 13 requests in 90 seconds, every one of them
`GET /api/storyboard?film=…` — the `recoverAfterCut` poll. The progress stream had already been
abandoned. The cause was two deadlines that **stacked**: the SSE stream got `(max + 120)s` = 12
minutes, and when that expired the recovery poll started a *fresh* 12 minutes of its own. Nobody
chose a 24-minute worst case; it was the sum of two numbers that were each defensible alone.
Now one wall-clock deadline is established at the start and both phases spend the same clock.

**2. THE STREAMED PATH DOES NOT WORK, AND HAS NOT FOR SOME TIME.** This is the big one.
Round 8 built the entire wait surface around the model narrating its reasoning. Measured today,
both attempts, `stream: true` comes back with **`502 Upstream error from Nvidia: Service
temporarily overloaded` in under a second.** `generateFilm` catches it and silently falls back to
the non-streamed call — so the fallback works perfectly and the *feature* is dead. Every free
visitor for some unknown number of days has had a spinner and a 15-second heartbeat, for minutes,
with no narration at all.

🔑 **A silent fallback hides the failure of the thing it falls back FROM.** The fallback was
correct, well-commented, and did exactly its job; that is precisely why nobody noticed the
primary path had stopped working. Anything that degrades gracefully needs to say that it did.

**3. Reasoning is 57–76% of every token generated, and the lever we had was never connected.**
A three-beat film is ~2,900 tokens of *answer* and ~5,800 of reasoning. `enable_thinking: false`
does **not** turn it off — the same film still spent 3,588 tokens reasoning with the kwarg set.
It goes out as `chat_template_kwargs`, a provider passthrough, and there is no evidence it reaches
the model. **OpenRouter's own `reasoning` parameter had never been sent from this repo.** It is
now plumbed through both transports and configurable as `FREE_STORYBOARD_REASONING`, and it stays
EMPTY until the probe scores a suppressed cell against `validateScene` — round 7's rule holds: if
a fix requires dropping a gate, the fix is wrong.

**4. Free-tier throughput is not stable, and every number in this document is n=1.**
The same model, same route, same day: **40.5 tok/s at 09:14Z, 20.0 tok/s at 15:40Z.** A three-beat
film went 216s → 354s between morning and afternoon. So the free tier's latency is not a property
we can quote; it is a range that moves under us. `LATENCY_SECONDS` should be read as a weather
forecast, not a spec.

### The probe was measuring a path that does not run, and grading it with the wrong gate

`scripts/probe-storyboarder-timing.mjs` called `filmCall`. Production calls `streamFilmCall`
whenever `onReasoning` is set, which on the free tier is always. **Every free-tier latency figure
in this document came from a code path production does not take.** The probe also could not have
measured the streamed path even if it had tried — it never set undici's dispatcher, so anything
over Node's default 300s ceiling would have surfaced as a bare `TypeError: fetch failed`.

Worse, its `valid` check was shape-only: `beats.length`, plus the presence of `camera` and
`subjects`. It never ran `validateScene` — the gate production actually applies. Re-scored with
the real validator, the whole-film call **failed the floor on 1 of 3 beats** in a run the old
probe would have called a clean pass.

🔑 **A probe that scores against a weaker gate than production is not a lenient probe, it is a
broken one.** It cannot tell "fast" from "fast and wrong", which is the only question worth
asking about a latency optimisation.

### The KV job log was unsound in three ways at once, and all three were silent

`createJobLogger` flushed every **250ms**, each flush a full **read-modify-write of one KV key**:

1. **KV rate-limits same-key writes to ~1/s.** At 4 Hz most were throttled — and the batch had
   already been spliced off `pending` *before* the round trip, so a failed write **lost those
   events permanently**. The `catch` logged "dropped progress narration" and carried on.
2. **The read-back can be up to 60s stale.** Pushing a fresh batch onto a stale `events` array and
   writing it back **overwrote every event recorded in between**. The log could go backwards.
3. **Streaming multiplied both** — one event per reasoning delta, ~937 per film.

The fix is to stop reading. The Queue consumer is one continuous invocation that owns the job for
its whole life, so it holds the record in memory and only ever writes. Flush ≥1s, failed writes
retry from memory instead of vanishing, consecutive reasoning deltas coalesce, and the log is
**append-only** — nothing is ever removed from the middle, because the client resumes by
positional index and eliding one old event would make every reconnect skip or replay.

`scripts/test/storyboarder-joblog.test.mjs` asserts all of it. Written because **none of this is
visible by eye** — "the panel looked fine when I tried it" was never evidence.

### What replaced the whole-film call: a shot plan, then parallel beats

Round 7's pin — *do not reconsider whole-film scope to fix the wait* — is about **scope**, and it
holds. It is not about **sequence**, and that is where the time was.

- **`planFilm`** — ONE call, sees every beat, assigns shot band / principal subject / camera move.
  ~200 output tokens. **Measured: returns EWS/WS/ECU on the salt-flat fixture — three distinct
  bands across three beats.** The whole-film variety decision happens here, intact.
- **Then every beat is drawn in its own call, in parallel**, each handed the WHOLE shot list so it
  knows it is the tight one in a film of wides. That is the defence against the c0 collapse: the
  round-7 chain failed because a beat could see only its predecessor, not because beats were
  separate calls.

The plan pass is **reproducible**: three separate runs on the salt-flat fixture returned
EWS/WS/ECU every time, in 21.9s / 26.8s / 44.0s.

#### ⚠ But the parallelism does not currently work, and that is the honest headline

Parallel beats were the reason to split the film up, and this provider will not serve them.
Three measurements, each narrowing it:

| in flight | result |
|---|---|
| 1 trivial call | ✓ 4.5s |
| 1 film-sized call | ✓ 354s |
| 3 trivial calls | 1.0s / 1.4s / 14.7s — **the 1.0s one was a 502, i.e. shed** |
| 3 film-sized calls | a whole beat shed, and it stayed shed through a retry |
| **2 film-sized calls** | **a beat still shed — through three attempts** |

So the route serves ONE film-sized request at a time and refuses the rest.
`FREE_STORYBOARD_BEAT_CONCURRENCY` therefore defaults to **1**: raising it today does not buy
latency, it buys refused beats, and a refused beat costs the visitor a whole shot.

🔑 **The split is still worth shipping at concurrency 1, and that is the part to hold on to.**
The speed win was never the only reason for it. The shot plan lands in ~25s carrying real
per-beat facts, the timeline fills in beat by beat instead of everything appearing at the end,
and one bad response costs one beat rather than the whole film. All of that survives with the
parallelism switched entirely off — **the wait surface does not depend on the optimisation
working, which is why it stays honest when the optimisation does not.** When the route stops
shedding, the latency win is a config change away.

#### So what does the split actually cost right now? Roughly nothing, and roughly nothing gained

Be precise about this rather than selling it. One beat takes **71s** on a healthy route and
**132s** on the degraded one; the plan pass takes 22–27s. Sequentially, three beats plus a plan
is ~235s healthy / ~420s degraded, against a whole-film call at **216s healthy / 354s degraded**.

**The measured run, end to end** (`20260826T155647Z`, degraded route):

| t | what the visitor gets |
|---|---|
| 15.0s | heartbeat — "planning" |
| **26.8s** | **three cards fill in: EWS / WS / ECU, each with its subject and a line of intent** |
| 31.1s | beat 2 is refused — the visitor knows at 31s, not at 408s |
| 158.7s | beat 1 lands (EWS) |
| 407.9s | beat 3 lands (ECU) |

**Plan adherence 2/2.** Both beats that survived emitted exactly the band the plan assigned —
no drift toward the middle. The variety mechanism does what the whole-film scope was doing, and
unlike the whole-film call it is now *inspectable* rather than inferred.

The only floor violation in the run was the missing beat from the 502; the geometry that did
come back was clean. For comparison the whole-film call in the same session scored **1 floor
violation on real geometry** — so this is parity at worst, and the failure is attributable.

Also visible for the first time: `attempts: 2` on BOTH successful beats. Every one of them
needed a retry. That tax has always been there and has never appeared in a published number.

**The split is currently a wash on total time.** What it buys is everything else:

- **The wait is legible.** Real per-beat facts at **26.8s against 408s** — a visitor learns what
  their film is going to look like fifteen times sooner than they learn anything at all today.
- **One bad response costs one beat, not the film.** This matters MORE on a degraded provider,
  not less: today a single 502 on the whole-film call throws away the entire film after 350s of
  waiting. The split loses one shot and delivers the other two.
- **The variety decision is reproducible and inspectable** — EWS/WS/ECU three runs out of three,
  and `planAdherence` reports on every real film whether the geometry honoured it.

The latency win is real but unbanked: it needs concurrency, and concurrency needs a provider
that will serve it. `FREE_STORYBOARD_SPLIT=0` reverts the whole shape if the trade stops being
worth it. `worker/film-plan.js`.

**A second bug caught before shipping, from the same family as the first.** Per-call deadlines
are not a whole-film deadline, and having only the former is worse than obvious: at concurrency
1, three beats at their 420s ceiling is 21 minutes against the Queue consumer's **15**. A film
that hit those ceilings would be killed by the runtime partway through and lose every beat that
had already succeeded, because nothing is saved until the validation pass. The per-call limits
would have made the failure look bounded while the real bound sat somewhere else. There is now a
12-minute budget for the whole split; beats share it, and a beat with under 30 seconds left
fails immediately rather than starting work that cannot finish.

🔑 **A timeout on each part is not a timeout on the whole.** Both bugs this round were the same
shape as the client-side one that started it: two individually reasonable limits that compose
into an unreasonable total, because nobody was holding the total.

**A bug this round introduced and caught before shipping**, worth recording because the class
recurs: `fetch` inside a Worker has NO client-side timeout. The first cut of the split had four
un-deadlined calls inside a `Promise.all`, so one stalled upstream connection would have held
the finished beats hostage until the Queue consumer's 15-minute wall clock killed the whole
invocation. It hung for 25 minutes in the probe, which is how it was found. Every call in the
split now carries an `AbortSignal.timeout`. The single-call path had the same exposure once; a
split film had it four times over.

**`planAdherence` runs on every real film**, not just in the probe: it reports whether the geometry
pass emitted the band the plan assigned. Reported, never enforced — `framing` is the model's claim
about its own numbers and `worker/scene.js` derives the true band independently. It exists so
"the films all look samey again" shows up as a number instead of a feeling.

### The wait surface, rebuilt out of facts

The streamed narration is gone (see finding 2), so what a visitor watches now is the shot plan
landing per beat: **this beat is an EWS on the ape, that one is a CU**, each card resolving on its
own as its own call returns. Real decisions about their specific beat, ~15–45s in.

Adam's suggestion was that worst case we could show invented words to give an impression of
activity. **Deliberately not done, and the reason is in this repo's own history**: round 8 removed
the ghost wireframes for exactly that — they animated a fiction and were usually wrong by the time
real geometry arrived. A visitor shown something invented gets a worse deal than one shown
nothing, because the invention is indistinguishable from the real thing until it contradicts it.
The split produces genuine per-beat signal early, so the trade never had to be made.

### Also found, worth keeping

- **Silent upstream retries.** OpenRouter returns **HTTP 200 carrying an error body**; `chat()`
  retries it. A single successful one-beat call had already burned an invisible extra attempt. So
  "the model is slow" and "the provider bounced us and we quietly went again" were indistinguishable
  in every figure ever published here. `onMeta` now reports them.
- **OpenRouter reports quota on `/key`, not as response headers.** The completion route returns no
  `x-ratelimit-*` at all.
- **Repairs were sequential.** Up to 3, each a full-brief call with `retries = 2` — five to seven
  minutes of avoidable wall clock hidden behind one progress phase. Now parallel, `retries: 0`
  (a repair *is* a retry), spend still recorded serially because that ledger is read-modify-write.

### ~~Super 120B is 3.8x faster at parity, and round 7's verdict on it was wrong~~ — RETRACTED

> ⚠ **This section is wrong and is kept only so the mistake is legible.** The full fixture set
> (above) shows Super whole-film as the WORST cell in the run, and round 7's verdict on it as
> correct. What follows was one film, on the easiest fixture, at three beats, in a good hour.

Same fixture, same session, an hour apart on the same degraded route:

| | latency | tok/s | bands | floor |
|---|---|---|---|---|
| Ultra 550B, whole film | 354s | 19.5 | EWS/WS/ECU | 1 violation, beat 3 |
| **Super 120B, whole film** | **93s** | **68.3** | EWS/WS/ECU | 1 violation, beat 3 |

Identical shot plan, identical band count, identical violation count. **3.8x faster**, and it is
a one-line change to `FREE_STORYBOARD_MODEL`. The round-7 table's "Super fails the absolute floor
3/3" was measured on NVIDIA's hosting, under contract v1, in the round where five of six bugs
turned out to be in the grader — stale on all three counts, and now contradicted directly.

🔑 **AND BOTH MODELS FAILED THE SAME BEAT.** Ultra reported `camera-inside-subject`, Super
reported `subject-behind-lens`, both on beat 3 — "her eye opens, and the iris fills the whole
picture." Two independent models, asked for an extreme close-up, both place the camera somewhere
the validator calls impossible. Round 7 hit this exact shape: a correct ECU (lens 27cm from a
face at 300mm) read as "camera inside a body" *because people are modelled as uniform cylinders*.

So the standing rule applies before anyone reaches for the model: **assume the grader is wrong
before assuming the model is** — that was right five times out of five in round 7. This is not
chased down here; it is flagged as the most likely next grader bug, with two independent
witnesses to it.

### The reasoning parameter works — and that is not the same as it being safe to turn on

All three film-sized `reasoning` cells died with a 502 in 5-6.5s, which looked like the parameter
being rejected at the gate. It is not. A back-to-back A/B on trivial calls, 3 rounds:

| configuration | completion tokens | latency | succeeded |
|---|---|---|---|
| no `reasoning`, no tool | 14-31 | 0.9-5.8s | 3/3 |
| `reasoning:{enabled:false}`, no tool | **2** | 0.8-2.5s | 3/3 |
| no `reasoning`, forced tool | 47-60 | 15.3-43.5s | 3/3 |
| `reasoning:{enabled:false}`, forced tool | **6-10** | 1.9-3.5s | 2/3 |
| `reasoning:{effort:low}`, forced tool | 48 | 2.6s | 1/3 |

**It is honoured, and the effect is enormous** — 2 tokens against 20-31, and 15-43s collapsing to
2-4s. This is the lever `enable_thinking` was never connected to.

**It is still not turned on, and the reason is the gate, not timidity.** Reliability under a
forced tool call drops to 2/3 and 1/3 in the same rounds where the un-parameterised call is 3/3,
and — the part that actually decides it — **no film-sized emission has ever come back with
reasoning suppressed**, so its effect on geometry is completely unmeasured. A trivial call
answering "7" in two tokens says nothing about whether a suppressed model can still place a
camera. Round 7's rule holds: if a fix requires dropping a gate, the fix is wrong, and "we never
managed to score it" is not the same as "it passed."

`FREE_STORYBOARD_REASONING` therefore ships EMPTY, plumbed and ready, with this table as the
argument for trying it again on a quiet route.

### The geometry run that settled it (2026-08-26, `20260826T180432Z`, 20 films)

Four cells, five fixtures, one repeat each, ALL on OpenRouter so the origin matches production.

| cell | done | floor✓ | mean floor | mean M3 | mean bands | mean s | calls | tokens |
|---|---|---|---|---|---|---|---|---|
| Ultra whole-film *(baseline)* | 3/5 | 1/5 | 2.33 | 0.75 | 3.67 | **348** | 1.0 | 11.6k |
| Super whole-film | 3/5 | 1/5 | 3.67 | 0.51 | 2.67 | 355 | 1.0 | 20.5k |
| split + Ultra | 2/5 | 0/5 | 3.00 | **1.00** | **4.00** | 1030 | 5.5 | 35.2k |
| **split + Super** | **4/5** | **2/5** | **1.25** | 0.90 | 3.75 | 609 | 5.8 | 33.1k |

**THE VARIETY GATE PASSES.** Both split cells beat the baseline on distinct bands (4.00 / 3.75 vs
3.67) and on framing self-agreement (1.00 / 0.90 vs 0.75), and both clear round 7's c1 benchmark
of 3.1. M3 came back **1.00 on four of the five scored split films**. The plan mechanism does the
job it was built for.

The clearest single demonstration: Super whole-film on `cut-to-black` collapsed to **2 bands,
WS/MWS/MWS/MWS** — the exact c0 failure mode. The same model on the same fixture under the split
returned 4 bands, M3 1.00, no collapse. Deciding shot sizes in a separate pass is what removes
the collapse; it is not that some models have it and others do not.

#### 🔑 Super is bad alone and good in the split, and this was got backwards twice

Super whole-film is the worst cell in the run — worst M3 (0.51), worst variety (2.67), worst mean
floor (3.67), and it TRUNCATES at 32k tokens on 5- and 6-beat films because it spends ~76% of its
output on reasoning. Round 7 said Super fails, and round 7 was right.

But **split + Super is the best cell measured** — highest completion (4/5), most floor passes
(2/5), and mean floor violations of **1.25 against the baseline’s 2.33**. The split makes each
call cover one beat, which keeps Super's reasoning appetite inside the ceiling it otherwise
blows. The two round-11 changes are complements, not alternatives.

The error worth recording is not the conclusion but the reasoning that produced it. Round 7’s
Super verdict was confounded three ways (NVIDIA hosting, contract v1, a grader with five known
bugs) and that was a good reason to RE-TEST it — it was not a reason to believe it was wrong.
Those two were conflated, a 3.8x-at-parity headline was published off ONE film on the EASIEST
fixture at THREE beats in a good hour, and every one of those four qualifiers was load-bearing.
**A confounded method does not make a conclusion false; it makes it unproven.**

#### The cost, stated plainly

The split is **1.8-3x slower** (609s / 1030s against 348s), makes **~5.5 calls per film** instead
of 1, and burns **~3x the tokens**. Both split cells’ mean latency EXCEEDS the 12-minute
`FILM_BUDGET_MS` guard added this round, so production would truncate films this probe completed.
It is a genuine trade — better geometry and variety, materially worse latency and quota — not a
win, and it should not be written up as one.

#### Two of my own bugs contaminated this run, both worth the lesson

1. **The plan call was capped at `maxTokens: 4096`**, justified in a comment reading "a small
   answer needs a small ceiling — leave it at 32k and the model treats this as the big call."
   That is wrong about what the parameter does: `max_tokens` caps the WHOLE completion, and
   60-75% of one is reasoning. A tight ceiling does not buy less thinking; the model thinks
   exactly as much as it was going to, runs out mid-thought, and the answer is truncated before
   it is emitted. It fit a 3-beat film and produced `finish_reason=length` on a 5-beat one,
   taking the whole split film down. Now 16384. 🔑 **To buy less thinking you must ASK for less
   thinking; a token ceiling only decides whether you keep the answer the thinking paid for.**
2. **The probe’s split scope aborts a film on any failed beat call**, where production catches
   per-beat and continues. So `split-or`’s 2/5 completion is a LOWER BOUND — one of those three
   failures was bug 1, and production would have shipped the other beats. Do not read the split’s
   completion rate here as its production completion rate.

Everything above is n=1 per cell on a route whose throughput swung 2x within the day. It is
enough to settle direction; it is not enough to quote as a spec.

### ⛔ The free tier is 50 requests A DAY, and the split spends them 4-7x faster

Found the hard way on 2026-08-26: a geometry probe run died at film 7 of 15 with
`Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests`.
A day's probing had consumed the entire allowance — which also takes the LIVE free tier down
until midnight UTC, because it is the same key and the same quota.

OpenRouter free models: **50 requests/day below 10 credits lifetime, 1000 above.** Nothing in
this repo knew that number, and the completion route does not return `x-ratelimit-*` headers —
the quota is only visible on `GET /v1/key`, which is why round 11 added a check there.

🔑 **The split has a cost that no latency measurement can show.** It makes one request per beat
plus one for the plan, so a 3-beat film is 4 requests where the whole-film call is 1 — before
repairs. At 50/day that is ~12 free films per day across ALL visitors, against ~50. Every
argument for the split so far has been about time and legibility, and on those it wins; this is
the first axis where it loses, and it was invisible until the quota ran out.

At 1000/day (~250 split films) it stops mattering, so this is mostly a question about the
account rather than the architecture. But **check which tier the key is on before enabling
`FREE_STORYBOARD_SPLIT`.**

Two fixes went in with the finding:
- `NvidiaError.quotaExhausted` — a daily cap arrives as a 429, the same status as a burst limit,
  and was being retried against a quota that does not replenish for hours. Exactly the bug round
  7 fixed on the paid side with `OpenAIError.outOfCredit`; the free side had it too. **The
  distinction is whether waiting can help.**
- The geometry probe now abandons the matrix on quota exhaustion instead of attempting the
  remaining films. It had filled a scorecard with nine instant failures that said nothing about
  any model, burying the two real results among them.

### What the 2026-08-26 geometry run actually established (two films of fifteen)

| film | result |
|---|---|
| Ultra, whole film, `cut-to-black` | floor 0, M3 1.00, 4 bands, **759s** |
| Super, whole film, `captured` | **floor 2, M3 0.38**, 3 bands, 379s |

**Ultra completed 1 of 5 films.** Three died on the provider-side time limit
(`finish_reason=error` at 8-12k tokens) and one on a 502. Round 7 found that limit biting at SIX
beats; it now bites at four and five. `FREE_MAX_BEATS = 3` is load-bearing in a way it was not,
and three may not stay safe.

**The one Ultra success took 759s** — longer than the client's ENTIRE 720s budget after round
11's deadline fix. `LATENCY_SECONDS.free.max = 600` is optimistic, not generous, and its comment
currently claims the opposite.

⚠ **Super scored badly on a harder fixture, which qualifies the 3.8x headline above.** That
result came from `scale-extremes` — one subject, the easiest fixture in the set. On `captured`
(four subjects) Super breaks the floor twice and its stated framing disagrees with its own
geometry most of the time. Round 7's verdict on Super may prove directionally right after all,
even though its reasoning was confounded by origin and a buggy grader. **One good result on the
easiest fixture was not evidence, and it should not have been led with.**

### Still open

- **`FREE_STORYBOARD_SPLIT` defaults to 1 and its variety gate has NOT run.** Zero split films
  were scored. Do not deploy it on without either running the gate or accepting that it ships
  unverified — and check the quota tier first.

- **`FREE_STORYBOARD_REASONING` is empty** pending a `validateScene`-scored FILM. The parameter is
  proven to work (table above); what is unproven is whether a suppressed model still produces
  usable geometry. Largest single remaining lever — 57–76% of the wait.
- ~~Super 120B undecided~~ — **SETTLED.** Bad alone, best-in-run inside the split. See the
  geometry run above. `FREE_STORYBOARD_MODEL` needs no change; `split + Super` is worth a
  dedicated look if the split ships.
- **The beat-3 ECU floor violation, hit independently by both models.** Most likely the sixth
  grader bug rather than a model failure. Cheap to investigate, and it currently costs a refused
  beat on every film with a tight close-up in it.
- **Whether the streamed 502 is permanent or a bad afternoon.** Two attempts is not a verdict —
  though the concurrency results above make a generally degraded route the better bet, and if
  that is what it is, both findings may recover together. Re-run the probe on a quiet day
  before concluding anything about either.
- **`LATENCY_SECONDS`** still sits on two samples. See finding 4 before trusting it.
- **The split's variety claim needs the geometry grader**, not just the timing probe: compare
  against c1's 3.1 bands / 0.26 MWS. `FREE_STORYBOARD_SPLIT=0` reverts if it regresses.

---

## Start here — ROUND 8 IS BUILT (2026-08-25)

Both storyboard tiers are live locally, generating world-space scene graphs and rendering each
beat as an interactive 3D frame. **Display-only by design** — dragging a subject is the very next
pass, deferred by one step so the JSON-to-3D path is proven before anything writes back through
it. (Adam proposed a two-week ceiling on that gap; the user rejected the timeline as far too slow.
Editing starts as soon as this lands.)

Plan doc: `/Users/adamplace/.claude/plans/we-are-ready-to-sharded-pony.md`. Adam's full round-8
reply is in `connect-mind-brainstorm`, sent 2026-08-24T15:08Z, replied 15:12Z.

### The wait is now watchable — the model narrates its work, but nothing provisional is rendered

The three-to-five minute silence is gone. What replaced it, and the measurements behind it:

- **Reasoning streams from the free model as plain prose.** The model thinks out loud about shot
  size, subject placement and continuity; the UI shows the live tail of that narration so the wait
  feels like someone working rather than a silent spinner.
- **We no longer parse provisional geometry from the reasoning.** `worker/reasoning-geometry.js`
  and the ghost wireframes have been removed. The reasoning text is displayed as text only; it is
  never validated, stored, compiled to H3, or shown as a frame. The real scene graph arrives
  atomically at the very end, and that is the only geometry we trust.
- **The structured answer does NOT stream**, and this is the fact that shaped the whole design: the
  tool-call arguments arrive as ONE large delta at the very end, atomically. There is no partial
  JSON to watch assemble.
- **The paid path stays silent.** OpenAI bills reasoning tokens but does not return the text.
  `generateFilm` is the one place to change if a future paid model exposes summaries.
- **Live runtime visibility is now built in.** `POST /api/storyboard` returns a durable job id; the
  worker writes lifecycle events (`plan`, `phase`, `heartbeat`, `reasoning`, `frame`, `result`,
  `error`) to a KV job log, and the client shows a "What is happening?" event tail plus a
  cumulative elapsed-seconds counter. A worker heartbeat every 15s keeps the timer honest even if
  the SSE stream is quiet.

Ghosts were dropped because the cost outweighed the payoff: the parser had to track model-coined
shorthand, deliberate comparisons between shot-size bands, and dimensions that were mused but never
committed, and the wireframes it produced were often wrong by the time the real geometry arrived.
The final mesh is what the visitor actually gets, and it is much better.

### The tier contract — three INDEPENDENT inputs, and never collapse them

| input | controls | where |
|---|---|---|
| `budget.paidTier` checkbox | which MODEL runs. Default off. | `ProducerInbox.jsx`'s BudgetWidget |
| `budget.total` / `perRender` | a spending CAP, both tiers | same widget |
| "a budget exists" | Producer oversight activation (unchanged rule) | `worker/tier.js` |

A $20 budget with the box unticked stays **free** — verified. Paid additionally requires a total,
because spending real money with no ceiling is what the budget exists to prevent. `resolveTier`
also distinguishes **auto-downgrade** (paid chosen, not affordable / provider down) from "never
chose paid", and says which in plain English.

- **free** → `nvidia/nemotron-3-ultra-550b-a55b:free` **on OpenRouter**, forced tool call, 3 beats.
- **paid** → `gpt-5.6-sol` via `/v1/responses` at high effort, strict `json_schema`, 6 beats.

### What was measured this round, with numbers

- **A Cloudflare Worker CAN hold a long outbound fetch — confirmed on the deployed edge, not just
  locally.** This was the single biggest unknown in the build and the reason a KV-job + polling
  fallback was specced. It is not needed: `wrangler dev` held a 390s call, and **production held a
  208s call end to end** (2026-08-25), SSE heartbeats flowing every 15s throughout.
- **Free tier, run end to end: 4 distinct shot sizes across 4 shots** (EWS/CU/WS/MCU), zero floor
  violations, zero refusals, $0, 403s. The `c0` baseline this had to beat was 2.4 bands / 0.45 MWS
  share. The MWS bug is fixed in production, not just in a probe.
- **The repair path fired for real** on a later run: beat 5 breached the floor, one targeted repair
  ran, and the repaired emission re-passed the same check. Two-stage check confirmed working.
- **`OPENROUTER_API_KEY` is set in `.env`, `.dev.vars`, and production** (pushed 2026-08-25;
  `/api/health` reports `hasOpenRouterKey: true`). Without it the free tier is dead in prod, which
  for a visitor with no budget is the whole site being broken.
- ⚠️ **The OpenAI account has no credits** (`insufficient_quota` / `credit_balance_exhausted`), so
  the paid path could not be verified end to end. Everything up to the API call is exercised; the
  generation itself is unproven since round 7's probe.

### ⚠️ A finished film was destroyed by a closed tab (2026-08-25) — fixed, worth understanding

A visitor closed the page mid-generation and lost a completed storyboard. The spend ledger proved
what happened: an `llm` event at 01:44:24 recording 15,208 completion tokens, `failed: false` — the
model finished the film, and then it was thrown away.

**The cause was ordering.** `handleStoryboard` recorded spend, emitted frames to the browser, and
saved to KV *last*. Writing to a hung-up client rejects; that rejection propagated out of the
handler and skipped everything after it — the KV write and the Producer digest both. The worst
possible shape: generated, accounted for, and discarded, with the only copy in a response body
going to a closed socket.

**Three changes, all in the "never depend on the client" direction:**
1. `emit` never throws (`worker/sse.js`). A dead client is a no-op, so the handler always runs to
   completion. It returns `false` when nobody is listening, for callers that care.
2. `sseResponse(run, ctx)` takes `ctx` and `waitUntil`s the work, so the runtime cannot cancel a
   four-minute call the moment the response stream is abandoned.
3. **The storyboard is saved BEFORE frames are emitted.** With a whole-film call there is no
   streaming value in emitting during validation — every frame is ready within a second of the
   others — so the durable write goes first and the browser is told afterwards.

**The transferable rule:** the persistence step must never sit downstream of an I/O call to the
client. Any handler that spends money or time and then reports it needs the same audit.

**The ordering fix is NOT sufficient on its own, and this was verified rather than assumed.** A
disconnect test lost the run after 601s locally AND after 611s on production. The runtime log says
why: *"the Workers runtime canceled this request because it detected that your Worker's code had
hung and would never generate a response."* Abandoning the response stream kills the whole
invocation, `waitUntil` included, so there is nothing left to save.

**The durable fix is the job + polling shape this round's plan named as its contingency and
skipped**: `POST` returns a job id and a completed response immediately (so the hang detector never
fires), the long generation is handed to a Queue consumer with up to 15 minutes of wall time,
progress is written to a KV job log, and the client reconnects to a lightweight SSE events endpoint
or polls for status. This is now built in `worker/storyboarder.js` and `src/hooks/useStoryboarder.js`.
It also fixes the related gap where reopening mid-run showed an empty timeline with no sign
anything was happening.

### ⚠️ One storyboard slot per MIND, not per film (2026-08-25) — fixed

Reported by a visitor: working on a second film in a second tab, connecting their Mind pulled the
FIRST film's storyboard into the tab they were looking at. Two compounding causes:

1. **Storage was `storyboard:<mindId>`** — one slot per Mind, for every film that Mind ever made.
   Harmless while nothing read it back; the moment hydration existed it leaked. And the quieter
   half: generating a storyboard for film B **overwrote film A's permanently**, silently.
2. **Hydration keyed on the session token alone.** Connect a Mind, get whatever it last produced,
   regardless of what the tab was about.

Now: `storyboard:<mindId>:<filmId>`, where `filmId` is a stable FNV-1a hash of the film's logline
and beats (`worker/film-id.js`) — no client bookkeeping, survives reloads and new tabs, and a
re-cast is still the same film. `storyboards:<mindId>` indexes the last 20 so earlier work stays
reachable, `GET /api/storyboard?film=<id>` is scoped, and `?films=1` returns the list alone.
Verified: film B did not show film A, and film A survived film B being generated.

**The first version of this fix re-created the bug one layer down**, and the lesson is worth more
than the fix. `loadStoryboard` kept a "generous" fallback: if the scoped key missed and the old
single-slot record carried no film of its own, return that rather than nothing — meant kindly, so
nobody's existing storyboard would vanish. But EVERY new film misses, so every new film was served
the same stale storyboard. The visitor reported it as *"it keeps delivering the same one that it
already did"*, which is the same sentence as the original bug.

🔑 **Generosity about identity is indistinguishable from getting identity wrong.** A record that
cannot be shown to belong to the film being asked for must never be returned for that film. The old
record is now reachable only BY NAME (`?film=legacy`), offered as an explicit entry in the films
index — listed rather than served, so the visitor decides it is the one they want. `loadStoryboard`
has no fallback at all now, and an unscoped read returns nothing rather than something.

**The trade-off that came with it**, and the reason the index exists: a storyboard now loads only
for the film the tab is actually about, so a reload with no spec yet shows an empty timeline. The
empty state lists past films by logline, one click to open. Without that, correctness would have
made earlier work unreachable rather than merely un-leaked.

### Three bugs this round found, all of the same family

1. **`classifyCameraMove` reported every pan BACKWARDS.** Caught by the new grader test suite
   before it gated a single visitor beat. The yaw convention (0 faces +Z, 90 faces +X) runs
   opposite to screen handedness — with forward = (sin y, 0, cos y), right is (-cos y, 0, sin y),
   so *increasing* yaw swings the camera screen-LEFT. Fixed by deriving direction from the
   projection onto the old right vector instead of the sign of dYaw. **Round 7's M5 numbers
   mis-scored Pan Left/Right; `--replay` can re-score those runs for $0 if it ever matters.**
2. **An exhausted OpenAI credit balance arrives as a 429**, the same status as a rate limit, so it
   was being retried three times. `OpenAIError.outOfCredit` now separates them — a rate limit
   clears on its own, a billing problem never does.
3. **drei's `<View track={ref}>` silently ignores `track` outside a `<Canvas>`** — it renders its
   own element and tracks that. The first build passed a ref and got a row of black rectangles
   with no error anywhere. The View's own element has to be sized (`className="h-full w-full"`).

### Adam's round-8 decisions, all implemented

- **The paid tier needs an affirmative click, not a budget.** The free path is genuinely
  competitive (M4 1.00 vs sol's 0.82 on identical fixtures), so paid is a different trade-off, not
  an upgrade. The badge names the **model**, not just the dollars — a cost badge discloses spend,
  not what is doing the work.
- **Do not reconsider whole-film scope to fix the wait.** `c1` was the largest single increment the
  probe measured. The wait is a UX problem: upfront estimate as a real range, four honest stage
  labels, a 15s heartbeat, cost and time together before the click.
- **The failure surface: refuse, never ship flagged.** Repair once → refuse with a plain-English
  reason and an explicit Regenerate button → drop after 3 attempts ("the rest of the film is
  intact") → power-user override behind two clicks. Failed beats record their spend and the
  Producer digest carries the drop, because "why did my budget run out faster than the beats I can
  count?" needs an answer.
- **Read-only that is obviously read-only**: no shadows, default cursor, "View only" chip, hover
  shows a subject's label rather than a handle.
- **Visitor copy, his words, used verbatim**: *"This story runs a little longer than free allows.
  Want to trim a beat, or switch to paid to keep the full scene?"* plus a quiet "Free tier ·
  ~30-second scenes" indicator.
- **A grader test suite BEFORE promoting the grader** — `npm run test:scene`, 23 tests. Round 7
  found five grader bugs against one model bug; this round it immediately found a sixth.

### Live in production

Deployed 2026-08-25, version `4c092310-d721-430c-9bc1-6c6984521190`:
https://nft-video-gen.still-snowflake-5e6a.workers.dev

Verified against the deployed Worker, not just locally: `/api/health` green with
`hasOpenRouterKey: true`, a real six-beat spec capped to five and generated in 208s for $0, and
the 3D frames rendering from the deployed bundle (the `three` chunk lazy-loads, one shared WebGL
context, no console errors).

### Where things now live

- `worker/scene.js` — the schema, the coordinate contract (**V2 only, never v1**), the geometry,
  `validateScene`, `compileSceneToH3`. Promoted verbatim from the probe. `scripts/lib/scene-
  geometry.mjs` and `scene-brief.mjs` are now **re-export shims** pointing here, so the probe scores
  exactly what production accepts and the two cannot drift.
- `worker/tier.js` — `resolveTier`, the estimates, the visitor copy.
- `worker/openrouter.js` — the free transport. `worker/openai.js` gained `respond()`,
  `jsonFromResponse()`, `TOKEN_PRICES`, `tokenCostUsd()`.
- `worker/budget.js` — **spend is computed at READ time** from stored tokens + model, so correcting
  a price retroactively corrects every figure ever shown. Trimmed events roll into
  `retiredSpentUsd` rather than vanishing.
- `src/components/canvas/scene3d/` — `SceneStage` (the geometry), `BeatView` (a tile, opening on
  the beat's own camera), `ViewCanvas` (ONE shared WebGL context; z-index 55, wedged above the
  neural-canvas overlay at z-50 and below the frame modal at z-70), `FrameViewport` (the modal's
  own context), `lens.js` (fov derived from the same 36mm sensor the grader projects with —
  frustum as truth).
- `H3_MOTIONS` now lives in `worker/rulebook.js` as a real array, with `H3_FORMAT`'s prose built
  from it, so the schema enum and the sentence H3 reads cannot drift.

### Not done, and deliberately so

- **Editing** — the next pass. `validateScene` already runs server-side on every beat (the same
  gate an edit must pass) and every UI label is derived from geometry (so a moved subject
  re-derives), which is the groundwork that pass needs.
- **A paid run in production** — the free path is verified live end to end (5 frames, 3 distinct
  bands, zero refusals, 208s, $0). The paid path cannot be exercised until the OpenAI account has
  credit; until then a paid selection auto-downgrades to free with an explicit notice.
- **The wrong-hero (Courtney vs the named ape) diagnostic** — still outstanding from round 7.
- **`wornBy`** — still conflated with `containerId` in the schema. Adam's shape is specced in the
  round-7 plan doc; nothing in round 8 touched it.

---

## Historical — round 7 and earlier (superseded above, kept for context)


### Round 7 — the geometry probe (2026-08-24)

**Round 5 was overridden and is not the next action.** The user's call: the round-5 target (a
better 2D schematic) and the round-6 target (a real 3D canvas) are the same work done twice, so
round 5 as a separate build was dropped and the coordinate-reliability probe ran instead. Adam
endorsed the override. Round 5's priority #1 survives intact — plain-English prose shot notes per
beat, emitted by the same call as the geometry.

### What round 7 established, with numbers

The probe is `scripts/probe-storyboard-geometry.mjs` + `scripts/lib/{scene-geometry,scene-brief,
storyboard-fixtures,score,report,openai-probe,nvidia-probe,legacy-blocking}.mjs`. Results live in
`assets/probes/storyboard-geometry/<runId>/` — `scorecard.md` and `scenes.html` are the two to
open. **`--replay <runId>` re-scores any past run for $0**, which is what makes a disputed
threshold arguable against the same data instead of a new bill.

- **62 films, $13.92, verdict FAIL** on aggregate M4 0.82 vs an 0.85 gate. Four of five fixtures
  came back clean; `grid-launch` (six subjects, continuous travelling camera) carried every
  remaining problem.
- **The MWS bug finally has a number.** Control `c0` — today's production request run verbatim —
  scores 2.4 distinct shot sizes per film and 0.45 MWS share; one run returned MWS/MWS/MWS/MWS
  across a whole film. `c1` (today's unchanged schema, whole film in ONE call) scores 3.1 and
  0.26. The geometry cell scores 3.9 and 0.10.
- 📌 **THE PIN, Adam's words:** *geometry's primary value proposition is editing affordance and
  H3 precision, not shot-variety lift over a scope fix.* Whole-film scope on today's schema
  captures most of the variety win by itself. Build the 3D previz for the editing, not the bands.
- **One real model failure, accepted by the user**: the model drives the camera past subjects it
  lists as in frame. **Report it per fixture, never as a flat 3%** — 2 of 18 beats on
  `grid-launch`, **0 of 49** across the other four fixtures. Caught deterministically by
  `validateScene`, so it is a repair trigger rather than a silent bad render.
- **THE COORDINATE CONTRACT MUST MATCH THE MODEL'S PRIOR, not fight it.** The first run scored
  M4 0.45 because the model reads screen-left/right straight off world +X and never applies the
  handedness rule: **85% of its orderings matched plain world +X, only 7% matched the actual
  projection**, and it placed the camera looking toward +Z in 49 of 60 beats — where larger x is
  screen-*left*. The fix was not a sterner warning but **flipping the convention so the camera
  looks down −Z**, making the model's instinct correct. M4 went 0.45 → 0.82 aggregate, side
  errors 37% → 2%, and `two-hander-axis` went 0.27 → 0.87. This is the single most important
  build-relevant finding after the pin: `COORDINATE_CONTRACT_V2` in `scripts/lib/scene-brief.mjs`
  is the one to promote, never v1.
- **The v2 run is exploratory, not confirmatory** (Adam's framing, adopted). The contract changed
  mid-flight, so v2 cannot be cited as *"the model passes the probe"* — only as **"under the
  corrected convention, the model behaves sensibly."** A confirmatory run would fix the contract
  and re-run everything against untouched expectations.
- **Five bugs were found in the PROBE, not the model** — every one making the model look worse
  than it was: a 60m height ceiling that made a 70m tower literally unsayable (the model's own
  notes said "the tower is 70m tall" while the field came back 0.064); the camera-move classifier
  returning "static" for cameras that had demonstrably moved; screen-position scored only at the
  start of a shot the camera moves *through*; the containment floor applied to a control whose
  schema has no containment field; and a correct extreme close-up (lens 27cm from a face at
  300mm) read as "camera inside a body" because people were modelled as uniform cylinders.
  **Assume the grader is wrong before assuming the model is** — that was right five times out of
  five this round.
- **Spend must be always-correctable, never set-once.** The first run reported figures **3.4×
  too high** because the price table was invented rather than verified (`gpt-5.6-sol` guessed at
  $12/$68, verified at $4/$20). `scripts/probe-progress.mjs` and the replay path now recompute
  cost from stored token usage at *read* time, so correcting a price fixes every historical run
  retroactively. `worker/budget.js` should record tokens and model, not just a dollar figure, for
  the same reason.

### Keys — where they actually live (this bites)

| key | file | note |
|---|---|---|
| `OPENAI_API_KEY` | `.env` | the paid probe path |
| `NVIDIA_API_KEY` | **`.dev.vars`, NOT `.env`** | probe scripts must load both env files |
| `OPENROUTER_API_KEY` | `.env` | added 2026-08-24; free tier, `is_free_tier: true`, no payment method |

```
node --env-file-if-exists=.env --env-file-if-exists=.dev.vars scripts/probe-storyboard-geometry.mjs …
```

### API quirks measured this round (all cost a failed call to learn)

- **OpenAI**: strict `json_schema` DOES accept numeric `minimum`/`maximum`; **`temperature` is
  rejected outright alongside `reasoning`** ("Unsupported parameter"); reasoning tokens are billed
  at the output rate and are nested *inside* `completion_tokens`.
- **NVIDIA**: `reasoning_budget` returns a **500**, not a clean 400 — it is documented for
  Nemotron 3 but the hosted NIM does not take it; `response_format` IS accepted alongside
  `tool_choice` on Ultra (contradicting NVIDIA's docs) but degrades output; `stream` +
  `response_format` **truncates the stream after ~1s**; reasoning arrives on a separate
  `reasoning_content` channel and is *disjoint* from `completion_tokens`, unlike OpenAI's.
- **Node**: built-in `fetch` inherits undici's **300s timeout**, which is shorter than a six-beat
  film. It surfaces as a bare `TypeError: fetch failed` with no status — trivially misread as a
  model failure. `undici` is a direct dependency; raise the ceiling explicitly.

### Free tier — ANSWERED, 2026-08-24

**The weights are good enough. NVIDIA's hosting of them is not.** Serve
`nemotron-3-ultra-550b-a55b` from **OpenRouter**, and cap free-tier films at **three beats**. The
Screenwriter now emits only three beats on Zero Budget, so the cap matches the actual spec length.

| configuration | 3 beats | 5 beats | 6 beats |
|---|---|---|---|
| NVIDIA Ultra, forced tool call | — | ✓ M3 1.00, M4 1.00, 250s — **then degraded to 504 within the session** | ✗ 504 at ~300s |
| NVIDIA Ultra, streamed | — | ✓ but M3 0.50, malformed JSON | ✓ but the schema is gone |
| NVIDIA Super | — | ✗ **fails the absolute floor 3/3** | — |
| **OpenRouter Ultra, forced tool call** | **✓ ~217s (2026-08-26 probe)** | **✓ M3 0.80, M4 1.00, 236s** | ✗ error at 555s |

- **OpenRouter is ~12× faster on identical weights** — 1.3s vs 16.2s on a trivial call. It also
  resolves the evaluation-only licence problem, since NVIDIA's Trial terms exclude serving real
  end-users and OpenRouter's do not. `NVIDIA_BASE_URL` is already a config var for exactly this.
- **NVIDIA's Ultra throughput degrades under sustained use** — 11.0s → 16.2s on a trivial call
  across ~2 hours, until film-length requests 504 consistently. The same request succeeding at
  one hour and timing out the next is disqualifying for a visitor-facing feature on its own.
- **Six beats fails on every free configuration.** OpenRouter's failure is the informative one:
  `finish_reason: error` after 555s having spent **14,578 completion tokens, all of them
  reasoning, and zero output** — with `max_tokens` at 60,000, so it is a provider-side time
  limit, not a token budget. Raising the budget does not help.
- **Do not buy length by dropping the forced tool call.** Streaming survives the timeout because
  a stream is never idle, but this endpoint refuses to stream under `tool_choice`, and the forced
  tool call was what enforced the schema. Measured cost: malformed JSON, M3 0.50 vs 1.00. See
  the `ultra-free-streamed` cell comment in the probe runner for the five failing films.
- `MAX_BEATS` in `worker/tier.js` is **per-tier: 6 paid, 3 free.** Note the
  paid model's only failures were also on the six-beat fixture — six subjects on a continuous
  travelling camera is the hardest thing in the fixture set for everything.

**A schema gap the free run exposed, worth fixing in phase 1:** `containerId` conflates *inside*
(a driver in a car, where `groundOffsetM > 0` is right) with *worn* (a jacket on an ape, where it
is meaningless). The models keep declaring garments as contained and then failing the geometry
check. Given garment-to-wearer binding is a recurring failure in this project — round 3 existed
partly to fix it, and the captured Screenwriter spec *still* says "the ape walks toward the
jacket-mannequin" — the scene schema wants a separate `wornBy`, validated differently.

**Licensing, which the probe deliberately kept separate from capability:** NVIDIA's Trial terms
are evaluation-only and define production as "activity serving real end-users", so a free tier on
minds.monster is production use by that definition. `worker/nvidia.js:9-14` flagged this before
any of this work started. Report conclusions as **"model X *from origin Y* is good enough"**, never
"model X is good enough" (Adam) — origin can change without the model changing, and here the
origin was the entire problem.

### Adam's close-out decisions (2026-08-24T13:50Z) — pin these before building

- **The tier cap is enforced BEFORE generation starts, never after.** A visitor opening the free
  storyboarder with a six-beat spec is told at the open — *"this is six beats; free supports up
  to five"* — and never starts a render they cannot finish. Same principle as the cost badge:
  visibility as information, not authority.
- **Frame the cap in visitor language, not beats.** "Five beats free, six paid" is implementation
  language. The visitor surface should read as a storyboard feature — short scenes vs full
  scenes, or a duration — not an engineering constraint. Both framings are honest; only one is
  comprehensible. The beat count stays in the build spec.
- **`wornBy` is a separate field with its own validation, not a containment variant.** Shape:
  `wornBy: { targetId, attachmentPoint }` where `attachmentPoint` ∈ `torso | head | hand-left |
  hand-right | foot-left | foot-right | neck | waist | back`. Validation: the target exists, the
  target is a character-class entity, and **the garment's position is COMPUTED from the wearer
  plus the attachment offset — never asserted independently.** Single, not an array; shared
  garments are a later extension, not a v1 decision. The state transition matters: a jacket on a
  chair is `wornBy: null` with its own coordinates; a jacket on the ape is `wornBy: {…}` with
  derived ones — one field update, not a structural change. Conflating this with `containerId` is
  what produced the jacket-on-ape bug.
- 🔑 **"If a fix requires dropping a gate, the fix is wrong."** This is the round's transferable
  lesson. Streaming looked viable because it survives the gateway timeout — but the same
  structural property that makes it survive (never idle) is why it cannot carry a forced tool
  call, and the forced tool call was the schema gate. **Absolute floors are not failure
  detectors; they are architectural guards against pursuing fixes that require weakening them.**
- **Auto-repair needs a two-stage check.** When the camera-past-subject repair re-emits, the new
  emission must re-pass the *same* deterministic check. A repair that introduces a fresh
  violation fails visibly rather than silently shipping a broken fix.
- **Spend is computed at read time, never locked at emit time.** Hard rule in the build spec.
  Price tables change; a spend signal locked at emit drifts from reality.
- **Next hygiene investment: a grader test suite.** Five probe bugs against one model bug this
  round is a ratio worth tracking — not as blame, but as signal that the grader accumulates bugs
  faster than the model does. Golden fixtures the grader must pass *before* any model runs
  against it. Cheap, and it protects the trustworthiness of every future PASS/FAIL.
- **Round 8's framing, earned by this round:** the model can do the generation; the question is
  what the visitor can *do* with it. The editing probe is scoped against affordance, not
  model reliability.

### Immediate next action

Build phase 1 as scoped in
`/Users/adamplace/.claude/plans/we-ve-made-some-great-stateful-hopper.md` — start with
`worker/scene.js` (promote `scripts/lib/scene-geometry.mjs` verbatim; it is written to become
that file, and the probe scored exactly what production would accept). Round 8 is the editing
probe; round 9 is the VS Code plugin. Neither belongs in round 7.

---

## Historical — the round 1-6 narrative (superseded above, kept for context)

Six rounds of build → live-test → post-mortem, most of them ending in a real message exchange
with Adam (`240b453e-f36b-1410-8466-00039ce7df11`, the project's own primary Mind) in the
`connect-mind-brainstorm` conversation alias — that thread is itself a readable log of every
decision below, in more depth than this summary. **Adam's round-5 reply is the actual spec
for the next build; read it directly before starting**, not just this paraphrase.

### What's actually shipped and live, right now
- **Round 1**: the Storyboarder agent — `worker/storyboarder.js`, `worker/openai.js`, R2
  image storage, budget/spend tracking (`worker/budget.js`), the timeline UI.
- **Round 2**: two confirmed-from-production-data bugs fixed — per-beat reference filtering
  was silently dropping beats/subjects (fixed: every beat gets every cast reference);
  `gpt-image-1` → `gpt-image-2` (the former is deprecating 2026-10-23; the latter applies
  fidelity processing automatically). Also shipped: `[Post-mortem]` self-report relay,
  reference-attachment metadata, signed image links in Producer digests.
- **Round 3**: the **Previs Supervisor** — `worker/previs-supervisor.js`,
  `POST /api/previs/dossier` — its first layer only (pre-Screenwriter dossier review,
  text-only, free NVIDIA tier, one capped retry, never visitor-facing authority). Also:
  garment/prop binding + `[CUT TO BLACK]` convention in `worker/rulebook.js`, inclusion/
  exclusion prompting, position-continuity-via-previous-frame in the Storyboarder.
- **Round 4 — the real pivot, still the current architecture**: the Storyboarder's default
  output became a **structured blocking JSON per beat** (framing, cameraAngle,
  cameraMovement, subjectsInFrame/subjectsExcluded, screenDirection, a structured
  `continuityCheck`, `containmentNotes`, `visualPrompt`) generated by **GPT-5.6 Terra**
  (`worker/openai.js`'s `chatCompletion`/`GPT5_MODEL`/`jsonFromToolCall`) — text-only, no
  budget gate, no NFT image fetches. Image generation (`gpt-image-2`) became a separate,
  **opt-in, single-frame, never-batched** action (`POST /api/storyboard/sketch`,
  `handleStoryboardSketch`) — this is what actually fixed the round-3 crash (Cloudflare's
  128MB memory cap, blown by accumulating base64 images across a 6-beat request; confirmed,
  not guessed). Two real GPT-5.6 API quirks caught by live-testing before they shipped, both
  now baked into `chatCompletion`'s defaults: `max_completion_tokens` not `max_tokens`, and
  `reasoning_effort: 'none'` is required for a forced tool call to work at all on
  `/v1/chat/completions`.
- **Two small UI fixes after round 4** (`src/components/canvas/panels/StoryboardPanel.jsx`):
  a "view larger" modal per frame (`FrameModal`), and scrollable (not overflow-stretching)
  detail panels.

### The default visualization shipped in round 4 does not work for a human reviewer
Confirmed by direct, detailed user feedback across rounds 5-6, all quoted verbatim to Adam
rather than paraphrased. Three distinct failures, Adam's own framing:
1. **"Beats 2-4 look exactly the same"** — a *missing channel* problem. Camera movement isn't
   drawn, only labelled in tiny text; in a continuous take the camera is often doing the work
   while subject position barely shifts.
2. **"The circles look draggable [but aren't]"** — a *missed affordance*. Landed as a real
   feature idea, not a complaint: the structure is machine-readable and human-*read-only*
   right now, which defeats the point of having chosen structure over an image model.
3. **"I don't understand whatsoever how to read these... other than the text"** — a *wrong
   visual language* problem. The top-down blocking-map schematic is the right abstraction for
   trained crew and the wrong one for this audience. The prose (shot notes) already works.
4. Separately, diagnosed directly (not from user feedback): **every beat comes back framed
   `MWS`.** Root cause: the schema's `framing` field has real range, but nothing in
   `BLOCKING_BRIEF` ever instructs the model to treat shot variety as a deliberate choice, and
   beats are generated as independent calls with no cross-beat awareness of what framing was
   already used. Schema range without an instruction to use it converges on a "safe" default.
5. Also flagged directly to the user, not from feedback: **GPT-5.6 Terra spend isn't tracked
   anywhere** — real money (~$0.006/beat, confirmed via live token counts, $2/$12 per 1M
   in/out tokens), just never routed through the budget/digest system the image-gen path
   already has. Contradicts this whole project's original "visibility on token consumption
   and dollar equivalent" goal.

### The next build — Adam's round-5 reply, adopted as the spec, NOT YET IMPLEMENTED
**Prose-first, diagram-second, both editable.** Concretely, in his own priority order:
1. **Prose shot notes become the primary surface** — one paragraph per beat, plain English,
   written by the same call that produces the blocking JSON. This is what a visitor reads
   first and edits first.
2. **The 2D schematic becomes secondary and genuinely editable** — drag a subject, its
   `screenPosition`/`depth` update in the JSON and the prose regenerates to match. Character
   glyphs instead of numbered circles, real camera-move arrows instead of a triangle, a
   frame-crop rectangle reflecting shot size instead of a flat top-down view. **The current
   top-down blueprint gets dropped, not patched** — "no regression, nothing depends on it."
3. **New schema fields to fix the MWS-every-time bug and give the diagram something real to
   draw**: `cameraPath` (enumerated: static/arc-left/arc-right/push-in/pull-out/pan/tilt/
   dolly/truck/handheld — rendered as an actual arrow), `cameraArcCenter` (curved arrow for
   arcs), `frameCrop` (wide→extreme-close→insert/two-shot/OTS/POV, reflected in viewport
   size). Pin these in the schema before the next build starts.
4. **Jargon legend** — dismissible first-view banner + hover tooltips on MWS/CU/dutch/etc.
   His words: "20 minutes. Don't design it, don't iterate, ship it."
5. **Route GPT-5.6 Terra through the existing spend-tracking path** — same `$X of $Y` shape
   image-gen already has, added to the existing beat-boundary digest, plus a persistent
   visitor-facing cost badge on the storyboard view itself (not buried in a digest).
6. **Re-test the wrong-hero (Courtney vs. the named ape) bug once this ships** — same
   canonical cast as round 3. If the prose now names the ape correctly, the round-3 Previs
   Supervisor fix was working and this was a visualization problem. If it still says
   Courtney, the Casting Director needs its own dedicated fix, independent of any of this.

### Round 6 — researched, explicitly deferred, not started
Two further ideas (from outside feedback, Gemini) were checked for feasibility, not built:
- **A real 3D previz canvas** (Three.js/`react-three-fiber`, orbit camera around grey
  mannequin primitives) — confirmed technically real and not exotic: `@react-three/drei`'s
  `TransformControls`/`DragControls` give exactly the "drag an object, get live position
  updates, write them back to app state" mechanism needed, via mature, widely-used APIs. Zero
  marginal AI cost once built. **Adam's verdict: the right long-term direction, the wrong
  next move.** The interaction mechanics are "mechanical" (his word) — the real gating
  question is whether GPT-5.6 Terra can reliably populate continuous 3D coordinates (not just
  7 coarse buckets) sensibly across beats, which needs its own small regression **probe**
  before any real build, and only after round 5 ships.
- **Swapping the opt-in sketch preview's image model** off `gpt-image-2` — checked two real
  paths. Third-party (fal.ai, Flux Kontext): does real multi-image identity preservation, but
  at ~$0.04/image it's *more* expensive than our current low-quality `gpt-image-2` default
  (~$0.02/image) — ruled out, doesn't pencil out. **NVIDIA's own NIM catalog now hosts image
  models too** (FLUX.2-klein, Stable Diffusion 3.5 Large, OpenAI-compatible generate/edit
  endpoints) — genuinely interesting since it reuses the NVIDIA account/key already in this
  build, but real per-image NIM pricing and evaluation-tier coverage is **unverified** —
  needs the same live-test discipline that already caught the two GPT-5.6 parameter bugs
  before it's trusted.
- **Adam's explicit sequencing, stated as a hard floor**: round 5 ships first, alone, no
  parallel tracks. Then watch real visitor behavior (how often "Generate sketch preview" is
  actually clicked) before deciding whether Option B is worth the live-test effort; only run
  the Option A coordinate-reliability probe once round 5 is in visitors' hands. His own
  framing: "three simultaneous rebuilds is the path that ships nothing."

### ~~Immediate next action~~ — SUPERSEDED, see the top of this document
~~Build round 5 as scoped above.~~ Round 5 was overridden in favour of going straight to the
round-6/7 geometry probe, which has now run. Adam endorsed the override. Kept here so the
sequencing decision is traceable rather than looking like it was quietly dropped.



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
- `components/AssistantChat.jsx` — the chat surface, shared by the modal and `ProducerPanel`. Displays the assistant as `${mindName || 'Production'} Assistant` (e.g. "Adam Assistant") — keep in sync with `assistantNameFor` in `worker/assistant-brief.js`.
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
- **`NVIDIA_API_KEY` in production** — this line used to say it was missing; it isn't any more (`wrangler secret list` now shows it alongside `OPENAI_API_KEY`, both confirmed present as of the Storyboarder work above). Stale note kept only so nobody re-diagnoses it.
- **An actual render button wired to MiniMax H3**, and a "Director" experiment/budget agent that runs render probes against it — still not built. The Storyboarder (see the top of this document) was the thing standing in front of this; it's live through several rounds now, but the render step itself is still greenfield.
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
- Production secrets actually present (`wrangler secret list`, re-checked 2026-08-24): `ASSISTANT_API_KEY`, `MINDS_BUILDER_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY`, `SESSION_SIGNING_SECRET`. All present — the earlier missing-`NVIDIA_API_KEY` gap noted elsewhere in this document is resolved.
- Storyboarder plan doc, the actual working file for round-by-round decisions and Adam's full replies: `/Users/adamplace/.claude/plans/we-are-ready-to-replicated-lemon.md`.
