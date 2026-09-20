// The Director's judgement: which hazards are worth money, and what an answer means.
//
// THREE CALLS, AND NONE OF THEM TOUCHES THE SCRIPT'S FORMAT.
//
// That separation is the whole design and it is worth being explicit about, because the obvious
// thing to do — hand the model the script and ask it to improve it — is the thing that would
// quietly break every render from here on. H3's wire format was established by a probe that cost
// money (P8 in scripts/probe-h3.mjs), and `src/lib/h3Script.js` and `worker/scene.js` compile to
// it MECHANICALLY, with no model in the loop. That stays true.
//
// So the agent decides, and deterministic code compiles:
//
//   planShoot   — reads the film and the measured register, picks which hazards to buy answers to
//   reviewTest  — reads a verdict, says what it means, and may replace ONE named block of prose
//   reviewDaily — reads the visitor's notes on a DELIVERED take, and may replace one block or ask
//                 for a rehearsal before the next take is bought
//
// A revision is a block of TEXT for a named field the Screenwriter already emits, which the same
// compiler then assembles exactly as before. The model never sees, and never writes, the wire
// format itself.
//
// ── ON THE MODEL ─────────────────────────────────────────────────────────────────────────────
//
// Runs on SCREENWRITER_MODEL, which is already proven on this account for forced tool calls and
// costs nothing per token. The Director's expensive resource is FOOTAGE, not tokens, and adding a
// paid reasoning tier here would be spending money to decide how to spend money.

import { answersFit } from './screen-test.js';
import { subjectSlots } from './rulebook.js';
import { chat, jsonFrom } from './nvidia.js';
import { priceUsd } from './minimax.js';
import { MOTION_TEST } from './director-risks.js';
import {
  DAILY_BRIEF,
  DAILY_NOTES_SCHEMA,
  DIRECTOR_BRIEF,
  REVIEW_BRIEF,
  REVISABLE_BLOCKS,
  REVISION_SCHEMA,
  SHOOTING_PLAN_SCHEMA,
} from './director-brief.js';

/** The film, as the Director reads it. Deliberately compact — this call decides, it does not draw.
 *
 * THE VISITOR'S PROMPT IS HERE VERBATIM, and it is the most important line. The spec is what the
 * Screenwriter made of the prompt; the prompt is what the visitor is paying for. The gap between
 * them — "literally transform" become "gives way to" — is where the Hollywood film was lost, and
 * a Director that only ever read the spec had no way to see it. */
