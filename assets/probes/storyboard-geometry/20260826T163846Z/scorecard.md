# Storyboard geometry probe — 20260826T163846Z

## VERDICT: FAIL  |  sanity floor: CLEAN  |  self-agreement: M3 1.00 (exact 1.00), M4 0.95, M5 0.75

Champion cell: `ultra-or-film` — R11 baseline: Ultra 550B on OpenRouter, whole film in one call
Repeats: 1 · films scored: 2 · failed: 13 · spend: **$0.00**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

CLEAN. No camera inside a subject, no subject behind its own lens, no teleport, no containment miss, no impossible side swap, in any fixture, in any repeat.

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement | 1.00 | ≥ 0.8 | ✓ |
| M3 exact-match rate | 1.00 | ≥ 0.55 | ✓ |
| M4 screen-position agreement | 0.95 | ≥ 0.85 | ✓ |
| M4 side errors | 0.00 | ≤ 0.02 | ✓ |
| M5 camera-move agreement | 0.75 | ≥ 0.7 | ✓ |

### Diagnostic gates

Missed: M2b soft plausibility/scene = 1.20 · M13 H3 compile failures = 4.00

| metric | value |
|---|---|
| M1 schema validity | 1.00 |
| M2b soft plausibility per scene | 1.20 |
| M6 distinct bands / modal share / spread | 4.0 / 0.25 / 3.0 |
| M6 MWS share (the original bug) | 0.25 |
| M6 pre-registered band hit rate | 1.00 |
| M7 identical consecutive cameras | 2 |
| M8 teleports / unjustified drift per film | 0 / 0.0 |
| M8b height instability | 0.000 |
| M8c self-reported drift recall |  n/a |
| M9 containment hit rate | 1.00 |
| M10 axis errors + unpermitted crosses | 0 |
| M11 transitions honoured | 1.00 |
| M12 early reveals / omissions | 0.00 / 0.00 |
| M13 H3 compile failures | 4 |
| M14 band instability across repeats |  n/a |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
| `ultra-or-film` | 1/5 | 0 | 1.00 | 0.95 | 0.75 | 4.0 | 0.25 | 0.25 | 1.00 | 0.00 |
| `super-or-film` | 1/5 | 2 | 0.38 | 0.91 | 0.75 | 3.0 | 0.50 | 0.25 |  n/a | 0.00 |
| `split-or` | 0/5 | 0 |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |  n/a |

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

_c0 not run._
_c1 not run._



### The ten worst violations, with their numbers

1. **[floor] containment-invalid** — `super-or-film` / captured r0 / beat 3
   <Subject 2> sits at 0m inside <Subject 1>, which is 1.8m tall.
2. **[floor] containment-invalid** — `super-or-film` / captured r0 / beat 4
   <Subject 2> sits at 0m inside <Subject 1>, which is 1.8m tall.
3. **[soft] framing-disagreement** — `super-or-film` / captured r0 / beat 2
   Beat 2 declares MCU; its own geometry gives WS (hFrac 0.356).
4. **[soft] framing-disagreement** — `super-or-film` / captured r0 / beat 4
   Beat 4 declares EWS; its own geometry gives MWS (hFrac 0.838).
5. **[soft] identical-consecutive-camera** — `ultra-or-film` / cut-to-black r0 / beat 2
   Beats 1 and 2 have the same camera pose.
6. **[soft] identical-consecutive-camera** — `ultra-or-film` / cut-to-black r0 / beat 5
   Beats 4 and 5 have the same camera pose.
7. **[soft] projects-outside-frame** — `ultra-or-film` / cut-to-black r0 / beat 1
   <Subject 2> is listed in frame but projects to (0.00, -2.10).
8. **[soft] projects-outside-frame** — `ultra-or-film` / cut-to-black r0 / beat 1
   <Subject 3> is listed in frame but projects to (0.00, 16.26).
9. **[soft] projects-outside-frame** — `ultra-or-film` / cut-to-black r0 / beat 2
   <Subject 3> is listed in frame but projects to (0.00, 41.47).
10. **[soft] projects-outside-frame** — `ultra-or-film` / cut-to-black r0 / beat 4
   <Subject 1> is listed in frame but projects to (0.00, 1.45).

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
| `ultra-or-film` | 1 | $0.000 | 759 | 9554 |
| `super-or-film` | 1 | $0.000 | 379 | 17361 |
| `split-or` | 0 | — | — | — |

_Now open `scenes.html`. The whole point is what actually landed._
