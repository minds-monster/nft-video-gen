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
import { filmCall, FREE_MAX_BEATS } from './openrouter.js';
import { resolveTier, LATENCY_SECONDS, TIER_LABEL } from './tier.js';
import {
  SCENE_SCHEMA,
  COORDINATE_CONTRACT_V2,
  buildBrief,
  buildFilmUserMessage,
  compileBeatToH3,
  toStrictSchema,
  validateScene,
} from './scene.js';
import { castingStills, fetchImageAsDataUri } from './casting-director.js';
import { verifySession, signSession } from './session.js';
import { H3_FORMAT } from './rulebook.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// The beat ceiling is now PER TIER and lives in worker/tier.js (6 paid, 5 free) — six beats
// failed on every free configuration round 7 tried, so it is a measured limit rather than a
// product decision. SHOT_SPEC_SCHEMA in worker/rulebook.js still caps what the Screenwriter emits.
const PATTERN_ABUSE_REGEN_COUNT = 10;
const IMAGE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_SIZE = '1024x1024';
const IMAGE_QUALITY = 'low';

const storyboardKey = (mindId) => `storyboard:${mindId}`;
const r2Key = (mindId, aFrameId, version) => `storyboard/${mindId}/${aFrameId}/${version}.png`;
const makeFrameId = (beatIndex) => `beat-${beatIndex}-${crypto.randomUUID().slice(0, 8)}`;

async function loadStoryboard(env, mindId) {
  return (await env.MIND_CONNECTIONS.get(storyboardKey(mindId), 'json')) ?? { frames: [], createdAt: Date.now() };
}

