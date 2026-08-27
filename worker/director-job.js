// The Director's job: one step per queue message, and never a render awaited inside one.
//
// WHY A STEP MACHINE RATHER THAN A RUN. The Storyboarder's job (worker/storyboarder.js) is one
// continuous Queue invocation that owns its work from start to finish, and that is right for it:
// a film takes 3-8 minutes and a Queue invocation gets 15.
//
// A render does not fit inside that. Measured, from the manifests in assets/renders/:
//
//     768P / 4s    133-149 s          768P / 15s    ~530 s
//     768P / 6s    190-333 s          2K   / 15s    941-1123 s
//
// A 2K/15s take can outlive a whole invocation on its own, and the invocation being killed while
// holding a clip that has already been charged for is precisely the failure worker/mesh.js paid
// to learn on the 3D side:
//
//   "the first version awaited the whole task inside one SSE response, and seven dev-server
//    reloads in an afternoon abandoned $0.60 of already-charged generations. Make it a job. The
//    call is short and idempotent, the task id is written down BEFORE anything can go wrong."
//
// So each message does ONE step and enqueues the next with an explicit `delaySeconds`. Polling is
// a fresh message, never a retry — the retry budget is for transient 5xx, and spending it on
// waiting would leave nothing for what it exists to absorb.
//
// ⚠️ THE TASK ID IS PERSISTED BEFORE ANYTHING ELSE HAPPENS. Not after the spend is recorded, not
// after the record is tidied. The moment MiniMax returns it, we are being charged, and a task id
// we have lost is money spent on something nobody can ever collect.

import { createJobLogger } from './job-log.js';
import { castingStills, fetchImageAsDataUri } from './casting-director.js';
import { recordSpend } from './budget.js';
import { authoriseSpend, getEnvelope } from './render-budget.js';
import { LATENCY_SECONDS, MinimaxError, createH3Task, h3Content, pollVideo, priceUsd } from './minimax.js';
import { extractFrames } from './frames.js';
import { judgeFrames } from './director-judge.js';
import { planShoot, reviewTest } from './director-agent.js';
import { signedMediaUrl } from './signed-media.js';

const jobKey = (mindId, jobId) => `director-job:${mindId}:${jobId}`;

/** A day. The finished film lives on the production record, which has no TTL — this is the
 * progress log, and a log nobody read within 24 hours is a log nobody is going to read. */
const JOB_TTL_SECONDS = 24 * 60 * 60;

/** How often to ask MiniMax whether it is done.
 *
 * The first wait is long on purpose. Nothing settles in under two minutes even at 4s/768P, so an
 * early poll is a wasted invocation and a wasted request against a provider that rate-limits
 * (error 1002). After that, 20 seconds is close enough that a visitor sees the result promptly
 * without the poll itself becoming the load. */
const firstPollSeconds = (params) => Math.max(30, Math.floor(LATENCY_SECONDS(params.resolution, params.duration).p50 * 0.4));
const POLL_EVERY_SECONDS = 20;

/** When to stop asking. Generous, and deliberately not a cancellation: see `poll` below. */
const deadlineFor = (params) => Date.now() + Math.min(45 * 60_000, LATENCY_SECONDS(params.resolution, params.duration).max * 2 * 1000);

export const loadJob = (env, mindId, jobId) => env.MIND_CONNECTIONS.get(jobKey(mindId, jobId), 'json').catch(() => null);

export async function saveJob(env, mindId, record) {
  record.updatedAt = Date.now();
  await env.MIND_CONNECTIONS.put(jobKey(mindId, record.jobId), JSON.stringify(record), {
    expirationTtl: JOB_TTL_SECONDS,
  });
  return record;
}

