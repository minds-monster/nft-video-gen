// The Director. Right now: the pass that happens BEFORE anything is spent.
//
// This file will grow into the agent — the step machine that proposes Screen Tests, shoots them,
// judges the frames and commits to a final render. What lands first is the half that costs
// nothing and is worth having on its own: exactly what would be sent to MiniMax, exactly what it
// would cost, and everything already known to be wrong with it.
//
// `--dry-run` AS A PRODUCT FEATURE. Every probe script in this repo has one, and the reason is
// stated in scripts/probe-h3.mjs: "numbered hypotheses, a dry run that spends nothing, real cost
// accounting, and artifacts you can go and look at afterwards." That discipline is what made the
// hero affordable — 22 clips and $17.69 — and there is no reason a visitor should get a worse
// instrument than the person who built the thing.
//
// TWO WAYS IN, ONE SCRIPT OUT. This is what makes the Storyboarder optional rather than
// mandatory, and it needed no new compiler:
//
//   with a storyboard  →  worker/scene.js `compileSceneToH3` derives the script from blocked
//                         geometry, mechanically, with no model in the loop.
//   without one        →  src/lib/h3Script.js `h3Script` derives it from the Screenwriter's spec.
//
// Both emit H3's three named fields, so everything downstream takes `{ description, soundscape,
// music }` and never learns which produced it. A visitor who wants to block their film precisely
// can; a visitor who wants to shoot the screenplay as written can too.

import { requireSession } from './mind-chat.js';
import { castingStills } from './casting-director.js';
import { fetchLegalReference } from './reference-legal.js';
import { compileSceneToH3 } from './scene.js';
import { filmIdFor } from './film-id.js';
import { listFilms, loadStoryboard } from './storyboarder.js';
import { assessRisks } from './director-risks.js';
import { preflightReferences } from './reference-preflight.js';
import { LATENCY_SECONDS, checkH3Params, priceUsd } from './minimax.js';
import { DEFAULT_MODE, MODES, closeEnvelope, getEnvelope, listEnvelopes, openEnvelope, recordDecision, spentOnFilm } from './render-budget.js';
import { getSpend } from './budget.js';
import { castRefsFrom, dropRevision, loadJob, loadProduction, rememberTake, resumeAfterApproval, saveJob, startTake, startAssessment, startReview, enqueue } from './director-job.js';
import { draftCastForWire, loadDraft } from './draft.js';
import { applyRevisions } from './director-agent.js';
import { serveSignedMedia, signedMediaUrl } from './signed-media.js';
import { streamJobEvents } from './job-events.js';
import { buildScreenTest, demandAsRisk, isDemandId, VERDICTS } from './screen-test.js';
import { relayScreenTestDigest } from './filmography.js';
import { testGate } from './director-gate.js';
import { parseBrief } from '../src/lib/directorBrief.js';
import { recordVerdict } from './director-job.js';
import { h3Params, h3ScriptFrom, h3Script } from '../src/lib/h3Script.js';
import { record as trackEvent } from './analytics.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * The visitor's own words for this film, from their saved draft (worker/draft.js) — the only
 * place the prompt exists server-side. Only when the draft IS this film: a visitor mid-way
 * through a second screenplay must not have its prompt read against the first.
 */
const promptFor = async (env, mindId, filmId) => {
  const draft = await loadDraft(env, mindId).catch(() => null);
  return draft?.filmId === filmId ? draft.prompt ?? null : null;
};

/**
 * The register plus the Director's own demands, in one list.
 *
 * The register is recomputed from the spec every time; the demands are read from the shooting
 * plan the Director saved, because they are its judgement about THIS reading of the film and
 * there is nothing to recompute them from. Both carry a price and a test, and the panel and the
 * test endpoint treat them alike — the difference is labelled, not hidden.
 */
const withDemands = (risks, production) => [
  ...risks,
  ...(production?.shootingPlan?.demands ?? []).map(demandAsRisk).filter(Boolean),
];

/**
 * Turn a spec — and a storyboard, when there is one — into the exact script H3 receives.
 *
 * The storyboard path is preferred where it is COMPLETE, and only there. A storyboard whose beats
 * failed or were dropped carries `scene: null` on those frames, and quietly compiling the ones
 * that survived would render a shorter film than the visitor wrote without ever saying so. That
 * is the kind of silent narrowing this codebase keeps finding and refusing, so it is reported as
 * a fact and the screenplay is used instead.
 */
