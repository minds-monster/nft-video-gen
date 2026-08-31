// The scorecard and the scene viewer.
//
// Two rules shape this file. First, the verdict prints BOTH axes always — a cell that clears the
// sanity floor but misses self-agreement is "geometry works, labels don't", which is a repair
// problem; a cell that breaches the floor is a model that cannot hold a world. Those need
// different follow-ups, so collapsing them into one PASS/FAIL word would destroy the finding.
//
// Second, the ten worst violations print with their numbers AND the beat text that produced
// them, and scenes.html draws every beat from the same projection code the grader uses. A
// verdict a human cannot check is a verdict taken on faith.

import {
  FRAMING_ORDER, cameraBasis, deriveFraming, projectSubject, sceneScaleOf,
} from './scene-geometry.mjs';
import { aspectOf } from './storyboard-fixtures.mjs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (n, digits = 2) => (n === null || n === undefined || Number.isNaN(n) ? ' n/a' : n.toFixed(digits));

/** The two-axis gate, exactly as pinned in the plan after Adam's review. */
const GATES = {
  selfAgreement: { m3: 0.8, m3exact: 0.55, m4: 0.85, m4sideErrors: 0.02, m5: 0.7 },
  diagnostic: {
    m1: 0.98, m2bPerScene: 0.1, m6distinct: 3, m6modal: 0.5, m6spread: 3,
    m6extreme: 0.75, m8height: 0.05, m11: 1.0, m12: 0.05, m14band: 1.0,
  },
};

const aggregate = (rows) => {
  const live = rows.filter((r) => !r.failed);
  const pick = (fn) => live.map(fn).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  return {
    films: rows.length,
    failed: rows.length - live.length,
    floorViolations: live.reduce((s, r) => s + r.floorCount, 0),
    fixturesBreached: [...new Set(live.filter((r) => !r.passesFloor).map((r) => r.fixture))],
    m1: live.length ? live.filter((r) => r.metrics.m1.valid).length / live.length : null,
    m2b: mean(pick((r) => r.metrics.m2.softPerScene)),
    m3: mean(pick((r) => r.metrics.m3.mean)),
    m3exact: mean(pick((r) => r.metrics.m3.exactRate)),
    m4: mean(pick((r) => r.metrics.m4.mean)),
    m4side: mean(pick((r) => r.metrics.m4.sideErrorRate)),
    m5: mean(pick((r) => r.metrics.m5.mean)),
    m6distinct: mean(pick((r) => r.metrics.m6.distinctBands)),
    m6modal: mean(pick((r) => r.metrics.m6.modalShare)),
    m6spread: mean(pick((r) => r.metrics.m6.spread)),
    m6mws: mean(pick((r) => r.metrics.m6.mwsShare)),
    m6extreme: mean(pick((r) => r.metrics.m6.extremeHitRate)),
    m7static: live.reduce((s, r) => s + (r.metrics.m7.staticCameraPairs ?? 0), 0),
    m8teleport: live.reduce((s, r) => s + (r.metrics.m8.teleports ?? 0), 0),
    m8drift: mean(pick((r) => r.metrics.m8.unjustifiedDrift)),
    m8height: mean(pick((r) => r.metrics.m8.heightInstability)),
    m8recall: mean(pick((r) => r.metrics.m8.selfReportRecall)),
    m9: mean(pick((r) => r.metrics.m9.rate)),
    m10errors: live.reduce((s, r) => s + (r.metrics.m10.axisErrors ?? 0) + (r.metrics.m10.unpermittedCrosses ?? 0), 0),
    m11: mean(pick((r) => r.metrics.m11.rate)),
    m12early: mean(pick((r) => r.metrics.m12.earlyRevealRate)),
    m12omit: mean(pick((r) => r.metrics.m12.omissionRate)),
    m13: live.reduce((s, r) => s + (r.metrics.m13.failures ?? 0), 0),
  };
};

const VIOLATION_RANK = {
  'camera-inside-subject': 0, 'subject-behind-lens': 1, 'non-finite': 2, 'teleport': 3,
  'containment-missed': 4, 'containment-invalid': 5, 'axis-error': 6, 'unpermitted-line-cross': 7,
  'subject-underground': 8, 'subject-floating': 9, 'absurd-scale': 10,
  'framing-expectation-miss': 11, 'framing-disagreement': 12, 'camera-move-disagreement': 13,
  'early-reveal': 14, 'omission': 15, 'screen-side-error': 16, 'height-drift': 17,
  'identical-consecutive-camera': 18, 'unjustified-drift': 19, 'near-interpenetration': 20,
  'projects-outside-frame': 21, 'camera-grazes-subject': 21.5, 'transition-not-honoured': 22, 'h3-compile-failure': 23,
};

