# Storyboard geometry probe — 20260826T180432Z

## VERDICT: FAIL  |  sanity floor: 7 violation(s) across 2 fixture(s)  |  self-agreement: M3 0.75 (exact 0.65), M4 0.72, M5 0.66

Champion cell: `ultra-or-film` — R11 baseline: Ultra 550B on OpenRouter, whole film in one call
Repeats: 1 · films scored: 12 · failed: 8 · spend: **$0.00**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

**BREACHED** — 7 violation(s) in fixture(s): captured, scale-extremes. One floor violation fails that fixture outright; these are the checks with no judgement in them.

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement | 0.75 | ≥ 0.8 | ✗ |
| M3 exact-match rate | 0.65 | ≥ 0.55 | ✓ |
| M4 screen-position agreement | 0.72 | ≥ 0.85 | ✗ |
| M4 side errors | 0.06 | ≤ 0.02 | ✗ |
| M5 camera-move agreement | 0.66 | ≥ 0.7 | ✗ |

### Diagnostic gates

Missed: M2b soft plausibility/scene = 0.50 · M13 H3 compile failures = 5.00

| metric | value |
|---|---|
| M1 schema validity | 1.00 |
| M2b soft plausibility per scene | 0.50 |
| M6 distinct bands / modal share / spread | 3.7 / 0.43 / 4.0 |
| M6 MWS share (the original bug) | 0.15 |
| M6 pre-registered band hit rate | 0.90 |
| M7 identical consecutive cameras | 1 |
| M8 teleports / unjustified drift per film | 0 / 0.3 |
| M8b height instability | 0.000 |
| M8c self-reported drift recall | 1.00 |
| M9 containment hit rate | 1.00 |
| M10 axis errors + unpermitted crosses | 0 |
| M11 transitions honoured |  n/a |
| M12 early reveals / omissions | 0.00 / 0.00 |
| M13 H3 compile failures | 5 |
| M14 band instability across repeats |  n/a |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
| `ultra-or-film` | 3/5 | 7 | 0.75 | 0.72 | 0.66 | 3.7 | 0.43 | 0.15 | 0.90 | 0.00 |
| `super-or-film` | 3/5 | 11 | 0.51 | 0.83 | 0.96 | 2.7 | 0.62 | 0.33 | 0.57 | 0.00 |
| `split-or` | 2/5 | 6 | 1.00 | 0.94 | 0.89 | 4.0 | 0.35 | 0.23 | 1.00 | 0.00 |
| `split-or-super` | 4/5 | 5 | 0.90 | 0.77 | 0.89 | 3.8 | 0.38 | 0.13 | 0.72 | 0.00 |

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

_c0 not run._
_c1 not run._



### The ten worst violations, with their numbers

1. **[floor] camera-inside-subject** — `ultra-or-film` / scale-extremes r0 / beat 3
   The camera stands inside <Subject 1> (0.03m from its centre-line, well within its 0.6m width).
2. **[floor] camera-inside-subject** — `super-or-film` / cut-to-black r0 / beat 1
   The camera stands inside <Subject 3> (6.00m from its centre-line, well within its 30m width).
3. **[floor] camera-inside-subject** — `super-or-film` / cut-to-black r0 / beat 2
   The camera stands inside <Subject 3> (6.00m from its centre-line, well within its 30m width).
4. **[floor] camera-inside-subject** — `super-or-film` / cut-to-black r0 / beat 4
   The camera stands inside <Subject 3> (1.50m from its centre-line, well within its 30m width).
5. **[floor] camera-inside-subject** — `super-or-film` / cut-to-black r0 / beat 5
   The camera stands inside <Subject 3> (1.50m from its centre-line, well within its 30m width).
6. **[floor] subject-behind-lens** — `super-or-film` / cut-to-black r0 / beat 4
   <Subject 3> is listed in frame but sits behind the lens.
7. **[floor] subject-behind-lens** — `super-or-film` / cut-to-black r0 / beat 5
   <Subject 3> is listed in frame but sits behind the lens.
8. **[floor] subject-behind-lens** — `split-or-super` / cut-to-black r0 / beat 1
   <Subject 3> is listed in frame but sits behind the lens.
9. **[floor] teleport** — `split-or` / scale-extremes r0 / beat 3
   <Subject 1> moves 182.0m between beats 2 and 3; the physical ceiling for this beat is 57.6m.
10. **[floor] teleport** — `split-or` / scale-extremes r0 / beat 5
   <Subject 1> moves 149.0m between beats 4 and 5; the physical ceiling for this beat is 57.6m.

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
| `ultra-or-film` | 3 | $0.000 | 348 | 6110 |
| `super-or-film` | 3 | $0.000 | 355 | 14755 |
| `split-or` | 2 | $0.000 | 1030 | 26124 |
| `split-or-super` | 4 | $0.000 | 609 | 26011 |

_Now open `scenes.html`. The whole point is what actually landed._
