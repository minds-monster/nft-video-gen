// The probe's fixtures, and the expectations they are scored against.
//
// ── PRE-REGISTRATION ────────────────────────────────────────────────────────────────────────
// Every expectation in this file was written BEFORE any model output was seen, and none of them
// may be revised once the probe has run. That discipline is the only thing separating a real
// verdict from a post-hoc rationalisation: thresholds that can be edited after the results are
// in are not thresholds. Each fixture carries a sha of its own content, written into every
// result file, and the runner refuses to merge results across differing shas — so a fixture
// that quietly drifts invalidates the comparison instead of poisoning it.
//
// The cast is real. scripts/fixtures/cast-dossiers.json holds eight dossiers captured verbatim
// from this project's own Casting Director output (.wrangler/state/v3/kv/DOSSIERS), so the
// model is fed the same messy, hazard-flagged, brand-marked prose production feeds it, rather
// than a tidy invention that would flatter it.
//
// Framing expectations are stated as a SET of acceptable bands, generously drawn. The question
// is never "did it choose the shot I would have chosen" — it is "does the beat obviously demand
// a close shot and did the geometry deliver one".

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CAST = JSON.parse(readFileSync('scripts/fixtures/cast-dossiers.json', 'utf8'));

const castOf = (...names) => names.map((n) => {
  const entry = CAST[n];
  if (!entry) throw new Error(`unknown cast member "${n}" in scripts/fixtures/cast-dossiers.json`);
  return entry;
});

const referencePlanOf = (cast) => cast.map((c) => ({ key: c.key, role: c.name, crop: '' }));

const GUARD = 'Every character has ordinary skin and is a living figure, not a mannequin and not a chrome statue.';

// ───────────────────────────────────────────────────────────────────────── F1 grid-launch
// The six-beat single take, lifted from scripts/launch-prompts.mjs's own oneshot. This is the
// case where the current pipeline's failures were actually measured — drivers inside cars, a
// garment bound to a wearer, one continuous lateral travelling camera — so it carries the most
// weight of any fixture here.

const f1Cast = castOf('ape', 'camoCar', 'antagonist', 'whiteCar', 'gmoney', 'velvetJacket');

