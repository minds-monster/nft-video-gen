// Prompts and render configs for the hero video, kept in git so a good render is
// reproducible and a bad one is diagnosable.
//
// Two rules govern every prompt here:
//
// 1. NO BRAND NAMES. MiniMax rejects prompts naming real brands (error 1026), and we do
//    not need them: the reference images carry the exact marks, materials and geometry.
//    The text only has to direct motion and light. Fidelity lives in the pixels.
//
// 2. NO BRACKETED CAMERA DIRECTIVES ON H3. `[Push in]`, `[Tracking shot]` and friends are
//    a /v1 feature. H3 (/v2) wants natural cinematic prose plus a `Sound:` clause. Only
//    the `car` probe below uses brackets, and it deliberately runs on /v1 to test them.

const REF = 'assets/refs/frames';
const RAW = 'assets/refs/raw';
const WIDE = 'assets/refs/wide';

/**
 * 1920×1080 reference frames, composed by prep-refs.mjs.
 *
 * These exist because /v1 image-to-video returns a video with the aspect ratio of its
 * first frame — `resolution` only sets the short side. Every source token is square, so
 * without these the hero would come back 768×768.
 */
export const WIDE_REFS = {
  car: `${WIDE}/car.png`,
  carFleet: `${WIDE}/car-fleet.png`,
  ape: `${WIDE}/ape.png`,
  rimowa: `${WIDE}/rimowa.png`,
  lvTrunk: `${WIDE}/lv-trunk.png`,
  jacket: `${WIDE}/jacket.png`,
};

/**
 * Reference stills, after prep-refs.mjs has cut the subjects out of their composites.
 *
 * `apeHead` and `apeFigure` are crops: the source token is a trading card on which the
 * ape is about a sixth of the frame, behind a neon border and a wall of type. Handed over
 * whole, the card is what gets reproduced.
 */
export const REFS = {
  apeHead: `${REF}/ape-head.png`,
  apeFigure: `${REF}/ape-figure.png`,
  // The Revuelto token is a slideshow of photoreal studio renders in many liveries.
  car: `${REF}/revuelto-03.png`, // clean white car, front three-quarter
  carAlt: `${REF}/revuelto-06.png`, // white with pale blue stripes, front three-quarter
  carLineup: `${REF}/revuelto-07.png`, // several cars side by side — a grid, in the source art
  jacket: `${RAW}/jacket-still.jpg`,
  rimowa: `${RAW}/rimowa-still.png`,
  lvTrunk: `${RAW}/lv-trunk-still.jpg`,
};

/**
 * Diagnostic probes, cheap on purpose (768P, 6s, ≈$0.48 each).
 *
 * `launch` and `showroom` are a deliberate head-to-head. The brief asked for the ape
 * driving the car with luggage in the frunk; the source art makes that four acts of
 * invention (extract the ape from a card, give the car an interior and a frunk it was
 * never rendered with, swap his tracksuit for a jacket that only exists on a mannequin,
 * and place two flat product shots inside a cavity). `showroom` tests the opposite
 * approach — stage the assets the way their own renders already present them. Rendering
 * both is cheaper than arguing about it.
 */
