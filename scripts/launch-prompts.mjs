// Race-launch prompts, as composable blocks rather than prose blobs.
//
// A shot is data: pick a camera move, a cast list, a wardrobe list and the beats, and the
// text assembles itself. That keeps the invariants (world, grade, no-brand-names) identical
// across every shot, which is what makes separate generations cut together.
//
// ── The rules, all measured rather than assumed (scripts/probe-h3.mjs) ───────────────────
//
// 1. NO BRAND NAMES. Naming a real brand trips the content filter (error 1026). Text carries
//    form and material; the reference images carry the marks.
//
// 2. REFERENCE MODE AND FRAME MODE CANNOT MIX. Verified: passing a first_frame alongside
//    reference images returns 400 "reference mode cannot be mixed with first_frame/
//    middle_frame/last_frame; choose one (2013)". Since every shot needs its own references,
//    no shot can be frame-chained — joins have to be designed instead (lightning flash).
//
// 3. ONLY EVER USE ORIGINAL REFERENCES. Feeding a derived frame back in as a reference
//    degrades the subject: probe P6 added a tiara correctly but left the character's face
//    gaunt and narrowed. No iterated dressing, no keyframe chains.
//
// 4. NINE SLOTS, AND NOTHING MAY FALL BACK TO PROSE. The cap is 9 and this film needs 12
//    assets, so v2 left the tiara, the Blossom and the crowd on prose alone. All three failed:
//    the Blossom rendered hatless, and the crowd was generic toys that were never Mocaverse in
//    any sense — no Moca reference was passed at all. The fix is COMPOSITES: side-by-side
//    panels in one slot (luggage-pair, wardrobe-trio, moca-trio, cars-trio). This is not a
//    resolution compromise — an individual crop is ~465x1024, whereas a three-panel composite
//    at H3's ceiling gives each asset 1200x1440. Faces stay individual regardless, because
//    that fidelity is the most valuable thing in the film.
//
// 5. GUARD AGAINST THE MANNEQUINS. The gown and the mosaic jacket are both photographed on
//    chrome mannequins (gold and iridescent). Without an explicit "ordinary skin, not a
//    mannequin" line the chrome is the most salient thing in the reference and comes along.
//    Probe P4 proved the guard works.
//
// 6. H3 DOES HANDLE MULTI-BEAT DIRECTION. The repo's old post-mortem said otherwise, but it
//    was reading a contact sheet made by a broken sampler. Re-sampled evenly, launch-1.mp4
//    runs four beats with five references and a travelling camera. Beats are numbered in the
//    text to hold the ordering.

// ─────────────────────────────────────────────────────────────────────── invariants

export const WORLD =
  'Night on a wet black asphalt starting grid, heavy rain falling through the beams of ' +
  'overhead floodlights and steam drifting low across the ground. A lighting gantry hangs ' +
  'above the grid. Tiered grandstands rise on both sides beyond the barriers, packed from ' +
  'front row to back with the small round-faced toy characters from the reference image — ' +
  'grey arms, knitted beanies and helmets, bright flat-coloured clothes — thousands of them, ' +
  'on their feet and cheering throughout.';

// NB "no text" is deliberately NOT absolute any more. v2 said "No text, lettering or signage
// anywhere", which fights the licensed assets themselves: the Blossom's cap is printed with a
// number, and the luggage carries monogram and pixel-print marks. The thing actually worth
// forbidding is ADDED type — the smeared card typography that ruined shot-ape-2 and the
// MCL_GENESIS lettering probe P3 reproduced letter-perfect. So forbid overlay, not print.
export const GRADE =
  'Photoreal cinematic render, anamorphic lens, shallow depth of field, high-contrast night ' +
  'grade, volumetric rain and light shafts, reflections in standing water, teal shadows ' +
  'against warm highlights. No captions, subtitles, watermarks or added signage.';

