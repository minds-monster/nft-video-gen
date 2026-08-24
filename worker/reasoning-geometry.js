// Reading the model's own thinking-out-loud for geometry it has not committed to yet.
//
// WHY THIS EXISTS. A whole-film call takes three to five minutes, and measurement (2026-08-25)
// settled exactly what is available during that time:
//
//   - the reasoning channel streams from 4.4s and never stops: 937 deltas, 8,121 characters
//   - the structured answer does NOT stream. The tool-call arguments arrive as ONE 6,358-character
//     delta at 347.3s, atomically, at the very end
//
// So "watch the JSON assemble" is not a thing that can exist. What CAN exist is better: the model
// narrates its geometry in prose as it decides it, and revises it out loud. One measured trace
// contained 41 explicit coordinates, 7 dimensions, 6 lens lengths, 21 shot-size calls, containment
// decisions, and five self-corrections — passing over the beats six times in order, planning, then
// refining, then re-checking the 180-degree line.
//
// This module turns that prose into provisional scene fragments, so a visitor can watch a frame
// assemble and correct itself instead of watching a spinner.
//
// ⚠️ EVERYTHING HERE IS A GUESS, AND MUST BE PRESENTED AS ONE. It is heuristic parsing of prose
// written for the model's own benefit, not an interface. It is provisional in the strongest sense:
// the model contradicts itself on purpose, which is what thinking is. Nothing in here is ever
// validated, stored, compiled to H3, or shown as though it were the frame. The authoritative scene
// is the one that arrives in the tool call and passes validateScene — this is the thinking, drawn.
//
// It is also model-specific by nature. Nemotron narrates this way; another model may not, and the
// paid path exposes only summaries. Degrade quietly: no parse, no ghosts, reasoning text alone.

const BANDS = ['EWS', 'WS', 'MWS', 'MS', 'MCU', 'CU', 'ECU'];

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const TRIPLE = String.raw`\(\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*\)`;

/** "Camera at (2, 1.6, 13) looking at (0, 1.0, 10)" — the single most valuable line in the trace,
 * because it is a complete pose and can be drawn immediately. */
const CAMERA_POSE = new RegExp(
  String.raw`camera\s*(?:is|sits|starts|at|:)?\s*(?:at\s*)?${TRIPLE}\s*(?:,\s*)?(?:looking\s*at|aimed\s*at|toward)\s*${TRIPLE}`,
  'gi',
);

/** A bare position for a named thing: "ape at (0, 0, 0)", "<Subject 2> at (0,0,10)". */
const SUBJECT_AT_TRIPLE = new RegExp(String.raw`([\w<>\s-]{2,24}?)\s+(?:is\s+)?at\s*${TRIPLE}`, 'gi');

/** "ape at x=0", "car at x = 2.5" — the trace uses this shorthand constantly. */
const SUBJECT_AT_X = new RegExp(String.raw`([\w<>\s-]{2,24}?)\s+(?:is\s+)?at\s+x\s*=\s*(${NUM})`, 'gi');

/** "height ~1.8m", "Height ~1.3m, width ~2.0m". */
const HEIGHT = new RegExp(String.raw`height\s*[~:]?\s*(${NUM})\s*m`, 'gi');
const WIDTH = new RegExp(String.raw`width\s*[~:]?\s*(${NUM})\s*m`, 'gi');

const LENS = new RegExp(String.raw`(\d{2,3})\s*mm`, 'gi');
const BEAT_HEADER = /(?:^|\n)\s*(?:beat|for beat)\s*(\d+)/gi;
const BAND = new RegExp(String.raw`\b(${BANDS.join('|')})\b`, 'g');
const CONTAINER = /container(?:Id)?\s*[=:]?\s*"?(<Subject \d+>)"?|(\w+)\s+inside\s+(?:the\s+)?(\w+)/gi;

/** The model coins its own shorthand and then uses it exclusively — it writes "<Subject 2> (car)"
 * once and says "Car" forever after. That shorthand is frequently NOT a word in the dossier name:
 * the sedan's name is "a battered sand-coloured sedan", which contains no "car" at all, so
 * "Car width 2m" resolved to the wrong subject entirely and made the ape two metres wide.
 *
 * So the aliases are learned from the trace itself rather than assumed from the cast. */
const ALIAS_AFTER = /<Subject (\d+)>[ \t]*(?:\(([^)\n]{2,24})\)|[ \t]*[:=][ \t]*([A-Za-z][\w-]{1,23}))/g;
/** The other direction, which the model uses just as freely: "Car (<Subject 2>) appears". */
const ALIAS_BEFORE = /\b([A-Za-z][\w-]{1,23})[ \t]*\(\s*<Subject (\d+)>\s*\)/g;

/** Words that are the vocabulary of the task rather than a name for anything in it. Without this,
 * a bullet like "- Shot size: EWS" sitting under a subject line teaches "shot" as an alias, and
 * every later mention of a shot resolves to that subject. */