const F1 = {
  id: 'grid-launch',
  label: 'six-beat continuous take, drivers inside cars, one travelling camera',
  spec: {
    title: 'Lights Out',
    logline: 'Two cars and their drivers wait on a wet night grid, and launch.',
    world:
      'Night on a wet black asphalt starting grid, heavy rain falling through the beams of overhead ' +
      'floodlights and steam drifting low across the ground. Tiered grandstands rise on both sides ' +
      'beyond the barriers, packed with cheering spectators.',
    staging:
      '<Subject 1> is the driver of <Subject 2> and stays inside it. <Subject 3> is the driver of ' +
      '<Subject 4> and stays inside it. <Subject 5> stands on the grid itself and is never in a car. ' +
      '<Subject 6> is a garment worn by <Subject 5>, never an independent figure. The two cars sit ' +
      'side by side on the grid, <Subject 2> on the left of the pair and <Subject 4> on the right.',
    guard: GUARD,
    camera:
      'One continuous unbroken take. The camera glides in a single smooth sideways movement down the ' +
      'grid at window height, staying outside the cars at all times and looking in through their open ' +
      'side windows.',
    continuity:
      'This is one single continuous unbroken shot filmed in one take. There are no cuts and no scene ' +
      'changes at any point.',
    beats: [
      'Rain falls across the starting grid. The camera opens on <Subject 2> alone, its front storage compartment standing open, no one else yet in frame.',
      'The camera glides along the grid and finds <Subject 1> sitting inside <Subject 2> in the driver\'s seat, both hands on the wheel, seen through the open side window.',
      'Continuing down the grid, the camera reaches <Subject 4>, where <Subject 3> sits inside at the wheel and turns to look straight down the lens.',
      '<Subject 5>, wearing <Subject 6>, stands alone at the front of the grid with one arm raised, both cars waiting behind.',
      'The arm drops and both <Subject 2> and <Subject 4> launch forward off the line together, throwing spray.',
      'The camera cranes up and back to hold the whole wet grid and the grandstands as the cars disappear into the rain.',
    ],
    sound: 'Rain on asphalt, idling engines, a crowd roar rising.',
    music: 'N/A',
    referencePlan: referencePlanOf(f1Cast),
    duration: 12,
    resolution: '768P',
    ratio: '16:9',
    intentTrace: [],
    notes: '',
  },
  cast: f1Cast,
  expectations: {
    axisTested: false, // a deliberately travelling camera legitimately re-orders the frame constantly
    perBeat: [
      { beat: 0, mustInclude: ['<Subject 2>'], mustExclude: ['<Subject 1>', '<Subject 3>', '<Subject 5>', '<Subject 6>'], expectFramingBand: ['EWS', 'WS', 'MWS'] },
      { beat: 1, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: ['<Subject 3>', '<Subject 5>', '<Subject 6>'], expectFramingBand: ['MCU', 'MS', 'MWS', 'CU'] },
      { beat: 2, mustInclude: ['<Subject 3>', '<Subject 4>'], mustExclude: ['<Subject 5>', '<Subject 6>'], expectFramingBand: ['CU', 'MCU', 'MS', 'MWS'] },
      { beat: 3, mustInclude: ['<Subject 5>', '<Subject 6>'], mustExclude: [], expectFramingBand: ['MS', 'MWS', 'WS'] },
      { beat: 4, mustInclude: ['<Subject 2>', '<Subject 4>'], mustExclude: [], expectFramingBand: ['MWS', 'WS', 'EWS'] },
      { beat: 5, mustInclude: [], mustExclude: [], expectFramingBand: ['WS', 'EWS'] },
    ],
    containment: [
      { subject: '<Subject 1>', container: '<Subject 2>', beats: [1] },
      { subject: '<Subject 3>', container: '<Subject 4>', beats: [2] },
    ],
    movement: [
      { subject: '<Subject 2>', beat: 4, moved: true, minMetres: 4 },
      { subject: '<Subject 4>', beat: 4, moved: true, minMetres: 4 },
    ],
    transitions: [],
    permittedSideSwaps: [],
  },
};

// ───────────────────────────────────────────────────────────────────── F2 two-hander-axis
// Adversarial, and the only fixture that tests the 180-degree line. Five beats across a table,
// with exactly two legitimate side swaps pre-registered. Beats 1 and 3 hold the camera on one
// side, so a swap there is physically impossible and counts as a floor violation.

const f2Cast = castOf('ape', 'antagonist');

const F2 = {
  id: 'two-hander-axis',
  label: 'five beats across a table; only two legitimate side swaps',
  spec: {
    title: 'Across The Table',
    logline: 'Two figures face each other across a narrow table, and one of them moves.',
    world: 'A low-lit room at night, a single hanging bulb over a narrow wooden table, bare walls beyond.',
    staging:
      '<Subject 1> and <Subject 2> sit facing each other across the narrow table. In the establishing ' +
      'framing <Subject 1> is on the left of frame and <Subject 2> is on the right.',
    guard: GUARD,
    camera: 'Deliberate and mostly still, with one considered move around the table and back.',
    continuity: 'No cuts. The camera moves only where a beat says it moves.',
    beats: [
      '<Subject 1> and <Subject 2> sit across the narrow table from each other, the camera holding a wide two-shot from one side of the table.',
      'From that same side of the table, without moving around it, the camera pushes in to a tighter two-shot.',
      'The camera moves round behind <Subject 1>\'s shoulder to a reverse angle looking across the table at <Subject 2>.',
      'Holding that same position behind <Subject 1>\'s shoulder, the camera tilts down to the table between them.',
      'The camera does not move. <Subject 1> stands, walks around the table, and stops standing behind <Subject 2>.',
    ],
    sound: 'A hum from the bulb, a chair scraping.',
    music: 'N/A',
    referencePlan: referencePlanOf(f2Cast),
    duration: 10,
    resolution: '768P',
    ratio: '16:9',
    intentTrace: [],
    notes: '',
  },
  cast: f2Cast,
  expectations: {
    axisTested: true,
    // Beat 2 crosses the line by camera; beat 4 swaps sides because a subject walks. Beats 1 and
    // 3 hold the camera still on one side, so a swap there cannot happen physically.
    permittedSideSwaps: [2, 4],
    perBeat: [
      { beat: 0, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: [], expectFramingBand: ['WS', 'MWS', 'MS'] },
      { beat: 1, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: [], expectFramingBand: ['MWS', 'MS', 'MCU'] },
      { beat: 2, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: [], expectFramingBand: ['MS', 'MCU', 'CU', 'MWS'] },
      { beat: 3, mustInclude: [], mustExclude: [], expectFramingBand: ['MCU', 'CU', 'MS', 'ECU'] },
      { beat: 4, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: [], expectFramingBand: ['MS', 'MWS', 'WS', 'MCU'] },
    ],
    containment: [],
    movement: [{ subject: '<Subject 1>', beat: 4, moved: true, minMetres: 1.2 }],
    transitions: [],
  },
};