// The fix for two separate v2 defects that turned out to be one problem: nothing bound a
// driver to a car and nothing capped how many cars existed. So the model reused the
// Lamborghini for Courtney (it leads cars-trio), invented a fourth empty 911, and then
// launched only two of them.
export const GRID = ({ cars, cast }) =>
  `There are exactly three cars on the starting grid and no others, and not one of them is ` +
  `empty. The first car is ${cars.lambo}, and its driver is ${cast.ape}. The second car is ` +
  `${cars.porsche}, and its driver is ${cast.courtney}. The third car is ${cars.mclaren}, and ` +
  `its driver is ${cast.gmoney}. Each driver stays in their own car for the whole shot and ` +
  `never appears in another one. All three cars are different shapes from each other. ` +
  // Take 4 stood all three drivers OUTSIDE their cars, posed against the bodywork like a
  // photocall, which is not a race start. Seating has to be stated as a constraint, not left
  // implied by the word "driver".
  `Every driver is sitting inside their own car in the driver's seat with their hands on the ` +
  `steering wheel, visible from outside through the open side window. No driver ever stands ` +
  `outside a car, leans on one, or sits on the bodywork.`;

// The fix for the abrupt ape-to-Courtney jump. v2's beats read as a series of arrivals, which
// invites the model to cut between them; this says outright that it must not.
export const CONTINUITY =
  'This is one single continuous unbroken shot, filmed in one take. There are no cuts, no ' +
  'edits, no jump cuts and no scene changes at any point. The camera never stops moving and ' +
  'never teleports — it glides in one smooth uninterrupted sideways movement down the grid, ' +
  'passing each car in turn. ' +
  // Take 5 seated the drivers correctly but put the camera INSIDE the cabins to do it, and a
  // camera inside one car cannot glide to the next — so it cut between them, which is the one
  // thing this block exists to prevent. Camera position therefore has to be constrained too:
  // outside the cars, at window height, looking in.
  'The camera stays outside the cars at all times, flying alongside them at window height and ' +
  'looking in through their open side windows from outside. It never goes inside a cabin, and ' +
  'the exterior of each car stays visible in frame as it passes.';

export const GUARD =
  'Every character has ordinary skin and is a living figure, not a mannequin and not a ' +
  'chrome statue.';

// ─────────────────────────────────────────────────────────────────────────── cast

export const CAST = {
  ape:
    'a stylised blue-grey ape character with a tan muzzle, wearing a woven yellow bucket ' +
    'hat and red heart-shaped sunglasses',
  courtney:
    'a stylised bald young woman with green diamond-shaped paint around both eyes, dark ' +
    'plum lipstick and a studded black choker',
  gmoney:
    'a stylised brown ape character with wide pale eyes, wearing a knitted orange beanie',
};

export const WARDROBE = {
  'velvet-jacket': 'a deep burgundy velvet jacket with dense silver baroque embroidery',
  'silver-dress':
    'an off-the-shoulder silver metallic gown embroidered with colourful jewelled goblets ' +
    'and trimmed in gold',
  'mosaic-jacket':
    'a jacket covered in small glazed mosaic tiles of gold, deep green, white and dark ' +
    'blue, patterned with white eight-pointed star-flowers, with a dark green patent collar',
  tiara:
    'a tall jewelled tiara set with deep red stones, turquoise-blue stones and clear brilliants',
};

export const PROPS = {
  rimowa:
    'a grooved aluminium cabin case printed with black-and-white pixel camouflage and a ' +
    'small yellow lightning bolt',
  'lv-trunk':
    'a white hard-sided travel trunk with a repeating monogram pattern and tan leather corners',
  // The cap is stated first and hard, because v2 rendered this as a hatless white blob. It had
  // no reference slot then; now it has one, and the prose leads with the thing that went missing.
  blossom:
    'a small glossy white vinyl figure wearing a bright green peaked cap with a number printed ' +
    'on the front and a dark strap under its chin, with pointed cat-like ears either side of ' +
    'the cap and its whole body printed with painted flowers',
  // Described by the Mocaverse traits that actually identify one — grey arms, the beanie-over-
  // helmet head, the big flat face — rather than the generic "round pastel faces, knitted
  // beanies" of v2, which is precisely the description a generic toy crowd satisfies.
  mocas:
    'the small toy characters from the reference image: big round flat-coloured faces with wide ' +
    'simple eyes and rosy cheeks, grey arms and dark mitten hands, each wearing a knitted ' +
    'beanie over a rounded white helmet, in bright flat-coloured clothes',
};

