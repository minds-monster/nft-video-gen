// The Storyboarder: turns the Screenwriter's shot spec into a technical blocking
// specification per beat — shot framing, camera angle/movement, explicit subject positions,
// screen direction, a continuity check against the previous beat. Text only, cheap, and the
// actual deliverable a storyboard exists to produce, per real storyboarding practice and two
// rounds of live-run evidence (see the plan doc's post-mortems): a storyboard's job is
// direction, not a picture.
//
// ROUND 4'S PIVOT, AND WHY. Rounds 1-3 generated an image per beat automatically and treated
// it as the deliverable. That turned out to be the wrong interface for this job — an image
// model has to interpret "wide shot" and "screen-left" through learned visual priors, which
// is exactly the "dice roll" a strict text schema doesn't have: a forced tool call either
// produces valid framing/cameraAngle/subjectsInFrame or it doesn't, with nothing left to
// chance the way pixels are. It also fixes a real bug: round 3's continuity fix fed each
// beat's generated frame back in as an extra reference image, accumulating base64 image data
// across one long-lived request until it silently exceeded Cloudflare's 128MB memory cap —
// "5 of 6 beats, the 6th never arrived, no error" was that crash. A blocking JSON per beat is
// a few KB, not megabytes; the whole failure mode is gone by construction, not by tuning.
//
// SO: `handleStoryboard` below is now text-only — no NFT image fetches, no R2 writes, no
// spend, no budget gate. It runs the moment a shot spec exists. Continuity is checked
// text-against-text (this beat's JSON against the previous beat's own JSON), which is
// reliable and explainable in a way image-against-image comparison never was.
//
// IMAGE GENERATION IS STILL HERE — OPT IN, PER FRAME, NEVER BATCHED. gpt-image-2 remains
// genuinely useful for an actual visual, once a beat's blocking is precise. See
// `handleStoryboardSketch`: it generates exactly one image for one frame per invocation, on
// an explicit visitor click, fed by that beat's own `visualPrompt` and only the reference
// images for subjects the blocking JSON actually placed in frame. ARCHITECTURAL FLOOR, NOT A
// SUGGESTION: this must never run in a loop across multiple beats within one Worker
// invocation — that loop, not merely "images are heavy," is what caused the round-3 crash,
// and the fix only holds if this stays true by design.
//
// Frames are never overwritten by a regeneration — every sketch attempt appends to the
// frame's own `history`, so the eventual render's blueprint can carry its full history, not
// just the latest state.

import { sseResponse } from './sse.js';
import { requireSession, relayToMind } from './mind-chat.js';
import { getBudget, getSpend, recordSpend, markThresholdRelayed } from './budget.js';
import { editImage, estimateCostUsd, respond, jsonFromResponse } from './openai.js';
import { filmCall, streamFilmCall, FREE_MAX_BEATS } from './openrouter.js';
import { resolveTier, LATENCY_SECONDS, TIER_LABEL, checkStoryboardInput } from './tier.js';
import { filmIdFor } from './film-id.js';
import {
  SCENE_SCHEMA,
  COORDINATE_CONTRACT_V2,
  buildBrief,
  buildFilmUserMessage,
  compileBeatToH3,
  subjectAssetsFrom,
  toStrictSchema,
  validateScene,
} from './scene.js';
import { castingStills, fetchImageAsDataUri } from './casting-director.js';
import { serveSignedMedia, signedMediaUrl } from './signed-media.js';
import { streamJobEvents } from './job-events.js';
import { createJobLogger as makeJobLogger } from './job-log.js';
import { H3_FORMAT } from './rulebook.js';
import {
  FILM_PLAN_SCHEMA,
  buildPlanBrief,
  buildPlanUserMessage,
  buildBeatUserMessage,
  planAdherence,
} from './film-plan.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// The beat ceiling is now PER TIER and lives in worker/tier.js (6 paid, 5 free) — six beats
// failed on every free configuration round 7 tried, so it is a measured limit rather than a
// product decision. SHOT_SPEC_SCHEMA in worker/rulebook.js still caps what the Screenwriter emits.
const PATTERN_ABUSE_REGEN_COUNT = 10;
const IMAGE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_SIZE = '1024x1024';
const IMAGE_QUALITY = 'low';

// ONE STORYBOARD PER FILM, not one per Mind. The old `storyboard:<mindId>` shape gave every Mind
// a single slot, which meant a visitor's second film overwrote their first without telling them —
// see worker/film-id.js for the incident. The legacy key is still read as a fallback so nobody's
// existing storyboard vanishes, but nothing writes to it any more.
const storyboardKey = (mindId, filmId) => `storyboard:${mindId}:${filmId}`;
const legacyStoryboardKey = (mindId) => `storyboard:${mindId}`;
const filmIndexKey = (mindId) => `storyboards:${mindId}`;

// THE GENERATION, KEPT SEPARATELY FROM THE DERIVATION.
//
// One /api/storyboard call is a single three-to-eight-minute model call followed by validation, a
// repair loop that can make MORE model calls, and scene construction — and until now the first
// durable write of any of it happened after all of that. Anything that killed the invocation in
// between threw away the expensive half to protect nothing: measured 2026-08-25, a run that
// streamed 3943 reasoning events left no storyboard record in KV at all.
//
// So the model's raw answer is written the moment it arrives. It is not a storyboard and is never
// served as one — it is the receipt for the part that cost minutes, so a re-run can skip straight
// to the part that costs milliseconds.
const draftKey = (mindId, filmId) => `storyboard-draft:${mindId}:${filmId}`;

// A week. Long enough that a visitor coming back tomorrow still skips the regeneration, short
// enough that abandoned drafts do not accumulate — unlike a storyboard, a draft has no value once
// its film has been built.
const DRAFT_TTL_SECONDS = 7 * 24 * 60 * 60;
const r2Key = (mindId, aFrameId, version) => `storyboard/${mindId}/${aFrameId}/${version}.png`;
const makeFrameId = (beatIndex) => `beat-${beatIndex}-${crypto.randomUUID().slice(0, 8)}`;

// A generation job: durable progress and result storage that survives a dropped SSE stream.
//
// The long model call is no longer tied to the HTTP response. POST /api/storyboard creates the job,
// returns its id immediately, and starts the work under ctx.waitUntil. The client then connects to
// a lightweight SSE endpoint that reads this record. If that progress stream drops, the work keeps
// going and the client reconnects.
const storyboardJobKey = (mindId, jobId) => `storyboard-job:${mindId}:${jobId}`;
const makeJobId = () => crypto.randomUUID();
const JOB_TTL_SECONDS = 24 * 60 * 60;

async function loadStoryboardJob(env, mindId, jobId) {
  return env.MIND_CONNECTIONS.get(storyboardJobKey(mindId, jobId), 'json').catch(() => null);
}

async function saveStoryboardJob(env, mindId, record) {
  record.updatedAt = Date.now();
  await env.MIND_CONNECTIONS.put(
    storyboardJobKey(mindId, record.jobId),
    JSON.stringify(record),
    { expirationTtl: JOB_TTL_SECONDS },
  );
}

