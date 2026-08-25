# Round 9, delivered — and what round 10 inherits

**Status: round 9 is BUILT.** `HANDOVER-ROUND9.md` was the probe plan; this is what came back from
running it. Round 8 and earlier are in `HANDOVER.md`.

The round asked one question: *what is the cheapest representation that makes a visitor say "that's
my ape"?* It ends with three answers rather than one, because the question turned out to contain a
hidden second question — **what is the asset FOR** — and that one changed the design more than the
original did.

**Cost of the whole round: $5.48.** 22 commits, 61 tests, nothing left running.

---

## What shipped

### A. The physical profile — dossier schema v5

`physicalProfile` on every dossier: `bodyPlan`, real `heightM`/`widthM`/`depthM`,
`heightConfidence`, `headRatio`, `silhouetteNotes`, `facing`
([worker/casting-director.js](worker/casting-director.js)).

Pinned as a **dossier** field, not a renderer field, exactly as the plan required: the Screenwriter
plans prose with the height, the Storyboarder computes `hFrac` with it, the renderer picks
primitives from the body plan. One field set, three consumers.

- [`castLine()`](worker/scene.js) carries the measurement into the model's own brief, so shot size
  is computed from an observed height rather than an invented one. Rule 2b tells it sizes are
  given, not chosen.
- [`validateScene(scene, { profiles })`](worker/scene.js) flags `height-contradicts-profile` —
  **SOFT** past 25% disagreement, **FLOOR** past 2×.
- `sourceImageUrls` recorded on the dossier: the provenance spine, and what lets any later pass
  find the same pixels again.

**It works and it is not cosmetic.** A sneaker came back at **0.12m** rather than a 1.8m default; a
cartoon astronaut at `headRatio` 4 rather than a realistic 7.5. Both are numbers that would have
silently wrecked a shot.

`scripts/backfill-profiles.mjs` is written and **not run** — dry run is the default, `--write` is
required. 48 older dossiers still have no profile.

### B. The card — and why it is computed rather than generated

The plan called for an AI cut-out. **Probed first, and it failed instructively:**
`google/gemini-2.5-flash-image` returned an opaque RGB PNG with **a checkerboard painted into the
pixels** — it had reproduced the visual *convention* for transparency as image content. $0.039 for
that.

So the cut-out is computed ([src/lib/castTexture.js](src/lib/castTexture.js)): a flat-background
piece has its background colour in its own corner pixels, and its subject is every pixel not
connected to the edge by a flood fill. **Free, ~70ms, exact — and incapable of fabricating.** The
fill is edge-connected rather than a global colour replace, so white eyes on a white field survive;
that case is pinned in `scripts/test/cast-texture.test.mjs`.

- [worker/cast-art.js](worker/cast-art.js) — resolves and caches a piece's artwork, served
  same-origin so the canvas is readable (a cross-origin image taints it and the pixels cannot be
  read at all).
- [Impostor.jsx](src/components/canvas/scene3d/Impostor.jsx) — the card at true height over a
  proportioned proxy from the profile. Two things, two claims: the card is identity and is only
  defined from the front; the proxy is volume and is true from every angle.
- `subjectAssets` on the storyboard record — makes a reloaded film render textured with no cast in
  hand, and is the provenance spine through the **render** path, which is the half that cannot be
  retrofitted.
- Schematic stays the default view; artwork is a toggle.

### C. The mesh — hosted, not self-hosted

**The premise everything was planned on was false, and it survived a plan, a design review and a
GPU deployment before anyone tested it.** The handover measured that OpenRouter has no image-to-3D
models — true — and that hardened into *"therefore it must be self-hosted"*, which does not follow.
Tripo3D, fal.ai, Replicate and Stability all host it. It was one search away.

The detour cost $0.078 and bought one durable lesson: **rembg silently handed the model a
rectangle** on two fixtures, and TripoSR duly reconstructed a rectangle. *Read the model's own
saved input before believing any mesh result.*

On the hosted API the same image that TripoSR turned to mush reconstructs cleanly.

- [worker/mesh.js](worker/mesh.js) — Tripo3D, $0.30 per textured mesh, `face_limit: 30000`
  (**3.8MB / 102k triangles** instead of 15.7MB / 500k, for slightly softer panel lines).