export const renderScorecard = ({ runId, cells, cellIds, fixtures, scored, ledger, spent, repeats, stabilityOf }) => {
  const byCell = {};
  for (const id of cellIds) byCell[id] = scored.filter((r) => r.cell === id);

  const champion = cellIds.find((id) => id === 'scene-film') ?? cellIds.find((id) => cells[id]?.kind === 'scene') ?? cellIds[0];
  const championRows = byCell[champion] ?? [];
  const agg = aggregate(championRows);

  // M14 is per fixture, across that fixture's repeats.
  const stabilities = fixtures
    .map((f) => stabilityOf(championRows.filter((r) => r.fixture === f.id && !r.failed)))
    .map((s) => s.bandInstability)
    .filter((v) => v !== null);
  const m14 = mean(stabilities);

  const axis1Pass = agg.floorViolations === 0;
  const axis2Pass =
    agg.m3 !== null && agg.m3 >= GATES.selfAgreement.m3 &&
    agg.m3exact >= GATES.selfAgreement.m3exact &&
    agg.m4 >= GATES.selfAgreement.m4 &&
    agg.m4side <= GATES.selfAgreement.m4sideErrors &&
    agg.m5 >= GATES.selfAgreement.m5;

  const c0 = byCell.c0 ? aggregate(byCell.c0) : null;
  const c1 = byCell.c1 ? aggregate(byCell.c1) : null;
  const beatsC0 = c0 ? agg.m6distinct > c0.m6distinct && agg.m6modal < c0.m6modal : null;

  const diagnosticMisses = [];
  const dcheck = (name, value, ok) => { if (!ok) diagnosticMisses.push(`${name} = ${fmt(value)}`); };
  dcheck('M1 schema validity', agg.m1, agg.m1 >= GATES.diagnostic.m1);
  dcheck('M2b soft plausibility/scene', agg.m2b, agg.m2b <= GATES.diagnostic.m2bPerScene);
  dcheck('M6 distinct bands', agg.m6distinct, agg.m6distinct >= GATES.diagnostic.m6distinct);
  dcheck('M6 modal share', agg.m6modal, agg.m6modal <= GATES.diagnostic.m6modal);
  dcheck('M6 spread', agg.m6spread, agg.m6spread >= GATES.diagnostic.m6spread);
  dcheck('M6 extreme hit rate', agg.m6extreme, agg.m6extreme >= GATES.diagnostic.m6extreme);
  dcheck('M8b height instability', agg.m8height, agg.m8height <= GATES.diagnostic.m8height);
  dcheck('M11 transitions', agg.m11, agg.m11 === null || agg.m11 >= GATES.diagnostic.m11);
  dcheck('M12 early reveals', agg.m12early, agg.m12early <= GATES.diagnostic.m12);
  dcheck('M12 omissions', agg.m12omit, agg.m12omit <= GATES.diagnostic.m12);
  dcheck('M13 H3 compile failures', agg.m13, agg.m13 === 0);
  dcheck('M14 band instability', m14, m14 === null || m14 <= GATES.diagnostic.m14band);

  const pass = axis1Pass && axis2Pass && diagnosticMisses.length === 0 && beatsC0 !== false;
  const verdict = pass ? 'PASS' : 'FAIL';
  const verdictLine =
    `VERDICT: ${verdict}  |  sanity floor: ${axis1Pass ? 'CLEAN' : `${agg.floorViolations} violation(s) across ${agg.fixturesBreached.length} fixture(s)`}` +
    `  |  self-agreement: M3 ${fmt(agg.m3)} (exact ${fmt(agg.m3exact)}), M4 ${fmt(agg.m4)}, M5 ${fmt(agg.m5)}`;

  const worst = scored
    .filter((r) => !r.failed)
    .flatMap((r) => (r.violations ?? []).map((v) => ({ ...v, cell: r.cell, fixture: r.fixture, repeat: r.repeat })))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'floor' ? -1 : 1;
      return (VIOLATION_RANK[a.code] ?? 99) - (VIOLATION_RANK[b.code] ?? 99);
    })
    .slice(0, 10);

  const cellRow = (id) => {
    const a = aggregate(byCell[id] ?? []);
    const isLegacy = cells[id]?.kind === 'legacy';
    return `| \`${id}\` | ${a.films - a.failed}/${a.films} | ${isLegacy ? '—' : a.floorViolations} | ${isLegacy ? '—' : fmt(a.m3)} | ${isLegacy ? '—' : fmt(a.m4)} | ${isLegacy ? '—' : fmt(a.m5)} | ${fmt(a.m6distinct, 1)} | ${fmt(a.m6modal)} | ${fmt(a.m6mws)} | ${fmt(a.m6extreme)} | ${fmt(a.m12early)} |`;
  };

  const totalUsd = spent ?? 0;

  const markdown = `# Storyboard geometry probe — ${runId}

## ${verdictLine}

Champion cell: \`${champion}\` — ${cells[champion]?.label ?? ''}
Repeats: ${repeats} · films scored: ${scored.filter((r) => !r.failed).length} · failed: ${scored.filter((r) => r.failed).length} · spend: **$${totalUsd.toFixed(2)}**

### Axis 1 — the sanity floor (absolute, zero tolerance, per fixture)

${axis1Pass
  ? 'CLEAN. No camera inside a subject, no subject behind its own lens, no teleport, no containment miss, no impossible side swap, in any fixture, in any repeat.'
  : `**BREACHED** — ${agg.floorViolations} violation(s) in fixture(s): ${agg.fixturesBreached.join(', ')}. One floor violation fails that fixture outright; these are the checks with no judgement in them.`}

### Axis 2 — self-agreement (the crux)

Does the model's own geometry match its own declared labels? A model that disagrees with itself
did not understand what it emitted.

| metric | value | gate | |
|---|---|---|---|
| M3 framing self-agreement | ${fmt(agg.m3)} | ≥ ${GATES.selfAgreement.m3} | ${agg.m3 >= GATES.selfAgreement.m3 ? '✓' : '✗'} |
| M3 exact-match rate | ${fmt(agg.m3exact)} | ≥ ${GATES.selfAgreement.m3exact} | ${agg.m3exact >= GATES.selfAgreement.m3exact ? '✓' : '✗'} |
| M4 screen-position agreement | ${fmt(agg.m4)} | ≥ ${GATES.selfAgreement.m4} | ${agg.m4 >= GATES.selfAgreement.m4 ? '✓' : '✗'} |
| M4 side errors | ${fmt(agg.m4side)} | ≤ ${GATES.selfAgreement.m4sideErrors} | ${agg.m4side <= GATES.selfAgreement.m4sideErrors ? '✓' : '✗'} |
| M5 camera-move agreement | ${fmt(agg.m5)} | ≥ ${GATES.selfAgreement.m5} | ${agg.m5 >= GATES.selfAgreement.m5 ? '✓' : '✗'} |

### Diagnostic gates

${diagnosticMisses.length ? `Missed: ${diagnosticMisses.join(' · ')}` : 'All clear.'}

| metric | value |
|---|---|
| M1 schema validity | ${fmt(agg.m1)} |
| M2b soft plausibility per scene | ${fmt(agg.m2b)} |
| M6 distinct bands / modal share / spread | ${fmt(agg.m6distinct, 1)} / ${fmt(agg.m6modal)} / ${fmt(agg.m6spread, 1)} |
| M6 MWS share (the original bug) | ${fmt(agg.m6mws)} |
| M6 pre-registered band hit rate | ${fmt(agg.m6extreme)} |
| M7 identical consecutive cameras | ${agg.m7static} |
| M8 teleports / unjustified drift per film | ${agg.m8teleport} / ${fmt(agg.m8drift, 1)} |
| M8b height instability | ${fmt(agg.m8height, 3)} |
| M8c self-reported drift recall | ${fmt(agg.m8recall)} |
| M9 containment hit rate | ${fmt(agg.m9)} |
| M10 axis errors + unpermitted crosses | ${agg.m10errors} |
| M11 transitions honoured | ${fmt(agg.m11)} |
| M12 early reveals / omissions | ${fmt(agg.m12early)} / ${fmt(agg.m12omit)} |
| M13 H3 compile failures | ${agg.m13} |
| M14 band instability across repeats | ${fmt(m14)} |

### Every cell

| cell | ok | floor | M3 | M4 | M5 | bands | modal | MWS | pre-reg hit | early reveals |
|---|---|---|---|---|---|---|---|---|---|---|
${cellIds.map(cellRow).join('\n')}

Legacy control cells have no geometry, so their self-agreement columns are blank by
construction and their variety columns are computed on DECLARED labels — the only thing those
cells have. That asymmetry is real and is why c0/c1 are controls rather than candidates.

### The controls — what caused what

${c0 ? `**c0 (today's exact request)**: ${fmt(c0.m6distinct, 1)} distinct bands, modal share ${fmt(c0.m6modal)}, MWS share ${fmt(c0.m6mws)}. This is what "nothing" looks like in numbers.` : '_c0 not run._'}
${c1 ? `**c1 (today's schema, whole film at once)**: ${fmt(c1.m6distinct, 1)} distinct bands, modal share ${fmt(c1.m6modal)}, MWS share ${fmt(c1.m6mws)}.` : '_c1 not run._'}
${c0 && c1
  ? c1.m6distinct > c0.m6distinct + 0.5
    ? '\n**Scope alone moves the needle.** c1 beats c0 on variety using today\'s schema, so cross-beat context was a real part of the every-beat-is-MWS bug. The geometry work has to justify itself on the editing and H3-precision goals as well as on variety. Adam\'s named follow-up for round 8 is c2: whole-film, today\'s labels, geometry stripped — if that also wins, variety was always a labels problem.'
    : '\n**Scope alone does not explain it.** c1 is no better than c0, so cross-beat context was not the bug on its own.'
  : ''}
${beatsC0 === false ? '\n⚠ **The champion does not beat c0 on variety.** That alone fails the round regardless of every other number.' : ''}

### The ten worst violations, with their numbers

${worst.length === 0 ? '_None recorded._' : worst.map((v, i) => `${i + 1}. **[${v.severity}] ${v.code}** — \`${v.cell}\` / ${v.fixture} r${v.repeat}${v.beat !== undefined ? ` / beat ${v.beat + 1}` : ''}\n   ${v.detail}`).join('\n')}

### Cost

| cell | films | mean $/film | mean s/film | reasoning tokens/film |
|---|---|---|---|---|
${cellIds.map((id) => {
  const rows = (ledger ?? []).filter((l) => l.cell === id && !l.failed);
  if (!rows.length) return `| \`${id}\` | 0 | — | — | — |`;
  return `| \`${id}\` | ${rows.length} | $${fmt(mean(rows.map((r) => r.costUsd)), 3)} | ${fmt(mean(rows.map((r) => r.wallMs / 1000)), 0)} | ${fmt(mean(rows.map((r) => r.reasoningTokens)), 0)} |`;
}).join('\n')}

_Now open \`scenes.html\`. The whole point is what actually landed._
`;

  return { markdown, verdictLine, verdict, pass, aggregate: agg };
};