const NOT_A_NAME = new Set([
  'shot', 'subject', 'beat', 'camera', 'frame', 'framing', 'size', 'principal', 'reveal',
  'container', 'position', 'height', 'width', 'lens', 'angle', 'scene', 'the', 'and', 'for',
  'maybe', 'appears', 'shots', 'ground', 'offset',
]);

export const learnAliases = (text) => {
  const aliases = {};
  const add = (word, index) => {
    const bare = String(word ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).pop();
    if (!bare || bare.length < 2 || NOT_A_NAME.has(bare)) return;
    aliases[bare] = `<Subject ${index}>`;
  };
  for (const m of text.matchAll(ALIAS_AFTER)) add(m[2] ?? m[3], m[1]);
  for (const m of text.matchAll(ALIAS_BEFORE)) add(m[1], m[2]);
  return aliases;
};

/** A beat named INLINE rather than as a header — "Containment: beat 3, ape inside car". The model
 * writes plenty of these, and attributing them to whichever section they physically sit in put the
 * ape inside the car a beat before it ever climbed in. */
const beatHintNear = (text, offset) => {
  const lineStart = text.lastIndexOf('\n', offset) + 1;
  const lineEnd = text.indexOf('\n', offset);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const hit = line.match(/beat\s*(\d+)/i);
  return hit ? Number(hit[1]) - 1 : null;
};

/**
 * Resolve whatever the model called something into a canonical "<Subject N>" tag.
 *
 * The trace mixes registers freely — "<Subject 1>", "the ape", "ape" — because it is talking to
 * itself. `names` is the tag→name map the storyboard already builds for display, used backwards.
 */
