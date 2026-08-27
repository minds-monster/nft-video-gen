// The Director's judgement: which hazards are worth money, and what an answer means.
//
// TWO CALLS, AND NEITHER OF THEM TOUCHES THE SCRIPT'S FORMAT.
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

import { chat, jsonFrom } from './nvidia.js';
import { DIRECTOR_BRIEF, REVIEW_BRIEF, REVISABLE_BLOCKS, REVISION_SCHEMA, SHOOTING_PLAN_SCHEMA } from './director-brief.js';

/** The film, as the Director reads it. Deliberately compact — this call decides, it does not draw. */
const filmSummary = (spec, brief) =>
  [
    `Title: ${spec.title ?? 'untitled'}`,
    spec.logline ? `Logline: ${spec.logline}` : null,
    `Length: ${spec.duration}s at ${spec.resolution}, ${spec.ratio}`,
    `World: ${spec.world ?? '(none)'}`,
    spec.continuity ? `Continuity: ${spec.continuity}` : 'Continuity: not stated.',
    spec.guard ? `Guard: ${spec.guard}` : 'Guard: not stated.',
    `Camera: ${spec.camera ?? '(none)'}`,
    '',
    'Beats, in order:',
    ...(spec.beats ?? []).map((beat, index) => `  ${index + 1}. ${beat}`),
    '',
    brief?.intent ? `What the visitor said they want: ${brief.intent}` : null,
    brief?.mustHold?.length
      ? `They specifically asked that these survive into the render: ${brief.mustHold.join('; ')}.`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

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
export async function planShoot(env, { spec, risks, brief, finalUsd, remainingUsd, signal, onReasoning }) {
  const testable = risks.filter((risk) => risk.test);

  const user = [
    filmSummary(spec, brief),
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
    '',
    'Choose which hazards to buy answers to. Remember that the final render has to be affordable',
    'after whatever you spend on tests.',
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
  const fixes = (data?.fixes ?? []).filter(
    (fix) => byId.has(fix.riskId) && REVISABLE_BLOCKS.includes(fix.block) && typeof fix.text === 'string' && fix.text.trim(),
  );

  return {
    reading: data?.reading ?? '',
    tests,
    fixes,
    skip: (data?.skip ?? []).filter((entry) => byId.has(entry.riskId)),
    ownConcern: data?.ownConcern ?? null,
    plan: data?.plan ?? '',
    dropped: (data?.tests ?? []).filter((entry) => !byId.get(entry.riskId)?.test).map((entry) => entry.riskId),
    usage,
  };
}

/**
 * Read back a test and decide what it changes.
 *
 * The verdict may have come from a person or from the frame judge. Which one is stated, because
 * they carry different weight: a visitor watched the whole clip; the judge saw eight stills.
 */
export async function reviewTest(env, { spec, question, verdict, riskMeasured, signal, onReasoning }) {
  const user = [
    filmSummary(spec, null),
    '',
    'THE TEST YOU ASKED FOR:',
    `  Question: ${question}`,
    riskMeasured ? `  Why it was worth asking: ${riskMeasured}` : null,
    '',
    'THE RESULT:',
    `  Answer: ${verdict.answer}`,
    verdict.note ? `  What was seen: ${verdict.note}` : null,
    `  Judged by: ${verdict.by === 'visitor' ? 'the visitor, who watched the whole clip' : 'the frame judge, which saw eight stills sampled evenly across it'}`,
    '',
    'Decide what this means for the film, and whether one named block of the script should change.',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, usage } = await call(env, {
    system: REVIEW_BRIEF,
    user,
    schema: REVISION_SCHEMA,
    name: 'review',
    signal,
    onReasoning,
  });

  // A test that held must never produce a revision. The model is instructed not to, and this is
  // the guard for when it does anyway: a script that survived a test is a script that works, and
  // "improving" it is how a working shot gets broken by an agent looking busy.
  const revision = verdict.answer === 'held' ? null : (data?.revision ?? null);

  return {
    settled: Boolean(data?.settled),
    finding: data?.finding ?? '',
    revision,
    readyToShoot: Boolean(data?.readyToShoot),
    suppressedRevision: verdict.answer === 'held' && Boolean(data?.revision),
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