export async function createJob(
  env,
  mindId,
  {
    filmId, script, params, refKeys, proposalId, costUsd, status, step,
    kind = 'take', question = null, riskId = null, origin = null,
    // What the AGENT steps read. Carried on the record rather than re-derived, because a Queue
    // consumer has no request to re-read them from and the spec is pure client state — nothing
    // server-side stores it.
    spec = null, risks = null, brief = null, finalUsd = 0, remainingUsd = null, riskMeasured = null,
  },
) {
  const record = {
    jobId: crypto.randomUUID(),
    mindId,
    filmId,
    status,
    step,
    proposalId,
    script,
    params,
    refKeys,
    spec,
    risks,
    brief,
    finalUsd,
    remainingUsd,
    riskMeasured,
    // A Screen Test and a final take are the same machinery — same submit, same poll, same
    // mirror — and differ only in what they are FOR. Keeping them one code path is what makes a
    // test cheap to add; keeping `question` on the record is what makes it worth having run.
    // A Queue consumer has no incoming request, so the origin it should build media links against
    // has to be written down when the job is created. Without it a link built during `wrangler
    // dev` would point at production and vice versa.
    origin,
    take: {
      takeId: `${kind === 'screen-test' ? 'test' : 'take'}-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      question,
      riskId,
      costUsd,
      status: 'pending',
    },
    events: [],
    attempts: 0,
    deadlineAt: deadlineFor(params),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveJob(env, mindId, record);
  return record;
}

export const enqueue = (env, { mindId, jobId, step }, delaySeconds = 0) =>
  env.DIRECTOR_JOBS.send({ mindId, jobId, step }, { contentType: 'json', delaySeconds });

const r2VideoKey = (mindId, filmId, takeId) => `director/${mindId}/${filmId}/${takeId}/video.mp4`;

// ─────────────────────────────────────────────────────────────────────── the durable record
//
// The job record above expires in 24 hours, because it is a progress log. THE FILM DOES NOT.
//
// Round 8 lost a finished film to a closed tab and the lesson stuck: what a visitor paid for
// outlives the machinery that produced it. So a settled take is appended here, to a record with
// no TTL, keyed by film — and it is written BEFORE the job is marked complete, for the same
// reason worker/storyboarder.js persists a storyboard before it emits a frame. Telling the
// browser about something we have not yet stored is how a success becomes a loss.

const productionKey = (mindId, filmId) => `director:${mindId}:${filmId}`;

export const loadProduction = async (env, mindId, filmId) =>
  (await env.MIND_CONNECTIONS.get(productionKey(mindId, filmId), 'json').catch(() => null)) ?? {
    filmId,
    takes: [],
    revisions: [],
    shootingPlan: null,
    createdAt: Date.now(),
  };

/**
 * Append a settled take. Idempotent on takeId, because the step that calls this can be retried
 * and a duplicated take would misreport what the visitor spent.
 */
/** The Director's own reading of the film, and what it proposes to spend on. */
export async function saveShootingPlan(env, mindId, filmId, shootingPlan) {
  const record = await loadProduction(env, mindId, filmId);
  const next = { ...record, filmId, shootingPlan, updatedAt: Date.now() };
  await env.MIND_CONNECTIONS.put(productionKey(mindId, filmId), JSON.stringify(next));
  return next;
}

/**
 * One amendment to the script, from one test.
 *
 * APPENDED, never applied over the Screenwriter's work. The visitor's screenplay stays theirs and
 * stays visible in the Screenplay panel; revisions are layered on at compile time
 * (`applyRevisions`). That keeps every change reversible by dropping it from this list, rather
 * than by trying to remember what a block used to say.
 */
export async function appendRevision(env, mindId, filmId, revision) {
  const record = await loadProduction(env, mindId, filmId);
  const revisions = [...(record.revisions ?? []), { ...revision, at: Date.now() }];
  const next = { ...record, filmId, revisions, updatedAt: Date.now() };
  await env.MIND_CONNECTIONS.put(productionKey(mindId, filmId), JSON.stringify(next));
  return next;
}

export async function appendTake(env, mindId, filmId, take) {
  const record = await loadProduction(env, mindId, filmId);
  const takes = [...record.takes.filter((existing) => existing.takeId !== take.takeId), take];
  const next = { ...record, filmId, takes, updatedAt: Date.now() };
  await env.MIND_CONNECTIONS.put(productionKey(mindId, filmId), JSON.stringify(next));
  return next;
}

/**
 * Record what a Screen Test actually showed.
 *
 * Kept on the take rather than in a separate log, because a verdict without the clip it is about
 * is an opinion. Idempotent by takeId — a visitor changing their mind replaces their answer
 * rather than appending a second one.
 */
export async function recordVerdict(env, mindId, filmId, { takeId, answer, note, by }) {
  // A person's answer outranks the model's, always — and never the other way round. The Director
  // judging is a convenience where frames are available; the visitor watching the clip is the
  // instrument this project actually trusts.
  const record = await loadProduction(env, mindId, filmId);
  const takes = record.takes.map((take) =>
    take.takeId === takeId ? { ...take, verdict: { answer, note, by, at: Date.now() } } : take,
  );
  const next = { ...record, filmId, takes, updatedAt: Date.now() };
  await env.MIND_CONNECTIONS.put(`director:${mindId}:${filmId}`, JSON.stringify(next));
  return next;
}

// ──────────────────────────────────────────────────────────────────────────────── the steps

/**
 * Resolve the reference images. Sequential and individually defended, like every other
 * reference-fetch loop here: these are third-party media hosts and one being down is normal.
 *
 * A reference that cannot be fetched is FATAL rather than skipped, and that is the point of
 * H3_RULES rule 4 — "anything with a reference renders; anything prose-only tends not to", and
 * "a dropped asset is the single most common cause of a wrong render". Quietly shooting without
 * one would spend the visitor's money on a film missing a character they cast.
 */
async function resolveReferences(cast, refKeys) {
  const byKey = new Map((cast ?? []).map((entry) => [entry?.key, entry]));
  const images = [];
  for (const key of refKeys ?? []) {
    const entry = byKey.get(key);
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential against third-party media hosts.
      images.push(await fetchImageAsDataUri(castingStills(entry?.nft)));
    } catch (error) {
      throw new Error(
        `Could not fetch the artwork for "${key}", and shooting without it would render a film ` +
          `missing a piece you cast: ${error.message}`,
      );
    }
  }
  return images;
}

/**
 * The Director reads the film and decides what is worth paying to find out.
 *
 * Costs nothing — SCREENWRITER_MODEL is free per token on this account, and the Director's
 * expensive resource is footage. Its reasoning streams into the job log as it arrives, because
 * "which of these is worth your money, and why" is the one thing a visitor most needs to watch
 * being decided rather than be handed as a finished list.
 */
async function assess(env, record, logger) {
  logger.log('phase', { phase: 'assessing', detail: 'Reading the film and the measured hazards.' });

  const plan = await planShoot(env, {
    spec: record.spec,
    risks: record.risks ?? [],
    brief: record.brief ?? null,
    finalUsd: record.finalUsd ?? 0,
    remainingUsd: record.remainingUsd ?? null,
    onReasoning: (text) => {
      if (text) logger.log('reasoning', { delta: text });
    },
  });

  if (plan.dropped.length) {
    // A hallucinated risk id is filtered rather than charged. Recorded so a model that keeps
    // inventing hazards is visible in the log rather than merely absent from the bill.
    console.warn(`Director proposed unknown risks: ${plan.dropped.join(', ')}`);
  }

  logger.log('reading', { reading: plan.reading, plan: plan.plan });

  // Free fixes are applied NOW, as revisions, because a hazard the Director says is "cheap to fix
  // in the script" is only actually fixed if something writes the fix down. Applied before the
  // tests are proposed, so a hazard it just repaired is not also something it asks money for.
  for (const fix of plan.fixes) {
    await appendRevision(env, record.mindId, record.filmId, {
      block: fix.block,
      text: fix.text,
      why: fix.why,
      fromRiskId: fix.riskId,
      free: true,
    });
    logger.log('revision', { block: fix.block, why: fix.why, free: true });
  }
  for (const test of plan.tests) {
    logger.log('proposed', {
      riskId: test.riskId,
      why: test.why,
      question: test.risk?.test?.question ?? null,
      estUsd: test.risk?.estUsd ?? 0,
    });
  }
  for (const skipped of plan.skip) logger.log('skipped', skipped);
  if (plan.ownConcern) logger.log('own-concern', plan.ownConcern);

  await saveShootingPlan(env, record.mindId, record.filmId, {
    reading: plan.reading,
    plan: plan.plan,
    fixes: plan.fixes.map((fix) => ({ riskId: fix.riskId, block: fix.block, why: fix.why })),
    tests: plan.tests.map((test) => ({
      riskId: test.riskId,
      why: test.why,
      question: test.risk?.test?.question ?? null,
      estUsd: test.risk?.estUsd ?? 0,
    })),
    skip: plan.skip,
    ownConcern: plan.ownConcern,
    totalTestUsd: Math.round(plan.tests.reduce((sum, t) => sum + (t.risk?.estUsd ?? 0), 0) * 100) / 100,
    at: Date.now(),
  });

  logger.log('result', { tests: plan.tests.length, reading: plan.reading });
  await logger.setStatus('complete');
}

/**
 * Read back a settled screen test and decide what it changes.
 *
 * Runs only when the test HAS a verdict. An unjudged test is not a failure — it is a question the
 * visitor has not answered yet, and reviewing one would be inventing the answer.
 */
async function review(env, record, logger) {
  const take = record.take;
  if (!take?.verdict?.answer) {
    logger.log('phase', { phase: 'unjudged', detail: 'Waiting for a verdict before reading this back.' });
    await logger.setStatus('complete');
    return;
  }

  logger.log('phase', { phase: 'reviewing', detail: 'Reading the test back against the film.' });

  const result = await reviewTest(env, {
    spec: record.spec,
    question: take.question,
    verdict: take.verdict,
    riskMeasured: record.riskMeasured ?? null,
    onReasoning: (text) => {
      if (text) logger.log('reasoning', { delta: text });
    },
  });

  logger.log('finding', {
    finding: result.finding,
    settled: result.settled,
    readyToShoot: result.readyToShoot,
    suppressedRevision: result.suppressedRevision,
  });

  if (result.revision) {
    await appendRevision(env, record.mindId, record.filmId, {
      ...result.revision,
      fromTakeId: take.takeId,
      fromQuestion: take.question,
    });
    logger.log('revision', result.revision);
  }

  logger.log('result', { finding: result.finding, revised: Boolean(result.revision) });
  await logger.setStatus('complete');
}

/** Submit the take. The only step that starts a charge, and the only one whose ordering matters. */
async function submit(env, record, logger, cast) {
  logger.log('phase', { phase: 'submitting', detail: 'Sending the shot to MiniMax.' });

  const images = await resolveReferences(cast, record.refKeys);
  const content = await h3Content({ text: record.script.text, referenceImages: images });

  let taskId;
  try {
    taskId = await createH3Task(env, { ...record.params, content });
  } catch (error) {
    // A rejected request never rendered and never will. It is free, and it must not be billed —
    // but it also must not be retried unchanged, because nothing about waiting makes a banned
    // word acceptable.
    if (error instanceof MinimaxError && (error.contentFiltered || error.invalidParams)) {
      throw Object.assign(error, { fatal: true });
    }
    throw error;
  }

  // ⚠️ FIRST. Before the spend, before the log, before anything that could throw. From here on we
  // are being charged, and a task id we did not write down is money nobody can collect.
  record.take.taskId = taskId;
  record.take.submittedAt = Date.now();
  record.step = 'poll';
  await saveJob(env, record.mindId, record);

  await recordSpend(env, record.mindId, {
    kind: 'video',
    amountUsd: record.take.costUsd,
    model: record.params.model,
    filmId: record.filmId,
    testId: record.take.takeId,
  });

  logger.log('take', { takeId: record.take.takeId, taskId, costUsd: record.take.costUsd, status: 'running' });
  await enqueue(env, { mindId: record.mindId, jobId: record.jobId, step: 'poll' }, firstPollSeconds(record.params));
}

/**
 * Ask once, then either finish or ask again later.
 *
 * ⚠️ A DEADLINE HERE IS NOT A CANCELLATION. scripts/minimax.mjs has always said the right thing
 * about this and it is worth keeping verbatim: "query it directly rather than re-rendering, it
 * may yet succeed and you have paid for it." So passing the deadline stops US waiting; it does
 * not stop the task, and the task id stays on the record precisely so the clip can still be
 * collected by hand.
 */
async function poll(env, record, logger) {
  const result = await pollVideo(env, record.take.taskId, { api: 'v2' });

  if (!result.done) {
    if (Date.now() > record.deadlineAt) {
      record.take.status = 'unsettled';
      record.take.reason =
        `MiniMax has not settled task ${record.take.taskId} within the time this shape of render has ever taken. ` +
        'It may still succeed, and it has already been paid for — query the task rather than shooting it again.';
      logger.log('phase', { phase: 'unsettled', detail: record.take.reason });
      await logger.setStatus('failed', { take: record.take, error: record.take.reason });
      return;
    }
    const waited = Math.round((Date.now() - record.take.submittedAt) / 1000);
    logger.log('heartbeat', { phase: 'rendering', elapsedSeconds: waited, status: result.status });
    await enqueue(env, { mindId: record.mindId, jobId: record.jobId, step: 'poll' }, POLL_EVERY_SECONDS);
    return;
  }

  if (result.failed) {
    // Money spent, nothing to show. Recorded rather than swallowed — worker/budget.js's own note
    // on `failed` is the reason: "why did my budget run out faster than the beats I can see?"
    record.take.status = 'failed';
    record.take.reason = result.reason;
    record.take.settledAt = Date.now();
    logger.log('take', { takeId: record.take.takeId, status: 'failed', reason: result.reason });
    await logger.setStatus('failed', { take: record.take, error: `The render failed: ${result.reason}` });
    return;
  }

  // MIRRORED IN THE SAME INVOCATION THAT SAW THE URL, not in a following step. MiniMax hands back
  // a short-lived link, and a queue hop is exactly the kind of gap in which one expires. If this
  // throws, the whole step is retried and the URL is simply fetched again from a fresh poll —
  // idempotent, because the task id is what identifies the work, not the link.
  logger.log('phase', { phase: 'mirroring', detail: 'Copying the film out of MiniMax before the link expires.' });

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Could not download the finished take: ${response.status}`);
  const bytes = await response.arrayBuffer();

  const key = r2VideoKey(record.mindId, record.filmId, record.take.takeId);
  await env.RENDERS.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });

  record.take.status = 'ready';
  record.take.r2Key = key;
  record.take.bytes = bytes.byteLength;
  record.take.settledAt = Date.now();
  record.take.seconds = Math.round((record.take.settledAt - record.take.submittedAt) / 1000);
  record.take.usage = result.usage ?? null;

  // ── Judging, and why it happens AFTER the clip is safe. ──────────────────────────────────
  //
  // The bytes are in R2 by this point, so everything below can fail without costing anything.
  // That ordering is deliberate: judging is the least important thing in this function and the
  // most likely to break, since it depends on a per-zone Cloudflare toggle that is currently OFF.
  //
  // A Screen Test with no verdict is an ordinary state — the visitor answers it, and given the
  // contact-sheet history a person watching the clip is the more trustworthy instrument anyway.
  if (record.take.kind === 'screen-test' && record.take.question) {
    try {
      const origin = new URL(record.origin ?? 'https://minds.monster').origin;
      const sourceUrl = await signedMediaUrl(env, record.mindId, {
        path: '/api/director/media',
        key,
        requestUrl: origin,
        ttlMs: 10 * 60_000,
      });
      const sampled = await extractFrames(env, {
        sourceUrl,
        origin,
        durationSeconds: record.params.duration,
      });
      record.take.frames = { requested: sampled.requested ?? 0, arrived: sampled.frames.length, available: sampled.available };
      if (sampled.available && sampled.frames.length) {
        const verdict = await judgeFrames(env, {
          question: record.take.question,
          frames: sampled.frames,
          requested: sampled.requested,
        });
        if (verdict) {
          record.take.verdict = verdict;
          logger.log('verdict', { takeId: record.take.takeId, answer: verdict.answer, note: verdict.note });
        }
      } else if (!sampled.available) {
        record.take.judgeNote = sampled.why;
      }
    } catch (error) {
      // Never fatal. The clip is already safe and the question is still answerable by a person.
      console.warn(`Director could not judge ${record.take.takeId}:`, error.message);
    }
  }

  // Durable first, told second. The job log expires in a day; this does not.
  await appendTake(env, record.mindId, record.filmId, {
    ...record.take,
    params: record.params,
    // The exact request, kept beside the result. scripts/gen-video.mjs has always done this and
    // the reason is one line: "a good render is worthless if we can't repeat it."
    script: record.script,
    refKeys: record.refKeys,
  });

  logger.log('take', {
    takeId: record.take.takeId,
    status: 'ready',
    seconds: record.take.seconds,
    bytes: record.take.bytes,
  });
  logger.log('result', { takeId: record.take.takeId, r2Key: record.take.r2Key, costUsd: record.take.costUsd });
  await logger.setStatus('complete', { take: record.take });

  // A screen test that already has a verdict closes its own loop: the Director reads it back and
  // may amend the script. A test the visitor has not judged yet stops here — the review is
  // triggered by their answer instead, because reviewing an unanswered question would be
  // inventing the answer.
  if (record.take.kind === 'screen-test' && record.take.verdict?.answer && record.spec) {
    await enqueue(env, { mindId: record.mindId, jobId: record.jobId, step: 'review' }, 1);
  }
}