export const PROBES = {
  // ---------------------------------------------------------- A: character fidelity
  ape: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '768P',
    duration: 6,
    ratio: '16:9',
    referenceImages: [REFS.apeHead, REFS.apeFigure],
    text: `The stylised blue-furred ape character from the reference stands in a dark studio, lit from the front. He wears the neon-yellow zip-up tracksuit, the woven yellow bucket hat and the red heart-shaped sunglasses exactly as shown. He turns his head slowly toward the lens and tilts his chin up. The camera drifts in a slow arc from his left toward centre. Glossy toy-like 3D render, saturated colour, soft studio key light, deep violet background falling off to black.

Sound: a low synth pad, a soft mechanical click as he turns.`,
    why: 'Does H3 hold this character\'s exact design — fur colour, muzzle, hat, heart glasses — through a head turn?',
  },

  // ------------------------------------------------------- B: vehicle + motion quality
  // On /v1 on purpose: Hailuo-02 supports first_frame_image AND the bracketed camera
  // directives, so this probe tests both the bodywork and the directive vocabulary.
  car: {
    api: 'v1',
    model: 'MiniMax-Hailuo-02',
    resolution: '768P',
    duration: 6,
    firstFrameImage: REFS.car,
    text: `The camera rises slightly and pushes slowly along the flank of the white wedge-profile supercar toward its front wheel arch [Pedestal up, Push in]. Soft overhead studio light travels across the paint and the carbon inlets. The car does not move. Nothing else enters frame. Clean bright studio backdrop, photoreal, high-gloss reflections.`,
    why: 'Do panel lines, wheel geometry and badges survive camera motion, and do the bracketed directives work?',
  },

  // ------------------------------------------ C: the brief as specified — "The Launch"
  launch: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '768P',
    duration: 6,
    ratio: '16:9',
    referenceImages: [REFS.apeHead, REFS.jacket, REFS.car, REFS.rimowa, REFS.lvTrunk],
    text: `Night, on wet black asphalt. The front storage compartment of the white wedge-profile supercar from the reference stands open and lit from within. Inside sit the grooved aluminium cabin case with the black pixel-camouflage print and the white patterned hard-sided travel trunk from the references, rain beading on both. The compartment lid glides shut. The camera rises and pushes along the flank to the driver's window, where the blue-furred ape from the reference sits at the wheel in the burgundy velvet jacket with silver baroque embroidery, one hand on the rim, turning to face the lens. Overhead lamps sweep the bodywork; steam drifts low.

Photoreal, anamorphic, shallow depth of field, high-contrast night grade, volumetric rain.

Sound: rain on metal, a soft servo as the lid closes, a rising hybrid whine.`,
    why: 'The brief as written. Tests whether H3 can invent an interior, a frunk cavity and a costume swap while keeping five assets recognisable.',
  },

  // ------------------------------- D: the alternative — stage them as the art presents them
  showroom: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '768P',
    duration: 6,
    ratio: '16:9',
    referenceImages: [REFS.carLineup, REFS.apeFigure, REFS.rimowa, REFS.lvTrunk, REFS.jacket],
    text: `A long bright white gallery. The row of wedge-profile supercars from the reference stands in formation down the centre of the floor, each in its own livery, nose toward camera, perfectly still. Along the left wall, the grooved aluminium cabin case and the white patterned travel trunk rest on low lit plinths, and the burgundy embroidered velvet jacket stands on a chrome mannequin. The blue-furred ape in the neon-yellow tracksuit walks slowly away from camera down the centre line between the cars, hands at his sides. The camera tracks steadily forward behind him at waist height. Soft infinite studio light, white seamless floor and walls, clean reflections, no text or signage anywhere.

Sound: a quiet room tone, soft footsteps, a distant low hum.`,
    why: 'Stages every asset the way its own render already does — objects in a lit space. Nothing invented, so nothing to morph.',
  },
};

// ---------------------------------------------------------------------------- the hero
//
// ⚠️ THE POST-MORTEM THAT USED TO LIVE HERE WAS WRONG. It asserted two things:
//
//   1. "H3 reference-mode DISCARDS references it can't reconcile — given five heterogeneous
//      assets it rendered two, or one. It never combined them."
//   2. "H3 also ignores multi-beat direction inside a short clip. Both five-reference probes
//      came back as near-static single tableaux."
//
// Both are FALSE, and together they cost this project its architecture: they are why the hero
// collapsed to a single static shot instead of the race launch that was asked for.
//
// They were an artifact of the contact-sheet sampler bug documented in gen-video.mjs — the
// old `select='not(mod(n,round(max(1,t))))'` filter, whose interval grows with t, crushed
// every sample into the opening second. Re-sampled EVENLY with `fps=N`:
//
//   * launch-1.mp4 runs the whole original brief in one 6.5s generation — the open frunk with
//     both cases, THE LID CLOSING, a pull back to the entire car, the camera TRAVELLING THE
//     FLANK, and the ape at the wheel in the embroidered jacket. Five refs, four beats.
//   * showroom-1.mp4 rendered ALL FIVE of its references too: the car lineup, the ape, both
//     luggage pieces, and the velvet jacket on a chrome mannequin.
//
// What is actually true, measured by scripts/probe-h3.mjs:
//
//   * Reference mode holds heterogeneous refs well (2 cleanly; 5 and 9 both landed in full)
//     and DOES carry multi-beat direction with a travelling camera.
//   * Reference mode and first/last-frame mode are mutually exclusive — the API rejects the
//     combination outright: "reference mode cannot be mixed with first_frame/middle_frame/
//     last_frame; choose one (2013)". The guard in minimax.mjs is correct.
//   * Feeding a DERIVED frame back in as a reference degrades the subject, so keyframe
//     chaining is a false economy. Only ever reference the original artwork.
//   * Per-asset fidelity is excellent, which is the proof the licensing thesis needs.
//
// The race launch therefore lives in ONE 15s generation with 9 references — see
// scripts/launch-prompts.mjs. The montage below is superseded and kept only for reference.
//
// The rule this leaves behind: NEVER judge a render from a contact sheet whose sampling you
// have not verified. An evenly-sampled sheet is the cheapest instrument here, and a badly
// sampled one does not merely mislead, it inverts the conclusion.