// ─────────────────────────────────────────────────────────────────────── F3 cut-to-black
// Containment plus a transition. Beat 3 is a verbatim [CUT TO BLACK]: it must come back
// geometry-free, and continuity must RESET across it rather than firing a false teleport when
// the character reappears somewhere else entirely.

const f3Cast = castOf('ape', 'whiteCar', 'tower');

const F3 = {
  id: 'cut-to-black',
  label: 'a driver inside a car, a cut to black, and a world that resumes elsewhere',
  spec: {
    title: 'The Long Way Up',
    logline: 'A driver leaves the tower, and is somewhere else when the light returns.',
    world: 'A deserted city at dusk, wet streets, a single enormous concrete tower dominating the skyline.',
    staging:
      '<Subject 1> is the driver of <Subject 2> and is inside it whenever it appears. <Subject 3> is ' +
      'a building and never moves.',
    guard: GUARD,
    camera: 'Unhurried, mostly locked off, one move per beat at most.',
    continuity: 'A single cut to black divides the film; everything either side of it is continuous.',
    beats: [
      '<Subject 1> sits inside <Subject 2> in the driver\'s seat, the car parked at the foot of <Subject 3>.',
      '<Subject 2> pulls away from <Subject 3> and drives off down the empty street.',
      '[CUT TO BLACK] the screen holds black for a long moment before the world returns.',
      '<Subject 1> stands alone on an empty rooftop high above the city, no car anywhere.',
      '<Subject 1> walks to the edge of the roof and looks down at the street far below.',
    ],
    sound: 'Tyres on wet tarmac, distant wind at height.',
    music: 'A low sustained drone.',
    referencePlan: referencePlanOf(f3Cast),
    duration: 12,
    resolution: '768P',
    ratio: '16:9',
    intentTrace: [],
    notes: '',
  },
  cast: f3Cast,
  expectations: {
    axisTested: false,
    transitions: [2],
    perBeat: [
      { beat: 0, mustInclude: ['<Subject 1>', '<Subject 2>'], mustExclude: [], expectFramingBand: ['MCU', 'MS', 'MWS', 'CU'] },
      { beat: 1, mustInclude: ['<Subject 2>'], mustExclude: [], expectFramingBand: ['MWS', 'WS', 'EWS'] },
      { beat: 2, mustInclude: [], mustExclude: [], expectFramingBand: null },
      { beat: 3, mustInclude: ['<Subject 1>'], mustExclude: ['<Subject 2>'], expectFramingBand: ['MWS', 'WS', 'EWS', 'MS'] },
      { beat: 4, mustInclude: ['<Subject 1>'], mustExclude: ['<Subject 2>'], expectFramingBand: ['MS', 'MWS', 'WS', 'MCU'] },
    ],
    containment: [{ subject: '<Subject 1>', container: '<Subject 2>', beats: [0, 1] }],
    movement: [{ subject: '<Subject 2>', beat: 1, moved: true, minMetres: 5 }],
    permittedSideSwaps: [],
  },
};

// ───────────────────────────────────────────────────────────────────── F4 scale-extremes
// The direct test of the every-beat-is-MWS bug. Five beats whose shot size is not a matter of
// taste: a speck on a salt flat cannot be a close-up, and an iris filling the picture cannot be
// a wide. If the geometry can't reach the ends of the range here, it can't anywhere.

const f4Cast = castOf('antagonist');

