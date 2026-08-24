# Round 9 — making the cast real in the previz

**Status: not started. This is a probe plan, not a build.** Round 8 is built and live; see
`HANDOVER.md` for that. This document is the next question and how to answer it.

---

## The question

The 3D storyboard frames work — every beat is a real camera view with real geometry — but every
character in them is a **grey capsule**, and every vehicle is a **grey box**. That is not laziness
in the renderer; it is the only honest thing it can draw, because `DOSSIER_SCHEMA`
(`worker/casting-director.js:30`) describes how a piece *looks* and nothing about what it *is* in
space:

| the dossier knows | the dossier does not know |
|---|---|
| `subject`, `identityMarkers`, `palette` | how tall it is |
| `medium`, `framing`, `cropAdvice` | whether it is a biped, a quadruped, a vehicle, a building |
| `burnedInText`, `isMannequin`, `hazards` | how deep it is, what its silhouette is |

So the storyboarder **guesses** `heightM` and `widthM` for every subject. That is not only a
cosmetic problem: `hFrac = heightM · focalMm / (zCam · sensorHeightMm)` decides every framing band
in the film. A guessed height is a guessed shot size.

**The round-9 question:** what is the cheapest representation that makes a visitor say *"that's my
ape"* when they look at a beat — and what does each option actually cost, given the AI resources
this project has today?

## Licensing is settled — do not re-raise it

Recorded because it will otherwise be re-litigated by whoever reads this next. Generating a 3D
derivative of licensed NFT artwork is **not a blocker here**. The user's position, verbatim in
substance: *the entire point of this endeavour is to technically fix this kind of thing*, and this
is built for an **Animoca Brands hackathon** — the people who persuaded brands like Lamborghini to
issue NFTs in the first place. Attribution is the product, not the obstacle. Treat rights handling
as a feature to design (every derivative traceable to its source piece), never as a reason to stop.

## What we actually have — measured 2026-08-25, not assumed

This is the half that changes the plan, and it was checked rather than guessed.

| resource | state | what it can do for this round |
|---|---|---|
| **OpenRouter** (`OPENROUTER_API_KEY`) | live, 417 models | **7 free vision models**, including `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` — **the exact model the Casting Director already runs** (`CASTING_MODEL`), free, and ~12× faster from this origin than NVIDIA's own. Also `google/gemma-4-31b-it:free`, `thinkingmachines/inkling:free`. |
| **OpenRouter, image output** | 11 models | `google/gemini-2.5-flash-image` and `gemini-3.1-flash-image` at fractions of a cent; `openai/gpt-5-image`. Enough for clean cutouts and multi-view impostors **without** OpenAI credit. |
| **OpenRouter, image→3D** | ❌ **ZERO** | Searched the full catalogue for 3d/mesh/tripo/hunyuan3d/rodin/meshy: **nothing**. The mesh path cannot come from this key. |
| **RunPod** (`RUNPOD_API_KEY`) | ✅ **live and authenticated**, 0 serverless endpoints deployed | The realistic mesh route: deploy an open image-to-3D model (TripoSR / InstantMesh / Hunyuan3D-class) as a serverless GPU endpoint, billed per second. Nothing is deployed yet, so this is real work, not a config change. |
| **OpenAI** (`OPENAI_API_KEY`) | ⚠️ **out of credit** (`credit_balance_exhausted`) | Blocks `gpt-image-2` AND the paid storyboard tier. Everything below is designed to need none of it. |
| **NVIDIA** (`NVIDIA_API_KEY`) | live | Evaluation-only terms — fine for probing, not for serving visitors. See `worker/nvidia.js:9`. |
| **MiniMax** (`MINIMAX_API_KEY`) | present | The eventual render target (H3), not a cast-representation tool. |

**The headline:** the analysis and impostor paths are **free or near-free today**. The mesh path
needs a GPU endpoint stood up on RunPod. That asymmetry should drive the probe order.

## The three candidates