export async function createStoryboardJob(env, mindId, { plan, filmId }) {
  const jobId = makeJobId();
  const record = {
    jobId,
    mindId,
    filmId,
    plan,
    status: 'queued',
    events: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveStoryboardJob(env, mindId, record);
  return { jobId, record };
}

/** The storyboard's own name for the shared job log — see worker/job-log.js. Kept as a wrapper
 * rather than a re-export so the `(env, mindId, record)` signature every existing caller and test
 * uses stays exactly as it was. */
export const createJobLogger = (env, mindId, record) =>
  makeJobLogger({ record, save: (updated) => saveStoryboardJob(env, mindId, updated) });

const emptyStoryboard = () => ({ frames: [], createdAt: Date.now() });

/** The id under which a pre-film-identity storyboard is reachable. Explicit, so the visitor can
 * open it deliberately — and so nothing can serve it by accident. */
export const LEGACY_FILM_ID = 'legacy';

/**
 * One film's storyboard. NEVER a different film's.
 *
 * THERE IS NO FALLBACK, and that is the entire point. The first version of this keying kept a
 * "generous" one — if the scoped key missed and the old single-slot record carried no film of its
 * own, hand that back rather than nothing — and it recreated the exact bug the keying existed to
 * fix, one layer down: every new film misses, so every new film was served the same stale
 * storyboard. Reported by the visitor as "it keeps delivering the same one it already did".
 *
 * A record with no film identity cannot be shown to belong to the film being asked for. So it is
 * reachable only by asking for it BY NAME (`LEGACY_FILM_ID`), which the films index offers as an
 * explicit entry. Generosity about identity is indistinguishable from getting identity wrong.
 */
export async function loadStoryboard(env, mindId, filmId) {
  if (filmId === LEGACY_FILM_ID) {
    return (await env.MIND_CONNECTIONS.get(legacyStoryboardKey(mindId), 'json')) ?? emptyStoryboard();
  }
  if (filmId) {
    return (await env.MIND_CONNECTIONS.get(storyboardKey(mindId, filmId), 'json')) ?? emptyStoryboard();
  }
  // No film asked for, so no film answered. An unscoped read is what let one storyboard stand in
  // for all of them; callers that do not know which film they mean get nothing.
  return emptyStoryboard();
}

/** The films index, plus the old single-slot record as an explicit, openable entry when it holds
 * anything worth opening. Listed rather than served: the visitor decides it is the one they want. */
export async function listFilms(env, mindId) {
  const films = (await env.MIND_CONNECTIONS.get(filmIndexKey(mindId), 'json')) ?? [];
  const legacy = await env.MIND_CONNECTIONS.get(legacyStoryboardKey(mindId), 'json');
  if (!legacy?.frames?.length || legacy.filmId) return films;
  return [
    ...films,
    {
      filmId: LEGACY_FILM_ID,
      logline: legacy.logline ?? 'Earlier storyboard (made before films were kept separately)',
      frames: legacy.frames.length,
      tier: legacy.tier ?? null,
      updatedAt: legacy.updatedAt ?? legacy.createdAt ?? null,
    },
  ];
}

/** A short list of this Mind's films, so past work stays reachable rather than merely stored.
 * Kept small and denormalised: enough to show a visitor "you also have these", nothing more. */
const MAX_INDEXED_FILMS = 20;

async function indexFilm(env, mindId, record) {
  const existing = (await env.MIND_CONNECTIONS.get(filmIndexKey(mindId), 'json')) ?? [];
  const entry = {
    filmId: record.filmId,
    logline: record.logline ?? null,
    frames: record.frames?.length ?? 0,
    tier: record.tier ?? null,
    updatedAt: record.updatedAt,
  };
  const next = [entry, ...existing.filter((f) => f.filmId !== record.filmId)].slice(0, MAX_INDEXED_FILMS);
  await env.MIND_CONNECTIONS.put(filmIndexKey(mindId), JSON.stringify(next));
}

/** Best-effort by design: failing to checkpoint must never fail the run that produced the thing
 * worth checkpointing. A lost draft costs a regeneration; a thrown draft write would cost the film. */
async function saveDraft(env, mindId, filmId, draft) {
  try {
    await env.MIND_CONNECTIONS.put(
      draftKey(mindId, filmId),
      JSON.stringify({ ...draft, filmId, createdAt: Date.now() }),
      { expirationTtl: DRAFT_TTL_SECONDS },
    );
  } catch (error) {
    console.warn('Storyboard draft checkpoint failed:', error.message);
  }
}

const loadDraft = async (env, mindId, filmId) =>
  env.MIND_CONNECTIONS.get(draftKey(mindId, filmId), 'json').catch(() => null);

/** Dropped once the storyboard it fed has been saved — past that point the record IS the answer
 * and a stale draft could only ever contradict it. */
const clearDraft = async (env, mindId, filmId) => {
  try {
    await env.MIND_CONNECTIONS.delete(draftKey(mindId, filmId));
  } catch {
    // A draft that outlives its film is harmless: it expires on its own, and the reuse path
    // below only ever runs when there is no storyboard yet.
  }
};

async function saveStoryboard(env, mindId, record) {
  if (!record.filmId) throw new Error('A storyboard cannot be saved without a filmId.');
  record.updatedAt = Date.now();
  await env.MIND_CONNECTIONS.put(storyboardKey(mindId, record.filmId), JSON.stringify(record));
  await indexFilm(env, mindId, record);
}

const TRANSITION_PREFIX = /^\s*\[(CUT TO BLACK|TRANSITION|FADE)\]\s*/i;
const isTransitionBeat = (beatText) => TRANSITION_PREFIX.test(beatText);
const transitionText = (beatText) => beatText.replace(TRANSITION_PREFIX, '').trim();

// Beat-boundary digests to the connected Mind — system events, not visitor chat text, so
// they bypass worker/assistant.js's decideRelay entirely and call relayToMind directly.
const lastDigestAt = new Map();
const DIGEST_MIN_INTERVAL_MS = 5_000;

async function relayStoryboardDigest(env, mindId, text) {
  const now = Date.now();
  const last = lastDigestAt.get(mindId) ?? 0;
  if (now - last < DIGEST_MIN_INTERVAL_MS) return;
  lastDigestAt.set(mindId, now);
  try {
    await relayToMind(env, mindId, text);
  } catch (err) {
    console.warn('Storyboarder digest relay failed:', err.message);
  }
}

async function maybeRelayThreshold(env, mindId, spend, budget) {
  if (budget?.total == null) return;
  const fraction = spend.totalSpent / budget.total;
  for (const threshold of [0.8, 0.5]) {
    if (fraction < threshold || spend.thresholdsRelayed?.includes(threshold)) continue;
    await relayStoryboardDigest(
      env,
      mindId,
      `[Storyboarder] Spend has crossed ${Math.round(threshold * 100)}% of the stated $${budget.total} cap — $${spend.totalSpent.toFixed(2)} so far.`,
    );
    await markThresholdRelayed(env, mindId, threshold);
    return;
  }
}

/** A signed, scoped link to one frame's sketch image — see the round-2/3 plan notes on why
 * this is a URL, not a binary attachment.
 *
 * The mechanism now lives in worker/signed-media.js, because the Director needs exactly the same
 * thing for video and an authorisation check that exists twice is one that will eventually be
 * tightened once. This stays as the storyboard's own name for it. */
const signedImageUrl = (env, mindId, key, requestUrl) =>
  signedMediaUrl(env, mindId, { path: '/api/storyboard/image', key, requestUrl, ttlMs: IMAGE_LINK_TTL_MS });

// ─────────────────────────────────────────────────────────── whole-film scene generation
//
// ROUND 8'S PIVOT, AND WHY IT REPLACES THE PER-BEAT CHAIN ABOVE.
//
// Round 4 generated one blocking JSON per beat, each call seeing only its predecessor. Round 7
// measured what that costs, with today's exact production request as the control:
//
//     c0  today's per-beat chain          2.4 distinct shot sizes per film, 0.45 MWS share
//     c1  the SAME schema, whole film     3.1 distinct shot sizes,          0.26 MWS share
//     scene graph, whole film             3.9 distinct shot sizes,          0.10 MWS share
//
// So "every beat comes back MWS" was never a schema problem — it was a SCOPE problem. A model
// choosing a shot size for beat 3 with no idea what beats 1, 2, 4, 5 and 6 look like picks the
// safe middle every time, and no amount of instruction fixes it, because the information it needs
// is genuinely absent. One call, all beats, is the fix.
//
// Adam's pin on why we ALSO moved to world-space geometry, since scope alone captures most of the
// variety win: geometry's primary value is EDITING AFFORDANCE and H3 precision, not shot-variety
// lift over a scope fix. The scene graph is here so a visitor can eventually grab a subject and
// move it, and so what H3 receives is compiled from real numbers rather than restated prose.
//
// TWO TIERS, ONE CODE PATH. worker/tier.js decides which model runs; everything after the call is
// identical, because a visitor does not care which model put the camera inside somebody's head —
// it is equally broken either way. The sanity floor is absolute on both tiers.

const heartbeatEvery = 15_000;

/** Emits `heartbeat` while a long call is in flight.
 *
 * NOT decoration. This call takes 3-5 minutes (round 7 measured p50 194s on the paid path, 236s
 * for a five-beat free film), and Adam's read is that the wait is the highest-stakes surface in
 * the whole build: "a visitor who waits 4 minutes for a working product is patient; a visitor who
 * waits 4 minutes wondering if it's broken is not." An SSE stream that goes silent for four
 * minutes is indistinguishable from a dead one, to a browser and to a person. */
const withHeartbeat = async (emit, phase, work) => {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    emit('heartbeat', { phase, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }).catch(() => {});
  }, heartbeatEvery);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
};

/** One whole film, from whichever model this tier resolved to. Every transport returns the same
 * `{ data, usage, model }` shape so nothing downstream has to know which one ran.
 *
 * `onReasoning` is honoured only where a raw reasoning channel exists — the free path. OpenAI
 * bills reasoning tokens but does not return the text, so the paid path stays silent until it
 * answers. If a future paid model exposes summaries, this is the one place that needs to change. */
async function generateFilm(env, plan, { system, user, signal, onReasoning, retries, onDegraded }) {
  if (plan.tier === 'paid') {
    const result = await respond(env, {
      model: plan.model,
      system,
      user,
      schema: SCENE_SCHEMA,
      effort: plan.effort,
      signal,
    });
    return { data: jsonFromResponse(result), usage: result.usage, model: result.model };
  }
  // NVIDIA has no strict-schema mode; the forced tool call carries the structure, and the range
  // keywords are stripped because nothing enforces them there and an unrecognised keyword is a
  // needless 400 risk on an endpoint that has already rejected `guided_json`.
  const schema = toStrictSchema(SCENE_SCHEMA);
  if (!onReasoning) {
    return filmCall(env, { system, user, schema, signal, ...(retries != null ? { retries } : {}) });
  }
  try {
    return await streamFilmCall(env, { system, user, schema, signal, onReasoning });
  } catch (error) {
    // A transient stream cut should not throw away a run that is minutes deep. The non-streamed
    // path has its own retry ladder and returns the same shape, at the cost of losing the live
    // reasoning animation.
    const retryable = error?.status === 429 || error?.status >= 500 || error?.retryable;
    if (retryable && !signal?.aborted) {
      // SAY THAT WE DEGRADED. This fallback worked so well that nobody noticed the path it
      // falls back FROM had stopped working entirely: measured 2026-08-26, `stream: true`
      // returns a 502 within a second on every attempt, so free visitors had been getting a
      // silent spinner instead of the reasoning narration the whole wait surface was built
      // around — for an unknown number of days, with no signal anywhere that it was happening.
      //
      // 🔑 A silent fallback hides the failure of the thing it falls back from. Anything that
      // degrades gracefully has to announce that it did, or the graceful degradation becomes
      // the reason the outage is invisible.
      console.warn('Storyboarder streaming call failed, falling back to non-streamed call:', error.message);
      await onDegraded?.({ from: 'streamed', to: 'non-streamed', reason: error.message, status: error?.status ?? null });
      return filmCall(env, { system, user, schema, signal, ...(retries != null ? { retries } : {}) });
    }
    throw error;
  }
}


/** Free-tier default. Flip `FREE_STORYBOARD_SPLIT` to "0" in wrangler.jsonc to fall back to the
 * single whole-film call without a code change — the same re-pointability rationale as
 * `FREE_STORYBOARD_MODEL`, and the escape hatch if the grader ever finds the split regressing
 * shot variety toward round 7's c0 baseline. */