export const compileScript = (spec, storyboard = null) => {
  const beats = spec?.beats ?? [];
  const frames = storyboard?.frames ?? [];
  const blocked = frames.filter((frame) => frame?.scene);

  if (blocked.length && blocked.length === beats.length) {
    const fields = compileSceneToH3(
      { beats: blocked.map((frame) => frame.scene) },
      spec,
      { subjectNames: storyboard.subjectNames ?? {} },
    );
    return {
      source: 'storyboard',
      why: 'Compiled from the blocked geometry — camera distances, subject placement and framing are derived from real numbers rather than restated in prose.',
      fields: {
        description: fields.integrated_multimodal_description,
        soundscape: fields.overall_soundscape,
        music: fields.non_diegetic_music,
      },
      text: h3ScriptFrom({
        staging: spec.staging,
        description: fields.integrated_multimodal_description,
        soundscape: fields.overall_soundscape,
        music: fields.non_diegetic_music,
      }),
      incomplete: null,
    };
  }

  const incomplete =
    frames.length && blocked.length !== beats.length
      ? {
          blocked: blocked.length,
          beats: beats.length,
          detail:
            `The storyboard has ${blocked.length} of ${beats.length} beats blocked, so compiling from it ` +
            'would render a shorter film than the screenplay describes. Shooting the screenplay instead.',
        }
      : null;

  return {
    source: 'screenplay',
    why: 'Compiled from the screenplay. The Storyboarder is optional — blocking first buys precision about where the camera and subjects are, not permission to render.',
    fields: { description: null, soundscape: spec?.sound ?? null, music: spec?.music ?? null },
    text: h3Script(spec),
    incomplete,
  };
};

/**
 * Fetch and measure the references, so an illegal one is found here rather than by the API after
 * the task has queued and been billed.
 *
 * Sequential and individually defended, for the same reason every other reference-fetch loop in
 * this codebase is: these are third-party media hosts, one of them being down is normal, and a
 * single failure must degrade the preflight rather than fail the whole request.
 */
const gatherReferences = async (spec, cast) => {
  const byKey = new Map(cast.map((entry) => [entry?.key, entry]));
  const references = [];
  const unreachable = [];

  for (const slot of spec?.referencePlan ?? []) {
    const entry = byKey.get(slot.key);
    try {
      // The first LEGAL still, measured (worker/reference-legal.js); a piece with no legal still
      // is reported by reason rather than silently passed on to fail after billing.
      // eslint-disable-next-line no-await-in-loop -- sequential against third-party media hosts.
      const legal = await fetchLegalReference(castingStills(entry?.nft), { key: slot.key, dossierFraming: entry?.dossier?.framing ?? null });
      references.push({
        key: slot.key,
        dataUri: legal.dataUri,
        dossierFraming: entry?.dossier?.framing ?? null,
      });
    } catch (error) {
      unreachable.push({ key: slot.key, reason: error.message, code: error.code ?? 'reference_unreachable' });
    }
  }
  return { references, unreachable };
};

/**
 * Measure the references a shot will use, at the moment of spending.
 *
 * Returns null when every piece has a legal still; otherwise the refusal to send. This is the
 * call the Phoenix film needed (2026-08-28): three renders billed and failed on a 140x250
 * thumbnail that this would have refused for free, by name, with the reason.
 */
const refuseIllegalReferences = async (spec, cast, refKeys) => {
  const wanted = new Set(refKeys ?? []);
  const scoped = { ...spec, referencePlan: (spec?.referencePlan ?? []).filter((slot) => wanted.has(slot.key)) };
  const { unreachable } = await gatherReferences(scoped, cast);
  if (!unreachable.length) return null;
  const named = new Map(cast.map((entry) => [entry?.key, entry?.name ?? entry?.key]));
  return json(
    {
      error: 'reference_illegal',
      detail:
        `${unreachable.map((piece) => `"${named.get(piece.key) ?? piece.key}"`).join(', ')} ` +
        `${unreachable.length === 1 ? 'has' : 'have'} no still MiniMax will accept, so nothing was sent and nothing was charged. ` +
        'H3 needs a short side of at least 256px, an aspect between 0.4 and 2.5, and a JPEG, PNG or WebP. ' +
        'Add a larger image of the piece to the cast, or recast it.',
      pieces: unreachable,
    },
    400,
  );
};

/**
 * POST /api/director/plan — what would happen, what it would cost, and what is already wrong.
 *
 * POST rather than GET despite changing nothing, because the whole spec and cast travel in the
 * body; /api/storyboard/sketch takes the same shape for the same reason.
 *
 * `preflight: true` additionally fetches and measures every reference. Off by default so the
 * panel can price a film instantly, on when the visitor is actually about to spend — measuring
 * costs nothing but a dozen media fetches, and it is the difference between finding an illegal
 * aspect ratio for free and finding it one charge later.
 */
