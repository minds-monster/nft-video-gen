// Frames out of a finished clip, for judging it.
//
// ⚠️ THE SAMPLING IS THE WHOLE THING, and this project has already paid once to learn it. From
// scripts/hero-prompts.mjs, about a post-mortem that was confidently wrong for weeks:
//
//   "They were an artifact of the contact-sheet sampler bug … the old
//    `select='not(mod(n,round(max(1,t))))'` filter, whose interval grows with t, crushed every
//    sample into the opening second … Both are FALSE, and together they cost this project its
//    architecture."
//
//   "NEVER judge a render from a contact sheet whose sampling you have not verified. An evenly-
//    sampled sheet is the cheapest instrument here, and a badly sampled one does not merely
//    mislead, it INVERTS the conclusion."
//
// So the design here is not "make a contact sheet in a Worker". It is to make that class of bug
// structurally impossible: each frame is requested AT AN EXPLICIT TIMESTAMP and carries that
// timestamp with it to the judge. There is no filter expression whose behaviour has to be
// reasoned about, and a missing frame is a missing frame rather than a silently skewed set.
//
// ── WHAT THIS NEEDS, AND DOES NOT HAVE YET ──────────────────────────────────────────────────
//
// There is no ffmpeg in a Worker. The mechanism is Cloudflare Media Transformations
// (`/cdn-cgi/media/mode=frame,time=Ns/<source>`), which is a per-zone toggle in the dashboard.
// As of 2026-08-27 it is NOT enabled on minds.monster: /cdn-cgi/trace returns 200, so the path
// routes, but /cdn-cgi/media/... and /cdn-cgi/image/... both 404.
//
// This module is therefore written to DETECT that and say so, rather than to assume. Everything
// downstream treats "no frames" as an ordinary outcome — the visitor judges the clip themselves,
// which given the history above is the more trustworthy instrument anyway, not the lesser one.

/** Cached so a probe does not run on every render. Short, because the answer changes the moment
 * somebody flips the toggle and we would rather find out in an hour than never. */
const CAPABILITY_KEY = 'caps:media-transformations';
const CAPABILITY_TTL_SECONDS = 60 * 60;

/**
 * Where to sample.
 *
 * UNIFORM, and offset from both ends. The first and last frames of a generated clip are the least
 * informative — a fade, a settle — and a judge shown them wastes two of its samples on the two
 * places nothing happens.
 */
export const sampleTimes = (durationSeconds, count = 8) => {
  const span = Math.max(0.5, durationSeconds - 0.6);
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round((0.3 + index * step) * 100) / 100);
};

const frameUrl = (origin, sourceUrl, atSeconds) =>
  `${origin}/cdn-cgi/media/mode=frame,time=${atSeconds}s,format=jpeg,width=640/${sourceUrl}`;

/**
 * Is frame extraction available on this zone?
 *
 * Probed against a real request rather than assumed from config, because the only thing that
 * settles it is whether the edge answers. Cached, and never allowed to throw — a capability check
 * that fails a render is worse than the missing capability.
 */
export async function framesAvailable(env, { origin, sourceUrl }) {
  const cached = await env.MIND_CONNECTIONS.get(CAPABILITY_KEY, 'json').catch(() => null);
  if (cached && typeof cached.available === 'boolean') return cached.available;

  let available = false;
  try {
    const response = await fetch(frameUrl(origin, sourceUrl, 0.3), { method: 'GET' });
    available = response.ok && (response.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    available = false;
  }

  await env.MIND_CONNECTIONS.put(
    CAPABILITY_KEY,
    JSON.stringify({ available, checkedAt: Date.now() }),
    { expirationTtl: CAPABILITY_TTL_SECONDS },
  ).catch(() => {});
  return available;
}

/**
 * Pull evenly-timed frames out of a clip.
 *
 * Returns `{ available, frames }`. `frames` carries each one's own `atSeconds`, and that field is
 * shown to the judge — so a judge reasoning about ORDER ("does the subject hold the left side
 * throughout?") is reasoning about real timestamps rather than about a grid it has to trust.
 *
 * A frame that fails to fetch is DROPPED AND COUNTED, never silently replaced. Eight frames of
 * which three are missing is a different piece of evidence from five evenly-spaced ones, and the
 * judge is told which it is looking at.
 */
export async function extractFrames(env, { sourceUrl, origin, durationSeconds, count = 8 }) {
  if (!(await framesAvailable(env, { origin, sourceUrl }))) {
    return {
      available: false,
      frames: [],
      why:
        'Frame extraction is not enabled on this zone, so nothing can look at this clip except a ' +
        'person. Cloudflare Media Transformations is a per-zone toggle.',
    };
  }

  const times = sampleTimes(durationSeconds, count);
  const frames = [];
  const missed = [];

  for (const atSeconds of times) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one request per sample, deliberately serial:
      // eight parallel transform requests against one freshly-written object is a good way to
      // find its cold-start behaviour the expensive way.
      const response = await fetch(frameUrl(origin, sourceUrl, atSeconds));
      if (!response.ok) {
        missed.push(atSeconds);
        continue;
      }
      frames.push({ atSeconds, bytes: await response.arrayBuffer() });
    } catch {
      missed.push(atSeconds);
    }
  }

  return { available: true, frames, missed, requested: times.length };
}

/** Bytes → the data URI the vision model takes, matching worker/casting-director.js's shape. */
export const frameToDataUri = (bytes) => {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
};
