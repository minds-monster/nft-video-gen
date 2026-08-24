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
  already knows which is which, so the shipped system could choose per piece — mesh where
  reconstruction means something, impostor where it does not. **That hybrid is the likely answer,
  and the probe should be designed to reveal it rather than to crown one winner.**
- **Weight.** Five multi-MB GLBs in a browser already carrying three.js.
- **Static pose.** A T-posed mesh cannot "climb into a car". Fine for still storyboard frames,
  fatal for motion. Name the limit now.

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
| **H5** | A mesh is recognisable AND better than an impostor at the same tile size | Same blind test, head to head. **If a mesh is not better at tile size, the mesh is not worth its cost** — the frames are small, and that is the honest bar. |
| **H6** | Mesh cost and latency per piece, on RunPod | Seconds and dollars per generation, plus cold-start, measured on a real deployed endpoint. |
| **H7** | Mesh weight is viable in the browser | GLB size, and frame rate with 5 loaded beside the existing scene. |
| **H8** | `medium` predicts mesh quality | Correlate H5's result against the dossier's own `medium`. If it holds, the hybrid rule is data-driven rather than a hunch. |

**Cost ceiling:** H1-H4 should cost ~$0 (free vision + free/cheap image models). H5-H8 need the
RunPod endpoint; that stage is gated behind a `--dry-run` estimate and an explicit go-ahead, and
must not start until H1-H4 have reported.

**Verdict shape:** not "impostor or mesh" but **a rule per `medium` band**, with the cost per piece
and the recognisability score behind each choice. Plus an explicit "neither is worth it, ship the
proportioned primitives from A" outcome, which is a real result and should not be treated as
failure.

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

## Still open from round 8 — carried, not forgotten

- **A closed tab still destroys a run in progress.** Confirmed on production: the runtime cancels
  the whole invocation when the response stream is abandoned. Needs the job + polling shape.
- **The paid tier is unproven end to end** — OpenAI has no credit. Paid selection auto-downgrades to
  free with an explicit notice, so no visitor hits a dead end.
- **Editing** (drag a subject, insert a shot) — the immediate next build, deferred by one pass so
  the JSON-to-3D path was proven first.
- **`wornBy`** is still conflated with `containerId` in the scene schema.
- **The wrong-hero diagnostic** (Courtney vs the named ape) from round 7.