export async function handleDirectorPlan(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { spec, cast = [], preflight: wantPreflight = false } = body;

  if (!spec || !Array.isArray(spec.beats) || !spec.beats.length) {
    return json({ error: 'no_spec', detail: 'The Director needs a screenplay with at least one beat.' }, 400);
  }

  const filmId = filmIdFor(spec);
  const [storyboard, production] = await Promise.all([
    loadStoryboard(env, session.mindId, filmId).catch(() => null),
    loadProduction(env, session.mindId, filmId).catch(() => null),
  ]);

  // The Director's amendments are layered on HERE rather than written back over the Screenwriter's
  // work. The visitor's screenplay stays theirs and stays visible; a revision is reversible by
  // dropping it from the list rather than by remembering what a block used to say.
  const revisions = production?.revisions ?? [];
  const revised = applyRevisions(spec, revisions);
  const script = compileScript(revised, storyboard);

  const params = h3Params(revised);
  const paramViolations = checkH3Params(params);
  const finalUsd = priceUsd(params) ?? 0;

  let preflight = null;
  let unreachable = [];
  if (wantPreflight) {
    const gathered = await gatherReferences(spec, cast);
    unreachable = gathered.unreachable;
    preflight = preflightReferences(gathered.references);
    // A piece with no legal still is a floor violation of the set, not a footnote beside it.
    for (const piece of unreachable) {
      preflight.violations.push({ key: piece.key, code: piece.code ?? 'reference-unusable', severity: 'floor', detail: piece.reason });
    }
    preflight.ok = preflight.ok && !unreachable.length;
  }

  const [brief, prompt] = await Promise.all([
    loadBrief(env, session.mindId, filmId),
    promptFor(env, session.mindId, filmId),
  ]);
  const assessment = assessRisks({
    spec: revised,
    cast,
    preflight,
    mustHold: brief?.mustHold ?? [],
    prompt,
    intent: brief?.intent ?? null,
  });
  const risks = withDemands(assessment.risks, production);
  const testableUsd = Math.round(risks.reduce((sum, risk) => sum + (risk.estUsd ?? 0), 0) * 100) / 100;

  // Whether the film may be shot yet — read, and every asked test answered. Distinct from
  // `ready` below, which only says whether MiniMax would accept the request.
  const gate = testGate(production?.shootingPlan ?? null, production?.takes ?? [], {
    knownRiskIds: risks.map((risk) => risk.id),
  });

  return json({
    filmId,
    brief,
    prompt,
    revisions,
    shootingPlan: production?.shootingPlan ?? null,
    gate,
    script: {
      source: script.source,
      why: script.why,
      // The exact string that would be sent. Shown verbatim on purpose — a preview that
      // paraphrases the request is a preview that can quietly stop describing it.
      text: script.text,
      characters: script.text.length,
      incomplete: script.incomplete,
    },
    params,
    paramViolations,
    estimate: {
      finalUsd,
      // What settling every testable risk would cost, demands included. The Director proposes
      // a SUBSET of the register; showing the ceiling first is what makes the subset read as a
      // decision rather than an upsell.
      testsCeilingUsd: testableUsd,
      totalCeilingUsd: Math.round((finalUsd + testableUsd) * 100) / 100,
      seconds: LATENCY_SECONDS(params.resolution, params.duration),
    },
    risks,
    blocking: assessment.blocking,
    preflight,
    unreachable,
    // False whenever anything would be rejected outright. Not a verdict on whether the film is
    // GOOD — only on whether it can legally be submitted.
    ready: assessment.blocking.length === 0 && paramViolations.length === 0 && (preflight?.ok ?? true),
    hasKey: Boolean(env.MINIMAX_API_KEY),
  });
}

// ────────────────────────────────────────────────────────────────────────────── the brief
//
// What the visitor and the assistant agreed the film should be. Stored per film, no TTL, and
// deliberately SMALL: the only field that does deterministic work is `mustHold`, which the risk
// register matches against hazards it has already measured.

const briefKey = (mindId, filmId) => `brief:${mindId}:${filmId}`;

export const loadBrief = (env, mindId, filmId) =>
  env.MIND_CONNECTIONS.get(briefKey(mindId, filmId), 'json').catch(() => null);

/** POST /api/director/brief — the visitor accepting a scope the assistant proposed.
 *
 * ⚠️ THE ASSISTANT CANNOT REACH THIS. It writes a `[BRIEF]` block into its own reply and the
 * visitor presses a button; this endpoint is that button. That line is the whole boundary of the
 * assistant's authority, and it is enforced by the assistant having no way to call anything. */
export async function handleDirectorBrief(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { filmId, brief, text } = await request.json().catch(() => ({}));
  if (!filmId) return json({ error: 'film_id_required' }, 400);

  // Accept either a parsed brief or the raw reply it came in, so the client never has to be the
  // only thing that understands the format.
  const resolved = brief ?? parseBrief(text).brief;
  if (!resolved) return json({ error: 'no_brief', detail: 'Nothing in that looked like a scope.' }, 400);

  const record = {
    filmId,
    intent: String(resolved.intent ?? '').slice(0, 400),
    duration: Number.isInteger(resolved.duration) ? resolved.duration : null,
    resolution: resolved.resolution === '2K' ? '2K' : resolved.resolution === '768P' ? '768P' : null,
    mustHold: (resolved.mustHold ?? []).map((item) => String(item).slice(0, 120)).slice(0, 8),
    willingToSpend: Number.isFinite(resolved.willingToSpend) ? resolved.willingToSpend : null,
    acceptedAt: Date.now(),
  };
  await env.MIND_CONNECTIONS.put(briefKey(session.mindId, filmId), JSON.stringify(record));
  return json({ brief: record });
}