export const makeTagResolver = (names = {}, aliases = {}) => {
  const byWord = new Map();
  // Learned aliases win over dossier words: they are what the model actually uses.
  for (const [word, tag] of Object.entries(aliases)) byWord.set(word, tag);
  for (const [tag, name] of Object.entries(names)) {
    byWord.set(tag.toLowerCase(), tag);
    for (const word of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
      // Skip words too generic to identify anything — "a", "the", "battered".
      if (word.length >= 3 && !['the', 'and', 'with', 'his', 'her', 'its'].includes(word)) {
        if (!byWord.has(word)) byWord.set(word, tag);
      }
    }
  }
  return (phrase) => {
    const cleaned = String(phrase ?? '').trim().toLowerCase();
    if (!cleaned) return null;
    const direct = cleaned.match(/<subject \d+>/);
    if (direct) return direct[0].replace(/subject/, 'Subject');
    for (const word of cleaned.split(/[^a-z0-9<>]+/).reverse()) {
      if (byWord.has(word)) return byWord.get(word);
    }
    return null;
  };
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const plausible = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * Everything the trace has said so far, as provisional per-beat fragments.
 *
 * Re-parsed from the whole accumulated text rather than incrementally, deliberately: the model
 * revises, and a later statement about beat 2 must WIN over an earlier one. Re-reading is how a
 * correction becomes a correction on screen instead of an accumulation of contradictions. The
 * traces are a few kilobytes and this runs a few times a second at most, so the cost is nothing.
 */
export const parseReasoningGeometry = (text, { names = {}, maxBeats = 6 } = {}) => {
  const resolveTag = makeTagResolver(names, learnAliases(text));
  const beats = new Map();
  const beatOf = (index) => {
    if (!beats.has(index)) beats.set(index, { beatIndex: index, subjects: new Map() });
    return beats.get(index);
  };
  const subjectOf = (beat, tag) => {
    if (!beat.subjects.has(tag)) beat.subjects.set(tag, { subject: tag });
    return beat.subjects.get(tag);
  };

  // Which beat is being discussed at each character offset. The trace walks the beats in order,
  // repeatedly, so a fact belongs to the nearest beat header before it.
  const dims = new Map();
  const markers = [];
  for (const m of text.matchAll(BEAT_HEADER)) {
    const index = Number(m[1]) - 1;
    if (index >= 0 && index < maxBeats) markers.push({ at: m.index, index });
  }
  if (!markers.length) return { beats: [], hasGeometry: false };
  const beatAt = (offset) => {
    const inline = beatHintNear(text, offset);
    if (inline !== null && inline >= 0 && inline < maxBeats) return inline;
    let current = markers[0].index;
    for (const marker of markers) {
      if (marker.at > offset) break;
      current = marker.index;
    }
    return current;
  };

  // Dimensions and lenses attach to whatever subject/beat was most recently named, so the text is
  // walked in order and "the last thing mentioned" is tracked as it goes.
  const lastTagBefore = (offset) => {
    let tag = null;
    for (const m of text.slice(0, offset).matchAll(/<Subject \d+>|\b[a-z]{3,}\b/gi)) {
      const candidate = resolveTag(m[0]);
      if (candidate) tag = candidate;
    }
    return tag;
  };

  for (const m of text.matchAll(CAMERA_POSE)) {
    const [x, y, z, lx, ly, lz] = m.slice(1, 7).map(Number);
    if (!plausible(y, 0.02, 500)) continue;
    const beat = beatOf(beatAt(m.index));
    beat.camera = {
      position: { x: clamp(x, -2000, 2000), y: clamp(y, 0.05, 500), z: clamp(z, -2000, 2000) },
      lookAt: { x: clamp(lx, -2000, 2000), y: clamp(ly, -50, 500), z: clamp(lz, -2000, 2000) },
    };
  }

  for (const m of text.matchAll(SUBJECT_AT_TRIPLE)) {
    const tag = resolveTag(m[1]);
    if (!tag || /camera/i.test(m[1])) continue;
    const [x, , z] = m.slice(2, 5).map(Number);
    const subject = subjectOf(beatOf(beatAt(m.index)), tag);
    subject.x = clamp(x, -2000, 2000);
    subject.z = clamp(z, -2000, 2000);
  }

  for (const m of text.matchAll(SUBJECT_AT_X)) {
    const tag = resolveTag(m[1]);
    if (!tag || /camera/i.test(m[1])) continue;
    const subject = subjectOf(beatOf(beatAt(m.index)), tag);
    subject.x = clamp(Number(m[2]), -2000, 2000);
  }

  // A dimension is a property of the THING, not of a moment — a 1.8m ape is 1.8m in every beat —
  // so it propagates to every beat where that subject already stands.
  //
  // It must never CREATE one, and first mention wins. Both rules were learned from the same trace:
  // the model muses "Car appears there" while planning beat 2 and then decides the car belongs in
  // beat 3, so creating on mention parked a sedan in two beats it is not in. And it writes "car
  // seat height ~0.5m?" — a fact about a seat, question mark and all — which overwrote the car's
  // real 1.3m with the height of its upholstery. Heights do not change, so the first one stands.
  const dimensioned = new Set();
  for (const [regex, field, lo, hi] of [[HEIGHT, 'heightM', 0.05, 500], [WIDTH, 'widthM', 0.05, 500]]) {
    for (const m of text.matchAll(regex)) {
      const value = Number(m[1]);
      if (!plausible(value, lo, hi)) continue;
      const tag = lastTagBefore(m.index);
      if (!tag || dimensioned.has(`${tag}:${field}`)) continue;
      dimensioned.add(`${tag}:${field}`);
      for (const beat of beats.values()) {
        if (beat.subjects.has(tag)) beat.subjects.get(tag)[field] = value;
      }
      dims.set(`${tag}:${field}`, value);
    }
  }

  // Anything positioned later still gets the dimensions already learned for it.
  for (const beat of beats.values()) {
    for (const subject of beat.subjects.values()) {
      for (const field of ['heightM', 'widthM']) {
        const known = dims.get(`${subject.subject}:${field}`);
        if (known !== undefined && subject[field] === undefined) subject[field] = known;
      }
    }
  }

  for (const m of text.matchAll(LENS)) {
    const value = Number(m[1]);
    if (!plausible(value, 8, 300)) continue;
    beatOf(beatAt(m.index)).focalMm = value;
  }

  for (const m of text.matchAll(BAND)) {
    // Ignore any line that names more than one band, or that quotes a band's numeric range.
    //
    // The model does its arithmetic out loud — "hFrac = 0.0267 -> EWS (0-0.25). Good." and "EWS or
    // WS?" — and taking the last band token on such a line makes the ghost flip between sizes it
    // is only comparing. A line that names exactly one band is a decision; a line that names two
    // is a deliberation, and deliberation should not move the picture.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineEnd = text.indexOf('\n', m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const named = new Set(line.match(BAND) ?? []);
    if (named.size !== 1) continue;
    if (/\(\s*\d*\.?\d+\s*-\s*\d*\.?\d+\s*\)/.test(line)) continue;
    beatOf(beatAt(m.index)).framing = m[0];
  }

  for (const m of text.matchAll(CONTAINER)) {
    const beat = beatOf(beatAt(m.index));
    const containerTag = resolveTag(m[1] ?? m[3]);
    const containedTag = m[2] ? resolveTag(m[2]) : lastTagBefore(m.index);
    if (containerTag && containedTag && containerTag !== containedTag) {
      // Only this beat. Being inside something is a fact about a MOMENT, not about the thing —
      // the ape is in the car in the beat where it climbs in, and beside it in the beat before.
      subjectOf(beat, containedTag).containerId = containerTag;
    }
  }

  const out = [...beats.values()]
    .sort((a, b) => a.beatIndex - b.beatIndex)
    .map((beat) => ({
      ...beat,
      subjects: [...beat.subjects.values()].map((s) => ({
        ...s,
        // Sensible stand-ins so a half-known subject can still be drawn. Marked provisional by
        // construction: the caller never treats any of this as measured.
        x: s.x ?? 0,
        z: s.z ?? 0,
        heightM: s.heightM ?? 1.8,
        widthM: s.widthM ?? 0.6,
      })),
    }));

  return {
    beats: out,
    hasGeometry: out.some((b) => b.camera || b.subjects.length || b.framing),
  };
};