/**
 * Per-call deadlines, and they are not belt-and-braces — without them the split is strictly
 * MORE dangerous than the single call it replaces.
 *
 * `fetch` inside a Worker has no client-side timeout. One upstream connection that stalls and
 * never answers will sit there until the Queue consumer's 15-minute wall clock kills the whole
 * invocation, taking the finished beats with it. The single-call path carried that exposure
 * once; a split film carries it four times, and `Promise.all` means ANY one of them stalling
 * holds all the others hostage.
 *
 * Measured reason to expect exactly that (2026-08-26): three concurrent trivial calls to this
 * route returned in 1.0s, 1.4s and 14.7s, and the 1.0s one was a `502 Service temporarily
 * overloaded` — the provider sheds load under concurrency rather than queueing politely. A
 * 14x spread on a trivial call is a strong hint that a film-sized call can hang outright.
 *
 * So each call gets a budget, and a beat that overruns it fails as one beat. The rest of the
 * film is unaffected, which is the whole advantage of having split it up.
 */
const PLAN_CALL_TIMEOUT_MS = 120_000;
const BEAT_CALL_TIMEOUT_MS = 420_000;

/**
 * A budget for the WHOLE split, not just for each call in it — and without this the per-call
 * deadlines above are actively dangerous rather than merely insufficient.
 *
 * The arithmetic: at concurrency 1 (which is where the provider currently puts us) three beats
 * at 420s each is 21 minutes. The Queue consumer has FIFTEEN. So a film that hit its per-call
 * ceilings would be killed by the runtime partway through — losing every beat that had already
 * succeeded, because nothing is saved until the validation pass runs. The per-call deadlines
 * would have made the failure LOOK bounded while the real bound was somewhere else entirely.
 *
 * So the film gets its own clock and the beats share it: each call is given whatever is left,
 * and a beat with nothing left fails immediately instead of starting work that cannot finish.
 * Twelve minutes leaves the Queue three to save the storyboard, emit the frames and write the
 * digest — a film that comes back with one refused beat is worth far more than a film that was
 * complete at the moment the runtime killed it.
 */
const FILM_BUDGET_MS = 12 * 60_000;

/**
 * HOW MANY BEATS MAY BE IN FLIGHT AT ONCE — and the measured answer today is ONE.
 *
 * The parallelism was the headline reason to split the film up, and it does not currently
 * work. Three measurements on 2026-08-26, each one narrowing it further:
 *   - three concurrent TRIVIAL calls returned 1.0s / 1.4s / 14.7s, and the 1.0s one was a
 *     `502 Service temporarily overloaded` — shed, not served;
 *   - three concurrent FILM-sized calls shed a whole beat, and it stayed shed through a retry;
 *   - **at concurrency TWO, a beat was still shed — through three attempts.**
 * A single film-sized call, meanwhile, succeeds (354s), and a single trivial call succeeds in
 * 4.5s. So this route serves one film-sized request at a time and refuses the rest.
 *
 * Defaulting to 1 is therefore not caution, it is the measurement. Setting it to 2 or 3 today
 * does not buy latency — it buys refused beats, which cost the visitor an entire shot.
 *
 * 🔑 THE SPLIT IS STILL WORTH IT AT CONCURRENCY 1, and this is the part worth holding on to:
 * the speed win was never the only reason for it. The shot plan lands in ~22-27s carrying real
 * per-beat facts, the timeline fills in beat by beat instead of everything appearing at the
 * end, and one bad response costs one beat rather than the whole film. All of that survives
 * with the parallelism switched entirely off. The wait surface does not depend on the
 * optimisation working, which is why it is still honest when the optimisation does not.
 *
 * A var because this is a property of the PROVIDER on a given day, not of our code — the same
 * reason FREE_STORYBOARD_MODEL is one. When the route stops shedding, raising this is a config
 * change and the latency win is there waiting. Re-measure before raising it; do not assume.
 */
const beatConcurrency = (env) => {
  const n = Number(env.FREE_STORYBOARD_BEAT_CONCURRENCY ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input order in the
 * result. Deliberately not Promise.all with a semaphore library — this is six lines, and the
 * ordering guarantee is load-bearing: beats are addressed by index everywhere downstream.
 */
const mapPooled = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
};

const splitEnabled = (env, plan) =>
  plan.tier === 'free' && (env.FREE_STORYBOARD_SPLIT ?? '1') !== '0';

/**
 * The split path: one cheap plan call, then every beat drawn in parallel.
 *
 * TWO THINGS THIS BUYS, and the second is the one Adam asked for.
 *
 * Time: a three-beat film is one ~216s call today (non-streamed; the streamed path is worse).
 * Here it is a ~15s plan plus three concurrent ~71s beats — measured units, not estimates
 * (assets/probes/storyboarder-timing/20260826T153434Z.json). Call it ~90s.
 *
 * A WAIT SURFACE MADE OF FACTS. The plan lands in about fifteen seconds and it is real: this
 * beat is an EWS on the ape, that one is a CU, this one tracks. Every one of those is emitted to
 * the browser the moment it exists, so three cards fill in with three different true answers
 * long before any geometry is ready — and then each card resolves on its own as its own call
 * returns, rather than all three appearing at once at the end.
 *
 * That matters because the surface it replaces is GONE. The streamed reasoning narration this
 * repo built the wait around does not run: the provider bounces `stream: true` with a 502 in
 * under a second (measured 2026-08-26, both attempts), and `generateFilm` silently falls back to
 * the non-streamed call. So a visitor today gets a spinner and a 15-second heartbeat for three
 * to six minutes. Staggered per-beat truth is not a nicer version of the narration; it is the
 * only wait surface that currently exists.
 *
 * Nothing here is invented to fill the gap. If the plan call fails, the beats are still drawn —
 * the caller falls back to the whole-film path — and the cards stay empty rather than being
 * given something made up to look busy.
 */
export async function generateFilmSplit(env, plan, { spec, cast, beats, emit }) {
  const usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
  const addUsage = (u) => {
    usage.promptTokens += u?.promptTokens ?? 0;
    usage.completionTokens += u?.completionTokens ?? 0;
    usage.reasoningTokens += u?.reasoningTokens ?? 0;
  };

  const cappedSpec = { ...spec, beats };
  const filmDeadlineAt = Date.now() + FILM_BUDGET_MS;
  const budgetLeft = () => filmDeadlineAt - Date.now();
  // No 'planning' phase emitted here: runStoryboardJob already emitted one before the
  // draft-resume check, and two identical phase events make the client's stage flicker back to a
  // stage it has already left.
  const planStartedAt = Date.now();
  const planResult = await withHeartbeat(emit, 'planning', () =>
    filmCall(env, {
      model: plan.model,
      system: buildPlanBrief(),
      user: buildPlanUserMessage(cappedSpec, cast),
      schema: toStrictSchema(FILM_PLAN_SCHEMA),
      toolName: 'emit_plan',
      // NOT a small ceiling, and the first version of this line got it exactly backwards.
      //
      // It was 4096, on the reasoning that "a small answer needs a small ceiling" — leave it at
      // the film-sized 32k and the model treats this as the big call and thinks for as long as
      // it would have anyway. That rationale sounds right and is wrong about what the parameter
      // does. `max_tokens` caps the WHOLE completion, and on this model 60-75% of a completion
      // is reasoning. So a tight ceiling does not discourage thinking; the model thinks exactly
      // as much as it was going to, runs out of budget mid-thought, and the answer is truncated
      // before it is ever emitted.
      //
      // Measured 2026-08-26: 4096 was enough for a 3-beat film and produced
      // `finish_reason=length after 4096 tokens` on a 5-beat one — a plan call that cost the
      // full reasoning time and returned nothing, which then took the whole split down with it.
      //
      // 🔑 To buy less thinking you have to ask for less thinking (`reasoning`, see
      // worker/openrouter.js). A token ceiling only decides whether you get to keep the answer
      // the thinking paid for.
      maxTokens: 16384,
      retries: 1,
      signal: AbortSignal.timeout(Math.min(PLAN_CALL_TIMEOUT_MS, budgetLeft())),
    }),
  );
  addUsage(planResult.usage);
  const filmPlan = planResult.data;
  console.log(`[Storyboarder] plan call finished in ${Date.now() - planStartedAt}ms: ${(filmPlan?.beats ?? []).map((b) => b.framing).join('/')}`);

  // The honest wireframe signal. One event per beat, each carrying what was actually decided for
  // it — emitted before any geometry exists, which is the whole point.
  for (const entry of filmPlan?.beats ?? []) {
    await emit('beat-plan', {
      beatIndex: entry.beatIndex,
      framing: entry.framing,
      principalSubject: entry.principalSubject,
      motion: entry.motion,
      intent: entry.intent,
    });
  }
  await emit('phase', { phase: 'drafting', planned: (filmPlan?.beats ?? []).length });

  // The beats, overlapped up to the concurrency the provider will actually serve. They are
  // independent by construction — each is given the whole shot list and asked for its own beat,
  // so no call waits on another's ANSWER; the only thing bounding them is how many in-flight
  // requests this route tolerates before it starts shedding. See beatConcurrency.
  const drawn = await withHeartbeat(emit, 'drafting', () =>
    mapPooled(beats, beatConcurrency(env), async (beatText, beatIndex) => {
      if (isTransitionBeat(beatText)) return { beatIndex, beat: null, transition: true };
      const startedAt = Date.now();
      let attempts = 0;
      // Refuse to start what cannot finish. A beat begun with thirty seconds left does not
      // produce a beat — it produces a runtime kill that takes the finished beats with it.
      if (budgetLeft() <= 30_000) {
        const error = `The film ran out of time before beat ${beatIndex + 1} could be blocked.`;
        console.warn(`[Storyboarder] beat ${beatIndex + 1} skipped: out of budget`);
        await emit('beat-drawn', { beatIndex, framing: null, failed: true, error, attempts: 0 });
        return { beatIndex, beat: null, error };
      }
      try {
        const result = await filmCall(env, {
          model: plan.model,
          system: buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2),
          user: buildBeatUserMessage(cappedSpec, cast, beatIndex, filmPlan),
          schema: toStrictSchema(SCENE_SCHEMA),
          toolName: 'emit_film',
          // Two retries, not one. A 502 from this route under concurrency is a shed request,
          // which is exactly the transient a retry ladder exists for — and a beat lost to it
          // costs the visitor a whole refused beat. The attempts are reported below rather
          // than absorbed, so the latency they cost stays attributable.
          retries: 2,
          signal: AbortSignal.timeout(Math.min(BEAT_CALL_TIMEOUT_MS, budgetLeft())),
          // Counted per upstream ATTEMPT, not per soft error. A 429 arrives as a real HTTP
          // status with no `softError` on it, so counting only soft errors would miss exactly
          // the rate-limit retries this tier hits most — and undercounting attempts is how the
          // retry latency became invisible in the first place.
          onMeta: () => { attempts += 1; },
        });
        const beat = (result.data?.beats ?? []).find((b) => b.beatIndex === beatIndex)
          ?? result.data?.beats?.[0]
          ?? null;
        console.log(`[Storyboarder] beat ${beatIndex + 1} drawn in ${Date.now() - startedAt}ms`);
        // Told the moment it is true, per beat. This is what makes the timeline fill in
        // piecemeal instead of everything appearing at once at the end.
        await emit('beat-drawn', { beatIndex, framing: beat?.framing ?? null, ms: Date.now() - startedAt, attempts });
        return { beatIndex, beat, usage: result.usage, sceneScaleNote: result.data?.sceneScaleNote, aspect: result.data?.aspect };
      } catch (error) {
        // ONE BEAT FAILING IS NOT THE FILM FAILING, and this is a property the single-call path
        // never had: there, one bad response lost everything. Here the beat comes back with no
        // geometry, validation refuses it by the normal route, and the visitor gets the rest of
        // the film plus an honest note about the one that did not make it.
        console.warn(`[Storyboarder] beat ${beatIndex + 1} failed:`, error.message);
        await emit('beat-drawn', { beatIndex, framing: null, failed: true, error: error.message, attempts });
        return { beatIndex, beat: null, error: error.message };
      }
    }),
  );

  for (const d of drawn) addUsage(d.usage);

  return {
    data: {
      units: 'metres',
      aspect: drawn.find((d) => d.aspect)?.aspect ?? 16 / 9,
      sceneScaleNote: filmPlan?.sceneScaleNote ?? drawn.find((d) => d.sceneScaleNote)?.sceneScaleNote ?? null,
      beats: drawn.map((d) => d.beat).filter(Boolean),
    },
    filmPlan,
    usage,
    model: plan.model,
    costUsd: 0,
  };
}