// ─────────────────────────────────────────────────────────────────────── scenes.html

const svgPlan = (beat, aspect) => {
  const camera = beat.camera;
  if (!camera) return '<div class="transition">CUT TO BLACK</div>';
  const points = [
    ...beat.subjects.map((s) => ({ x: s.x, z: s.z })),
    { x: camera.start.position.x, z: camera.start.position.z },
    { x: camera.end.position.x, z: camera.end.position.z },
  ];
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const pad = Math.max(2, (Math.max(...xs) - Math.min(...xs)) * 0.15);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minZ = Math.min(...zs) - pad;
  const maxZ = Math.max(...zs) + pad;
  const W = 300;
  const H = 200;
  const sx = (x) => ((x - minX) / (maxX - minX || 1)) * W;
  const sy = (z) => H - ((z - minZ) / (maxZ - minZ || 1)) * H;

  const { forward, right } = cameraBasis(camera.start, camera.rollDeg ?? 0);
  const halfAngle = Math.atan(18 / camera.focalStartMm);
  const reach = Math.max(maxX - minX, maxZ - minZ) * 0.9;
  const cone = [-1, 1].map((sign) => {
    const dir = {
      x: forward.x + right.x * Math.tan(halfAngle) * sign,
      z: forward.z + right.z * Math.tan(halfAngle) * sign,
    };
    const l = Math.hypot(dir.x, dir.z) || 1;
    return { x: camera.start.position.x + (dir.x / l) * reach, z: camera.start.position.z + (dir.z / l) * reach };
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="plan">
  <polygon points="${sx(camera.start.position.x)},${sy(camera.start.position.z)} ${cone.map((c) => `${sx(c.x)},${sy(c.z)}`).join(' ')}" fill="rgba(168,85,247,0.12)" stroke="rgba(168,85,247,0.4)" stroke-width="1"/>
  <line x1="${sx(camera.start.position.x)}" y1="${sy(camera.start.position.z)}" x2="${sx(camera.end.position.x)}" y2="${sy(camera.end.position.z)}" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4 3"/>
  <circle cx="${sx(camera.start.position.x)}" cy="${sy(camera.start.position.z)}" r="5" fill="#f59e0b"/>
  ${beat.subjects.map((s) => `<g><circle cx="${sx(s.x)}" cy="${sy(s.z)}" r="${Math.max(3, (s.widthM / (maxX - minX || 1)) * W / 2)}" fill="rgba(56,189,248,0.3)" stroke="#38bdf8" stroke-width="1.2"/><text x="${sx(s.x)}" y="${sy(s.z) + 3}" text-anchor="middle" font-size="9" fill="#e0f2fe">${(s.subject.match(/\d+/) ?? ['?'])[0]}</text></g>`).join('')}
</svg>`;
};

const svgCameraView = (beat, aspect) => {
  const camera = beat.camera;
  if (!camera) return '';
  const W = 300;
  const H = Math.round(W / aspect);
  const shapes = beat.subjects.map((s) => {
    const p = projectSubject(s, camera, { aspect });
    if (!Number.isFinite(p.ndcX) || p.behindLens) return '';
    const cx = ((p.ndcX + 1) / 2) * W;
    const h = p.hFrac * H;
    const w = h * (s.widthM / Math.max(s.heightM, 0.01));
    const cy = H / 2 - ((p.ndcY * H) / 2);
    return `<g><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="rgba(56,189,248,0.25)" stroke="#38bdf8" stroke-width="1"/><text x="${cx}" y="${cy}" text-anchor="middle" font-size="10" fill="#e0f2fe">${(s.subject.match(/\d+/) ?? ['?'])[0]}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="view"><rect width="${W}" height="${H}" fill="#0b1120"/>${shapes}</svg>`;
};

export const renderScenesHtml = ({ runId, scored, fixtures }) => {
  const films = scored.filter((r) => !r.failed && r.kind !== 'legacy');
  const sections = films.slice(0, 40).map((row) => {
    const fixture = fixtures.find((f) => f.id === row.fixture);
    const aspect = fixture ? aspectOf(fixture.spec) : 16 / 9;
    const raw = row.rawFilm;
    const beats = raw?.beats ?? [];
    return `<section>
  <h2>${row.cell} — ${row.fixture} <span class="repeat">repeat ${row.repeat}</span> ${row.passesFloor ? '<span class="ok">floor clean</span>' : `<span class="bad">${row.floorCount} floor violation(s)</span>`}</h2>
  <div class="beats">
  ${beats.map((beat, i) => `<figure>
    <figcaption>Beat ${i + 1} — declared <b>${beat.framing ?? '—'}</b>, derived <b>${row.derivedBands[i] ?? '—'}</b>${beat.camera ? ` · ${beat.camera.motion}` : ''}</figcaption>
    ${svgCameraView(beat, aspect)}
    ${svgPlan(beat, aspect)}
    <p class="beat-text">${(fixture?.spec.beats[i] ?? '').replace(/</g, '&lt;')}</p>
    <p class="prose">${(beat.proseNote ?? '').replace(/</g, '&lt;')}</p>
  </figure>`).join('')}
  </div>
</section>`;
  }).join('');

  return `<!doctype html><meta charset="utf-8"><title>probe ${runId}</title>
<style>
  body { background:#020617; color:#e2e8f0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; letter-spacing:.2em; text-transform:uppercase; color:#a855f7; }
  h2 { font-size:14px; border-bottom:1px solid #1e293b; padding-bottom:6px; margin-top:36px; }
  .repeat { color:#64748b; font-weight:400; }
  .ok { color:#4ade80; } .bad { color:#f87171; }
  .beats { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:18px; }
  figure { margin:0; background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:10px; }
  figcaption { font-size:11px; color:#94a3b8; margin-bottom:6px; }
  svg { width:100%; height:auto; display:block; border-radius:6px; margin-bottom:6px; background:#0b1120; }
  .plan { border:1px solid #1e293b; }
  .beat-text { font-size:11px; color:#64748b; font-style:italic; }
  .prose { font-size:12px; color:#cbd5e1; }
  .legend { color:#64748b; font-size:12px; max-width:70ch; }
</style>
<h1>Storyboard geometry probe — ${runId}</h1>
<p class="legend">Top image: what the camera actually sees, projected from the beat's own numbers —
subject boxes at their true screen position and true fraction of frame height. Bottom image: the
plan view, blue circles for subjects, amber for the camera with its dashed move and its frustum.
Both are drawn by the same projection code the grader scores with, so if a picture looks wrong,
the numbers are wrong.</p>
${sections || '<p class="legend">No geometry films in this run.</p>'}
`;
};
