// The scope brief: what the visitor and the assistant agreed the film should be.
//
// WHY A MARKER IN THE REPLY TEXT RATHER THAN A TOOL CALL. This build already carries the same
// idea twice, and both times for the same reason:
//
//   · the Producer's `[seen <ISO>]` acknowledgment (worker/mind-chat.js)
//   · the Screenwriter's `[CUT TO BLACK]` beat prefix (worker/rulebook.js)
//
// Both are machine-read markers inside prose written by a model that is ALSO talking to a person.
// The assistant's own reply is the one place the visitor can see what was agreed, so putting the
// agreement anywhere else means it can silently disagree with what they just read. A tool call
// would also cost a second forced round trip on a route whose whole job is to feel fast.
//
// ⚠️ THE BRIEF IS A PROPOSAL, NEVER AN INSTRUCTION. Parsing one does not apply it. The visitor
// presses a button. That line is where "the assistant helps you scope the film" stops and "the
// assistant spends your money" would start, and it is the whole boundary of this round.
//
// Pure and dependency-free, like h3Script.js and nftMedia.js beside it, because both the browser
// (parsing what arrived) and the Worker (teaching the format) have to agree on it exactly.

/** Opens a brief block. Chosen to look deliberate in prose rather than like a typo. */
export const BRIEF_MARKER = '[BRIEF]';

const FIELDS = {
  intent: 'intent',
  duration: 'duration',
  resolution: 'resolution',
  'must hold': 'mustHold',
  spend: 'willingToSpend',
};

/** Split "a; b; c" into items, tolerating commas and stray bullets from a chatty model. */
const items = (value) =>
  String(value ?? '')
    .split(/;|(?:,\s*(?=[a-z]))/i)
    .map((part) => part.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean);

/**
 * Pull a brief out of a reply, and hand back the reply without it.
 *
 * Returns `{ brief, text }`. `brief` is null when there is no marker, which is the common case —
 * most turns are conversation, not an agreement.
 *
 * FAILS OPEN. A malformed block yields whatever fields did parse, and the marker is stripped
 * either way. A visitor must never be shown raw scaffolding because a model forgot a colon.
 */
export const parseBrief = (raw) => {
  const text = String(raw ?? '');
  const index = text.indexOf(BRIEF_MARKER);
  if (index === -1) return { brief: null, text };

  const before = text.slice(0, index);
  const block = text.slice(index + BRIEF_MARKER.length);

  const brief = { intent: '', duration: null, resolution: null, mustHold: [], willingToSpend: null };
  let consumedTo = 0;

  for (const line of block.split('\n')) {
    const match = /^\s*([a-z ]+?)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!match) {
      // The first line that is not a field ends the block — everything after it is prose again.
      if (line.trim()) break;
      consumedTo += line.length + 1;
      continue;
    }
    const key = FIELDS[match[1].trim().toLowerCase()];
    consumedTo += line.length + 1;
    if (!key) continue;

    if (key === 'mustHold') brief.mustHold = items(match[2]);
    else if (key === 'duration') brief.duration = Number.parseInt(match[2], 10) || null;
    else if (key === 'willingToSpend') brief.willingToSpend = Number.parseFloat(String(match[2]).replace(/[^\d.]/g, '')) || null;
    else if (key === 'resolution') brief.resolution = /2k/i.test(match[2]) ? '2K' : '768P';
    else brief[key] = match[2];
  }

  const after = block.slice(consumedTo);
  const cleaned = `${before}${after}`.replace(/\n{3,}/g, '\n\n').trim();

  // A block with nothing in it is not a brief; it is a model that typed a marker.
  const empty = !brief.intent && !brief.mustHold.length && !brief.duration && !brief.willingToSpend;
  return { brief: empty ? null : brief, text: cleaned };
};

/** The inverse, for showing a stored brief back or seeding one. */
export const formatBrief = (brief) =>
  [
    BRIEF_MARKER,
    brief?.intent ? `intent: ${brief.intent}` : null,
    brief?.duration ? `duration: ${brief.duration}` : null,
    brief?.resolution ? `resolution: ${brief.resolution}` : null,
    brief?.mustHold?.length ? `must hold: ${brief.mustHold.join('; ')}` : null,
    brief?.willingToSpend ? `spend: ${brief.willingToSpend}` : null,
  ]
    .filter(Boolean)
    .join('\n');

/**
 * How the assistant is told to write one.
 *
 * `must hold` is the load-bearing field, and the instructions say why: it is the only part of a
 * brief that maps onto something the Director can act on deterministically. "The ape's face has
 * to be right" elevates a measured hazard that already exists in the register; "make it cinematic"
 * elevates nothing and costs the visitor a field.
 */
export const BRIEF_INSTRUCTIONS = `SHAPING THE FILM — when, and only when, the visitor has actually decided something

You help visitors work out what film they want before the Director spends anything on it. When a
conversation has genuinely settled something — not when you think it might have — end your reply
with a brief block, after your normal prose, in exactly this shape:

${BRIEF_MARKER}
intent: one sentence on what the film is
duration: 6
resolution: 768P
must hold: the ape's face; one unbroken take
spend: 6

Rules, and the first one matters most:

- ONLY EMIT THIS WHEN SOMETHING WAS DECIDED IN THE CONVERSATION. A brief you invented from a
  single opening message is a guess wearing the visitor's authority. No brief is always safe.
- "must hold" is the field that does real work. It is a list of things that must survive into the
  render — a character's face, a specific garment, the film being one unbroken take. The Director
  matches these against hazards it has actually measured and puts the matching ones first. Vague
  entries ("make it cinematic", "high quality") match nothing and waste the field, so write what
  would be VISIBLY WRONG if it failed.
- "spend" is a total for this whole film in dollars, never a per-render number. Nobody can set a
  per-render ceiling before they have seen what a render costs, so never ask for one.
- duration is a whole number of seconds from 4 to 15. resolution is 768P or 2K. If the visitor
  has not said, leave the line out rather than choosing for them.
- You are PROPOSING. The visitor accepts it with a button. Never say you have set anything up,
  started anything, or spent anything — you cannot, and saying so would be a promise the site
  then has to break.`;
