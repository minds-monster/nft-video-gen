# Storyboard geometry probe — 20260824T072814Z

## VERDICT: FAIL  |  sanity floor: 4 violation(s) across 1 fixture(s)  |  self-agreement: M3 0.91 (exact 0.86), M4 0.82, M5 0.76

Champion cell: `scene-film-v2` — world-space, whole film, CONTRACT V2 (camera looks -Z so larger x is screen-right)
Repeats: 3 · films scored: 14 · failed: 0 · spend: **$3.68**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

**BREACHED** — 4 violation(s) in fixture(s): grid-launch. One floor violation fails that fixture outright; these are the checks with no judgement in them.

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement | 0.91 | ≥ 0.8 | ✓ |
| M3 exact-match rate | 0.86 | ≥ 0.55 | ✓ |
| M4 screen-position agreement | 0.82 | ≥ 0.85 | ✗ |
| M4 side errors | 0.02 | ≤ 0.02 | ✓ |
| M5 camera-move agreement | 0.76 | ≥ 0.7 | ✓ |

### Diagnostic gates

Missed: M2b soft plausibility/scene = 0.52 · M13 H3 compile failures = 1.00

| metric | value |
|---|---|
| M1 schema validity | 1.00 |
| M2b soft plausibility per scene | 0.52 |
| M6 distinct bands / modal share / spread | 3.4 / 0.45 / 3.6 |
| M6 MWS share (the original bug) | 0.12 |
| M6 pre-registered band hit rate | 0.85 |
| M7 identical consecutive cameras | 3 |
| M8 teleports / unjustified drift per film | 0 / 0.0 |
| M8b height instability | 0.000 |
| M8c self-reported drift recall |  n/a |
| M9 containment hit rate | 1.00 |
| M10 axis errors + unpermitted crosses | 0 |
| M11 transitions honoured | 1.00 |
| M12 early reveals / omissions | 0.00 / 0.00 |
| M13 H3 compile failures | 1 |
| M14 band instability across repeats | 0.37 |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
| `scene-film-v2` | 14/14 | 4 | 0.91 | 0.82 | 0.76 | 3.4 | 0.45 | 0.12 | 0.85 | 0.00 |

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

_c0 not run._
_c1 not run._



### The ten worst violations, with their numbers

1. **[floor] subject-behind-lens** — `scene-film-v2` / grid-launch r0 / beat 3
   <Subject 4> is listed in frame but sits behind the lens.
2. **[floor] subject-behind-lens** — `scene-film-v2` / grid-launch r0 / beat 3
   <Subject 3> is listed in frame but sits behind the lens.
3. **[floor] subject-behind-lens** — `scene-film-v2` / grid-launch r1 / beat 6
   <Subject 5> is listed in frame but sits behind the lens.
4. **[floor] subject-behind-lens** — `scene-film-v2` / grid-launch r1 / beat 6
   <Subject 6> is listed in frame but sits behind the lens.
5. **[soft] framing-expectation-miss** — `scene-film-v2` / cut-to-black r0 / beat 1
   Beat 1 came back WS; pre-registered as MCU/MS/MWS/CU. Beat text: "<Subject 1> sits inside <Subject 2> in the driver's seat, the car parked at the foot of <Subject 3>."
6. **[soft] framing-expectation-miss** — `scene-film-v2` / cut-to-black r2 / beat 1
   Beat 1 came back WS; pre-registered as MCU/MS/MWS/CU. Beat text: "<Subject 1> sits inside <Subject 2> in the driver's seat, the car parked at the foot of <Subject 3>."
7. **[soft] framing-expectation-miss** — `scene-film-v2` / grid-launch r2 / beat 4
   Beat 4 came back CU; pre-registered as MS/MWS/WS. Beat text: "<Subject 5>, wearing <Subject 6>, stands alone at the front of the grid with one arm raised, both cars waiting behind."
8. **[soft] framing-expectation-miss** — `scene-film-v2` / two-hander-axis r0 / beat 2
   Beat 2 came back WS; pre-registered as MWS/MS/MCU. Beat text: "From that same side of the table, without moving around it, the camera pushes in to a tighter two-shot."
9. **[soft] framing-expectation-miss** — `scene-film-v2` / two-hander-axis r1 / beat 2
   Beat 2 came back WS; pre-registered as MWS/MS/MCU. Beat text: "From that same side of the table, without moving around it, the camera pushes in to a tighter two-shot."
10. **[soft] framing-expectation-miss** — `scene-film-v2` / two-hander-axis r1 / beat 5
   Beat 5 came back CU; pre-registered as MS/MWS/WS/MCU. Beat text: "The camera does not move. <Subject 1> stands, walks around the table, and stops standing behind <Subject 2>."

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
| `scene-film-v2` | 14 | $0.263 | 198 | 9210 |

_Now open `scenes.html`. The whole point is what actually landed._