// ═══════════════════════════════════════════════════════════════════════ shooting, for real
//
// Everything above this line spends nothing. Everything below it can.

/**
 * POST /api/director/start — open the production and shoot.
 *
 * The order of the checks is the design, not an accident. Each one is cheaper than the next, and
 * each refuses for a different reason:
 *
 *   1. Compile.        Free. Produces the exact text that would be sent.
 *   2. Parameters.     Free. A duration H3 will not accept is a 400 we can predict.
 *   3. Blocking risks. Free. A brand name is a rejected request; shooting it wastes a round trip
 *                      and teaches the visitor nothing.
 *   4. The tests.      Free. Has the Director read this film, and has every test it asked for
 *                      been answered? (worker/director-gate.js). The hero was made probes-first
 *                      and the Hollywood film was not; this is the difference, enforced. The
 *                      visitor can shoot past it with `override: true`, and that is written on
 *                      the take.
 *   5. Open the money. Only now. An envelope is a commitment, and committing to a film that
 *                      cannot legally be submitted is a commitment to nothing.
 *   6. Authorise.      The gate that either goes, parks for approval, or refuses.
 */
export async function handleDirectorStart(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { spec, cast = [], mode = DEFAULT_MODE, allowanceUsd = null, override = false } = body;

  if (!spec || !Array.isArray(spec.beats) || !spec.beats.length) {
    return json({ error: 'no_spec', detail: 'The Director needs a screenplay with at least one beat.' }, 400);
  }
  if (!env.MINIMAX_API_KEY) {
    return json(
      { error: 'not_configured', detail: 'The render key is not set on this deployment, so nothing can be shot.' },
      503,
    );
  }

  const filmId = filmIdFor(spec);
  const [storyboard, production] = await Promise.all([
    loadStoryboard(env, session.mindId, filmId).catch(() => null),
    loadProduction(env, session.mindId, filmId).catch(() => null),
  ]);
  const revised = applyRevisions(spec, production?.revisions ?? []);
  const script = compileScript(revised, storyboard);
  const params = h3Params(revised);

  const paramViolations = checkH3Params(params);
  if (paramViolations.length) return json({ error: 'bad_params', violations: paramViolations }, 400);

  // The prompt lives in the visitor's saved draft (worker/draft.js), never in this request. It is
  // read for the register (rule 12 fires on the visitor's own verbs) and carried on to the
  // screenplay record pinned beside the finished film, so that record says what was ASKED for.
  const [brief, prompt] = await Promise.all([
    loadBrief(env, session.mindId, filmId),
    promptFor(env, session.mindId, filmId),
  ]);
  const assessment = assessRisks({
    spec: revised,
    cast,
    mustHold: brief?.mustHold ?? [],
    prompt,
    intent: brief?.intent ?? null,
  });
  if (assessment.blocking.length) {
    return json(
      {
        error: 'would_be_rejected',
        detail: 'MiniMax would reject this outright, so shooting it would spend a round trip and teach us nothing.',
        blocking: assessment.blocking,
      },
      400,
    );
  }

  // Has the Director read it, and is every test it asked for answered? Refused rather than
  // warned about, because a warning beside a Shoot button is what the last two films had.
  const risks = withDemands(assessment.risks, production);
  const gate = testGate(production?.shootingPlan ?? null, production?.takes ?? [], {
    knownRiskIds: risks.map((risk) => risk.id),
  });
  if (gate.unread && !override) {
    return json(
      {
        error: 'unread',
        detail: 'The Director has not read this film. Reading is free; shooting blind is not.',
        gate,
      },
      409,
    );
  }
  if (!gate.cleared && !override) {
    return json(
      {
        error: 'untested',
        detail:
          `The Director asked for ${gate.outstanding.length} screen test${gate.outstanding.length === 1 ? '' : 's'} ` +
          'that have not been answered. Run them, or shoot anyway and own the result.',
        outstanding: gate.outstanding,
        gate,
      },
      409,
    );
  }

  const finalUsd = priceUsd(params) ?? 0;
  const castRefs = castRefsFrom(cast);

  // Measured before the envelope opens and before a task is created (see handleDirectorTest).
  const refused = await refuseIllegalReferences(spec, cast, (spec.referencePlan ?? []).map((slot) => slot.key));
  if (refused) return refused;

  const overrideRecord =
    override && (gate.unread || !gate.cleared)
      ? { unread: gate.unread, outstanding: gate.outstanding.map((test) => test.riskId), at: Date.now() }
      : null;

  try {
    await openEnvelope(env, session.mindId, { filmId, mode, allowanceUsd, finalUsd });
    const { record, verdict } = await startTake(env, session.mindId, {
      filmId,
      script: { source: script.source, text: script.text },
      params,
      refKeys: (spec.referencePlan ?? []).map((slot) => slot.key),
      cast,
      origin: new URL(request.url).origin,
      // Carried for the filmography digest, which names the film by its logline. The screen-test
      // path has always passed it; a final take without it reached the Mind as a bare hash.
      spec: revised,
      prompt,
      castRefs,
      castNames: castRefs.map((ref) => ref.name).filter(Boolean),
      override: overrideRecord,
    });

    return json({
      jobId: record.jobId,
      filmId,
      status: record.status,
      verdict,
      costUsd: finalUsd,
      override: overrideRecord,
      seconds: LATENCY_SECONDS(params.resolution, params.duration),
      envelope: await getEnvelope(env, session.mindId, filmId),
    });
  } catch (error) {
    // Explicit fields, never a spread of the Error — spreading it put the HTTP status into the
    // body as well as the status line, which is the sort of thing a client eventually starts
    // reading from the wrong place.
    if (error.status) {
      return json(
        {
          error: error.message,
          detail: error.detail ?? null,
          available: error.available ?? null,
          reserved: error.reserved ?? null,
          wanted: error.wanted ?? null,
        },
        error.status,
      );
    }
    throw error;
  }
}