const SHOT = {
  api: 'v1',
  model: 'MiniMax-Hailuo-02',
  resolution: '1080P',
  duration: 6,
};

/**
 * Camera directives are bracketed because these run on /v1, where the vocabulary is a
 * documented feature — and `prompt_optimizer: false` in the client keeps an LLM from
 * rewriting them away. Max three per bracket; beyond that the motion goes incoherent.
 */
export const SHOTS = {
  car: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.car,
    text: `The camera rises slightly and pushes slowly along the flank of the white wedge-profile supercar toward its front wheel arch [Pedestal up, Push in]. Soft overhead studio light travels across the paint and the carbon inlets. The car itself does not move. Clean bright studio backdrop, photoreal, high-gloss reflections.`,
  },
  fleet: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.carFleet,
    text: `The camera trucks slowly to the left across the row of parked supercars, each in a different livery [Truck left]. Overhead studio light sweeps along the line of bodywork. The cars are stationary. Bright seamless studio floor, photoreal, no text or signage.`,
  },
  ape: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.ape,
    text: `The stylised blue-furred ape character wearing the woven yellow hat and red heart-shaped sunglasses turns his head slowly toward the lens and tilts his chin up, while the camera eases in [Push in]. His design does not change. Glossy toy-like 3D render, saturated violet backdrop, soft studio key light.`,
  },
  rimowa: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.rimowa,
    text: `The grooved aluminium cabin case rotates very slowly on its illuminated circular plinth as the camera trucks right around it [Truck right]. The blue ring light pulses gently. The printed pattern on the shell stays sharp and unchanged. Dark navy void, photoreal product lighting.`,
  },
  lvTrunk: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.lvTrunk,
    text: `The camera pulls back slowly from the white patterned hard-sided travel case, revealing more of the chrome grid wall behind it [Pull out]. Cool light glides across the metal corners and the clasp. The case hangs perfectly still and its surface pattern does not change. Photoreal, cool grey palette.`,
  },
  jacket: {
    ...SHOT,
    firstFrameImage: WIDE_REFS.jacket,
    text: `The camera drifts upward along the burgundy velvet jacket with silver baroque embroidery, from hem to collar [Pedestal up]. Warm light travels across the raised metallic threadwork, catching it a section at a time. The garment and the iridescent chrome mannequin stay still. Photoreal, dark warm studio, shallow depth of field.`,
  },
};

/**
 * The one shot that is NOT a single pinned asset.
 *
 * This came out of the `launch` probe, which was written to fail — it asked H3 to invent a
 * frunk cavity, a car interior and a costume swap. It dropped three of its five references
 * exactly as expected. But what it *did* render — the open compartment with the aluminium
 * case and the monogram trunk strapped inside, on wet asphalt under bokeh city lights — is
 * the strongest single image in the whole set, and both brand marks are correctly formed.
 *
 * So it stays, as the payoff after the two cases have been introduced separately. Kept on
 * /v2 H3 with its original configuration so it remains reproducible; note it renders at
 * 1344×768 rather than 1920×1080, so the assembly upscales it ~1.4×.
 */
SHOTS.launch = {
  ...PROBES.launch,
  // The good take predates the shot naming convention, so it is on disk as `launch-N.mp4`
  // rather than `shot-launch-N.mp4`. assemble-hero.sh accepts either.
  take: 'launch',
};

/**
 * The cut: `shot` or `shot:seconds`, in order. Currently one shot, ≈6.5s.
 *
 * `launch` is the whole hero on its own, because it is not a tableau — it runs the entire
 * brief in a single generation: the open compartment with the aluminium case and the
 * monogram trunk, the lid closing, the camera travelling the flank, and the ape at the wheel
 * in the embroidered jacket. Every brand appears inside it, so cutting to separate product
 * shots afterwards only repeated what the shot had already said.
 *
 * The other entries in SHOTS are kept and still render on demand
 * (`npm run gen:video -- --shot rimowa`) — add them back here to lengthen the cut.
 *
 * scripts/assemble-hero.sh reads this array directly, so this is the only place the order
 * and timing are defined.
 */
export const MONTAGE = ['launch:6.5'];
