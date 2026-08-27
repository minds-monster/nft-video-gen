# Storyboard geometry probe — 20260826T163820Z

## VERDICT: FAIL  |  sanity floor: CLEAN  |  self-agreement: M3  n/a (exact  n/a), M4  n/a, M5  n/a

Champion cell: `scene-film` — world-space scene graph, whole film in one call, sol @ high reasoning
Repeats: 3 · films scored: 0 · failed: 60 · spend: **$0.00**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

CLEAN. No camera inside a subject, no subject behind its own lens, no teleport, no containment miss, no impossible side swap, in any fixture, in any repeat.

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement |  n/a | ≥ 0.8 | ✗ |
| M3 exact-match rate |  n/a | ≥ 0.55 | ✗ |
| M4 screen-position agreement |  n/a | ≥ 0.85 | ✗ |
| M4 side errors |  n/a | ≤ 0.02 | ✓ |
| M5 camera-move agreement |  n/a | ≥ 0.7 | ✗ |

### Diagnostic gates

Missed: M1 schema validity =  n/a · M6 distinct bands =  n/a · M6 spread =  n/a · M6 extreme hit rate =  n/a

| metric | value |
|---|---|
| M1 schema validity |  n/a |
| M2b soft plausibility per scene |  n/a |
| M6 distinct bands / modal share / spread |  n/a /  n/a /  n/a |
| M6 MWS share (the original bug) |  n/a |
| M6 pre-registered band hit rate |  n/a |
| M7 identical consecutive cameras | 0 |
| M8 teleports / unjustified drift per film | 0 /  n/a |
| M8b height instability |  n/a |
| M8c self-reported drift recall |  n/a |
| M9 containment hit rate |  n/a |
| M10 axis errors + unpermitted crosses | 0 |
| M11 transitions honoured |  n/a |
| M12 early reveals / omissions |  n/a /  n/a |
| M13 H3 compile failures | 0 |
| M14 band instability across repeats |  n/a |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
| `scene-film` | 0/15 | 0 |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |
| `scene-chain` | 0/15 | 0 |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |
| `c0` | 0/15 | — | — | — | — |  n/a |  n/a |  n/a |  n/a |  n/a |
| `c1` | 0/15 | — | — | — | — |  n/a |  n/a |  n/a |  n/a |  n/a |

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

**c0 (today's exact request)**:  n/a distinct bands, modal share  n/a, MWS share  n/a. This is what "nothing" looks like in numbers.
**c1 (today's schema, whole film at once)**:  n/a distinct bands, modal share  n/a, MWS share  n/a.

**Scope alone does not explain it.** c1 is no better than c0, so cross-beat context was not the bug on its own.

⚠ **The champion does not beat c0 on variety.** That alone fails the round regardless of every other number.

### The ten worst violations, with their numbers

_None recorded._

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
| `scene-film` | 0 | — | — | — |
| `scene-chain` | 0 | — | — | — |
| `c0` | 0 | — | — | — |
| `c1` | 0 | — | — | — |

_Now open `scenes.html`. The whole point is what actually landed._