/** POST /api/director/approve — the click that `ask` mode is built around. */
export async function handleDirectorApprove(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { jobId, approved = true, cast = [] } = await request.json().catch(() => ({}));
  const record = jobId ? await loadJob(env, session.mindId, jobId) : null;
  if (!record) return json({ error: 'not_found' }, 404);
  if (record.status !== 'awaiting-approval') {
    return json({ error: 'not_awaiting', detail: `This job is ${record.status}.` }, 409);
  }

  await recordDecision(env, session.mindId, record.filmId, {
    proposalId: record.proposalId,
    approved,
    what: record.proposal?.what ?? 'a take',
    costUsd: record.take.costUsd,
  });

  if (!approved) {
    record.status = 'cancelled';
    await saveJob(env, session.mindId, record);
    return json({ jobId, status: 'cancelled' });
  }

  await resumeAfterApproval(env, session.mindId, record, cast);
  return json({ jobId, status: 'queued' });
}

/** GET /api/director/job/:id — the cheap poll, and the fallback when a stream drops. */
export async function handleDirectorJobStatus(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const jobId = new URL(request.url).pathname.split('/')[4];
  const record = jobId ? await loadJob(env, session.mindId, jobId) : null;
  if (!record) return json({ error: 'not_found' }, 404);

  return json({
    jobId: record.jobId,
    filmId: record.filmId,
    status: record.status,
    step: record.step,
    take: record.take,
    proposal: record.proposal ?? null,
    error: record.error ?? null,
    eventCount: (record.events ?? []).length,
  });
}

/** GET /api/director/job/:id/events — progress, over the same stream shape the Storyboarder uses. */
export async function handleDirectorJobEvents(request, env, ctx) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { pathname, searchParams } = new URL(request.url);
  const jobId = pathname.split('/')[4];
  if (!jobId) return json({ error: 'job_id_required' }, 400);

  return streamJobEvents(ctx, {
    loadRecord: () => loadJob(env, session.mindId, jobId),
    lastEvent: searchParams.get('lastEvent') ?? 0,
  });
}

/**
 * Every production this Mind has opened, reconstructed with no client spec.
 *
 * This exists because filmId is a hash of the screenplay and the screenplay is pure client
 * state: a returning visitor has no way to name the film they already paid to shoot. The
 * `productions:` index (written on every openEnvelope) is the spec-free way back in — the same
 * recovery the Storyboarder ships as `?films=1`, which the Director never inherited until now.
 */
