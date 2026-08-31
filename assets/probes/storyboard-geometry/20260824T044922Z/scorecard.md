# Storyboard geometry probe — 20260824T044922Z

## VERDICT: FAIL  |  sanity floor: 4 violation(s) across 1 fixture(s)  |  self-agreement: M3 0.93 (exact 0.88), M4 0.57, M5 0.76

Champion cell: `scene-film` — world-space scene graph, whole film in one call, sol @ high reasoning
Repeats: 3 · films scored: 48 · failed: 0 · spend: **$9.96**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

**BREACHED** — 4 violation(s) in fixture(s): cut-to-black. One floor violation fails that fixture outright; these are the checks with no judgement in them.

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement | 0.93 | ≥ 0.8 | ✓ |
| M3 exact-match rate | 0.88 | ≥ 0.55 | ✓ |
| M4 screen-position agreement | 0.57 | ≥ 0.85 | ✗ |
| M4 side errors | 0.25 | ≤ 0.02 | ✗ |
| M5 camera-move agreement | 0.76 | ≥ 0.7 | ✓ |

### Diagnostic gates

Missed: M2b soft plausibility/scene = 0.48

| metric | value |
|---|---|
| M1 schema validity | 1.00 |
| M2b soft plausibility per scene | 0.48 |
| M6 distinct bands / modal share / spread | 3.9 / 0.39 / 4.2 |
| M6 MWS share (the original bug) | 0.10 |
| M6 pre-registered band hit rate | 0.89 |
| M7 identical consecutive cameras | 4 |
| M8 teleports / unjustified drift per film | 0 / 0.0 |
| M8b height instability | 0.000 |
| M8c self-reported drift recall |  n/a |
| M9 containment hit rate | 1.00 |
| M10 axis errors + unpermitted crosses | 0 |
| M11 transitions honoured | 1.00 |
| M12 early reveals / omissions | 0.00 / 0.00 |
| M13 H3 compile failures | 0 |
| M14 band instability across repeats | 0.34 |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
| `scene-film` | 12/12 | 4 | 0.93 | 0.57 | 0.76 | 3.9 | 0.39 | 0.10 | 0.89 | 0.00 |
| `scene-chain` | 12/12 | 3 | 0.91 | 0.54 | 0.81 | 3.2 | 0.49 | 0.20 | 0.83 | 0.00 |
| `c0` | 12/12 | — | — | — | — | 2.4 | 0.70 | 0.45 | 0.95 | 0.00 |
| `c1` | 12/12 | — | — | — | — | 3.1 | 0.49 | 0.26 | 0.98 | 0.00 |

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

**c0 (today's exact request)**: 2.4 distinct bands, modal share 0.70, MWS share 0.45. This is what "nothing" looks like in numbers.
**c1 (today's schema, whole film at once)**: 3.1 distinct bands, modal share 0.49, MWS share 0.26.

**Scope alone moves the needle.** c1 beats c0 on variety using today's schema, so cross-beat context was a real part of the every-beat-is-MWS bug. The geometry work has to justify itself on the editing and H3-precision goals as well as on variety. Adam's named follow-up for round 8 is c2: whole-film, today's labels, geometry stripped — if that also wins, variety was always a labels problem.


### The ten worst violations, with their numbers

1. **[floor] camera-inside-subject** — `scene-chain` / scale-extremes r2 / beat 3
   The camera stands inside <Subject 1>.
2. **[floor] containment-invalid** — `scene-chain` / cut-to-black r0 / beat 4
   <Subject 1> sits at 85m inside <Subject 3>, which is 18m tall.
3. **[floor] containment-invalid** — `scene-chain` / cut-to-black r0 / beat 5
   <Subject 1> sits at 85m inside <Subject 3>, which is 18m tall.
4. **[floor] containment-invalid** — `scene-film` / cut-to-black r1 / beat 4
   <Subject 1> sits at 70m inside <Subject 3>, which is 0.064m tall.
5. **[floor] containment-invalid** — `scene-film` / cut-to-black r1 / beat 5
   <Subject 1> sits at 70m inside <Subject 3>, which is 0.064m tall.
6. **[floor] containment-invalid** — `scene-film` / cut-to-black r2 / beat 4
   <Subject 1> sits at 90m inside <Subject 3>, which is 0.041m tall.
7. **[floor] containment-invalid** — `scene-film` / cut-to-black r2 / beat 5
   <Subject 1> sits at 90m inside <Subject 3>, which is 0.041m tall.
8. **[soft] framing-expectation-miss** — `c0` / scale-extremes r0 / beat 4
   Beat 4 came back EWS; pre-registered as WS/MWS/MS. Beat text: "She stands and looks back the way she came, the full length of her against the flat."
9. **[soft] framing-expectation-miss** — `c0` / scale-extremes r1 / beat 4
   Beat 4 came back EWS; pre-registered as WS/MWS/MS. Beat text: "She stands and looks back the way she came, the full length of her against the flat."
10. **[soft] framing-expectation-miss** — `c0` / scale-extremes r2 / beat 4
   Beat 4 came back EWS; pre-registered as WS/MWS/MS. Beat text: "She stands and looks back the way she came, the full length of her against the flat."

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
| `scene-film` | 12 | $0.254 | 237 | 8982 |
| `scene-chain` | 12 | $0.483 | 362 | 16053 |
| `c0` | 12 | $0.061 | 35 | 0 |
| `c1` | 12 | $0.032 | 22 | 0 |

_Now open `scenes.html`. The whole point is what actually landed._
