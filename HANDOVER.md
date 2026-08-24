# Connect Mind / Producer — Handover

## Start here — ROUND 8 IS BUILT (2026-08-25)

Both storyboard tiers are live locally, generating world-space scene graphs and rendering each
beat as an interactive 3D frame. **Display-only by design** — dragging a subject is the very next
pass, deferred by one step so the JSON-to-3D path is proven before anything writes back through
it. (Adam proposed a two-week ceiling on that gap; the user rejected the timeline as far too slow.
Editing starts as soon as this lands.)

Plan doc: `/Users/adamplace/.claude/plans/we-are-ready-to-sharded-pony.md`. Adam's full round-8
reply is in `connect-mind-brainstorm`, sent 2026-08-24T15:08Z, replied 15:12Z.

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

- **free** → `nvidia/nemotron-3-ultra-550b-a55b:free` **on OpenRouter**, forced tool call, 5 beats.
- **paid** → `gpt-5.6-sol` via `/v1/responses` at high effort, strict `json_schema`, 6 beats.

### What was measured this round, with numbers

- **A Cloudflare Worker CAN hold a ~390s outbound fetch.** This was the single biggest unknown in
  the build and the reason a KV-job + polling fallback was specced. It is not needed: `wrangler
  dev` held the whole call with SSE heartbeats flowing every 15s. **Still unverified on the
  deployed Worker** — check this before trusting production.
- **Free tier, run end to end: 4 distinct shot sizes across 4 shots** (EWS/CU/WS/MCU), zero floor
  violations, zero refusals, $0, 403s. The `c0` baseline this had to beat was 2.4 bands / 0.45 MWS
  share. The MWS bug is fixed in production, not just in a probe.
- **The repair path fired for real** on a later run: beat 5 breached the floor, one targeted repair
  ran, and the repaired emission re-passed the same check. Two-stage check confirmed working.
- **`OPENROUTER_API_KEY` is in `.env` and now `.dev.vars`. It is NOT yet a production secret** —
  `wrangler secret put OPENROUTER_API_KEY` before deploying, or the free tier is dead in prod,
  which for a visitor with no budget is the whole site being broken.
- ⚠️ **The OpenAI account has no credits** (`insufficient_quota` / `credit_balance_exhausted`), so
  the paid path could not be verified end to end. Everything up to the API call is exercised; the
  generation itself is unproven since round 7's probe.

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
- **Production deploy** — not pushed. Needs `wrangler secret put OPENROUTER_API_KEY`, then a
  re-check that the long fetch survives the real edge.
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
`nemotron-3-ultra-550b-a55b` from **OpenRouter**, and cap free-tier films at **five beats**.

| configuration | 5 beats | 6 beats |
|---|---|---|
| NVIDIA Ultra, forced tool call | ✓ M3 1.00, M4 1.00, 250s — **then degraded to 504 within the session** | ✗ 504 at ~300s |
| NVIDIA Ultra, streamed | ✓ but M3 0.50, malformed JSON | ✓ but the schema is gone |
| NVIDIA Super | ✗ **fails the absolute floor 3/3** | — |
| **OpenRouter Ultra, forced tool call** | **✓ M3 0.80, M4 1.00, 236s** | ✗ error at 555s |

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
- `MAX_BEATS` in `worker/storyboarder.js` should become **per-tier: 6 paid, 5 free.** Note the
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