async function listProductions(env, mindId, requestUrl) {
  const [envelopes, boards, spend] = await Promise.all([
    listEnvelopes(env, mindId),
    listFilms(env, mindId).catch(() => []),
    getSpend(env, mindId),
  ]);
  const loglines = new Map(boards.map((film) => [film.filmId, film.logline ?? null]));

  const newest = [...envelopes].sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)).slice(0, 10);
  return Promise.all(
    newest.map(async (envelope) => {
      const production = await loadProduction(env, mindId, envelope.filmId);
      const takes = production.takes ?? [];
      const ready = takes.filter((take) => take.status === 'ready' && take.kind !== 'screen-test');
      const poster = [...ready].reverse().find((take) => take.r2Key);
      return {
        filmId: envelope.filmId,
        logline: loglines.get(envelope.filmId) ?? null,
        mode: envelope.mode,
        allowanceUsd: envelope.allowanceUsd ?? null,
        spentUsd: spentOnFilm(spend, envelope.filmId),
        openedAt: envelope.openedAt ?? null,
        closedAt: envelope.closedAt ?? null,
        takeCount: takes.length,
        readyTakes: ready.length,
        screenTests: takes.filter((take) => take.kind === 'screen-test').length,
        lastTakeAt: takes.reduce((last, take) => Math.max(last, take.settledAt ?? 0), 0) || null,
        ipfsCount: takes.filter((take) => take.ipfs?.cid).length,
        // Every identifier the Mind was given for this film, so its recall can be checked
        // against the record whichever one it quotes back.
        takeIds: ready.map((take) => take.takeId),
        cids: ready.flatMap((take) => [take.ipfs?.cid, take.ipfs?.screenplayCid]).filter(Boolean),
        posterUrl: poster
          ? await signedMediaUrl(env, mindId, { path: '/api/director/media', key: poster.r2Key, requestUrl })
          : null,
      };
    }),
  );
}

/** GET /api/director?filmId= — the production: its money, and every take shot against it.
 *  GET /api/director?films=1 — every production this Mind has, spec-free (see listProductions). */
export async function handleDirectorGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const filmId = searchParams.get('filmId');
  if (!filmId && searchParams.has('films')) {
    return json({ films: await listProductions(env, session.mindId, request.url) });
  }
  if (!filmId) return json({ error: 'film_id_required' }, 400);

  const [production, envelope] = await Promise.all([
    loadProduction(env, session.mindId, filmId),
    getEnvelope(env, session.mindId, filmId),
  ]);

  // Links are signed here rather than stored, so they are always fresh and never outlive the
  // session that asked for them.
  const takes = await Promise.all(
    (production.takes ?? []).map(async (take) => ({
      ...take,
      url: take.r2Key
        ? await signedMediaUrl(env, session.mindId, { path: '/api/director/media', key: take.r2Key, requestUrl: request.url })
        : null,
    })),
  );

  return json({ filmId, envelope, takes, modes: MODES });
}