/**
 * Reasoning text relay.
 *
 * The free tier streams the model's thinking as it works. We forward that text to the browser so
 * the wait is legible — "someone is working" rather than a silent spinner. We no longer try to
 * parse provisional geometry out of the prose; the real scene graph arrives atomically at the end
 * and is the only geometry we trust.
 */

const reasoningRelay = (emit, { maxBeats }) => {
  let currentBeat = 0;
  return async (delta) => {
    const mentioned = [...String(delta).matchAll(/beat\s*(\d+)/gi)].pop();
    if (mentioned) {
      const index = Number(mentioned[1]) - 1;
      if (index >= 0 && index < maxBeats) currentBeat = index;
    }
    await emit('reasoning', { delta, beatIndex: currentBeat });
  };
};

/** Plain English for a violation a visitor has to make sense of without knowing what a frustum
 * is. Adam's failure-surface rule: refuse the beat, say what happened, offer a way forward — the
 * refusal is only respectful if the reason is legible. */
const violationInEnglish = (violation, nameOf = (tag) => tag) => {
  const who = violation.subject ? nameOf(violation.subject) : 'a subject';
  switch (violation.code) {
    case 'camera-inside-subject':
      return `the camera ended up inside ${who}`;
    case 'subject-behind-lens':
      return `${who} is listed in the shot but ends up behind the camera`;
    case 'subject-underground':
      return `${who} ended up below ground level`;
    case 'subject-floating':
      return `${who} is floating with nothing to stand on`;
    case 'containment-invalid':
      return `${who} is supposed to be inside something but ended up outside it`;
    case 'absurd-scale':
      return `something is the wrong size by orders of magnitude — ${violation.detail}`;
    case 'height-contradicts-profile':
      return `${who} was staged at a completely different size from the piece itself, so the shot size would be wrong`;
    case 'non-finite':
      return 'some of the coordinates came back as nonsense numbers';
    case 'missing-camera':
      return 'the beat came back with no camera at all';
    case 'transition-has-camera':
    case 'transition-has-subjects':
      return 'a cut-to-black came back with a shot in it';
    default:
      return violation.detail ?? violation.code;
  }
};

const floorViolations = (scene, profiles = null) =>
  validateScene(scene, { profiles }).filter((v) => v.severity === 'floor');

/**
 * Tag -> the physical profile of the piece cast in that slot, so validateScene can check the
 * height the model used against the height the Casting Director measured.
 *
 * Keyed by TAG rather than by cast key because that is what a scene's subjects are named by, and
 * the referencePlan is the one place the two are joined — the same join subjectNamesFrom does.
 */
const profilesFrom = (spec, castByKey) =>
  Object.fromEntries(
    (spec.referencePlan ?? [])
      .map((slot, i) => [`<Subject ${i + 1}>`, castByKey.get(slot.key)?.dossier?.physicalProfile])
      .filter(([, profile]) => profile),
  );

const subjectNamesFrom = (spec, castByKey) =>
  Object.fromEntries(
    (spec.referencePlan ?? []).map((slot, i) => {
      const entry = castByKey.get(slot.key);
      return [`<Subject ${i + 1}>`, entry?.dossier?.subject ?? entry?.name ?? `<Subject ${i + 1}>`];
    }),
  );

/**
 * One targeted re-emission of a single beat that breached the floor.
 *
 * TWO-STAGE BY DESIGN (Adam's round-7 pin): the repaired beat must re-pass the SAME deterministic
 * check that rejected the original. A repair that introduces a fresh violation fails visibly
 * rather than silently shipping a broken fix — otherwise "we repaired it" becomes a claim nobody
 * ever verifies, which is worse than not repairing at all.
 */
async function repairBeat(env, plan, { spec, cast, beatIndex, beatText, broken, violations, signal, retries }) {
  const system = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
  // The film header (world, staging, cast) minus its closing instruction, then the beat itself.
  //
  // Slicing the tail off `buildFilmUserMessage` used to take the BEAT TEXT with it — the model was
  // asked to re-emit a beat it was never shown, under a heading that read "The film is 1 beats
  // long, in order:" followed by nothing. It answered anyway, which is what made it hard to spot.
  const header = buildFilmUserMessage({ ...spec, beats: [beatText] }, cast)
    .split('\n')
    .slice(0, -4);
  const user = [
    ...header,
    `Beat ${beatIndex + 1}: ${beatText}`,
    '',
    `This is beat ${beatIndex + 1}, and your previous attempt at it is physically impossible:`,
    JSON.stringify(broken),
    '',
    'The specific problems, each computed from your own numbers, not opinions about them:',
    ...violations.map((v) => `  - ${v.detail}`),
    '',
    'Re-emit this ONE beat with the geometry corrected. Keep everything that was not wrong —',
    'the same subjects, the same intent, the same shot size where it was achievable — and change',
    'only what has to change to make the scene physically possible. Return a film object',
    `containing exactly this one beat, with beatIndex ${beatIndex}.`,
  ].join('\n');

  const { data, usage, model } = await generateFilm(env, plan, { system, user, signal, retries });
  const repaired = (data.beats ?? []).find((b) => b.beatIndex === beatIndex) ?? data.beats?.[0] ?? null;
  return { repaired, usage, model };
}

/** Frames the visitor never asked for but the film needs: a [CUT TO BLACK] carries no geometry,
 * so it is built in code rather than paid for. Deterministic, free, and impossible to get wrong. */
const transitionFrame = (beatIndex, beatText) => ({
  frameId: makeFrameId(beatIndex),
  beatIndex,
  transition: true,
  transitionText: transitionText(beatText),
  scene: null,
  proseNote: null,
  blocking: null,
  status: 'ok',
  violations: [],
  attempts: 0,
  r2Key: null,
  costUsd: 0,
  regenCount: 0,
  history: [],
  createdAt: Date.now(),
});

/**
 * The durable generation: one whole-film call, validated per beat, no image spend.
 *
 * This runs under ctx.waitUntil after POST /api/storyboard has already returned a job id. The
 * heavy work is therefore not tied to an HTTP response stream, so a dropped progress SSE cannot
 * kill it. Progress is written to a KV job log; the client reads it via GET
 * /api/storyboard/job/:jobId/events.
 */
