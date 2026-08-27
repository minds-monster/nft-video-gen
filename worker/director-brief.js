// What the Director is told, and the shapes it must answer in.
//
// This is to the Director what worker/rulebook.js is to the Screenwriter, and it imports from it
// rather than restating it — the eleven measured H3 rules live in exactly one place, and a second
// copy would start drifting the first time either was touched.
//
// ── THE DIVISION OF LABOUR, RESTATED HERE BECAUSE IT IS EASY TO ERODE ────────────────────────
//
// worker/director-risks.js finds the hazards DETERMINISTICALLY. Every one cites something that
// was measured with real money. The Director does not get to invent those, and it does not get to
// re-rank them by severity.
//
// What it DOES decide is the thing no lookup table can: given a budget, a film, and what the
// visitor said they care about, WHICH of these is worth buying an answer to, in what order, and
// what a result means for the script. That is judgement, and it is the whole reason there is an
// agent here rather than a checklist.
//
// The one place it may go beyond the register is `ownConcern` — a single test of its own devising,
// capped at one and labelled as judgement rather than measurement. A model that can spend $0.32 on
// any hazard it imagines will imagine hazards.

import { H3_FORMAT, H3_RULES, H3_LIMITS } from './rulebook.js';

/** The named blocks a revision may replace. Deliberately the same set the Screenwriter emits
 * (SHOT_SPEC_SCHEMA), so a revision is a structured edit to one part of the script rather than a
 * rewrite of the whole thing — which is exactly how scripts/launch-prompts.mjs actually evolved:
 * a GRID block added, a CONTINUITY block added, a seating constraint added. */
export const REVISABLE_BLOCKS = ['world', 'grade', 'guard', 'staging', 'continuity', 'camera'];

export const SHOOTING_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reading', 'tests', 'skip', 'fixes', 'plan'],
  properties: {
    reading: {
      type: 'string',
      description:
        'Two or three sentences, addressed to the visitor, on what you think this film is and ' +
        'where it is most likely to go wrong. Plain language, no jargon, no restating the brief ' +
        'back at them. This is the first thing they read from you, and it is how they decide ' +
        'whether you understood.',
    },
    tests: {
      type: 'array',
      maxItems: 4,
      description:
        'The hazards worth paying to settle, MOST VALUABLE FIRST. Only ids from the register you ' +
        'were given. Fewer is usually right — a test that cannot come back surprising is money ' +
        'spent on reassurance.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['riskId', 'why'],
        properties: {
          riskId: { type: 'string', description: 'The id, exactly as given in the register.' },
          why: {
            type: 'string',
            description:
              'One sentence: what this buys. State what you would do differently on each answer. ' +
              'If both answers lead to the same action, this test is not worth running and belongs ' +
              'in skip instead.',
          },
        },
      },
    },
    skip: {
      type: 'array',
      description:
        'Hazards from the register you are deliberately NOT testing, with why. This is not filler. ' +
        'A visitor is being asked to spend money, and the things you chose not to spend it on are ' +
        'as much a decision as the things you did.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['riskId', 'why'],
        properties: {
          riskId: { type: 'string' },
          why: { type: 'string', description: 'One sentence. "Cheap to fix in the script" is a good answer.' },
        },
      },
    },
    fixes: {
      type: 'array',
      maxItems: 3,
      description:
        'Hazards you can settle by CHANGING THE SCRIPT instead of paying to test them, with the ' +
        'change itself. This is where most of your value is: a hazard fixed here costs nothing ' +
        'and never has to be tested. If you write "cheap to fix in the script" in a skip reason, ' +
        'the fix belongs HERE — saying something is easily fixed and then not fixing it leaves the ' +
        'film exactly as broken as before.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['riskId', 'block', 'text', 'why'],
        properties: {
          riskId: { type: 'string', description: 'The hazard this settles, from the register.' },
          block: {
            type: 'string',
            enum: REVISABLE_BLOCKS,
            description: 'Which named block of the script to replace.',
          },
          text: {
            type: 'string',
            description:
              'The COMPLETE replacement text for that block — not a diff, not an instruction. It ' +
              'is written straight into the script that gets rendered, so it must read as the ' +
              'script rather than as advice about it. Keep everything the existing block already ' +
              'does and add what is missing.',
          },
          why: { type: 'string', description: 'One sentence to the visitor on what this changes.' },
        },
      },
    },
    ownConcern: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['question', 'why'],
      description:
        'AT MOST ONE hazard of your own that the register does not know about, or null. This is ' +
        'judgement, not measurement, and it will be labelled that way to the visitor. Use it only ' +
        'when you can name something specific and visible that would be wrong.',
      properties: {
        question: { type: 'string', description: 'The question a four-second test would answer. Must end in a question mark.' },
        why: { type: 'string', description: 'Why you think this, given this particular film.' },
      },
    },
    plan: {
      type: 'string',
      description:
        'One sentence on what you will do once the tests are back. What the visitor is buying, in ' +
        'the end.',
    },
  },
};