async function saveStoryboard(env, mindId, record) {
  record.updatedAt = Date.now();
  await env.MIND_CONNECTIONS.put(storyboardKey(mindId), JSON.stringify(record));
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
 * this is a URL, not a binary attachment. */
async function signedImageUrl(env, mindId, key, requestUrl) {
  const token = await signSession(env, { mindId, exp: Date.now() + IMAGE_LINK_TTL_MS });
  const url = new URL('/api/storyboard/image', requestUrl);
  url.searchParams.set('key', key);
  url.searchParams.set('token', token);
  return url.toString();
}

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

/** One whole film, from whichever model this tier resolved to. Both transports return the same
 * `{ data, usage, model }` shape so nothing downstream has to know which one ran. */
async function generateFilm(env, plan, { system, user, signal }) {
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
  const result = await filmCall(env, { system, user, schema: toStrictSchema(SCENE_SCHEMA), signal });
  return { data: result.data, usage: result.usage, model: result.model };
}

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

const floorViolations = (scene) => validateScene(scene).filter((v) => v.severity === 'floor');

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
async function repairBeat(env, plan, { spec, cast, beatIndex, beatText, broken, violations, signal }) {
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

  const { data, usage, model } = await generateFilm(env, plan, { system, user, signal });
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
 * The default path: one whole-film call, validated per beat, no image spend.
 *
 * The SSE contract is deliberately compatible with what useStoryboarder.js already consumes
 * (`phase` / `frame` / `result`), and adds `plan` (the tier decision, before anything runs) and
 * `heartbeat` (proof of life during the long call).
 */
export async function handleStoryboard(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const { spec, cast } = body;
  if (!spec || !Array.isArray(spec.beats) || !spec.beats.length || !Array.isArray(cast) || !cast.length) {
    return json({ error: 'Body needs { spec, cast: [{ key, dossier, name }] }' }, 400);
  }

  const mindId = session.mindId;
  const castByKey = new Map(cast.map((c) => [c.key, c]));

  return sseResponse(async (emit) => {
    const plan = await resolveTier(env, mindId, spec.beats.length);
    // The cap is applied HERE, before a single token is spent — a visitor is never allowed to
    // start a render they cannot finish. `overCap` is already in the plan event, so the UI can
    // say so in the visitor's own language rather than counting beats at them.
    const beats = spec.beats.slice(0, plan.maxBeats);
    await emit('plan', plan);

    const cappedSpec = { ...spec, beats };
    const system = buildBrief(H3_FORMAT, COORDINATE_CONTRACT_V2);
    const user = buildFilmUserMessage(cappedSpec, cast);
    const nameOf = (tag) => subjectNamesFrom(spec, castByKey)[tag] ?? tag;

    await emit('phase', { phase: 'planning', beats: beats.length, tier: plan.tier });

    let film;
    let usage;
    let model;
    let activePlan = plan;
    try {
      const result = await withHeartbeat(emit, 'drafting', () => {
        return emit('phase', { phase: 'drafting' }).then(() => generateFilm(env, activePlan, { system, user }));
      });
      film = result.data;
      usage = result.usage;
      model = result.model;
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
        await emit('result', { frames: [], error: error.message, plan: activePlan });
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
          generateFilm(env, activePlan, { system, user: buildFilmUserMessage({ ...cappedSpec, beats: beats.slice(0, FREE_MAX_BEATS) }, cast) }),
        );
        film = result.data;
        usage = result.usage;
        model = result.model;
      } catch (fallbackError) {
        await emit('result', { frames: [], error: fallbackError.message, plan: activePlan });
        return;
      }
    }

    let spend = await recordSpend(env, mindId, { kind: 'llm', model, usage, beatIndex: null });

    await emit('phase', { phase: 'validating' });

    const byIndex = new Map((film.beats ?? []).map((beat) => [beat.beatIndex, beat]));
    const usableBeats = beats.slice(0, activePlan.maxBeats);
    const storyboard = {
      frames: [],
      tier: activePlan.tier,
      model,
      aspect: film.aspect ?? 16 / 9,
      sceneScaleNote: film.sceneScaleNote ?? null,
      // Stored with the storyboard, not derived on the client: "<Subject 1>" is how the machinery
      // matches a subject across the schema, the references and the render prompt — it is not
      // what a person should ever be shown. Keeping the mapping on the record means a returning
      // visitor sees "the ape" without needing the original cast in hand.
      subjectNames: subjectNamesFrom(spec, castByKey),
      createdAt: Date.now(),
    };
    let repairsUsed = 0;
    const repaired = [];
    const refused = [];

    for (let beatIndex = 0; beatIndex < usableBeats.length; beatIndex += 1) {
      const beatText = usableBeats[beatIndex];

      if (isTransitionBeat(beatText)) {
        // Decided in code, not taken on trust: the marker is in the beat text, so a model that
        // returns a shot for it is simply wrong and there is nothing to verify.
        const frame = transitionFrame(beatIndex, beatText);
        storyboard.frames.push(frame);
        await emit('frame', frame);
        continue;
      }

      let scene = byIndex.get(beatIndex) ?? null;
      let violations = scene ? floorViolations(scene) : [{ code: 'missing-beat', severity: 'floor', detail: 'The model returned no geometry for this beat.' }];
      let attempts = 1;

      // At most one repair per beat, at most three per film. The ceiling is not timidity: round 7
      // measured these failures landing on DIFFERENT beats each run rather than compounding on
      // one, so a film needing four repairs is a film with something else wrong with it, and
      // spending more calls on it hides that rather than fixing it.
      if (scene && violations.length && repairsUsed < 3) {
        repairsUsed += 1;
        attempts += 1;
        await emit('phase', { phase: 'validating', beatIndex, repairing: true });
        try {
          const result = await withHeartbeat(emit, 'validating', () =>
            repairBeat(env, activePlan, { spec: cappedSpec, cast, beatIndex, beatText, broken: scene, violations, signal: undefined }),
          );
          spend = await recordSpend(env, mindId, { kind: 'llm', model: result.model, usage: result.usage, beatIndex });
          if (result.repaired) {
            const afterRepair = floorViolations({ ...result.repaired, beatIndex });
            // The two-stage check. A repair is only a repair if it passes the check that
            // rejected the original; otherwise the original failure stands and is reported.
            if (!afterRepair.length) {
              scene = { ...result.repaired, beatIndex };
              violations = [];
              repaired.push(beatIndex);
            } else {
              violations = afterRepair;
            }
          }
        } catch (error) {
          console.warn(`Beat ${beatIndex + 1} repair failed:`, error.message);
        }
      }

      const failed = violations.length > 0;
      if (failed) refused.push(beatIndex);

      const frame = {
        frameId: makeFrameId(beatIndex),
        beatIndex,
        transition: false,
        transitionText: null,
        beatText,
        scene: failed ? null : scene,
        // Kept even on a refused beat: the prose is the primary human surface, it is what the
        // visitor reads first, and it is not what failed.
        proseNote: scene?.proseNote ?? null,
        blocking: null,
        status: failed ? 'failed' : 'ok',
        violations: violations.map((v) => ({ ...v, english: violationInEnglish(v, nameOf) })),
        attempts,
        tier: activePlan.tier,
        model,
        r2Key: null,
        costUsd: 0,
        regenCount: 0,
        history: [],
        createdAt: Date.now(),
      };
      storyboard.frames.push(frame);
      await emit('frame', frame);
    }

    await emit('phase', { phase: 'finalising' });
    await saveStoryboard(env, mindId, storyboard);

    const budget = await getBudget(env, mindId);
    const shots = storyboard.frames.filter((f) => !f.transition).length;
    await relayStoryboardDigest(
      env,
      mindId,
      [
        `[Storyboarder] Blocked ${shots} shot(s) on the ${activePlan.tier} tier (${model}).`,
        repaired.length ? ` Repaired: ${repaired.map((i) => `beat ${i + 1}`).join(', ')} — geometry corrected and re-checked.` : '',
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
    });
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
  const record = await loadStoryboard(env, mindId);
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
    violations = scene ? floorViolations(scene) : [{ code: 'missing-beat', severity: 'floor', detail: 'The model returned no geometry for this beat.' }];
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

  const record = await loadStoryboard(env, session.mindId);
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
    const storyboardRecord = await loadStoryboard(env, mindId);
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

export async function handleStoryboardGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const storyboardRecord = await loadStoryboard(env, session.mindId);
  const spend = await getSpend(env, session.mindId);
  return json({ ...storyboardRecord, spend });
}

/**
 * Serves one stored sketch's image bytes from R2. Auth via a `token` query param — loaded
 * from a plain `<img src>` or a Producer digest's link, neither of which can attach custom
 * headers. `key` must already be namespaced under the caller's own mindId.
 */
export async function handleStoryboardImage(request, env) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const key = searchParams.get('key');
  const session = token ? await verifySession(env, token) : null;
  if (!session || !key || !key.startsWith(`storyboard/${session.mindId}/`)) {
    return json({ error: 'not_found' }, 404);
  }

  const object = await env.STORYBOARD_IMAGES.get(key);
  if (!object) return json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' },
  });
}