async function runStoryboardJob(env, { mindId, spec, cast, plan, jobId, record }) {
  // The record is passed IN rather than re-read, because the logger now owns it in memory for
  // the life of the job and never reads it back — see createJobLogger. The Queue consumer has
  // already loaded it to check the status, so this is the same read, used instead of repeated.
  const logger = createJobLogger(env, mindId, record ?? { jobId, mindId, plan, status: "running", events: [] });
  const emit = async (type, data) => {
    logger.log(type, data);
    if (type === 'result' || type === 'error') {
      await logger.flush();
    }
  };
  const castByKey = new Map(cast.map((c) => [c.key, c]));

  try {
    // The cap is applied HERE, before a single token is spent — a visitor is never allowed to
    // start a render they cannot finish. `overCap` is already in the plan event, so the UI can
    // say so in the visitor's own language rather than counting beats at them.
    const beats = spec.beats.slice(0, plan.maxBeats);
    await logger.setStatus('running');
    console.log(`[Storyboarder ${jobId}] starting ${plan.tier} tier, model=${plan.model}, beats=${beats.length}`);
    await emit('plan', plan);

    const cappedSpec = { ...spec, beats };
    const system = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
    const user = buildFilmUserMessage(cappedSpec, cast);
    const nameOf = (tag) => subjectNamesFrom(spec, castByKey)[tag] ?? tag;
    // Empty for a cast whose dossiers predate schema v5, which turns the height check off rather
    // than failing every beat of an older cast — the profile is an improvement, not a prerequisite.
    const profiles = profilesFrom(spec, castByKey);

    await emit('phase', { phase: 'planning', beats: beats.length, tier: plan.tier });

    const filmId = filmIdFor(spec);

    let film;
    let usage;
    let model;
    let activePlan = plan;
    // The shot list the split path decided, kept so the storyboard can record whether the
    // geometry pass actually honoured it — see planAdherence. Null on the whole-film path.
    let filmPlanUsed = null;

    // A GENERATION THIS RUN DOES NOT HAVE TO PAY FOR AGAIN. If a previous attempt got the model's
    // answer and then died before saving a storyboard — a killed invocation, a crash in the repair
    // loop — the answer is still here. Reusing it turns a second wait of three to eight minutes
    // into a second wait of about a second, and it costs nothing to check.
    const draft = await loadDraft(env, mindId, filmId);
    const resumed = Boolean(draft?.film);
    if (draft?.film) {
      console.log(`[Storyboarder ${jobId}] resuming from draft, model=${draft.model}`);
      film = draft.film;
      usage = draft.usage;
      model = draft.model;
      filmPlanUsed = draft.filmPlan ?? null;
      if (draft.tier && draft.tier !== activePlan.tier) activePlan = { ...activePlan, tier: draft.tier };
      await emit('phase', { phase: 'drafting', resumed: true });
    }

    try {
      // Skipped entirely on a resumed draft — the previous attempt already did this.
      if (!film) {
        console.log(`[Storyboarder ${jobId}] calling model ${activePlan.model} for ${beats.length} beat(s)`);
        const callStartedAt = Date.now();
        let result;

        if (splitEnabled(env, activePlan)) {
          // The plan-then-parallel-beats path. It emits its own phases as it goes, because the
          // whole reason it exists is that the wait has stages a visitor can see.
          try {
            result = await generateFilmSplit(env, activePlan, { spec: cappedSpec, cast, beats, emit });
            filmPlanUsed = result.filmPlan ?? null;
          } catch (splitError) {
            // THE SPLIT IS AN OPTIMISATION, NOT A DEPENDENCY. If the plan call fails there is
            // still a perfectly good whole-film path that has been in production for a round,
            // and a visitor should get a slower film rather than no film. Logged loudly, since
            // a split that quietly never runs would make its own measurements meaningless.
            console.warn(`[Storyboarder ${jobId}] split path failed, falling back to the whole-film call:`, splitError.message);
            await emit('phase', { phase: 'drafting', fellBackToWholeFilm: true });
            result = await withHeartbeat(emit, 'drafting', () =>
              generateFilm(env, activePlan, { system, user }),
            );
          }
        } else {
          const relay = activePlan.tier === 'free'
            ? reasoningRelay(emit, { maxBeats: beats.length })
            : undefined;
          result = await withHeartbeat(emit, 'drafting', () => {
            return emit('phase', { phase: 'drafting' }).then(() =>
              generateFilm(env, activePlan, {
                system,
                user,
                onReasoning: relay,
                onDegraded: (detail) => emit('degraded', detail),
              }),
            );
          });
        }

        console.log(`[Storyboarder ${jobId}] model call finished in ${Date.now() - callStartedAt}ms, returned ${result.data?.beats?.length ?? 0} beat(s)`);
        film = result.data;
        usage = result.usage;
        model = result.model;
        await saveDraft(env, mindId, filmId, { film, usage, model, tier: activePlan.tier, filmPlan: filmPlanUsed });
      }
    } catch (error) {
      // THE PAID PROVIDER BEING UNAVAILABLE IS NOT THE VISITOR'S PROBLEM TO ABSORB.
      //
      // Measured on the first live paid run, 2026-08-24: the account's credit balance was
      // exhausted, which OpenAI reports as a 429 with code `insufficient_quota`. Without this
      // branch the visitor gets nothing at all — for a reason that has nothing to do with their
      // scene, their budget, or anything they can act on.
      //
      // Same shape as the budget-exhausted downgrade in worker/tier.js, and the same rule
      // applies: downgrade explicitly, never silently. Deliberately narrow — only an
      // out-of-credit or auth failure falls back, because a truncated film or a refusal means
      // the free model would likely fail the same way and the honest answer is the error.
      const canFallBack = activePlan.tier === 'paid' && (error.outOfCredit || error.status === 401);
      if (!canFallBack) {
        await logger.setStatus('failed', { error: error.message });
        await emit('error', { error: error.message, plan: activePlan, retryable: error?.status === 429 });
        return;
      }
      activePlan = {
        ...activePlan,
        tier: 'free',
        model: env.FREE_STORYBOARD_MODEL ?? plan.model,
        maxBeats: FREE_MAX_BEATS,
        estimateUsd: 0,
        estimateSeconds: LATENCY_SECONDS.free.p50,
        label: TIER_LABEL.free,
        downgraded: true,
        downgradeReason: 'The paid model was unavailable for this run, so the scene was generated on the free model instead. Nothing was charged.',
      };
      await emit('plan', activePlan);
      try {
        const result = await withHeartbeat(emit, 'drafting', () =>
          generateFilm(env, activePlan, {
            system,
            user: buildFilmUserMessage({ ...cappedSpec, beats: beats.slice(0, FREE_MAX_BEATS) }, cast),
            onReasoning: reasoningRelay(emit, {
              maxBeats: Math.min(beats.length, FREE_MAX_BEATS),
            }),
          }),
        );
        film = result.data;
        usage = result.usage;
        model = result.model;
        await saveDraft(env, mindId, filmId, { film, usage, model, tier: activePlan.tier });
      } catch (fallbackError) {
        await logger.setStatus('failed', { error: fallbackError.message });
        await emit('error', { error: fallbackError.message, plan: activePlan, retryable: fallbackError?.status === 429 });
        return;
      }
    }

    // BILLED ONCE PER GENERATION, NOT ONCE PER ATTEMPT. A resumed draft's tokens were recorded by
    // the attempt that actually spent them, so recording them again would charge a visitor twice
    // for one model call because the FIRST attempt crashed — the worst possible direction for that
    // error to run. Read the ledger instead of adding to it.
    let spend = resumed
      ? await getSpend(env, mindId)
      : await recordSpend(env, mindId, { kind: 'llm', model, usage, beatIndex: null });

    await emit('phase', { phase: 'validating' });

    const byIndex = new Map((film.beats ?? []).map((beat) => [beat.beatIndex, beat]));
    const usableBeats = beats.slice(0, activePlan.maxBeats);
    const storyboard = {
      frames: [],
      tier: activePlan.tier,
      model,
      aspect: film.aspect ?? 16 / 9,
      sceneScaleNote: film.sceneScaleNote ?? null,
      // Stored so a RETURNING visitor still sees which tier made this storyboard. The badge
      // otherwise exists only while a plan is in hand, which means the one surface Adam asked to
      // be visible at all times quietly disappears on a reload.
      tierLabel: activePlan.label,
      // Stored with the storyboard, not derived on the client: "<Subject 1>" is how the machinery
      // matches a subject across the schema, the references and the render prompt — it is not
      // what a person should ever be shown. Keeping the mapping on the record means a returning
      // visitor sees "the ape" without needing the original cast in hand.
      subjectNames: subjectNamesFrom(spec, castByKey),
      // What each subject IS, and what it came from — see subjectAssetsFrom.
      subjectAssets: subjectAssetsFrom(spec, castByKey),
      // The shot list the plan pass decided, kept with the record. A refused beat is far
      // easier to read next to what it was MEANT to be, and a returning visitor can see the
      // film's intended shape without the plan being re-derived from geometry that failed.
      filmPlan: filmPlanUsed,
      // Which film this is. Without it a second film silently overwrites the first.
      filmId,
      logline: spec.logline ?? null,
      createdAt: Date.now(),
    };
    const repaired = [];
    const refused = [];

    // PASS ONE: validate everything, deterministically and for free. No model calls here, so the
    // whole film's verdict is known before a single repair is commissioned — which is what makes
    // the repairs schedulable as a set rather than discovered one at a time.
    const verdicts = usableBeats.map((beatText, beatIndex) => {
      if (isTransitionBeat(beatText)) return { beatIndex, beatText, transition: true };
      const scene = byIndex.get(beatIndex) ?? null;
      const violations = scene
        ? floorViolations(scene, profiles)
        : [{ code: 'missing-beat', severity: 'floor', detail: 'The model returned no geometry for this beat.' }];
      return { beatIndex, beatText, transition: false, scene, violations, attempts: 1 };
    });

    // PASS TWO: the repairs, IN PARALLEL.
    //
    // They used to run strictly one after another, inside the validation loop. Three repairs on a
    // route that answers in ~100-150s is five to seven minutes of wall clock spent on work that
    // has no reason to be sequential: round 7 measured these failures landing on DIFFERENT beats
    // each run rather than compounding on one, so no repair depends on the outcome of another.
    // Serialising them was incidental to where the code sat, not a property of the problem.
    //
    // The ceiling of three per film is unchanged and is NOT timidity — a film needing four
    // repairs is a film with something else wrong with it, and spending more calls on it hides
    // that rather than fixing it. Parallel repairs make the ceiling cheaper to hit, not higher.
    const needsRepair = verdicts.filter((v) => !v.transition && v.scene && v.violations.length).slice(0, 3);

    if (needsRepair.length) {
      await emit('phase', {
        phase: 'validating',
        repairing: true,
        beatIndexes: needsRepair.map((v) => v.beatIndex),
      });
      // POOLED, NOT Promise.all — and this had to be corrected after the fact, which is the
      // instructive part. The beat path was bounded to one in flight because this route was
      // measured shedding concurrent film-sized requests with a 502; the repair path was left
      // firing three at once, against the same route, for the same size of call. Parallelising
      // repairs is only a win where the provider will actually serve them, and the same
      // measurement governs both.
      //
      // Repairs share the film's clock too. A repair that starts with no budget left is a
      // runtime kill that discards every beat already validated.
      const repairDeadlineAt = Date.now() + Math.min(FILM_BUDGET_MS, BEAT_CALL_TIMEOUT_MS * 2);
      const results = await withHeartbeat(emit, 'validating', () =>
        mapPooled(needsRepair, beatConcurrency(env), async (verdict) => {
          const left = repairDeadlineAt - Date.now();
          if (left <= 30_000) {
            console.warn(`Beat ${verdict.beatIndex + 1} repair skipped: out of budget`);
            return { verdict, result: null };
          }
          try {
            // `retries: 0`. A repair IS a retry — the beat has already been attempted once and
            // deterministically rejected. Letting the transport retry it again turns one visible
            // repair into three multi-minute calls hidden behind a single progress phase, which
            // is precisely the kind of invisible latency this round exists to remove.
            const result = await repairBeat(env, activePlan, {
              spec: cappedSpec,
              cast,
              beatIndex: verdict.beatIndex,
              beatText: verdict.beatText,
              broken: verdict.scene,
              violations: verdict.violations,
              signal: AbortSignal.timeout(Math.min(BEAT_CALL_TIMEOUT_MS, left)),
              retries: 0,
            });
            return { verdict, result };
          } catch (error) {
            console.warn(`Beat ${verdict.beatIndex + 1} repair failed:`, error.message);
            return { verdict, result: null };
          }
        }),
      );

      // Spend is recorded here, serially, and deliberately NOT inside the parallel block: it is a
      // read-modify-write on one ledger, and concurrent writers would lose each other's tokens.
      // The calls are what benefits from being parallel; the accounting for them does not.
      for (const { verdict, result } of results) {
        if (!result) continue;
        verdict.attempts += 1;
        spend = await recordSpend(env, mindId, { kind: 'llm', model: result.model, usage: result.usage, beatIndex: verdict.beatIndex });
        if (!result.repaired) continue;
        const afterRepair = floorViolations({ ...result.repaired, beatIndex: verdict.beatIndex }, profiles);
        // The two-stage check, unchanged. A repair is only a repair if it passes the check that
        // rejected the original; otherwise the original failure stands and is reported.
        if (!afterRepair.length) {
          verdict.scene = { ...result.repaired, beatIndex: verdict.beatIndex };
          verdict.violations = [];
          repaired.push(verdict.beatIndex);
        } else {
          verdict.violations = afterRepair;
        }
      }
    }

    // PASS THREE: build the frames, in beat order, from settled verdicts.
    for (const verdict of verdicts) {
      if (verdict.transition) {
        // Decided in code, not taken on trust: the marker is in the beat text, so a model that
        // returns a shot for it is simply wrong and there is nothing to verify.
        storyboard.frames.push(transitionFrame(verdict.beatIndex, verdict.beatText));
        continue;
      }

      const failed = verdict.violations.length > 0;
      if (failed) refused.push(verdict.beatIndex);

      storyboard.frames.push({
        frameId: makeFrameId(verdict.beatIndex),
        beatIndex: verdict.beatIndex,
        transition: false,
        transitionText: null,
        beatText: verdict.beatText,
        scene: failed ? null : verdict.scene,
        // Kept even on a refused beat: the prose is the primary human surface, it is what the
        // visitor reads first, and it is not what failed.
        proseNote: verdict.scene?.proseNote ?? null,
        blocking: null,
        status: failed ? 'failed' : 'ok',
        violations: verdict.violations.map((v) => ({ ...v, english: violationInEnglish(v, nameOf) })),
        attempts: verdict.attempts,
        tier: activePlan.tier,
        model,
        r2Key: null,
        costUsd: 0,
        regenCount: 0,
        history: [],
        createdAt: Date.now(),
      });
    }

    await emit('phase', { phase: 'finalising' });

    // DID THE SPLIT ACTUALLY KEEP THE VARIETY? This is the one regression the split can cause
    // and the one round 7's pin was protecting against, so it is measured on every real run
    // rather than only in the probe. Reported, never enforced: `framing` is the model's claim
    // about its own numbers, and worker/scene.js derives the true band from the geometry
    // independently — if they disagree, the geometry is what counts.
    const adherence = filmPlanUsed ? planAdherence(filmPlanUsed, storyboard.frames) : null;
    if (adherence) {
      storyboard.planAdherence = adherence;
      console.log(`[Storyboarder ${jobId}] plan adherence ${adherence.matched}/${adherence.checked}` +
        ` (${adherence.distinctPlanned} bands planned, ${adherence.distinctEmitted} emitted)` +
        (adherence.drifted.length ? ` — drifted: ${adherence.drifted.map((d) => `beat ${d.beatIndex + 1} ${d.planned}->${d.emitted}`).join(', ')}` : ''));
      await emit('plan-adherence', adherence);
    }

    console.log(`[Storyboarder ${jobId}] validation done: ${repaired.length} repaired, ${refused.length} refused, saving storyboard`);

    // SAVE FIRST, THEN TELL THE BROWSER. The whole film arrives from one call, so there is no
    // streaming value in emitting frames as they are validated — they are all ready within a
    // second of each other. Persisting before emitting means the durable copy never depends on
    // anyone still being on the page, which is the exact ordering that lost a finished film on
    // 2026-08-25: spend recorded, frames built, first write to a closed tab threw, and the KV
    // write two lines below it never happened.
    await saveStoryboard(env, mindId, storyboard);
    console.log(`[Storyboarder ${jobId}] storyboard saved: ${storyboard.frames.length} frame(s)`);
    await clearDraft(env, mindId, filmId);

    for (const frame of storyboard.frames) {
      await emit('frame', frame);
    }

    const budget = await getBudget(env, mindId);
    const shots = storyboard.frames.filter((f) => !f.transition).length;
    await relayStoryboardDigest(
      env,
      mindId,
      [
        `[Storyboarder] Blocked ${shots} shot(s) on the ${activePlan.tier} tier (${model}).`,
        repaired.length ? ` Repaired: ${repaired.map((i) => `beat ${i + 1}`).join(', ')} — geometry corrected and re-checked.` : '',
        adherence?.drifted.length
          ? ` Shot list drift: ${adherence.drifted.map((d) => `beat ${d.beatIndex + 1} was planned ${d.planned} and came back ${d.emitted}`).join('; ')}.`
          : '',
        refused.length ? ` Refused validation: ${refused.map((i) => `beat ${i + 1}`).join(', ')}. The visitor can regenerate or accept them as-is.` : '',
        activePlan.downgraded ? ` Note: ${activePlan.downgradeReason}` : '',
        spec.beats.length > activePlan.maxBeats ? ` The spec ran to ${spec.beats.length} beats; ${activePlan.maxBeats} were blocked on this tier.` : '',
        ` Spend so far: $${spend.totalSpent.toFixed(2)}${budget?.total != null ? ` of $${budget.total}` : ''}.`,
      ].join(''),
    );
    await maybeRelayThreshold(env, mindId, spend, budget);

    await emit('result', {
      frames: storyboard.frames,
      plan: activePlan,
      spend,
      repaired,
      refused,
      subjectNames: storyboard.subjectNames,
      subjectAssets: storyboard.subjectAssets,
    });
    await logger.setStatus('complete', { filmId: storyboard.filmId });
    console.log(`[Storyboarder ${jobId}] complete, filmId=${storyboard.filmId}`);
  } catch (error) {
    console.error(`[Storyboarder ${jobId}] failed:`, error);
    await logger.setStatus('failed', { error: error.message });
    await emit('error', { error: error.message, retryable: error?.status === 429 });
  } finally {
    await logger.close();
  }
}