/** GET /api/director/media — playback. A URL rather than a header, because `<video>` cannot send one. */
export const handleDirectorMedia = (request, env) =>
  serveSignedMedia(request, env, {
    bucket: env.RENDERS,
    prefixFor: (mindId) => `director/${mindId}/`,
    contentType: (key) => (key.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'),
  });

/** POST /api/director/remember — pin an existing take and put it in the Mind's filmography. */
export async function handleDirectorRemember(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { filmId, takeId } = await request.json().catch(() => ({}));
  if (!filmId || !takeId) return json({ error: 'film_and_take_required' }, 400);

  // The logline is read here rather than in the job, because the storyboard module reaches
  // the job module through the connection path and the job must not import it back.
  //
  // The screenplay itself comes from the visitor's saved draft when it is this film — that is
  // the only place the prompt exists — and the cast falls back to the storyboard's subject
  // assets, which name every piece by asset key, for a film whose draft has since moved on.
  const [storyboard, draft] = await Promise.all([
    loadStoryboard(env, session.mindId, filmId).catch(() => null),
    loadDraft(env, session.mindId).catch(() => null),
  ]);
  const sameFilm = draft?.filmId === filmId;
  const castRefs = castRefsFrom(
    sameFilm
      ? draftCastForWire(draft)
      : Object.values(storyboard?.subjectAssets ?? {}).map((asset) => ({
          key: asset.assetKey,
          name: asset.name ?? null,
          collectionName: asset.collectionName ?? null,
        })),
  );
  try {
    const result = await rememberTake(env, session.mindId, {
      filmId,
      takeId,
      origin: new URL(request.url).origin,
      logline: storyboard?.logline ?? null,
      spec: sameFilm ? draft.spec : null,
      prompt: sameFilm ? draft.prompt : null,
      castRefs,
    });
    return json(result, 202);
  } catch (error) {
    return json({ error: error.message }, error.status ?? 500);
  }
}

/**
 * POST /api/director/revision/drop — take one of the Director's amendments back off the script.
 *
 * `applyRevisions` has always promised that "every revision is reversible by dropping it from the
 * list"; until 2026-08-28 nothing could drop one, and a visitor watched a landmark get rewritten
 * out of their film with no way back. Identified by `at`, the timestamp each revision is stamped
 * with on append.
 */
export async function handleDirectorRevisionDrop(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { filmId, at } = await request.json().catch(() => ({}));
  if (!filmId || !Number.isFinite(at)) return json({ error: 'film_and_at_required' }, 400);

  const production = await dropRevision(env, session.mindId, filmId, at);
  return json({ filmId, revisions: production.revisions ?? [] });
}

/** POST /api/director/close — settle the production and release whatever is left. */
export async function handleDirectorClose(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { filmId, reason = 'delivered' } = await request.json().catch(() => ({}));
  if (!filmId) return json({ error: 'film_id_required' }, 400);

  const envelope = await closeEnvelope(env, session.mindId, filmId, { reason });
  if (!envelope) return json({ error: 'not_found' }, 404);
  // A delivered film is the one outcome the whole site exists for; counted where it is closed.
  if (reason === 'delivered') trackEvent(env, 'film_shot', { mindId: session.mindId, value: envelope.spentUsd ?? 1 });
  return json({ envelope });
}

/**
 * POST /api/director/test — buy an answer to one question.
 *
 * The register (worker/director-risks.js) has already named the hazards and priced each one; this
 * turns a named hazard into a shot. Only risks whose answer needs a RENDER get here — a brand
 * name in the script is a rewrite, and paying to watch MiniMax reject it would be absurd.
 */
export async function handleDirectorTest(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { spec, cast = [], riskId, mode = DEFAULT_MODE, allowanceUsd = null } = await request.json().catch(() => ({}));
  if (!spec || !riskId) return json({ error: 'spec_and_risk_required' }, 400);
  if (!env.MINIMAX_API_KEY) return json({ error: 'not_configured' }, 503);

  const filmId = filmIdFor(spec);
  const [brief, prompt, production] = await Promise.all([
    loadBrief(env, session.mindId, filmId),
    promptFor(env, session.mindId, filmId),
    loadProduction(env, session.mindId, filmId).catch(() => null),
  ]);
  // The rehearsal renders the script as the Director has amended it so far — a test against the
  // un-revised film would answer a question about a film that is no longer going to be shot.
  const revised = applyRevisions(spec, production?.revisions ?? []);
  const { risks } = assessRisks({
    spec: revised,
    cast,
    mustHold: brief?.mustHold ?? [],
    prompt,
    intent: brief?.intent ?? null,
  });
  // A `demand:` id names a test the Director asked for in its shooting plan rather than one the
  // register measured. It is read from the plan, not recomputed — its rehearsal text is the
  // Director's judgement and there is nothing to derive it from.
  const risk = isDemandId(riskId)
    ? withDemands([], production).find((entry) => entry.id === riskId)
    : risks.find((entry) => entry.id === riskId);
  if (!risk) return json({ error: 'unknown_risk', detail: 'That hazard is not on this film any more.' }, 404);

  const test = buildScreenTest(risk, revised, cast);
  if (!test) {
    return json(
      {
        error: 'not_testable',
        detail: `"${risk.what}" is settled by changing the script, not by paying to watch it fail.`,
        fix: risk.fix,
      },
      400,
    );
  }

  // Measured before the envelope opens and before a task is created. A reference H3 refuses is
  // refused HERE, for free, by name.
  const refused = await refuseIllegalReferences(spec, cast, test.refKeys);
  if (refused) return refused;

  const castRefs = castRefsFrom(cast);
  try {
    await openEnvelope(env, session.mindId, { filmId, mode, allowanceUsd, finalUsd: priceUsd(h3Params(spec)) ?? 0 });
    const { record, verdict } = await startTake(env, session.mindId, {
      filmId,
      script: { source: 'screen-test', text: test.script },
      params: test.params,
      refKeys: test.refKeys,
      cast,
      kind: 'screen-test',
      question: test.question,
      riskId: risk.id,
      origin: new URL(request.url).origin,
      castRefs,
      castNames: castRefs.map((ref) => ref.name).filter(Boolean),
      // The review step reads these back. Carried on the job because a Queue consumer has no
      // request to re-derive them from, and the spec exists only in the visitor's browser.
      spec: revised,
      prompt,
      riskMeasured: risk.measured ?? risk.judgement ?? null,
      direction: risk.test?.direction ?? null,
      answers: test.answers ?? null,
    });

    return json({
      jobId: record.jobId,
      filmId,
      status: record.status,
      verdict,
      question: test.question,
      costUsd: record.take.costUsd,
    });
  } catch (error) {
    // The same body shape as /start, arithmetic included. A test is refused for the same money
    // reasons a take is, and the panel offers the same top-up for both.
    if (error.status) {
      return json(
        {
          error: error.message,
          detail: error.detail ?? null,
          available: error.available ?? null,
          reserved: error.reserved ?? null,
          wanted: error.wanted ?? null,
        },
        error.status,
      );
    }
    throw error;
  }
}

/**
 * POST /api/director/verdict — what the visitor saw.
 *
 * ⚠️ THE VISITOR IS THE JUDGE, and for now that is the whole mechanism rather than a placeholder
 * for one. Judging a render mechanically needs evenly-sampled frames, and the sampler is the one
 * instrument this project has already been burned by: a badly-sampled contact sheet did not
 * merely mislead, it INVERTED the conclusion and cost the hero its architecture. Until frames can
 * be pulled reliably, a person watching the clip is the more trustworthy instrument, not the
 * lesser one.
 */
export async function handleDirectorVerdict(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // Read ONCE. A Request body is a stream; a second `.json()` resolves to nothing, and the
  // `.catch(() => ({}))` around it would have turned that into a silently missing jobId — so the
  // review would simply never fire and nothing would say why.
  const body = await request.json().catch(() => ({}));
  const { filmId, takeId, answer, note = '', jobId } = body;
  if (!filmId || !takeId) return json({ error: 'film_and_take_required' }, 400);
  if (!VERDICTS.some((entry) => entry.id === answer)) {
    return json({ error: 'bad_answer', detail: `Answer must be one of ${VERDICTS.map((v) => v.id).join(', ')}.` }, 400);
  }

  const production = await recordVerdict(env, session.mindId, filmId, { takeId, answer, note, by: 'visitor' });

  // The answer is the fact worth remembering — more than the clip. Told to the Mind in the same
  // shape as a delivered take, and never allowed to fail the verdict that carries it.
  const judged = production.takes.find((take) => take.takeId === takeId);
  if (judged) {
    const draft = await loadDraft(env, session.mindId).catch(() => null);
    relayScreenTestDigest(env, {
      mindId: session.mindId,
      filmId,
      take: judged,
      params: judged.params ?? null,
      spec: draft?.filmId === filmId ? draft.spec : null,
      origin: new URL(request.url).origin,
    }).catch((error) => console.warn(`Screen test digest for ${takeId} failed:`, error.message));
  }

  // The answer closes the loop. Whichever job shot this test still holds the spec and the question,
  // so it is the thing that can read the verdict back — and a review costs nothing, so it never
  // needs approval. The client sends the job id when it has it; the take remembers it otherwise,
  // because a verdict that never reaches the Director is a test that taught the script nothing.
  const judgedTake = production.takes.find((take) => take.takeId === takeId) ?? null;
  const resolvedJobId = jobId ?? judgedTake?.jobId ?? null;
  const record = resolvedJobId ? await loadJob(env, session.mindId, resolvedJobId).catch(() => null) : null;
  let reviewing = false;
  if (record?.take?.takeId === takeId && record.spec) {
    record.take.verdict = { answer, note, by: 'visitor', at: Date.now() };
    record.status = 'running';
    await saveJob(env, session.mindId, record);
    await enqueue(env, { mindId: session.mindId, jobId: resolvedJobId, step: 'review' }, 1);
    reviewing = true;
  } else if (judgedTake) {
    // The job is gone (expired, or shot before takes remembered their job). The verdict must
    // still reach the Director, so a review job is rebuilt from the durable take and the draft.
    const draft = await loadDraft(env, session.mindId).catch(() => null);
    const rebuilt = await startReview(env, session.mindId, {
      filmId,
      take: judgedTake,
      spec: draft?.filmId === filmId ? draft.spec : null,
      prompt: draft?.filmId === filmId ? draft.prompt : null,
      origin: new URL(request.url).origin,
    });
    reviewing = Boolean(rebuilt);
  }

  return json({ production, reviewing });
}

/**
 * POST /api/director/assess — the Director reads the film.
 *
 * Spends nothing, so there is no money gate and no approval. Returns a job whose reasoning the
 * panel streams, because watching the decision get made is the point: a finished list of tests
 * handed over with no working is indistinguishable from an upsell.
 */
export async function handleDirectorAssess(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const { spec, cast = [] } = await request.json().catch(() => ({}));
  if (!spec?.beats?.length) return json({ error: 'no_spec' }, 400);

  const filmId = filmIdFor(spec);
  const [brief, production, envelope, prompt] = await Promise.all([
    loadBrief(env, session.mindId, filmId),
    loadProduction(env, session.mindId, filmId).catch(() => null),
    getEnvelope(env, session.mindId, filmId).catch(() => null),
    promptFor(env, session.mindId, filmId),
  ]);

  const revised = applyRevisions(spec, production?.revisions ?? []);
  const { risks } = assessRisks({
    spec: revised,
    cast,
    mustHold: brief?.mustHold ?? [],
    prompt,
    intent: brief?.intent ?? null,
  });

  const record = await startAssessment(env, session.mindId, {
    filmId,
    spec: revised,
    risks,
    brief,
    // The visitor's own words, verbatim. This is what the Director reads for demands — the spec
    // alone is what it read for the Hollywood film, and the spec had already softened the ask.
    prompt,
    finalUsd: priceUsd(h3Params(revised)) ?? 0,
    remainingUsd: envelope?.remainingUsd ?? null,
  });

  return json({ jobId: record.jobId, filmId, status: record.status });
}