// Silhouette only — never the marque. These are deliberately cheap on reference slots.
export const CARS = {
  // No "front storage compartment" here — the beats that need it say so, and repeating it
  // inside the silhouette produced "the front storage compartment of a hypercar with a front
  // storage compartment stands open".
  lambo: 'a low, sharply-creased wedge-profile hypercar with Y-shaped running lights',
  porsche: 'a white rounded-silhouette sports car with four round LED headlamps',
  mclaren:
    'a mid-engined coupe wrapped in a fine black-and-white topographic line pattern with ' +
    'gold wheels',
};

// ───────────────────────────────────────────────────────────────────── references

const CAST_DIR = 'assets/refs/cast';
const REFS = {
  ape: 'assets/refs/frames/ape-head.png',
  courtney: `${CAST_DIR}/courtney.png`,
  gmoney: `${CAST_DIR}/gmoney.png`,
  'velvet-jacket': 'assets/refs/raw/jacket-still.jpg',
  'silver-dress': `${CAST_DIR}/silver-dress.png`,
  'mosaic-jacket': `${CAST_DIR}/mosaic-jacket.png`,
  tiara: `${CAST_DIR}/tiara.png`,
  rimowa: 'assets/refs/raw/rimowa-still.png',
  'lv-trunk': 'assets/refs/raw/lv-trunk-still.jpg',
  blossom: `${CAST_DIR}/blossom.png`,
  revuelto: 'assets/refs/frames/revuelto-03.png',
  porsche: `${CAST_DIR}/porsche.png`,
  mclaren: `${CAST_DIR}/mclaren.png`,
  // Three marques in ONE reference slot, side by side at aspect 2.46. Built because take 1
  // of the one-shot rendered all three cars as the same Lamborghini: the second and third
  // were prose-only, so the model reached for the single car reference it had. Slots are the
  // scarce resource at 9, and this buys back two of them.
  'cars-trio': `${CAST_DIR}/cars-trio.png`,
  'moca-a': `${CAST_DIR}/moca-a.png`,
  'moca-b': `${CAST_DIR}/moca-b.png`,
  // Composites, each buying back a slot so nothing has to fall back to prose. v2 had 12 assets
  // and 9 slots, so the tiara, the Blossom and the ENTIRE CROWD got none — which is why the
  // crowd was never Mocaverse in any sense and the Blossom rendered without its cap.
  'luggage-pair': `${CAST_DIR}/luggage-pair.png`,
  'wardrobe-trio': `${CAST_DIR}/wardrobe-trio.png`,
  'moca-trio': `${CAST_DIR}/moca-trio.png`,
};

export const refFiles = (keys) =>
  keys.map((k) => {
    if (!REFS[k]) throw new Error(`unknown reference "${k}"`);
    return REFS[k];
  });

/** Numbered beats, because ordering is the thing H3 is most likely to shuffle. */
const beats = (list) => list.map((b, i) => `Beat ${i + 1}: ${b}`).join(' ');

export const assemble = ({ camera, beats: list, sound, grid = false, continuity = false }) =>
  [
    WORLD,
    grid ? GRID({ cars: CARS, cast: CAST }) : null,
    continuity ? CONTINUITY : null,
    camera,
    beats(list),
    GUARD,
    GRADE,
  ]
    .filter(Boolean)
    .join(' ') + `\n\nSound: ${sound}`;

// ─────────────────────────────────────────────────────────────────────────── shots