const F4 = {
  id: 'scale-extremes',
  label: 'five beats whose shot size is unambiguous',
  spec: {
    title: 'Salt',
    logline: 'A figure crosses an empty salt flat and finally speaks.',
    world: 'An empty white salt flat under an enormous pale sky, flat to the horizon in every direction, hard noon light.',
    staging: '<Subject 1> is the only figure anywhere in this world.',
    guard: GUARD,
    camera: 'Whatever each beat demands. The range is the point.',
    continuity: 'One continuous passage of time.',
    beats: [
      'A single lone figure, <Subject 1>, is a speck at the far end of the empty salt flat under a huge sky.',
      '<Subject 1> walks toward us across the flat, still small against the emptiness.',
      'Her eye opens, and the iris and its flecks fill the whole picture.',
      'She stands and looks back the way she came, the full length of her against the flat.',
      'She says one word, and we are close enough to read her mouth.',
    ],
    sound: 'Wind across salt, footsteps on crust.',
    music: 'N/A',
    referencePlan: referencePlanOf(f4Cast),
    duration: 12,
    resolution: '768P',
    ratio: '16:9',
    intentTrace: [],
    notes: '',
  },
  cast: f4Cast,
  expectations: {
    axisTested: false,
    perBeat: [
      { beat: 0, mustInclude: ['<Subject 1>'], mustExclude: [], expectFramingBand: ['EWS'] },
      { beat: 1, mustInclude: ['<Subject 1>'], mustExclude: [], expectFramingBand: ['EWS', 'WS', 'MWS'] },
      { beat: 2, mustInclude: ['<Subject 1>'], mustExclude: [], expectFramingBand: ['ECU'] },
      { beat: 3, mustInclude: ['<Subject 1>'], mustExclude: [], expectFramingBand: ['WS', 'MWS', 'MS'] },
      { beat: 4, mustInclude: ['<Subject 1>'], mustExclude: [], expectFramingBand: ['CU', 'MCU'] },
    ],
    containment: [],
    movement: [{ subject: '<Subject 1>', beat: 1, moved: true, minMetres: 5 }],
    transitions: [],
    permittedSideSwaps: [],
  },
};

// ──────────────────────────────────────────────────────────────────────── F0 captured
// Real Screenwriter output, captured once from a live run and frozen. It exists to prove the
// schema survives real Nemotron messiness — odd beat phrasing, a referencePlan carrying garments
// and props, an intentTrace — which no hand-authored fixture reproduces. Written by
// `probe-storyboard-geometry.mjs --capture`, which refuses to overwrite an existing capture.

let F0 = null;
try {
  const captured = JSON.parse(readFileSync('scripts/fixtures/captured-spec.json', 'utf8'));
  F0 = {
    id: 'captured',
    label: 'real Screenwriter output, frozen',
    spec: captured.spec,
    cast: captured.cast,
    expectations: captured.expectations,
    captured: true,
  };
} catch {
  F0 = null; // not captured yet; the runner says so plainly rather than silently running four
}

const withSha = (fixture) => ({
  ...fixture,
  sha: createHash('sha256')
    .update(JSON.stringify({ spec: fixture.spec, cast: fixture.cast, expectations: fixture.expectations }))
    .digest('hex')
    .slice(0, 12),
});

export const FIXTURES = [F0, F1, F2, F3, F4].filter(Boolean).map(withSha);

export const fixtureById = (id) => FIXTURES.find((f) => f.id === id);

export const aspectOf = (spec) => {
  const [w, h] = String(spec.ratio ?? '16:9').split(':').map(Number);
  return w && h ? w / h : 16 / 9;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of FIXTURES) {
    const beats = f.spec.beats.length;
    const registered = f.expectations.perBeat.length;
    console.log(
      `${f.id.padEnd(18)} sha ${f.sha}  ${beats} beats, ${f.spec.referencePlan.length} refs, ` +
        `${registered} pre-registered${f.expectations.axisTested ? ', axis tested' : ''}`,
    );
    if (registered !== beats) console.log(`  ⚠ ${registered} expectations for ${beats} beats`);
  }
  if (!fixtureById('captured')) {
    console.log('\ncaptured           — not yet captured (run with --capture)');
  }
}
