// Looking at what came back.
//
// ⚠️ READ worker/frames.js's header FIRST. Judging a render from a badly-sampled set of frames
// does not merely mislead — this project has a documented case where it INVERTED the conclusion
// and cost the hero its architecture. Everything here assumes frames that arrived with their own
// timestamps attached, and it is told how many were requested versus how many arrived, because
// "five of eight" is different evidence from "eight of eight" and a judge that cannot tell will
// answer as though it could.
//
// THE JUDGE IS NOT AN UPGRADE OVER THE VISITOR. It runs where frame extraction is available and
// the visitor has not already answered; a person watching the clip stays the more trustworthy
// instrument, and a `verdict.by` of 'visitor' is never overwritten by one of 'director'.
//
// Deliberately on the Casting Director's own model — an omni model already proven to take image
// parts on this account — so this adds no new provider, no new key and no new failure mode.

import { chat, jsonFrom } from './nvidia.js';
import { frameToDataUri } from './frames.js';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      enum: ['held', 'failed', 'unclear'],
      description:
        '"held" if the thing under test survived, "failed" if it visibly did not, "unclear" if ' +
        'the frames genuinely do not settle it. Unclear is a real answer and is much better than ' +
        'a confident wrong one — say it whenever the evidence does not decide.',
    },
    whatYouSaw: {
      type: 'string',
      description:
        'One or two sentences describing what is actually in the frames, in plain language a ' +
        'visitor could check against the clip themselves. Never restate the question back.',
    },
    whichFrames: {
      type: 'array',
      items: { type: 'number' },
      description: 'The timestamps, in seconds, of the frames that show what you just described.',
    },
  },
  required: ['answer', 'whatYouSaw', 'whichFrames'],
};

const brief = (question, markers, requested, arrived) => `You are looking at frames from one short
generated video clip, sampled at even intervals across it. Each frame is labelled with its
timestamp in seconds.

You are answering exactly one question, and nothing else:

  ${question}

${markers?.length ? `The thing under test must stay recognisable by: ${markers.join('; ')}.\n` : ''}
${arrived < requested ? `Only ${arrived} of ${requested} frames could be sampled, so you are seeing an incomplete picture of the clip. Weigh that.\n` : ''}
How to answer:

- Judge ONLY what is visible. Do not reason about what the prompt probably asked for, what the
  artwork probably looks like, or what would be a helpful answer. You have the frames; that is
  the evidence.
- "failed" needs something you can point at in a specific frame. If you cannot name the frame,
  the answer is "unclear".
- "unclear" is a real answer and costs nothing. A confident wrong one costs the visitor the next
  render, because they will act on it.
- Ordering matters when the question is about it. The timestamps are real, so "the subject is on
  the left at 0.3 and on the right at 2.6" is a finding; "it moves around" is not.`;

/**
 * Ask the model what the frames show.
 *
 * Returns null rather than throwing on any failure. An unjudged test is an ordinary state — the
 * visitor answers it — whereas a judging failure that fails the whole job would lose a clip that
 * has already been paid for.
 */
export async function judgeFrames(env, { question, markers = [], frames, requested }) {
  if (!frames?.length) return null;

  const parts = [{ type: 'text', text: brief(question, markers, requested ?? frames.length, frames.length) }];
  for (const frame of frames) {
    // The timestamp travels WITH its own picture rather than in a list at the top, so a model
    // cannot mis-associate the two — which is the same failure mode as a mis-sampled sheet,
    // arriving by a different route.
    parts.push({ type: 'text', text: `Frame at ${frame.atSeconds}s:` });
    parts.push({ type: 'image_url', image_url: { url: frameToDataUri(frame.bytes) } });
  }

  try {
    const response = await chat(env, {
      model: env.CASTING_MODEL,
      messages: [{ role: 'user', content: parts }],
      tools: [{ type: 'function', function: { name: 'judge', description: 'Answer the question about these frames.', parameters: VERDICT_SCHEMA } }],
      tool_choice: { type: 'function', function: { name: 'judge' } },
      retries: 1,
    });
    const verdict = jsonFrom(response);
    if (!verdict?.answer) return null;
    return {
      answer: verdict.answer,
      note: verdict.whatYouSaw ?? '',
      whichFrames: verdict.whichFrames ?? [],
      by: 'director',
      at: Date.now(),
    };
  } catch (error) {
    console.warn('Director judging failed, leaving it for the visitor:', error.message);
    return null;
  }
}