export const SHOTS = {
  // The whole film in one generation. 15s is H3's ceiling and 9 references is its cap, so this
  // is the most the model can be asked for at once — and the only way to get a race launch with
  // genuinely no joins at all.
  //
  // Every one of the nine slots is now filled, via composites where necessary. v2 left the
  // tiara, the Blossom and the crowd on prose alone, and all three failed: no cap on the
  // Blossom, and a crowd of generic toys that was never Mocaverse at all.
  //
  // Beat lengths are deliberately re-weighted. The frunk opening is the most proven image in
  // the project — it is essentially launch-1, and it is already the poster — so it can afford
  // to be brisk. That time goes to the finale, because the crowd needs long enough on screen
  // for the Mocas to be identifiable rather than a texture.
  oneshot: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '2K',
    duration: 15,
    ratio: '16:9',
    grid: true,
    continuity: true,
    referenceKeys: [
      'luggage-pair', 'cars-trio', 'ape', 'courtney', 'gmoney',
      'wardrobe-trio', 'tiara', 'blossom', 'moca-trio',
    ],
    camera:
      'One unbroken camera move: it starts tight on an open front storage compartment, rises ' +
      'and glides steadily left to right along the front row of the grid, passing all three ' +
      'stationary cars in turn without ever stopping, then drops down into the crowd at the ' +
      'trackside and stays low among them. The camera never leaves the stadium and never ' +
      'becomes a distant aerial view.',
    beats: [
      // Brisk: two seconds, no lingering. The lid is the only action.
      `quickly, the front storage compartment of the first car stands open and lit from within. Inside sit ${PROPS.rimowa} and ${PROPS['lv-trunk']}, rain beading on both, and the compartment lid glides shut.`,
      `still moving, the camera rises over the closing lid and slides back along that same car's flank to its open driver's window, where ${CAST.ape} sits at the wheel in ${WARDROBE['velvet-jacket']}, one hand on the rim. He turns his head to the lens.`,
      // "Slides past ... and continues along" rather than "arrives on": v2's arrival language
      // is what invited a cut here.
      `without any cut, the camera keeps sliding right, past the first car's rear wheel and along the flank of the SECOND car to its open driver's window, where ${CAST.courtney} sits at the wheel in ${WARDROBE['silver-dress']}, wearing ${WARDROBE.tiara} on her head. She looks at the lens and closes one eye in a slow deliberate wink, lips together, smiling only slightly.`,
      `still without any cut, the camera keeps sliding right along the flank of the THIRD car to its open driver's window, where ${CAST.gmoney} sits at the wheel in ${WARDROBE['mosaic-jacket']}. ${PROPS.blossom} is propped on the passenger seat beside him. Three red lights flare one after another on the gantry above and he grins.`,
      // Named individually, because counting ("all three") was not enough on its own in v3 — a
      // list is harder to quietly drop one from. But NOT "all three visible in the same frame at
      // once", which take 4 satisfied by pulling back into a group photocall and standing the
      // drivers outside their cars. Demand the three departures, not one wide frame.
      `the lights turn green and all three cars launch forward off the grid together — the wedge-profile hypercar, the white round-headlamp sports car and the topographic-patterned coupe — each one still driven from inside by its own seated driver, water exploding from their tyres and spray filling the air behind them.`,
      // The long beat. v3's version ended "rises into a wide over the packed stands", and the
      // camera took that literally: it climbed out of the stadium altogether and finished on a
      // distant aerial cityscape with the crowd nowhere in frame. So the rise is gone and the
      // camera is pinned down in the crowd for the whole beat.
      `the camera drops low into the front row of the grandstand, so the nearest toy characters fill the frame in sharp focus — big round flat-coloured faces, rosy cheeks, grey arms and dark mitten hands raised, knitted beanies over rounded white helmets — cheering as the three cars accelerate away up the track behind them. The camera stays down here among the crowd and does not rise, climb or pull away. Then a bolt of lightning strikes directly overhead and its flash floods the entire picture with pure blinding white.`,
    ],
    sound:
      'rain on metal, a soft servo as the lid closes, engines idling then rising, three ' +
      'countdown tones, a starting signal, three engines launching hard, a roaring crowd, ' +
      'and a thunder crack.',
    why:
      'v3. Same single-take recipe, but every one of the nine slots is filled via composites, ' +
      'plus a GRID block that binds each driver to their own car and caps the grid at three, ' +
      'and a CONTINUITY block forbidding cuts. Fixes, in order: Courtney appearing in a second ' +
      'Lamborghini, the abrupt cut onto her, a phantom fourth empty car, only two of the three ' +
      'launching, the Blossom losing its cap, and a crowd that was never Mocaverse.',
  },

  // ── The reliable spine: four 6s shots joined on lightning flashes. Built regardless of
  // whether the one-shot holds, because each of these is a much smaller ask.
  lambo: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '2K',
    duration: 6,
    ratio: '16:9',
    // Exactly launch-1's reference set, which is verified to render all five correctly.
    referenceKeys: ['ape', 'velvet-jacket', 'revuelto', 'rimowa', 'lv-trunk'],
    camera:
      'The camera starts tight on an open front storage compartment, then rises and travels ' +
      'along the flank of the car to the driver\'s window.',
    beats: [
      `the front storage compartment of ${CARS.lambo} stands open and lit from within. Inside sit ${PROPS.rimowa} and ${PROPS['lv-trunk']}, rain beading on both. The compartment lid glides shut.`,
      `the camera rises and travels the flank to the open driver's window, where ${CAST.ape} sits at the wheel in ${WARDROBE['velvet-jacket']}, one hand on the rim. He turns his head to the lens and lifts his chin.`,
    ],
    sound: 'rain on metal, a soft servo as the lid closes, and a rising hybrid whine.',
    why: "launch-1's exact configuration, re-rendered at 2K. Known good.",
  },

  porsche: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '2K',
    duration: 6,
    ratio: '16:9',
    referenceKeys: ['courtney', 'silver-dress', 'tiara', 'porsche'],
    // Probe P7 proved this exact move: the model orbits a front-on plate round to the side
    // window and re-lights the studio backdrop into wet floodlit night. Necessary because
    // the 911 artwork exists only front-on and its windscreen is too dark to read a driver
    // through.
    camera:
      'The camera trucks in from the left and arcs around the front of the car to settle on ' +
      "the open driver's window.",
    beats: [
      `${CARS.porsche} stands still on the grid with its engine idling, rain running down the glass.`,
      `${CAST.courtney} sits at the wheel in ${WARDROBE['silver-dress']}, wearing ${WARDROBE.tiara}, one hand on the rim. She turns her face to the lens and winks, and three lights begin to fill on the gantry above.`,
    ],
    sound: 'rain on metal, an idling engine, a low synth pulse, and the first countdown tone.',
    why: 'P7 rendered the core of this on the first take.',
  },

  mclaren: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '2K',
    duration: 6,
    ratio: '16:9',
    referenceKeys: ['gmoney', 'mosaic-jacket', 'blossom', 'mclaren'],
    camera:
      "The camera trucks to the right along the grid and pushes in slowly on the open driver's window.",
    beats: [
      `${CARS.mclaren} stands still on the grid, rain beading on the pattern, and ${PROPS.blossom} sits on the dashboard catching the light.`,
      `${CAST.gmoney} sits at the wheel in ${WARDROBE['mosaic-jacket']}, both hands on the rim. Three lights flare one after another on the gantry above and he grins.`,
    ],
    sound: 'rain, a deep engine idling, three rising countdown tones.',
  },

  launch: {
    api: 'v2',
    model: 'MiniMax-H3',
    resolution: '2K',
    duration: 6,
    ratio: '16:9',
    referenceKeys: ['moca-a', 'moca-b', 'revuelto'],
    camera:
      'The camera pulls back fast and cranes up from the grid into a wide aerial view.',
    beats: [
      `the gantry lights turn green and three cars launch forward together, water exploding from the tyres and spray filling the air behind them.`,
      `the camera rises to reveal the grandstands on both sides packed with ${PROPS.mocas}, all on their feet cheering as the cars accelerate away, and a bolt of lightning cracks across the sky and blows the whole frame to white.`,
    ],
    sound:
      'a starting signal, three engines launching hard, tyres tearing at wet asphalt, a ' +
      'roaring crowd, and a thunder crack.',
    why:
      'The Mocaverse art is flat 2D, so the crowd is deliberately prompted as toy-like 3D to ' +
      'match the adidas cast. The showroom probe proved H3 replicates one reference into many ' +
      'instances, which is what populates a full stand from two.',
  },
};

/** Cut order for the four-shot spine. */
export const SPINE = ['lambo', 'porsche', 'mclaren', 'launch'];

export const buildShot = (name) => {
  const shot = SHOTS[name];
  if (!shot) throw new Error(`unknown shot "${name}" (have: ${Object.keys(SHOTS).join(', ')})`);
  return {
    ...shot,
    name,
    text: assemble(shot),
    referenceImages: refFiles(shot.referenceKeys ?? []),
  };
};