### A. Physical profile — cheap, and the only one that improves correctness
Extend the dossier with `bodyPlan` (biped / quadruped / vehicle / aircraft / object /
architecture), a real-world height range, head-to-body ratio, and silhouette features. Build the
wireframe from proportioned primitives instead of one capsule, tinted by the existing `palette`.

Costs essentially nothing — the Casting Director is already looking at the image, and dossiers are
cached permanently by `assetKey`, so it is one call per piece, ever. **It is the only option that
makes framing more correct rather than only better-looking**, because it replaces a guessed
`heightM` with an observed one. It also improves both other options, so it is pre-work, not a rival.

**Architectural pin (Adam): the physical profile is a DOSSIER field, not a renderer field.** The
dossier is already the source of truth for what a piece is, it is already cached permanently per
asset, and three consumers read it — the Screenwriter plans prose with the height, the storyboarder
computes `hFrac` with it, the renderer picks primitives from the body plan. One field set, three
consumers, zero drift. Splitting it between dossier and renderer would guarantee they disagree.

**Rollout decision to make before A ships: backfill.** Existing dossiers have no physical profile;
new ones will. Adam's instinct, adopted unless the user disagrees: **one-shot backfill of the whole
library**, because a half-fixed library is worse than either a fixed one or an untouched one, and
the value compounds across every existing piece. The probe only tests new-asset behaviour; the
rollout is the thing that needs this answered.

**A ships without a probe.** It is a schema extension with a hand-labelled check (H1/H2), not an
experiment. B is the probe. C is contingent on B.

### B. Billboard impostors — the actual artwork, standing in the scene
Texture the real NFT image onto a camera-facing quad at the subject's true height. The pixels are
already fetched (`castingStills`, `fetchImageAsDataUri`), and `cropAdvice` exists precisely to get
a clean subject out of a busy composition. Zero AI cost in the base version; a cheap image model
can cut the background where the piece has one.

Flat when orbited — but cardboard cutouts are a literal storyboard tradition, and it would be
*recognisably the visitor's piece* from the first frame.

### C. Image-to-3D mesh — the real thing
A textured GLB per cast member, cached in R2 by `assetKey` (same permanent-cache pattern as the
dossiers), loaded with `useGLTF` — three.js is already in the bundle. **One cost per cast member,
amortised across every beat of every future film with that piece.**

Three things the probe must actually measure rather than assume:
- **`medium` decides whether it is even meaningful.** A `flat-2d-vector` PFP has no back; the model
  will invent one. A `3d-render` or `photoreal` piece is a far better candidate. The dossier
  already knows which is which, so the shipped system chooses per piece — mesh where reconstruction
  means something, impostor where it does not.
- **Weight.** Five multi-MB GLBs in a browser already carrying three.js.
- **Static pose.** A T-posed mesh cannot "climb into a car". Fine for still storyboard frames,
  fatal for motion. Name the limit now.

## Attribution architecture — designed in from beat one, per Adam

Since licensing is settled as a non-issue, the work is to make attribution structural rather than a
compliance layer. Three things that are much harder to retrofit than to build in:

1. **Provenance by reference, not by copy.** The dossier holds the source reference (URL, content
   hash, asset id), and every derivative — an impostor's texture, a mesh's geometry — is computed
   *from* that reference rather than stored as a free-floating asset. This is what makes "every
   derivative traceable to its source" true by construction instead of aspirational.
2. **Traceability through the RENDER path, not just the asset path.** Each beat, each frame, each
   eventual animation frame carries the source asset it derives from. This is a per-frame metadata
   problem, so retrofitting means scrubbing every frame after the fact and accepting that
   everything before the retrofit is untraceable. Build it at beat one, not beat one hundred.
3. **Licence terms visible at casting time** — on the surface where the visitor picks pieces, not
   in a compliance dashboard they never open. Some pieces permit derivatives, some require
   attribution in output, some allow commercial use. A visitor should learn this while choosing,
   not after building a film around a piece they cannot use.

**And attribution appears in the visitor's experience of the work, not only in stored metadata** —
a badge or hover on a beat showing which piece a character comes from. That is what "attribution is
the product" looks like in practice, and it is the line between this and a compliance checkbox.

## Probe design