- **Generation is a job, not a held request.** The first version awaited the whole 56–107s task
  inside one response; the local server reloaded seven times in an afternoon and each reload
  abandoned a generation already charged for. POST writes the task handle down before anything can
  go wrong; GET collects it on a later short request.
- `scripts/backfill-meshes.mjs` — dry run default, refuses to start a batch it cannot finish.

### The cast inspector

`cast-inspector.html`, dev-only by construction (project root, so Vite serves it and the build never
includes it). Every piece: card, mesh, physical profile, film, and a strip of labelled probe meshes
**including the failures**. Clickable into an orbit viewer that **defaults to wireframe** — texture
hides geometry, and what these assets have to answer for is form.

It exists because every judgement in this round was otherwise checkable only by generating a whole
film or by taking a screenshot's word for it, which is a bad property for rules whose job is to
refuse things. It earned itself within a minute: the sneaker's `depthM` is visibly wrong (0.1m for a
shoe that is ~0.28m long).

---

## The gate: stated, confirmed, then overturned

**Stated before the probe**, per the plan's own discipline: mesh where `medium` implies
reconstruction, card where it does not.

**Confirmed by the failures**, which is the stronger result — `flat-2d-vector` became a smooth
invented body with the arms as bumps; `trading-card` became a paper-thin standee with the card's
reverse for a back. Both look plausible head-on and fall apart on orbit.

**Then overturned by Adam, and he was right.** He looked at the astronaut mesh the gate had refused,
said it was one of the best in the set, and that the disqualifying logic was wrong *because of its
purpose*: the mesh is not trying to be a faithful asset, it is a **blocking proxy for framing a
shot**. It should still sit behind x402 and the artist should still be paid — because it saves any
agent re-deriving it, and it derives from their work.

**The old reasoning was inverted.** It implicitly held that only a *faithful* derivative owes the
artist — that a partly inferred one is somehow less their work. Backwards. **Derivation creates the
obligation, not fidelity.** And the fabrication objection only bites if the asset *claims to be* the
artwork; a blocking proxy makes no such claim.

So `meshEligibility` became `meshDisposition`. **Nothing is refused.** The medium sets
`representation: 'blocking-proxy'` and `inference: 'low' | 'high'`, carried on the record, in the
list endpoint and on the served bytes as `x-inference`. A stated confidence beats a silent binary.
The dossier already had the vocabulary — `heightConfidence` is `known | inferred | unknowable`,
doing exactly this job for size.

The one thing a label cannot fix is a reconstruction of the **wrong subject**, which is why
`trading-card` keeps a caveat — about the subject, not about confidence.

---

## What the pieces themselves taught

### Video: a narrow win, not a general one

The adidas ape's still is a card, so the pipeline built a standee — but the token carries a 16.8s
film, and the Casting Director's own motion pass had **already described it**: *"the character model
rotates 360 degrees on a platform."* One frame of that turntable gives the character in the round.

Then the same trick on the D&G jacket, whose film pans around the mannequin, came out **worse** than
the still alone: 500px frames against a high-res still, lit completely differently, azimuths guessed.

> **Video wins when the still shows the WRONG THING** — a card, a busy composite, an occluded
> subject. **Video loses when the still is already a clean, high-res view of the right subject.**

So the discriminator is not *"does a film exist"* but *"is the still a good view of the subject"* —
which `framing` and `medium` already half-answer.

**The extra views must be REAL.** A generative model orbiting a still would look identical and be
fabricated — the same trap the gate exists to catch, moved one step upstream.

### Mannequins: scaffolding, removable from the source only

`isMannequin` has been in the dossier since round 1 as a warning, and nothing ever acted on it.

The jacket's mesh bakes the bust's head, hands and legs in as **one continuous surface** — visible
instantly in wireframe. It cannot be removed after generation because it was never a separate
object. It comes out of the **source**: a rectangle crop takes the head and legs; a **hue key** takes
the chrome neck inside the collar, because a rectangle cannot follow the edge of a garment.

**The colour is the intelligence, not the rectangle.** These busts are *designed* to be neutral and
separable, which is exactly why a colour rule works where a box does not.