export async function handleStoryboard(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { spec, cast } = body;
  if (!spec || !Array.isArray(spec.beats) || !spec.beats.length || !Array.isArray(cast) || !cast.length) {
    return json({ error: 'Body needs { spec, cast: [{ key, dossier, name }] }' }, 400);
  }

  const mindId = session.mindId;
  const plan = await resolveTier(env, mindId, spec.beats.length);

  // Hard, deterministic caps are checked before any queue message is sent or any token is spent.
  // The UI also gates the button, but the API is the source of truth.
  const capViolations = checkStoryboardInput(plan, spec);
  if (capViolations.length) {
    return json({ error: 'over_cap', plan, violations: capViolations }, 400);
  }

  const filmId = filmIdFor(spec);
  const { jobId } = await createStoryboardJob(env, mindId, { plan, filmId });

  // The generation is long-running (3-8 min). It cannot safely live under ctx.waitUntils
  // 30-second ceiling, so it runs in a Queue consumer with up to 15 minutes of wall time and
  // survives client disconnects. See handleStoryboardQueue below and wrangler.jsonc.
  await env.STORYBOARD_JOBS.send({ mindId, spec, cast, plan, jobId, filmId }, { contentType: 'json' });

  return json({ jobId, plan, filmId });
}

/**
 * Queue consumer entry point. Runs the long generation with up to 15 minutes of wall time,
 * independent of any HTTP request, so a closed tab cannot kill a film that is already generating.
 *
 * Each message is acked when the job reaches a terminal state. Retries are limited: if a model
 * call already spent money and then crashed, re-running it from scratch would double-charge.
 * The draft-resume path inside runStoryboardJob makes retries cheap when the crash happened
 * after the model answer arrived.
 */