Same discipline as rounds 7-8: numbered hypotheses, deterministic metrics where possible,
`--dry-run` before spend, artefacts on disk, a verdict with numbers behind it.

**Fixtures:** real cast pieces already on disk in `.wrangler/state/v3/kv/DOSSIERS/blobs/`, chosen
to span the `medium` enum deliberately — at least one `flat-2d-vector` PFP, one `3d-render`, one
`photoreal`, one `trading-card`, one vehicle, one garment/`isMannequin`. The point is to find where
each representation breaks, not to prove it works on the easy case.

| # | Hypothesis | How it is measured |
|---|---|---|
| **H1** | A free vision model can produce a reliable physical profile | Height/body-plan against hand-labelled truth for each fixture. Absolute floor: never mislabels a biped as a vehicle. |
| **H2** | Real heights improve framing correctness | Re-run round 7's `scene-film` cell with observed heights instead of guessed, and compare M3 (framing self-agreement) against the stored 0.91 baseline. **This is the one metric that is already calibrated — use it.** |
| **H3** | An impostor is recognisable at tile size | Blind: show the tile and three candidate pieces, ask which it is. Human or judge, but recorded per fixture. |
| **H4** | Background removal is needed, and how often | Per `medium` band. A PFP on a flat field may need nothing. |
| **H5** | A mesh beats an impostor **at hero-shot scale**, not at tile size | The three-resolution ladder below. |
| **H6** | Mesh cost and latency per piece, on RunPod | Seconds and dollars per generation, plus cold-start, measured on a real deployed endpoint. |
| **H7** | Mesh weight is viable in the browser | GLB size, and frame rate with 5 loaded beside the existing scene. |
| **H8** | `medium` predicts mesh quality | Correlate H5's result against the dossier's own `medium`. If it holds, the hybrid rule is data-driven rather than a hunch. |

### The mesh bar — corrected by Adam, and the correction matters

My original bar was *"a mesh must beat an impostor at tile size or it isn't worth its cost"*. Adam's
pushback, adopted: **tile size is structurally unfair to the mesh.** The impostor *is* the source
artwork at tile size — literally the piece's own pixels cropped to `cropAdvice` — so it wins by
construction, and a mesh could only match it by becoming a more expensive impostor. That bar is one
no mesh can pass, which makes it a bar that decides nothing.

The bar belongs where structural information starts carrying identity:

| size | expectation |
|---|---|
| tile | impostor wins or roughly even — **by construction, not by merit** |
| quarter frame / slight orbit | roughly even; both now show some structure |
| **half frame / orbit three-quarters / hero shot** | **mesh should clearly win, or it is not worth its cost** |

The silhouette holding under orbit, proportions staying consistent, the back of the character
reading as the same character from any angle — none of that is visible at tile size, and all of it
is what the mesh is actually being bought for.

**And the thing being measured is recognisability, not appearance.** Adam's distinction, pinned so
the probe cannot drift: *a photoreal mesh that looks great but doesn't read as the cast character
fails; an impostor that looks slightly off but is unmistakably the cast character passes.* The
question is "is this my ape", never "is this pretty".

### Measuring recognisability — three layers, and they must agree

The one thing here that cannot be computed. Adam's methodology, adopted whole:

1. **Pixel-space similarity to source** — deterministic, automatic, every fixture. Render both
   representations at matched angles and compare against the `cropAdvice` crop of the source. This
   is the baseline that needs nobody's judgement.
2. **Blind identification by an LLM judge** — show the source plus several representations
   (impostor flat, impostor orbited, mesh flat, mesh orbited) and ask which is the same subject.
   This catches what pixels cannot: "looks like a person" versus "looks like THIS person".
3. **Blind A/B with real visitors** — the gold standard, run once per `medium` class rather than
   per fixture, to validate that the judge agrees with humans.

The defensible answer later is *"we measured it three ways, all three agree, and the numbers are
reported per class"*. No single layer is claimed to be sufficient.