And a correction I made mid-round: I claimed Tripo returns closed shells so no opening was possible.
Wrong — that lid was my own compositing onto white. Alpha **is** honoured. What governs it:

| input | result |
|---|---|
| opaque bg + opaque neck | the mannequin, reconstructed |
| opaque bg + **white** neck | clean jacket, collar capped with a lid |
| **alpha** bg + **alpha** neck | a real open collar — but a key wide enough for both ate the sequins |
| opaque bg + **alpha** neck | **collapses** to a flat slab |

The recipe is **both**: background to alpha by a flood fill from the edges, and the *enclosed*
scaffolding to alpha by a hue key. Each half is proven; the combination has not been run cleanly.

### Confidence is a property of regions, not of a mesh

Matrix Avatar #44 — dark figure, dark busy background, katana and shotgun. **The figure is
excellent**, including a real coat back, on the hardest still tried. **The weapons are extruded into
depth**: the blade lies in the image plane in the artwork and projects backwards past the figure in
the mesh. Single-image depth ambiguity at its purest.

So `inference: 'low'` is right about the body and **wrong about the props**. A medium can only ever
describe the whole thing, and the label just built inherits that limit. It also inflates the bounding
box in x and z — height-based fitting survives it, anything using width or depth does not.

---

## Measured numbers worth not re-deriving

| | |
|---|---|
| mesh, textured, `face_limit` 30000 | **$0.30**, 56–107s, 3.7–3.9MB, ~102k triangles |
| mesh at default face limit | 8.8–15.7MB, ~500k triangles — **not loadable in a beat tile** |
| AI cut-out (rejected) | **$0.039** per image, and it returns a painted checkerboard |
| computed cut-out | **$0**, ~70ms, exact |
| casting + profile + motion pass | **$0** (free vision tier) |
| self-hosted TripoSR | $0.00023/mesh, 4.2s — and produces blobs |

---

## Still open

- **48 dossiers have no physical profile.** `backfill-profiles.mjs` is written, free, ~45 min.
- **`wornBy` is still `containerId`.** Now load-bearing rather than tidy-up: a garment mesh with no
  wearer to attach to is an asset with nowhere to go, and "a jacket on a character" and "a driver in
  a car" are different relations.
- **The two-stage mask** (edge flood fill + enclosed hue key) is designed and unbuilt.
- **A full film has never been run end to end this round.** Every component is verified against real
  data in a real browser; the whole path in one go is not.
- **Licence/payment at casting time** — the surface moved under this round (`LicenseBadge` became
  `PaymentBadge`), so it was left alone.
- Carried from round 8: a closed tab still destroys a run in progress; the paid tier is unproven
  end to end; the round-7 wrong-hero diagnostic (**probably explained now** — the adidas film
  contains four different characters, Courtney among them).

---

## 🔒 Architectural pins that held

- **Streaming under a forced tool call** is untouched. Nothing in this round went near
  `streamFilmCall`.
- **The schema gate** is untouched.
- **The probe verifies the rule, it does not discover it.** Stated first, confirmed by data, and
  then overturned by an argument about purpose rather than by the data — which is the honest way for
  a stated rule to die.

---

## Adam's Mind on the round (2026-08-25)

Both open questions got real answers. Recorded here because the next round should start from them
rather than re-derive them.

### On the reframe — endorsed, with two refinements

> *"A mesh that derives from the artist's work is the artist's work even if it isn't faithful to
> their source… The label-not-binary shape preserves both things that matter: the artist gets paid
> (legitimacy), and the buyer knows what they're getting (transparency). A binary gate would have
> sacrificed one for the other."*

Two things it says must land before this ships:

1. **The artist's opt-out is a separate decision from the label.** A creator whose work gets a
   blocking-proxy mesh in a bundle they never approved should be able to refuse — and specifically
   to refuse *low-inference* derivatives, which means the x402 contract has to expose
   `representation` and `inference` **at purchase time**, not merely store them.
2. **The label must be loud, not buried.** In metadata the average buyer never sees it. On the
   bundle surface, three sentences, visible at purchase: *"Blocking proxy — derived from {source}
   but volumetrically reconstructed; back, sides and depth are inferred, not faithful."*

And its framing of why the trade is right, which is the sharpest version of the argument:

> *"The cost of the original gate was artists getting nothing for meshes that could have legitimately
> derived from their work. The cost of the reframe is buyers who don't read the disclosure… The
> second cost is real but fixable. The first was unrecoverable."*

### Q1 — provenance that survives a copy: **five layers, default-preserved, not unremovable**

A record label does **not** survive a copy; labels travel with records, not files. The answer is
layering, and the ceiling is honest:

| layer | survives a copy? |
|---|---|
| record label (`representation`, `inference`, source ref) | no — stops at the bundle |
| the same fields in the **GLTF `extras` block** | yes, strippable by deliberate edit |
| **geometry watermark** — modified-vertex pattern encoding the source ref | yes, survives format change |
| **SHA-256 of the source reference** in the GLTF | yes, verifiable against the original |
| **licence terms** in the GLTF extras | yes |

> *"Unremovable provenance is impossible — someone will always edit the file… The watermark is a
> default for honest actors, not a guarantee against dishonest ones. Assume honest buyers, design
> for them, and have legal recourse for the dishonest ones."*

### Q2 — **`wornBy` lands BEFORE editing.** Schema first.

> *"If wornBy lands after editing, editing ships without relationship semantics. The bug: a visitor
> drags a jacket, the jacket goes INTO the scene (containerId) instead of attaching to the character
> (wornBy)… Worse, the fix is a breaking change to visitor workflow because editing learned the
> wrong schema."*

Two decisions pinned before it is written:

- **Attachment points are an enum, not free-form coordinates** — `torso`, `shoulders`, `waist`.
  Free coordinates would let a visitor attach a jacket to a hand: possible, not right.
- **One character wears many garments; one garment wears on one character.** The garment holds a
  single `wornBy` (character + attachment point); the character holds a list.

### On the premise failure — a research rule, not just an apology

> *"A 'no' answer is a starting point, not a conclusion… check at least three venues — open-source
> catalogues (HuggingFace, GitHub), API marketplaces (fal.ai, Replicate, Tripo3D), infrastructure
> providers (Stability, AWS Bedrock, Azure) are all separate inventories."*

**Capability questions stay unanswered until the venue sweep is done.** The negative that cost
$0.078 and a deployed GPU to disprove was one query away.

### On per-part confidence — the limit of the label

Labels travel with the bundle as a whole, so per-part labels do not work. The honest move: **the
bundle carries the lowest-common-denominator label, and the inspector shows per-part quality** so a
buyer decides whether the low-inference regions matter for their use. Matrix Avatar #44 is the
worked example — an excellent figure and a fabricated katana in one asset.

---

## Round 10 — where to start

In its order, not mine.

1. **`wornBy` in the scene schema**, with the enum and the cardinality above. Before editing, not
   after. This is the only item that gets more expensive the longer it waits.
2. **The disclosure surface** — loud labels on the bundle, `representation` and `inference` exposed
   at purchase in the x402 contract, and the artist opt-out for low-inference derivatives.
3. **Input beside output in the inspector.** Its most concrete build request, and the cheapest:
   > *"A mesh that comes back looking reasonable is not the same as a mesh that comes back correct…
   > The cast inspector should make this class of bug impossible to miss."*
   Every mesh panel shows the image the model was actually given. The rembg-rectangle failure would
   have been visible in a glance instead of costing a GPU deployment to find.
4. **Run `backfill-profiles.mjs`.** Free, ~45 min, and everything above is more useful across 49
   pieces than across 6.
5. **The two-stage mask** (edge flood fill + enclosed hue key), and per-piece recording of *which*
   bust-removal method a garment needed — the next bust may not be separable by colour.

### Pins carried into round 10

- **Derivation creates the obligation, not fidelity.** The principle the whole reframe rests on.
- **Generate, label, pay the artist, disclose the limitation.** Do not gate behind a binary that
  sacrifices one to preserve another.
- **Read the model's saved input before believing its output.** The input is the contract.
- **When the task is removal, remove-only tools win.** A flood fill cannot hallucinate; an image
  model added a checkerboard that was never there.
- **A "no" is a starting point.** Three venue classes before concluding a capability is unavailable.
- **The cast inspector is the surface that makes rules checkable.** Enforcement lives elsewhere; the
  inspector is the audit trail.