const filmSummary = (spec, brief, prompt = null) =>
  [
    prompt ? `THE VISITOR'S PROMPT, VERBATIM: "${String(prompt).trim()}"` : null,
    prompt ? '' : null,
    `Title: ${spec.title ?? 'untitled'}`,
    spec.logline ? `Logline: ${spec.logline}` : null,
    `Length: ${spec.duration}s at ${spec.resolution}, ${spec.ratio}`,
    `World: ${spec.world ?? '(none)'}`,
    spec.staging ? `Staging: ${spec.staging}` : null,
    spec.continuity ? `Continuity: ${spec.continuity}` : 'Continuity: not stated.',
    spec.guard ? `Guard: ${spec.guard}` : 'Guard: not stated.',
    `Camera: ${spec.camera ?? '(none)'}`,
    '',
    'Beats, in order:',
    ...(spec.beats ?? []).map((beat, index) => `  ${index + 1}. ${beat}`),
    '',
    spec.notes ? `The Screenwriter's own notes: ${spec.notes}` : null,
    brief?.intent ? `What the visitor said they want: ${brief.intent}` : null,
    brief?.mustHold?.length
      ? `They specifically asked that these survive into the render: ${brief.mustHold.join('; ')}.`
      : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

/** A demand's id as the model wrote it, or as its question implies. */
const slugOf = (demand) =>
  String(demand?.id || demand?.question || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * The model's demands, made safe to spend on.
 *
 * Same discipline as the register filter below, applied to what the model is ALLOWED to invent:
 * a demand with no rehearsal text renders nothing worth judging; a beat the film does not have is
 * a hallucination; a beat the register already rehearses is a duplicate charge. And the price is
 * never the model's — it is computed from the parameters, like every other charge in this file.
 */
/**
 * Whether a rehearsal would only re-render the camera move the film already specifies.
 *
 * EVERY REHEARSAL CARRIES THE FILM'S OWN CAMERA BLOCK VERBATIM (worker/screen-test.js, focus
 * 'rehearsal'), so a demand whose beat text says nothing but what the camera does is a second
 * copy of a shot the visitor is already buying — its answer is visible in any other rehearsal of
 * this film, for free. Measured on production 2026-09-19: a robot film got three rehearsals, two
 * about the subject and one asking "does the camera push in with small amplitude at slow speed
 * without jumps or cuts?" — whose beat restated the camera line already printed above it in all
 * three prompts. The two useful ones rendered and answered it in passing; the third was rejected
 * by the content filter, twice, for $0.96.
 *
 * Read off the sentence subject rather than by comparing wording, because the restatement is
 * never a quotation — the model rewrites the move in its own words, which is exactly what makes
 * it look like a new question. Prohibitions ("no cuts", "nothing fades") are skipped: they are
 * the invariants every rehearsal states, not the thing under test. A demand that asks the
 * SUBJECT to do something keeps its camera sentence and is not touched.
 */
const cameraOnly = (direction) => {
  const sentences = String(direction ?? '')
    .replace(/^beat\s*\d+\s*:\s*/i, '')
    .split(/[.;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(no|nothing|never|without|there (are|is) no)\b/i.test(part));
  if (!sentences.length) return false;
  return sentences.every((part) => /^(the\s+)?camera\b/i.test(part));
};

const demandsOf = (data, spec, risks, { dropCameraOnly = true } = {}) => {
  const beatCount = spec?.beats?.length ?? 0;
  // Subjects, not slots — a piece with film-frame slots is one subject (rulebook.js subjectSlots).
  const referencePlan = subjectSlots(spec?.referencePlan);
  const rehearsedByRegister = new Set(
    risks.flatMap((risk) => (risk.test?.focus === 'rehearsal' ? risk.test.beats ?? [] : [])),
  );
  // A camera-only demand is dropped because ANOTHER rehearsal answers it in passing. Where there
  // is no other — no testable hazard in the register, no second demand — there is nothing to read
  // it off, and the question is the visitor's only look at the move before the full take. Kept.
  const otherTestsAsked =
    risks.some((risk) => risk.test) || (data?.demands ?? []).length > 1;
  const kept = [];
  const dropped = [];
  const seen = new Set();

  for (const raw of data?.demands ?? []) {
    const id = slugOf(raw);
    const question = String(raw?.question ?? '').trim();
    const direction = String(raw?.direction ?? '').trim();
    const beats = (Array.isArray(raw?.beats) ? raw.beats : []).filter(Number.isInteger);
    const subjects = (Array.isArray(raw?.subjects) ? raw.subjects : []).filter(Number.isInteger);

    const reason = !id || !question
      ? 'unnamed'
      : !direction
        ? 'no rehearsal text'
        : beats.some((n) => n < 1 || n > beatCount)
          ? 'names a beat the film does not have'
          : beats.some((n) => rehearsedByRegister.has(n))
            ? 'the register already rehearses that beat'
            : seen.has(id)
              ? 'duplicate'
              : dropCameraOnly && cameraOnly(direction) && otherTestsAsked
                ? 'only re-renders the camera move every other rehearsal already carries'
                : null;
    if (reason) {
      dropped.push({ id: id || '(unnamed)', reason });
      continue;
    }
    seen.add(id);

    const refKeys = subjects
      .map((n) => referencePlan[n - 1]?.key)
      .filter(Boolean);
    kept.push({
      id,
      question,
      why: String(raw?.why ?? '').trim(),
      beats,
      subjects,
      direction,
      onHeld: String(raw?.onHeld ?? '').trim() || null,
      onFailed: String(raw?.onFailed ?? '').trim() || null,
      // The buttons, in the film's words. Missing, malformed, or about a different film — the
      // model has copied the schema's example verbatim (worker/screen-test.js answersFit) — falls
      // back to the generic "It held / It did not" rather than dropping a demand over its labels.
      answers:
        answersFit(raw?.answers, question, direction)
          ? {
              held: String(raw.answers.held).trim().slice(0, 60),
              failed: String(raw.answers.failed).trim().slice(0, 60),
              unclear: 'Cannot tell',
            }
          : null,
      refKeys: refKeys.length ? refKeys.slice(0, 3) : referencePlan.slice(0, 3).map((slot) => slot.key),
      params: MOTION_TEST,
      estUsd: priceUsd(MOTION_TEST) ?? 0,
    });
  }
  return { demands: kept.slice(0, 4), droppedDemands: dropped };
};

/** The register, as text. `elevatedBy` is surfaced because it is the visitor's own words. */
const registerText = (risks) =>
  risks.length
    ? risks
        .map((risk) =>
          [
            `- id: ${risk.id}`,
            `  severity: ${risk.severity}${risk.test ? `, settling it costs $${risk.estUsd.toFixed(2)}` : ', NOT settled by rendering'}`,
            `  what: ${risk.what}`,
            `  measured: ${risk.measured}`,
            risk.elevatedBy ? `  the visitor asked to be sure of: "${risk.elevatedBy}"` : null,
            risk.test ? `  a test would ask: ${risk.test.question}` : `  fixed by: ${risk.fix}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n')
    : '(nothing measured applies to this film)';

const call = async (env, { system, user, schema, name, signal, onReasoning }) => {
  const response = await chat(env, {
    model: env.SCREENWRITER_MODEL,
    signal,
    retries: 2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [{ type: 'function', function: { name, description: 'Answer in this shape.', parameters: schema } }],
    tool_choice: { type: 'function', function: { name } },
  });
  const data = jsonFrom(response);
  onReasoning?.(response?.choices?.[0]?.message?.reasoning_content ?? '');
  return { data, usage: response?.usage ?? null };
};

/**
 * Decide what is worth shooting before the film is.
 *
 * `budget` is stated to the model in dollars because the decision is genuinely different at $3 and
 * at $30 — and because a model told only "be sparing" will be sparing in a way that has no
 * relationship to what the visitor can actually afford.
 */
export async function planShoot(env, { spec, risks, brief, prompt = null, finalUsd, remainingUsd, signal, onReasoning }) {
  const testable = risks.filter((risk) => risk.test);
  const rehearsalUsd = priceUsd(MOTION_TEST) ?? 0;

  const user = [
    filmSummary(spec, brief, prompt),
    '',
    'THE MEASURED REGISTER FOR THIS FILM:',
    registerText(risks),
    '',
    'THE MONEY:',
    `  The final render of this film costs $${finalUsd.toFixed(2)}.`,
    remainingUsd == null
      ? '  The visitor has not set a per-film allowance; every spend is approved individually.'
      : `  $${remainingUsd.toFixed(2)} is left for this film, and the final render has to come out of it.`,
    testable.length
      ? `  Settling every testable hazard would cost $${testable.reduce((sum, r) => sum + r.estUsd, 0).toFixed(2)} on top.`
      : '  Nothing in the register is settled by rendering.',
    `  A rehearsal of one beat — six seconds at 768P, inside the real film — costs $${rehearsalUsd.toFixed(2)}.`,
    '',
    'Choose which register hazards to buy answers to, and name every DEMAND in the prompt that',
    'needs a rehearsal before this film is shot. Remember that the final render has to be',
    'affordable after whatever you spend on tests.',
  ].join('\n');

  const { data, usage } = await call(env, {
    env,
    system: DIRECTOR_BRIEF,
    user,
    schema: SHOOTING_PLAN_SCHEMA,
    name: 'shooting_plan',
    signal,
    onReasoning,
  });

  // ⚠️ THE MODEL'S TEST LIST IS FILTERED AGAINST THE REGISTER, not trusted. A hallucinated risk id
  // would otherwise become a real charge against a hazard nobody measured — which is precisely the
  // failure mode the deterministic register exists to prevent.
  const byId = new Map(risks.map((risk) => [risk.id, risk]));
  const tests = (data?.tests ?? [])
    .filter((entry) => byId.get(entry.riskId)?.test)
    .map((entry) => ({ ...entry, risk: byId.get(entry.riskId) }));

  // Same discipline as `tests`: a fix against a hazard nobody measured is filtered out. A model
  // rewriting the script for an imagined problem is a quieter failure than one billing for it,
  // but it is the same failure.
  // Two more guards, both learned on 2026-08-28 when a Director "fixed" a landmark out of its own
  // film: a risk the register marked `autofix: false` is reported to the visitor and never
  // rewritten, and a hazard gets ONE fix — a second fix against the same id is the model using a
  // real hazard as a licence to rewrite something else.
  const fixedIds = new Set();
  const droppedFixes = [];
  const fixes = (data?.fixes ?? []).filter((fix) => {
    const risk = byId.get(fix.riskId);
    const reason = !risk
      ? 'not in the register'
      : risk.autofix === false
        ? 'reported, never rewritten'
        : !REVISABLE_BLOCKS.includes(fix.block) || typeof fix.text !== 'string' || !fix.text.trim()
          ? 'malformed'
          : fixedIds.has(fix.riskId)
            ? 'a hazard gets one fix'
            : null;
    if (reason) {
      droppedFixes.push({ riskId: fix.riskId ?? '(none)', block: fix.block ?? null, reason });
      return false;
    }
    fixedIds.add(fix.riskId);
    return true;
  });

  const { demands, droppedDemands } = demandsOf(data, spec, risks);

  return {
    reading: data?.reading ?? '',
    tests,
    fixes,
    skip: (data?.skip ?? []).filter((entry) => byId.has(entry.riskId)),
    demands,
    plan: data?.plan ?? '',
    dropped: (data?.tests ?? []).filter((entry) => !byId.get(entry.riskId)?.test).map((entry) => entry.riskId),
    droppedDemands,
    droppedFixes,
    usage,
  };
}

/**
 * Read back a test and decide what it changes.
 *
 * The verdict may have come from a person or from the frame judge. Which one is stated, because
 * they carry different weight: a visitor watched the whole clip; the judge saw eight stills.
 */
export async function reviewTest(
  env,
  { spec, question, verdict, riskMeasured, prompt = null, direction = null, priorVerdicts = [], signal, onReasoning },
) {
  const user = [
    filmSummary(spec, null, prompt),
    '',
    'THE TEST YOU ASKED FOR:',
    `  Question: ${question}`,
    riskMeasured ? `  Why it was worth asking: ${riskMeasured}` : null,
    direction ? `  What the rehearsal was told to render: ${direction}` : null,
    '',
    'THE RESULT:',
    `  Answer: ${verdict.answer}`,
    verdict.note ? `  What was seen: ${verdict.note}` : null,
    `  Judged by: ${verdict.by === 'visitor' ? 'the visitor, who watched the whole clip' : 'the frame judge, which saw eight stills sampled evenly across it'}`,
    priorVerdicts.length ? '' : null,
    priorVerdicts.length ? 'EARLIER TESTS ON THIS FILM:' : null,
    ...priorVerdicts.map(
      (prior) => `  - "${prior.question}" → ${prior.answer}${prior.note ? ` (${prior.note})` : ''}`,
    ),
    '',
    'Decide what this means for the film, whether one named block of the script should change,',
    'and whether this question has to be asked again before the film is shot.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const { data, usage } = await call(env, {
    system: REVIEW_BRIEF,
    user,
    schema: REVISION_SCHEMA,
    name: 'review',
    signal,
    onReasoning,
  });

  // A test that held with NOTHING said about it must never produce a revision: a script that
  // survived a test is a script that works, and "improving" it is how a working shot gets broken
  // by an agent looking busy. But a held test where the visitor WROTE what was wrong — "the brain
  // formed only from the Y and W" (2026-08-28) — is a working mechanism with a named defect, which
  // is exactly the unit the hero was fixed in. Their words unlock the revision; silence does not.
  const namedDefect = verdict.answer === 'held' && Boolean(String(verdict.note ?? '').trim());
  const locked = verdict.answer === 'held' && !namedDefect;
  const revision = locked ? null : (data?.revision ?? null);

  return {
    settled: Boolean(data?.settled),
    finding: data?.finding ?? '',
    revision,
    readyToShoot: Boolean(data?.readyToShoot),
    // A held test is settled by definition; a re-test only ever follows a failure, a doubt, or a
    // defect the visitor named.
    retest: !locked && Boolean(data?.retest),
    suppressedRevision: locked && Boolean(data?.revision),
    usage,
  };
}

/**
 * Read the visitor's notes on a delivered take and decide what the next one does differently.
 *
 * THE THIRD CALL, AND THE ONLY ONE WHOSE QUESTION THE DIRECTOR DID NOT ASK. `planShoot` reads the
 * register and the prompt; `reviewTest` reads back an answer to a question it chose. Both of them
 * are the Director talking to itself about a film nobody has seen yet. This one starts from the
 * one thing neither can produce — a person who watched the finished take and wrote down what was
 * wrong with it — and it is the loop the hero was actually made in: 22 clips, six takes of the
 * final shot, each one fixing a defect named after watching the last.
 *
 * It may ask for rehearsals, which `reviewTest` may not. That is the whole difference in kind: a
 * screen test's re-test asks the SAME question again, while a note is a new defect, and whether
 * the model can render the fix is exactly the thing worth $0.48 to find out before $1.95 is spent
 * finding out the expensive way.
 */
export async function reviewDaily(
  env,
  { spec, notes, take, prompt = null, brief = null, priorNotes = [], priorVerdicts = [], signal, onReasoning },
) {
  const user = [
    filmSummary(spec, brief, prompt),
    '',
    'THE TAKE THEY WATCHED:',
    `  ${take?.params?.duration ?? '?'}s at ${take?.params?.resolution ?? '?'}, costing $${Number(take?.costUsd ?? 0).toFixed(2)}.`,
    // The compiled script, not the spec's blocks: it is what H3 was actually sent, and a defect
    // the visitor names may be in the assembly rather than in any one block.
    take?.script?.text ? '' : null,
    take?.script?.text ? 'THE SCRIPT IT WAS RENDERED FROM, VERBATIM:' : null,
    take?.script?.text ? String(take.script.text).slice(0, 4000) : null,
    '',
    'WHAT THE VISITOR SAID, VERBATIM, HAVING WATCHED IT:',
    `  "${String(notes).trim()}"`,
    priorNotes.length ? '' : null,
    priorNotes.length ? 'WHAT THEY SAID ABOUT EARLIER TAKES OF THIS FILM:' : null,
    ...priorNotes.map((prior) => `  - Take ${prior.index}: "${prior.notes}"`),
    priorVerdicts.length ? '' : null,
    priorVerdicts.length ? 'THE SCREEN TESTS THIS FILM ALREADY ANSWERED:' : null,
    ...priorVerdicts.map(
      (prior) => `  - "${prior.question}" → ${prior.answer}${prior.note ? ` (${prior.note})` : ''}`,
    ),
    '',
    'Say what their notes mean for the next take, change at most one named block of the script,',
    'and ask for a rehearsal only where your fix is a guess about what the model can do.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const { data, usage } = await call(env, {
    system: DAILY_BRIEF,
    user,
    schema: DAILY_NOTES_SCHEMA,
    name: 'daily_notes',
    signal,
    onReasoning,
  });

  // The same filter the shooting plan's demands go through — a beat the film does not have is a
  // hallucination whichever call invented it, and the price is computed here, never quoted by the
  // model. `risks` is empty because the register is not what prompted these: they answer the
  // visitor's own words, and a note that says the camera stumbled EARNS a camera rehearsal, which
  // is why the camera-only rule is off here. There is no other rehearsal to read that answer off.
  const { demands, droppedDemands } = demandsOf(data, spec, [], { dropCameraOnly: false });

  const revision =
    data?.revision && REVISABLE_BLOCKS.includes(data.revision.block) && String(data.revision.text ?? '').trim()
      ? data.revision
      : null;

  return {
    finding: data?.finding ?? '',
    revision,
    demands,
    droppedDemands,
    // A revision or a rehearsal means the film is not finished, whatever the model ticked: a
    // Director that rewrites a block and then says the take is the film has contradicted itself,
    // and the visitor would be left with an amended script and no reason to shoot it.
    shootAgain: Boolean(data?.shootAgain) || Boolean(revision) || demands.length > 0,
    suppressedRevision: Boolean(data?.revision) && !revision,
    usage,
  };
}

/**
 * Apply the Director's revisions to a spec.
 *
 * Pure, and applied at COMPILE time rather than written back over the Screenwriter's work. Two
 * reasons: the visitor's screenplay stays theirs and stays visible in the Screenplay panel, and
 * every revision is reversible by dropping it from the list rather than by trying to remember what
 * a block used to say.
 */
export const applyRevisions = (spec, revisions = []) => {
  if (!revisions.length) return spec;
  const next = { ...spec };
  for (const revision of revisions) {
    if (!revision?.block || typeof revision.text !== 'string') continue;
    next[revision.block] = revision.text;
  }
  return next;
};