// ────────────────────────────────────────────────────────────────────────────── the consumer

/**
 * One message, one step.
 *
 * The retry condition and `max_retries` in wrangler.jsonc are set together, on purpose: the
 * storyboard consumer branches on `attempts <= 2` against a configured `max_retries: 1`, so its
 * second retry can never fire. That inconsistency is left alone there rather than changed blind,
 * and deliberately not reproduced here.
 */
export async function handleDirectorQueue(batch, env) {
  for (const message of batch.messages) {
    const { mindId, jobId, step } = message.body ?? {};
    const record = await loadJob(env, mindId, jobId);

    if (!record) {
      console.warn(`Director job ${jobId} not found — acking rather than looping.`);
      message.ack();
      continue;
    }
    // Idempotency. A redelivered message for finished work must not re-submit and re-charge.
    if (record.status === 'complete' || record.status === 'failed' || record.status === 'cancelled') {
      message.ack();
      continue;
    }

    const logger = createJobLogger({ record, save: (updated) => saveJob(env, mindId, updated) });

    try {
      if (record.status === 'queued') await logger.setStatus('running');

      if (step === 'submit') await submit(env, record, logger, message.body.cast ?? record.cast ?? []);
      else if (step === 'poll') await poll(env, record, logger);
      else if (step === 'assess') await assess(env, record, logger);
      else if (step === 'review') await review(env, record, logger);
      else console.warn(`Director job ${jobId}: unknown step "${step}"`);

      await logger.close();
      message.ack();
    } catch (error) {
      const retryable = !error.fatal && (error.retryable || error.status >= 500 || error instanceof TypeError);
      if (retryable && message.attempts <= 3) {
        console.warn(`Director job ${jobId} step "${step}" failed, retrying:`, error.message);
        await logger.close();
        message.retry({ delaySeconds: Math.min(60, 5 * 2 ** message.attempts) });
        continue;
      }

      // A failure AFTER submission leaves the take in whatever state it was in — the task id is on
      // the record and the money is spent, and saying so is more useful than a bare error.
      const submitted = Boolean(record.take?.taskId);
      logger.log('error', { message: error.message, taskId: record.take?.taskId ?? null });
      await logger.setStatus('failed', {
        error: submitted
          ? `${error.message} The take was already submitted as task ${record.take.taskId}, so it may still complete — it has been paid for either way.`
          : error.message,
      });
      await logger.close();
      message.ack();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────── starting

/**
 * Everything between "the visitor pressed Shoot" and either a queued job or a question.
 *
 * Returns the job either way. A job parked at `awaiting-approval` is a normal outcome, not a
 * failure — in `ask` mode it is the outcome every single time.
 */
export async function startTake(
  env,
  mindId,
  {
    filmId, script, params, refKeys, cast, kind = 'take', question = null, riskId = null, origin = null,
    spec = null, risks = null, brief = null, finalUsd = 0, remainingUsd = null, riskMeasured = null,
  },
) {
  const costUsd = priceUsd(params) ?? 0;
  const proposalId = crypto.randomUUID().slice(0, 8);

  // The visitor-facing description of what they are being asked to pay for. A Screen Test names
  // its QUESTION rather than its parameters, because "does the ape's face survive at this
  // framing?" is the thing worth $0.32 — "a 4s 768P take" is not an answer to anything.
  const what = kind === 'screen-test'
    ? (question ?? `a ${params.duration}s screen test`)
    : `a ${params.duration}s ${params.resolution} take`;

  const verdict = await authoriseSpend(env, mindId, { filmId, costUsd, what, proposalId });

  if (verdict.verdict === 'refused') {
    throw Object.assign(new Error(verdict.reason), { status: 402, detail: verdict.detail });
  }

  const needsApproval = verdict.verdict === 'needs-approval';
  const record = await createJob(env, mindId, {
    filmId,
    script,
    params,
    refKeys,
    proposalId,
    costUsd,
    kind,
    question,
    riskId,
    origin,
    spec,
    risks,
    brief,
    finalUsd,
    remainingUsd,
    riskMeasured,
    status: needsApproval ? 'awaiting-approval' : 'queued',
    step: 'submit',
  });

  if (needsApproval) {
    record.proposal = { proposalId, costUsd, what, ...verdict };
    await saveJob(env, mindId, record);
    return { record, verdict };
  }

  await env.DIRECTOR_JOBS.send({ mindId, jobId: record.jobId, step: 'submit', cast }, { contentType: 'json' });
  return { record, verdict };
}

/** Resume a job that was parked for approval. The cast rides along because the queue message is
 * the only place it exists — nothing server-side stores a visitor's cast. */
export async function resumeAfterApproval(env, mindId, record, cast) {
  record.status = 'queued';
  await saveJob(env, mindId, record);
  await env.DIRECTOR_JOBS.send({ mindId, jobId: record.jobId, step: 'submit', cast }, { contentType: 'json' });
  return record;
}

export { getEnvelope };

/**
 * Start a planning pass. Spends nothing, so it bypasses the money gate entirely.
 *
 * A job rather than a direct call, purely so the reasoning STREAMS. The panel's whole claim is
 * that you can watch the Director decide how to spend your money; a spinner followed by a
 * finished list would be a different, weaker product.
 */
export async function startAssessment(env, mindId, { filmId, spec, risks, brief, finalUsd, remainingUsd }) {
  const record = await createJob(env, mindId, {
    filmId,
    script: null,
    params: { model: 'MiniMax-H3', resolution: '768P', duration: 4, ratio: '16:9' },
    refKeys: [],
    proposalId: null,
    costUsd: 0,
    kind: 'plan',
    status: 'queued',
    step: 'assess',
    spec,
    risks,
    brief,
    finalUsd,
    remainingUsd,
  });
  await env.DIRECTOR_JOBS.send({ mindId, jobId: record.jobId, step: 'assess' }, { contentType: 'json' });
  return record;
}