**Per-class reporting is mandatory, not a preference.** "Mesh wins overall by 0.05" is a number
that hides the actual finding; "mesh wins for 3d-render at 0.85, impostor wins for flat-2d-vector
at 0.92" is the finding. The aggregate is the visitor-facing summary; the per-class table is the
design evidence.

**Cost ceiling:** H1-H4 should cost ~$0 (free vision + free/cheap image models). H5-H8 need the
RunPod endpoint; that stage is gated behind a `--dry-run` estimate and an explicit go-ahead, and
must not start until H1-H4 have reported.

### The probe VERIFIES the rule; it does not discover it

Adam's sharpest correction, and it changes the probe's shape. I had planned to design the probe "to
reveal a hybrid rule". That is the shape that produces false positives — **a probe built to reveal
what you already suspect will find it.** The disciplined version states the rule first and then
tests it against data.

**The rule, stated now, before anything runs:**

> Use a **mesh** when `medium` implies reconstruction — `3d-render`, `photoreal`.
> Use an **impostor** when it does not — `flat-2d-vector`, `pixel`, `trading-card`.

The discriminator already exists in the dossier. A flat 2D vector has no back, and a mesh model
will invent one; that is knowable without spending anything. The probe runs **both**
representations across **both** classes and reports per class, so the rule is either confirmed or
visibly refuted.

**The rule is hard-coded from the schema, never learned per asset.** No classifier picks the
representation. If a future round needs something more nuanced, the schema evolves — the probe does
not acquire judgement.

**Verdict shape:** a rule per `medium` band, with cost per piece and per-class recognisability
behind each choice. Plus an explicit "neither is worth it, ship the proportioned primitives from A"
outcome, which is a real result and not a failure.

## Order of work

1. **A first, alone.** It is nearly free, it improves shot-size correctness on its own (H2), and it
   makes B and C both better. It is the only item that is worth doing even if the probe kills the
   other two.
2. **B measured against A.** Cheap, no new infrastructure.
3. **C only after H1-H4 report**, and only with the RunPod endpoint stood up as its own piece of
   work with its own cost ceiling.

## Interaction with what round 8 just shipped

Cast assets are known **before** generation starts — they are per cast member, not per beat. So the
ghost frames could open with the real cast already standing on the grid from second one, with only
their *positions* provisional. The thinking display would then visibly be about *where the ape
goes*, rather than about what a capsule is. That is a genuine multiplier on the feature that just
landed, and it is an argument for doing this round next.

## 🔒 Architectural pin — do not lose the streaming capability

Adam's most emphatic point, and it is about protecting what round 8 just built rather than about
round 9. **Streaming under a forced tool call is non-negotiable architecture, exactly like the
schema gate.** The entire watch-it-think surface — reasoning from ~2s, wireframes assembling and
correcting themselves — exists only because OpenRouter permits it where NVIDIA's endpoint did not.
A future "let's simplify the streaming path" decision would silently take the whole UX with it.

His broader read, worth recording: a visitor watching a model's reasoning reshape a visual in real
time is likely to become a **project-defining pattern**, not a storyboarder feature — the same
shape applies to editing, and to the visual-representation work in this round.

**One correction to Adam's reply**, recorded because he was working from what he knew: he flagged
that "the persistence model still needs a home" before more per-asset data is layered on. That was
true when he last had the full picture, and it is **settled now** — round 8 keys storyboards per
film (`storyboard:<mindId>:<filmId>`) with a films index, after a visitor hit exactly the bug he
was worried about. The sequencing concern he raised is therefore already satisfied rather than
outstanding.

## Still open from round 8 — carried, not forgotten

- **A closed tab still destroys a run in progress.** Confirmed on production: the runtime cancels
  the whole invocation when the response stream is abandoned. Needs the job + polling shape.
- **The paid tier is unproven end to end** — OpenAI has no credit. Paid selection auto-downgrades to
  free with an explicit notice, so no visitor hits a dead end.
- **Editing** (drag a subject, insert a shot) — the immediate next build, deferred by one pass so
  the JSON-to-3D path was proven first.
- **`wornBy`** is still conflated with `containerId` in the scene schema.
- **The wrong-hero diagnostic** (Courtney vs the named ape) from round 7.