export async function handleStoryboardQueue(batch, env) {
  for (const message of batch.messages) {
    const payload = message.body;
    if (!payload || typeof payload !== 'object') {
      message.ack();
      continue;
    }
    const { mindId, spec, cast, plan, jobId } = payload;
    if (!mindId || !jobId) {
      message.ack();
      continue;
    }

    try {
      const record = await loadStoryboardJob(env, mindId, jobId);
      if (!record) {
        // The job record should have been created by POST /api/storyboard. Without it there is
        // nowhere to stream events to, so drop the message rather than run blindly.
        message.ack();
        continue;
      }
      if (record.status === 'complete' || record.status === 'failed') {
        message.ack();
        continue;
      }

      await runStoryboardJob(env, { mindId, spec, cast, plan, jobId, record });
      message.ack();
    } catch (error) {
      console.error('Storyboard queue consumer failed:', error);
      // Only retry transient, likely-provider-side failures, and only a couple of times.
      // Otherwise we mark the job failed and ack so the message does not loop forever.
      const retryable = error?.status === 429 || error?.status >= 500 || error?.retryable;
      if (message.attempts <= 2 && retryable) {
        message.retry({ delaySeconds: 5 + message.attempts * 5 });
      } else {
        try {
          const record = await loadStoryboardJob(env, mindId, jobId);
          if (record && record.status !== 'complete' && record.status !== 'failed') {
            record.status = 'failed';
            record.error = error?.message ?? 'Queue consumer failed after retries';
            await saveStoryboardJob(env, mindId, record);
          }
        } catch (updateErr) {
          console.error('Failed to mark storyboard job failed:', updateErr.message);
        }
        message.ack();
      }
    }
  }
}

/** One job's current state. Cheap — a KV read — so the client can poll it freely. */
export async function handleStoryboardJobStatus(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { pathname } = new URL(request.url);
  const parts = pathname.split('/');
  const jobId = parts[4];
  if (!jobId) return json({ error: 'job_id_required' }, 400);

  const record = await loadStoryboardJob(env, session.mindId, jobId);
  if (!record) return json({ error: 'not_found' }, 404);

  return json({
    jobId: record.jobId,
    status: record.status,
    filmId: record.filmId,
    plan: record.plan,
    events: record.events,
    error: record.error ?? null,
  });
}

/** Lightweight SSE over the job log. The loop itself lives in worker/job-events.js — the
 * Director needs the identical stream over a different record, and the only thing that actually
 * differed was how the record is loaded. */
export async function handleStoryboardJobEvents(request, env, ctx) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { pathname, searchParams } = new URL(request.url);
  const jobId = pathname.split('/')[4];
  if (!jobId) return json({ error: 'job_id_required' }, 400);

  return streamJobEvents(ctx, {
    loadRecord: () => loadStoryboardJob(env, session.mindId, jobId),
    lastEvent: searchParams.get('lastEvent') ?? 0,
  });
}

/** What the visitor is told BEFORE they click generate: which tier, which model, what it costs,
 * how long it takes, and whether their story is longer than this tier covers. Cheap — a KV read
 * and arithmetic, no model call — so the UI can poll it freely. */
export async function handleStoryboardPlan(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const beatCount = Number(new URL(request.url).searchParams.get('beats') ?? 0);
  return json(await resolveTier(env, session.mindId, beatCount));
}

/**
 * One beat, regenerated on the visitor's explicit click.
 *
 * ADAM'S FAILURE SURFACE, and the reason this is a button rather than an automatic retry: a beat
 * that fails validation is refused, not shipped flagged, and the visitor decides what happens
 * next. Three attempts, then the beat is dropped with a clear note — "a 5-beat film the visitor
 * can count is better than a 6-beat film with a hidden flaw."
 */
export async function handleStoryboardBeatRegenerate(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { frameId: targetId, spec, cast } = body;
  if (!targetId || !spec || !Array.isArray(cast)) return json({ error: 'Body needs { frameId, spec, cast }' }, 400);

  const mindId = session.mindId;
  const castByKey = new Map(cast.map((c) => [c.key, c]));
  const record = await loadStoryboard(env, mindId, filmIdFor(spec));
  const frame = record.frames.find((f) => f.frameId === targetId);
  if (!frame) return json({ error: 'frame_not_found' }, 404);
  if (frame.transition) return json({ error: 'A transition has no geometry to regenerate.' }, 400);
  if (frame.status === 'dropped') return json({ error: 'This beat was dropped after three failed attempts.' }, 409);

  const plan = await resolveTier(env, mindId, record.frames.length);
  const beatText = frame.beatText ?? spec.beats?.[frame.beatIndex] ?? '';
  const nameOf = (tag) => subjectNamesFrom(spec, castByKey)[tag] ?? tag;

  let usage;
  let model;
  let scene = null;
  let violations = [];
  try {
    const result = await repairBeat(env, plan, {
      spec,
      cast,
      beatIndex: frame.beatIndex,
      beatText,
      broken: frame.scene ?? { note: 'the previous attempt was discarded' },
      violations: frame.violations ?? [],
    });
    usage = result.usage;
    model = result.model;
    scene = result.repaired ? { ...result.repaired, beatIndex: frame.beatIndex } : null;
    violations = scene
      ? floorViolations(scene, profilesFrom(spec, castByKey))
      : [{ code: 'missing-beat', severity: 'floor', detail: 'The model returned no geometry for this beat.' }];
  } catch (error) {
    violations = [{ code: 'call-failed', severity: 'floor', detail: error.message }];
  }

  const spend = await recordSpend(env, mindId, {
    kind: 'llm',
    model: model ?? plan.model,
    usage,
    frameId: targetId,
    beatIndex: frame.beatIndex,
    // Spend on a beat the visitor never gets to see is still spend, and it is the answer to
    // "why did my budget run out faster than the beats I can count?"
    failed: violations.length > 0,
  });

  frame.attempts = (frame.attempts ?? 1) + 1;
  frame.model = model ?? plan.model;
  frame.tier = plan.tier;
  if (!violations.length) {
    frame.scene = scene;
    frame.proseNote = scene?.proseNote ?? frame.proseNote;
    frame.status = 'ok';
    frame.violations = [];
  } else {
    frame.violations = violations.map((v) => ({ ...v, english: violationInEnglish(v, nameOf) }));
    // Three strikes. The film keeps its integrity by losing a beat rather than by hiding one.
    frame.status = frame.attempts >= 3 ? 'dropped' : 'failed';
    if (scene) frame.lastRejectedScene = scene;
  }

  await saveStoryboard(env, mindId, record);

  if (frame.status === 'dropped') {
    await relayStoryboardDigest(
      env,
      mindId,
      `[Storyboarder] Beat ${frame.beatIndex + 1} dropped after ${frame.attempts} failed attempts (${frame.violations.map((v) => v.english).join('; ')}). The rest of the film is intact.`,
    );
  }

  return json({ frame, spend, plan });
}

/**
 * "I want this beat anyway."
 *
 * The power-user path out of the validator, deliberately behind an explicit action rather than
 * offered alongside the refusal — Adam's framing: two clicks, because friction IS the safeguard.
 * The violations stay on the record; accepting one is a decision, not an erasure.
 */
export async function handleStoryboardBeatOverride(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const targetId = body.frameId;
  if (!targetId) return json({ error: 'Body needs { frameId }' }, 400);

  const record = await loadStoryboard(env, session.mindId, body.filmId ?? filmIdFor(body.spec));
  const frame = record.frames.find((f) => f.frameId === targetId);
  if (!frame) return json({ error: 'frame_not_found' }, 404);

  const rejected = frame.scene ?? frame.lastRejectedScene ?? null;
  if (!rejected) return json({ error: 'There is no geometry to accept for this beat.' }, 409);

  frame.scene = rejected;
  frame.status = 'ok';
  frame.overriddenAt = Date.now();
  frame.overriddenViolations = frame.violations ?? [];
  await saveStoryboard(env, session.mindId, record);

  await relayStoryboardDigest(
    env,
    session.mindId,
    `[Storyboarder] The visitor accepted beat ${frame.beatIndex + 1} despite failing validation (${(frame.overriddenViolations ?? []).map((v) => v.english ?? v.code).join('; ')}). Their call, recorded rather than blocked.`,
  );

  return json({ frame });
}

/** Bridges the two frame shapes for the sketch path: round 4 frames carry `blocking.visualPrompt`
 * and `blocking.subjectsInFrame`; round 8 frames carry a scene graph, from which both are DERIVED
 * — the prompt by compiling the geometry to H3's own language, the in-frame list by reading who is
 * actually in the scene. Old storyboards keep working; new ones get a prompt built from numbers. */
export const frameVisualPrompt = (frame, spec) =>
  frame.blocking?.visualPrompt ?? (frame.scene ? compileBeatToH3(frame.scene, spec) : null);

export const frameSubjectsInFrame = (frame) =>
  frame.blocking?.subjectsInFrame ??
  (frame.scene?.subjects ?? []).map((s) => ({
    subject: s.subject,
    action: s.action,
    screenPosition: s.screenPosition,
    depth: s.depth,
  }));

// ------------------------------------------------------------------ on-demand sketch preview
//
// The only place this file spends real money, and the only place it calls gpt-image-2. Runs
// for exactly one frame per invocation — see the file header on why that's a hard floor, not
// a preference.

async function resolveReferenceImage(castEntry) {
  const stills = castingStills(castEntry?.nft);
  if (!stills.length) throw new Error(`No usable image for cast member ${castEntry?.key ?? '(unknown)'}`);
  return fetchImageAsDataUri(stills);
}