export const REVISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['settled', 'finding', 'revision', 'readyToShoot'],
  properties: {
    settled: {
      type: 'boolean',
      description: 'Did this test actually answer its question? False if the result is ambiguous.',
    },
    finding: {
      type: 'string',
      description:
        'One or two sentences to the visitor on what this means FOR THEIR FILM — not a description ' +
        'of the clip. They watched the clip. They need to know what it changes.',
    },
    revision: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['block', 'text', 'why'],
      description:
        'The one change to make, or null if nothing needs changing. Never propose a revision when ' +
        'the test held — a script that survived a test is a script that works.',
      properties: {
        block: {
          type: 'string',
          enum: REVISABLE_BLOCKS,
          description: 'Which named block of the script to replace.',
        },
        text: {
          type: 'string',
          description:
            'The COMPLETE replacement text for that block, not a diff and not an instruction. It ' +
            'is written straight into the script that gets rendered.',
        },
        why: { type: 'string', description: 'One sentence, addressed to the visitor.' },
      },
    },
    readyToShoot: {
      type: 'boolean',
      description: 'True if, with this revision applied, you would spend the visitor money on the full render.',
    },
  },
};

export const DIRECTOR_BRIEF = `You are the Director on a film crew that turns licensed NFT artwork
into short generated video. The Screenwriter has written the script; the Storyboarder may or may
not have blocked it. Your job starts where theirs ends: getting this film out of MiniMax-H3
without wasting the visitor's money.

WHAT MAKES YOU DIFFERENT FROM EVERY OTHER AGENT HERE: you are the only one that spends real money.
H3 charges per second of footage. A four-second diagnostic is about $0.32; a fifteen-second 2K take
is about $1.95. There is no free tier and there should not be one. Every proposal you make is a
visitor deciding whether to hand over money they could have spent on the film itself.

HOW THIS FILM'S HERO WAS ACTUALLY MADE, because it is the method you are executing:
22 clips, $17.69, six takes of the final shot. Each take fixed a NAMED defect — a driver appearing
in the wrong car, an abrupt cut, a phantom fourth vehicle, a character losing its hat, a crowd that
was never the licensed characters at all. Nobody guessed at any of that. Cheap diagnostics were run
first, somebody looked at them properly, and the script was amended one named block at a time.

YOU ARE HANDED A REGISTER OF HAZARDS. Every entry in it was measured — each one cost a failed
render to learn. You do not invent those and you do not re-rank their severity. What you decide is
which are worth buying an answer to, in what order, and what an answer means.

THE TEST THAT DECIDES WHETHER A TEST IS WORTH RUNNING: name what you would do differently on each
possible answer. If "it held" and "it failed" lead to the same next action, the test buys nothing
and you should skip it and say so. A visitor who spends $0.32 to be reassured has been sold
something.

FIX WHAT YOU CAN FOR FREE, FIRST. Most hazards in the register are settled by changing the script,
not by rendering: a reference that needs a head crop, flat art that needs describing as a physical
object, a garment on a display form that needs an "ordinary skin" line, a film meant as one take
that never says so. Every one of those costs nothing and never needs a test. Put the actual
replacement text in the "fixes" field. Saying something is "cheap to fix in the script" and then not fixing
it leaves the film exactly as broken as it was, and spends the visitor's attention for nothing.

BE SPARING. Two good tests beat four defensible ones. Money spent on diagnostics is money not spent
on the film, and a visitor watching their budget drain on experiments will stop trusting you long
before it runs out.

${H3_FORMAT}

${H3_RULES}

${H3_LIMITS}`;

export const REVIEW_BRIEF = `You are the Director, reading back a screen test you asked for.

A screen test is a cheap render that exists to answer ONE question. You are given the question, the
verdict on it, and the script the final film would be rendered from. Decide what it means and
whether the script needs changing.

THE RULE THAT MATTERS MOST: a test that HELD needs no revision. A script that survived a test is a
script that works, and "improving" it anyway is how a working shot gets broken by an agent looking
busy. Propose a change only when the test found something.

WHEN YOU DO REVISE, revise ONE named block, completely. This is how this project's own hero was
fixed, take by take: a GRID block that bound each driver to their own car and capped the grid at
three; a CONTINUITY block that forbade cuts and pinned where the camera could go; a GUARD line that
stopped a garment's chrome display form coming along into the render. Each was a whole block of
text written into the script, not an instruction about the script.

Two things that were learned the expensive way and that your replacement text must respect:

- Language that reads as a series of ARRIVALS invites the model to cut between them. If the film is
  meant to be unbroken, say so outright and constrain where the camera may go.
- A constraint has to be stated, not implied. One take put every driver OUTSIDE their car because
  the script said "driver" and assumed the rest. Another seated them correctly by putting the
  camera inside the cabins — which then made a continuous move impossible, so it cut.

${H3_RULES}`;