async function r2ObjectToDataUri(env, key) {
  const object = await env.STORYBOARD_IMAGES.get(key);
  if (!object) return null;
  const buffer = await object.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Resolves reference images only for the subjects the blocking JSON actually placed in
 * frame — a tighter, more reliable version of round 3's "attach everything, exclude via
 * prompt text" approach, now possible because subjectsInFrame is structured, high-confidence
 * data rather than a regex guess. Tolerates individual fetch failures. */
async function resolveInFrameReferences(spec, castByKey, blocking) {
  const inFrameByNumber = new Map(
    (blocking.subjectsInFrame ?? [])
      .map((s) => [Number(s.subject?.match(/\d+/)?.[0]), s])
      .filter(([num]) => Number.isFinite(num)),
  );
  const inFrameSlots = (spec.referencePlan ?? [])
    .map((slot, i) => ({ key: slot.key, subjectNumber: i + 1 }))
    .filter(({ subjectNumber }) => inFrameByNumber.has(subjectNumber));

  const images = [];
  const attachedKeys = [];
  // key -> the matching subjectsInFrame entry, so the prompt builder can label each attached
  // image with its real <Subject N> and action without re-deriving the match itself.
  const keyToSubject = new Map();
  const failures = [];
  for (const { key, subjectNumber } of inFrameSlots) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential against third-party media
      // hosts, same reasoning as every other reference-fetch loop in this file's history.
      images.push(await resolveReferenceImage(castByKey.get(key)));
      attachedKeys.push(key);
      keyToSubject.set(key, inFrameByNumber.get(subjectNumber));
    } catch (error) {
      failures.push({ key, reason: error.message });
    }
  }
  return { images, attachedKeys, keyToSubject, failures };
}

function sketchPrompt({ visualPrompt, castByKey, attachedKeys, keyToSubject }) {
  const subjectLines = attachedKeys.map((key, position) => {
    const entry = castByKey.get(key);
    const dossier = entry?.dossier;
    const inFrame = keyToSubject.get(key);
    return [
      `Reference image ${position + 1} of ${attachedKeys.length}${inFrame ? ` is ${inFrame.subject}, ${inFrame.action}` : ''}.`,
      dossier?.identityMarkers?.length ? `Must stay recognisable by: ${dossier.identityMarkers.join('; ')}.` : null,
      dossier?.palette?.length ? `Palette: ${dossier.palette.join(', ')}.` : null,
    ]
      .filter(Boolean)
      .join(' ');
  });

  return [
    'Single storyboard sketch — a blocking preview, not a final polished render.',
    'Render style: loose pencil/line-art sketch, minimal or no colour. Composition and identity accuracy matter far more than visual polish.',
    visualPrompt,
    ...subjectLines,
    'Reproduce each referenced subject’s appearance as closely as possible to its reference image — same face, same colours, same materials. Never redesign or restyle a subject.',
    'Every subject must be fully and plausibly contained by its described context — never visible through a windshield from an impossible angle, never standing through an open roof while apparently driving alone.',
    'No captions, no watermarks, no added text.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function handleStoryboardSketch(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { frameId: targetId, promptText: overridePrompt, spec, cast } = body;
  if (!targetId || !spec || !Array.isArray(cast)) {
    return json({ error: 'Body needs { frameId, spec, cast, promptText? }' }, 400);
  }

  const mindId = session.mindId;
  const castByKey = new Map(cast.map((c) => [c.key, c]));

  return sseResponse(async (emit) => {
    const storyboardRecord = await loadStoryboard(env, mindId, filmIdFor(spec));
    const frame = storyboardRecord.frames.find((f) => f.frameId === targetId);
    if (!frame) throw new Error('frame_not_found');
    if (frame.transition) throw new Error('This beat is a transition — there is no frame to sketch.');
    if (!frame.blocking && !frame.scene) throw new Error('This frame has no blocking spec yet.');
    if (frame.status && frame.status !== 'ok') {
      throw new Error('This beat has not passed validation yet — regenerate it before sketching it.');
    }

    const budget = await getBudget(env, mindId);
    if (!budget) throw new Error('No budget set — a sketch preview spends real money, so the Storyboarder needs a budget before generating one.');

    let spend = await getSpend(env, mindId);
    const estimate = estimateCostUsd({ size: IMAGE_SIZE, quality: IMAGE_QUALITY });
    if (budget.total != null && spend.totalSpent + estimate > budget.total) {
      throw Object.assign(new Error('Budget exhausted — no room left under the stated cap.'), { status: 402 });
    }

    await emit('phase', { phase: 'generating' });

    const { images: referenceImages, attachedKeys, keyToSubject, failures } = await resolveInFrameReferences(
      spec,
      castByKey,
      { subjectsInFrame: frameSubjectsInFrame(frame) },
    );
    if (!attachedKeys.length) throw new Error('None of this frame’s in-frame cast references could be fetched.');
    if (failures.length) {
      await relayToMind(
        env,
        mindId,
        `[Post-mortem] Sketch for beat ${frame.beatIndex + 1} generating with ${failures.length} reference(s) unavailable: ${failures.map((f) => `${f.key} (${f.reason})`).join('; ')}.`,
      ).catch(() => {});
    }

    // Position continuity: the immediately preceding beat's own sketch, if one was ever
    // generated — a single extra image, resolved fresh from R2 for this one invocation only,
    // never accumulated across beats (see the file header's architectural floor).
    const priorFrame = storyboardRecord.frames
      .filter((f) => !f.transition && f.beatIndex < frame.beatIndex && f.r2Key)
      .sort((a, b) => b.beatIndex - a.beatIndex)[0];
    const previousFrameDataUri = priorFrame ? await r2ObjectToDataUri(env, priorFrame.r2Key) : null;

    const basePrompt = sketchPrompt({
      visualPrompt: frameVisualPrompt(frame, spec),
      castByKey,
      attachedKeys,
      keyToSubject,
    });
    const visitorPromptText = overridePrompt?.trim() || null;
    const continuityNote = previousFrameDataUri
      ? '\nThe final reference image is the previous beat\'s own sketch, for position/composition continuity only — subject appearance still follows the original-artwork references above it.'
      : '';
    const prompt = (visitorPromptText ? `${basePrompt}\nVisitor refinement: ${visitorPromptText}` : basePrompt) + continuityNote;
    const images = previousFrameDataUri ? [...referenceImages, previousFrameDataUri] : referenceImages;

    const { b64, costUsd } = await editImage(env, { prompt, images, size: IMAGE_SIZE, quality: IMAGE_QUALITY });

    const version = frame.history.length + 1;
    const key = r2Key(mindId, targetId, version);
    await env.STORYBOARD_IMAGES.put(key, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

    spend = await recordSpend(env, mindId, { kind: 'image', amountUsd: costUsd, model: 'gpt-image-2', frameId: targetId, beatIndex: frame.beatIndex });

    frame.regenCount += 1;
    frame.r2Key = key;
    frame.promptText = prompt;
    frame.costUsd = costUsd;
    frame.cumulativeCostAtGen = spend.totalSpent;
    frame.overPerRenderCap = budget.perRender != null && costUsd > budget.perRender;
    frame.history.push({ promptText: prompt, visitorPromptText, costUsd, r2Key: key, createdAt: Date.now() });

    const recent = frame.history.slice(-PATTERN_ABUSE_REGEN_COUNT);
    const noRefinement = recent.length >= PATTERN_ABUSE_REGEN_COUNT && recent.every((h) => h.visitorPromptText === recent[0].visitorPromptText);
    frame.patternAbuseFlag = frame.regenCount >= PATTERN_ABUSE_REGEN_COUNT && noRefinement;

    await saveStoryboard(env, mindId, storyboardRecord);

    const imageUrl = await signedImageUrl(env, mindId, key, request.url);
    await relayStoryboardDigest(
      env,
      mindId,
      `[Storyboarder] Visitor requested a sketch preview for beat ${frame.beatIndex + 1} ($${costUsd.toFixed(3)}). Running sketch spend: $${spend.totalSpent.toFixed(2)}${budget.total != null ? ` of $${budget.total}` : ''}. ${imageUrl}`,
    );
    if (frame.patternAbuseFlag) {
      await relayStoryboardDigest(
        env,
        mindId,
        `[Storyboarder] A visitor has regenerated beat ${frame.beatIndex + 1}'s sketch ${frame.regenCount} times without changing their own prompt. Flagging the pattern, not blocking it.`,
      );
    }
    await maybeRelayThreshold(env, mindId, spend, budget);

    await emit('result', { frame, spend });
  });
}

/**
 * One film's storyboard, plus a short list of the visitor's other films.
 *
 * `?film=<id>` is what scopes it. Asking without one used to be harmless and is now the bug: it
 * returns whatever this Mind produced last, which is how a tab working on film B ended up showing
 * film A's storyboard the moment a Mind connected. Callers that know which film they are looking
 * at must say so; the unscoped read is kept only for the legacy record.
 */
export async function handleStoryboardGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const params = new URL(request.url).searchParams;
  const filmId = params.get('film');
  const spend = await getSpend(env, session.mindId);
  const films = await listFilms(env, session.mindId);

  // `?films=1` asks for the LIST only. An explicit mode rather than "no film id means give me
  // whatever you have": the whole point of this keying is that an unscoped read can hand back a
  // film the caller was not asking about, so the index has to be requestable without one.
  if (params.has('films') && !filmId) return json({ frames: [], films, spend });

  const storyboardRecord = await loadStoryboard(env, session.mindId, filmId);
  return json({ ...storyboardRecord, spend, films });
}

/**
 * Serves one stored sketch's image bytes from R2. Auth via a `token` query param — loaded
 * from a plain `<img src>` or a Producer digest's link, neither of which can attach custom
 * headers. `key` must already be namespaced under the caller's own mindId.
 */
export const handleStoryboardImage = (request, env) =>
  serveSignedMedia(request, env, {
    bucket: env.STORYBOARD_IMAGES,
    prefixFor: (mindId) => `storyboard/${mindId}/`,
    contentType: 'image/png',
  });
