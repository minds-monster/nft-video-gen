// What is likely to go wrong with this render, worked out before anything is spent.
//
// THE DELIBERATE DIVISION OF LABOUR. The Director is an agent, and an agent asked to find the
// risks in a script will find some — but the ones that actually cost this project money are not
// a matter of judgement. They are eleven measured rules (H3_RULES in worker/rulebook.js), each
// paid for with a failed render, and every one of them is DETECTABLE FROM STRUCTURED DATA the
// pipeline already produces: the Casting Director's dossier enums, the Screenwriter's reference
// plan, the reference dimensions.
//
// So this file raises the known hazards deterministically and hands the Director a register it
// can reason ON TOP OF. That ordering matters for three reasons:
//
//   1. A known failure must never depend on a model noticing it. "The model usually spots that"
//      is not a guard.
//   2. Most of these cost $0 to settle — a rewrite, a crop, a preflight — and an agent that
//      cannot tell those apart from the ones needing a render will propose paying for both.
//   3. It makes the Director's proposals defensible. "This is worth $0.32 because a full-length
//      reference was measured losing its subject's face" reads differently from "I think we
//      should test the character."
//
// Every risk carries `measured` — the specific finding behind it. If a risk cannot cite one, it
// does not belong here; it belongs in the Director's own reasoning, where it will be labelled as
// judgement rather than fact.

import { priceUsd } from './minimax.js';
import { FACE_AT_RISK_FRAMING } from './reference-preflight.js';

/** The body plans that have a face to lose. `physicalProfile.bodyPlan` is a real enum
 * (worker/casting-director.js), so this is a lookup rather than an inference — and the secondary
 * signal only: `headRatio`, which is null for anything headless, is checked first. */
const FACED_BODY_PLANS = new Set(['biped', 'quadruped', 'creature-other']);

/** The cheap diagnostic, and why it is this shape. Straight from scripts/probe-h3.mjs:
 * "Deliberately 4s @ 768P: $0.32 a probe, ~$1 for the set. Cheap enough that measuring beats
 * arguing." A Screen Test is not a small render — it is an instrument. */
export const SCREEN_TEST = { model: 'MiniMax-H3', resolution: '768P', duration: 4, ratio: '16:9' };

/** Two beats of camera movement need longer than a held pose. Used only where the question is
 * about motion or continuity, which 4 seconds cannot answer. */
export const MOTION_TEST = { model: 'MiniMax-H3', resolution: '768P', duration: 6, ratio: '16:9' };

const estUsd = (params) => priceUsd(params) ?? 0;

/** Every prose field of a shot spec that reaches H3 verbatim. Structured routing fields —
 * `referencePlan[].key` above all — are deliberately NOT here: they are internal identifiers and
 * the whole point of the brand scan is that anything in this list gets rendered as text if the
 * model decides to draw it. */
const PROSE_FIELDS = ['world', 'grade', 'guard', 'staging', 'continuity', 'camera', 'sound', 'music'];

const proseOf = (spec) =>
  [...PROSE_FIELDS.map((field) => spec?.[field] ?? ''), ...(spec?.beats ?? [])].join('\n');

/** Words that identify a chain or a wallet rather than a thing that can be filmed. A cast key or
 * a contract address in prose is both a content-filter risk and a literal instruction to a model
 * that renders the text it is shown. */
const IDENTIFIER_PATTERNS = [
  { pattern: /0x[a-fA-F0-9]{6,}/g, what: 'a contract address' },
  { pattern: /\b(ethereum|polygon|solana|base|arbitrum|optimism)\b/gi, what: 'a chain name' },
  { pattern: /\btoken\s*#?\d+\b/gi, what: 'a token id' },
];

const uniq = (values) => [...new Set(values.filter(Boolean))];

/** Words, lowercased, in order. Numbers and punctuation are separators. */
const wordsOf = (text) => String(text ?? '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];

/**
 * The marks PRINTED ON THE ARTWORK, which is where a brand name almost always comes from.
 *
 * This is the Casting Director's own shortcut, applied one stage later. worker/casting-director.js
 * refuses a dossier whose description reuses a word it transcribed into `burnedInText`, and its
 * comment names the exact case: "Measured on the adidas Phase 2 card, where the card reads
 * 'BORED APE YACHT CLUB' and the first dossier duly opened 'A Bored Ape character...'."
 *
 * ⚠️ THAT CHECK IS NOT SUFFICIENT ON ITS OWN, and this repo's own captured fixtures prove it: they
 * carry a dossier reading "A Bored Ape character" alongside a burnedInText of "PHASE 2 BORED APE
 * YACHT CLUB" — exactly what it exists to reject. Dossiers cached before it existed keep their
 * leak, and the Screenwriter builds its prose out of them. So the same test runs again HERE, at
 * the point where money is actually spent, against the script rather than the dossier, because
 * this is the last place it can be caught for free.
 *
 * Two shapes, for a reason:
 *
 *   - BIGRAMS catch the brand without catching the noun. "bored ape" appearing intact is a brand;
 *     "ape" on its own is a description, and the hero's own shipped prompt says "the stylised
 *     blue-furred ape character" against this very collection. Flagging that would be wrong.
 *   - DISTINCTIVE SINGLES (five characters or more) catch "adidas", "mclaren", "wbei". Anything a
 *     piece's own palette legitimately contains is exempt, so a colour printed on a card —
 *     "indigo", on the adidas one — stays usable as a colour.
 *
 * `hazards` contributes only its CAPITALISED tokens. It is free prose, and taking every long word
 * from "visible shield-shaped badge on hood (brand mark)" would flag "shield", "badge" and
 * "brand" — generic words a legitimate description uses.
 */
const printedMarks = (cast = []) => {
  const bigrams = new Map();
  const singles = new Map();

  for (const entry of cast) {
    const dossier = entry?.dossier;
    if (!dossier) continue;
    const palette = new Set((dossier.palette ?? []).flatMap(wordsOf));
    const owner = entry.name ?? entry.key ?? null;

    const printed = wordsOf(dossier.burnedInText);
    for (let i = 0; i < printed.length - 1; i += 1) {
      bigrams.set(`${printed[i]} ${printed[i + 1]}`, owner);
    }
    for (const word of printed) {
      if (word.length >= 5 && !palette.has(word)) singles.set(word, owner);
    }

    for (const hazard of dossier.hazards ?? []) {
      for (const token of String(hazard).match(/\b[A-Z][A-Za-z_]{3,}\b/g) ?? []) {
        const word = token.toLowerCase();
        if (!palette.has(word)) singles.set(word, owner);
      }
    }
  }
  return { bigrams, singles };
};

/**
 * Names that must not appear in the script, gathered from the cast itself.
 *
 * There is no list of "brands" to check against, and there could not be: the whole product is
 * licensed brand artwork, so which brands are in play is decided by whoever the visitor cast.
 *
 * ⚠️ THE NAIVE VERSION OF THIS IS WORSE THAN NOTHING, and it flagged the hero's own prompts the
 * first time it ran. A cast entry called "tower" matches a script that says "tower" — but
 * describing a tower as a tower is precisely what rule 1 ASKS for. So a single-word cast name is
 * a hit only when no dossier's own brand-free vocabulary contains it; a multi-word name has to
 * appear intact.
 */
const brandHits = (cast, prose) => {
  const { bigrams, singles } = printedMarks(cast);

  // The words the dossiers use for form, colour and material. Anything PRINTED on the artwork is
  // removed from it — otherwise a brand that leaked into a dossier would launder itself safe,
  // which is exactly what the captured fixtures would do with "Bored Ape".
  const safe = new Set();
  for (const entry of cast) {
    const dossier = entry?.dossier;
    if (!dossier) continue;
    for (const word of [
      ...wordsOf(dossier.subject),
      ...(dossier.identityMarkers ?? []).flatMap(wordsOf),
      ...(dossier.palette ?? []).flatMap(wordsOf),
      ...wordsOf(dossier.physicalProfile?.silhouetteNotes),
    ]) {
      if (!singles.has(word)) safe.add(word);
    }
  }

  const hits = [];
  const lower = prose.toLowerCase();

  for (const [bigram, owner] of bigrams) {
    if (new RegExp(`\\b${escapeRegex(bigram)}\\b`).test(lower)) {
      hits.push({ text: bigram, from: 'printed on the artwork', piece: owner });
    }
  }
  for (const [word, owner] of singles) {
    if (new RegExp(`\\b${escapeRegex(word)}\\b`).test(lower)) {
      hits.push({ text: word, from: 'printed on the artwork', piece: owner });
    }
  }

  const named = uniq(
    cast.flatMap((entry) => [entry?.name, entry?.collection?.name, entry?.nft?.contract?.name, entry?.nft?.contract?.symbol]),
  ).filter((name) => typeof name === 'string' && name.trim().length >= 4);

  for (const name of named) {
    const cleaned = name.trim().replace(/\s*#\d+\s*$/, '');
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1 && safe.has(cleaned.toLowerCase())) continue;
    if (new RegExp(`\\b${escapeRegex(cleaned)}\\b`, 'i').test(prose)) {
      hits.push({ text: cleaned, from: 'the name of a cast piece', piece: null });
    }
  }

  // A single word that is already inside a reported bigram adds nothing but noise: "bored ape"
  // and "bored" are one finding, and listing both makes the message read like two problems.
  const phrases = hits.filter((hit) => hit.text.includes(' '));
  const kept = hits.filter(
    (hit) => hit.text.includes(' ') || !phrases.some((phrase) => phrase.text.split(' ').includes(hit.text)),
  );

  const byText = new Map();
  for (const hit of kept) if (!byText.has(hit.text)) byText.set(hit.text, hit);
  return [...byText.values()];
};

/**
 * Words too common to distinguish anything. A "must hold" of "the take" should not match every
 * risk that happens to contain the word.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'its', 'must', 'has', 'have',
  'not', 'are', 'was', 'all', 'any', 'but', 'can', 'his', 'her', 'their', 'them', 'they',
  'stay', 'stays', 'keep', 'kept', 'look', 'looks', 'good', 'nice', 'well', 'make', 'made',
  'right', 'proper', 'properly', 'really', 'very', 'quality', 'cinematic', 'great', 'better',
]);

/**
 * Which risks the visitor said they care about.
 *
 * THIS IS THE ONLY PART OF A SCOPE BRIEF THAT DOES DETERMINISTIC WORK, and it is why
 * `mustHold` is written as a list of things that would be VISIBLY WRONG rather than as adjectives.
 * "the ape's face" names something the register has already measured a hazard about; "make it
 * cinematic" names nothing, matches nothing, and costs the visitor a field.
 *
 * Elevation only REORDERS. It never invents a risk, never raises a severity, and never spends —
 * a visitor caring about something cannot make it dangerous, only make it first.
 */
const elevatedBy = (risk, mustHold = []) => {
  if (!mustHold.length) return null;
  const haystack = [
    risk.what,
    risk.test?.question,
    typeof risk.evidence === 'object' && !Array.isArray(risk.evidence) ? Object.values(risk.evidence).join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const phrase of mustHold) {
    const words = String(phrase)
      .toLowerCase()
      .match(/[a-z][a-z'-]{2,}/g)
      ?.filter((word) => !STOPWORDS.has(word));
    if (words?.some((word) => haystack.includes(word))) return phrase;
  }
  return null;
};

/**
 * Read the risks out of a spec, its cast and (optionally) a reference preflight.
 *
 * Returns them ordered most-costly-to-ignore first, because that is the order a visitor should
 * be asked to spend in — and because the top of the list is what the Director will act on if it
 * only gets to act once.
 */
export const assessRisks = ({ spec, cast = [], preflight = null, mustHold = [] } = {}) => {
  const risks = [];
  const prose = proseOf(spec);
  const referencePlan = spec?.referencePlan ?? [];
  const beats = spec?.beats ?? [];
  const byKey = new Map(cast.map((entry) => [entry?.key, entry]));

  const add = (risk) => risks.push({ estUsd: risk.test ? estUsd(risk.test.params) : 0, ...risk });

  // ── Rule 1. NO BRAND NAMES. ────────────────────────────────────────────────────────────────
  // The one failure that costs nothing but stops everything: a rejected request never renders,
  // so it is free — but it is also the most likely single reason a first render fails, because
  // the input to this product is brand artwork and the obvious thing to write is the brand.
  const named = brandHits(cast, prose);
  if (named.length) {
    add({
      id: 'brand-name-in-script',
      rule: 1,
      severity: 'floor',
      what:
        `The script contains ${named.map((hit) => `"${hit.text}" (${hit.from})`).join(', ')}. ` +
        'MiniMax rejects the whole request.',
      evidence: named,
      measured:
        'MiniMax error 1026 — the content filter. The reference images carry the marks; the text ' +
        'carries only form, material and colour. "a low, sharply-creased wedge-profile hypercar ' +
        'with Y-shaped running lights", never the manufacturer.',
      fix: 'rewrite',
      test: null,
    });
  }

  const identifiers = IDENTIFIER_PATTERNS.flatMap(({ pattern, what }) =>
    (prose.match(pattern) ?? []).map((match) => ({ match, what })),
  );
  if (identifiers.length) {
    add({
      id: 'identifier-in-script',
      rule: 1,
      severity: 'floor',
      what: `The script contains ${uniq(identifiers.map((i) => i.what)).join(' and ')} — ${uniq(identifiers.map((i) => i.match)).slice(0, 3).join(', ')}.`,
      evidence: uniq(identifiers.map((i) => i.match)),
      measured:
        'This model reproduces text it is shown. Probe P3 rendered a card\'s "MCL_GENESIS / ' +
        'HONORARY" lettering letter-perfect into the picture. An internal identifier in a prose ' +
        'field is an instruction to draw it.',
      fix: 'rewrite',
      test: null,
    });
  }

  // ── Rule 4. NINE SLOTS, AND NOTHING MAY FALL BACK TO PROSE. ────────────────────────────────
  if (referencePlan.length > 9) {
    add({
      id: 'over-nine-slots',
      rule: 4,
      severity: 'floor',
      what: `${referencePlan.length} pieces for 9 reference slots.`,
      evidence: referencePlan.slice(9).map((slot) => slot.key),
      measured:
        'Measured on the hero: 12 assets into 9 slots left the tiara, the Blossom and the entire ' +
        'crowd on prose alone. All three failed — the Blossom rendered hatless and the crowd was ' +
        'generic toys that were never the licensed characters at all. Anything with a reference ' +
        'renders; anything prose-only tends not to.',
      // Composites are how the hero bought slots back, and they cannot be built here: there is no
      // canvas in a Worker, and a generated composite would be a DERIVED reference, which rule 3
      // forbids outright. So this is stated rather than silently solved.
      fix: 'trim-cast',
      test: null,
    });
  }

  // ── Rule 5. BIND EVERY SUBJECT TO ITS REFERENCE AND ITS PLACE. ─────────────────────────────
  if (referencePlan.length > 1 && !String(spec?.staging ?? '').trim()) {
    add({
      id: 'unbound-subjects',
      rule: 5,
      severity: 'hazard',
      what: `${referencePlan.length} subjects and no staging block binding each one to its reference.`,
      evidence: referencePlan.map((slot) => slot.key),
      measured:
        'Unbound subjects get duplicated, swapped or quietly deleted. One take reused the same car ' +
        'for two different drivers, invented an empty fourth, and then launched only two of them.',
      fix: 'rewrite',
      test: null,
    });
  }

  // ── Rule 9. ONE CONTINUOUS SHOT UNLESS ASKED OTHERWISE. ────────────────────────────────────
  if (beats.length > 2 && !String(spec?.continuity ?? '').trim()) {
    add({
      id: 'uncommitted-continuity',
      rule: 9,
      severity: 'hazard',
      what: `${beats.length} beats with nothing saying whether this is one take or several.`,
      evidence: beats.map((_, index) => index),
      measured:
        'Language that reads as a series of arrivals invites the model to cut between them. The ' +
        'hero needed an explicit ban on cuts AND a constraint on where the camera could go — a ' +
        'take that seated its drivers correctly did it by putting the camera inside the cabins, ' +
        'and a camera inside one car cannot glide to the next, so it cut.',
      fix: 'rewrite-then-test',
      test: {
        question: 'Does this run as one unbroken take, or does the model cut between beats?',
        params: MOTION_TEST,
        refKeys: referencePlan.slice(0, 3).map((slot) => slot.key),
        focus: 'continuity',
      },
    });
  }

  // ── Per-piece hazards, straight off the dossier enums. ─────────────────────────────────────
  for (const slot of referencePlan) {
    const entry = byKey.get(slot.key);
    const dossier = entry?.dossier;
    if (!dossier) continue;
    const label = dossier.subject ?? slot.key;

    // Rule 11. A FULL-BODY REFERENCE WILL LOSE THE FACE — where there IS a face.
    //
    // The measured finding is specifically about facial identity, and applying its wording to a
    // tower block would be a check that fires correctly and then says something false. The
    // dossier settles it directly: `physicalProfile.headRatio` is "null for anything without a
    // head". Where the profile is missing entirely — older cached dossiers, and the Storyboarder's
    // own fixtures — the risk is still real but is stated as identity rather than as a face,
    // because that is what the data actually supports.
    if (FACE_AT_RISK_FRAMING.has(dossier.framing)) {
      const profile = dossier.physicalProfile ?? null;
      const hasFace = profile
        ? profile.headRatio != null || FACED_BODY_PLANS.has(profile.bodyPlan)
        : null;
      const markers = (dossier.identityMarkers ?? []).slice(0, 3).join(', ');
      add({
        id: `identity-at-risk:${slot.key}`,
        rule: 11,
        severity: 'hazard',
        what:
          hasFace === true
            ? `${label} is framed "${dossier.framing}", so its FACE may not survive.`
            : `${label} is framed "${dossier.framing}", so the details that identify it may not survive${markers ? ` — ${markers}` : ''}.`,
        evidence: {
          key: slot.key,
          framing: dossier.framing,
          cropAdvice: dossier.cropAdvice || null,
          bodyPlan: profile?.bodyPlan ?? null,
          headRatio: profile?.headRatio ?? null,
          hasFace,
        },
        measured:
          hasFace === true
            ? 'Probe P8: a character passed as a full-length figure came back wearing its own ' +
              'outfit exactly and with a completely different face — the species was wrong, and ' +
              'the prose describing it did not save it. Clothing, colour and silhouette survive ' +
              'at any framing; facial identity only survives when the head is a large part of ' +
              'the reference.'
            : 'A subject that is small in its reference renders as its general shape. Measured on ' +
              'a character, where the loss is a face and therefore obvious; the same mechanism ' +
              'costs an object its distinguishing detail, which is harder to notice and just as ' +
              'wrong.',
        fix: dossier.cropAdvice ? 'crop-then-test' : 'test',
        test: {
          question:
            hasFace === true
              ? `Does ${label}'s face survive at this framing?`
              : `Does ${label} stay recognisable at this framing?`,
          params: SCREEN_TEST,
          refKeys: [slot.key],
          focus: 'identity',
        },
      });
    }

    // The trading-card lesson. Not one of the eleven numbered rules, but it cost the project a
    // render and the dossier has a dedicated enum value for it.
    if (dossier.medium === 'trading-card') {
      add({
        id: `card-reproduced:${slot.key}`,
        rule: 11,
        severity: 'hazard',
        what: `${label} is a trading card. Handed over whole, the CARD is what gets reproduced.`,
        evidence: { key: slot.key, medium: dossier.medium, burnedInText: dossier.burnedInText || null },
        measured:
          'The hero\'s ape token is a card on which the character is about a sixth of the frame, ' +
          'behind a neon border and a wall of type. It only rendered correctly once it was cropped ' +
          'to a head.',
        fix: 'crop-then-test',
        test: {
          question: `Does ${label} render as the character, or as the card it is printed on?`,
          params: SCREEN_TEST,
          refKeys: [slot.key],
          focus: 'identity',
        },
      });
    }

    // Rule 10. FLAT 2D ART MUST BE DIMENSIONALISED.
    if (dossier.medium === 'flat-2d-vector') {
      add({
        id: `flat-art:${slot.key}`,
        rule: 10,
        severity: 'hazard',
        what: `${label} is flat vector art, and renders as a sticker unless the script makes it a physical object.`,
        evidence: { key: slot.key, medium: dossier.medium },
        measured:
          'Vector artwork rendered as-is comes out a sticker. The hero prompted its flat 2D crowd ' +
          'as toy-like 3D figures on purpose, and that is the only reason they read as being in ' +
          'the world.',
        fix: 'rewrite-then-test',
        test: {
          question: `Does ${label} read as a physical object in the scene rather than a flat sticker?`,
          params: SCREEN_TEST,
          refKeys: [slot.key],
          focus: 'dimensionality',
        },
      });
    }

    // Rule 7. GUARD THE MANNEQUINS — and only where there IS one. The dossier is explicit that
    // getting isMannequin wrong on a character is actively harmful, because the guard strips fur
    // off an animal, so this fires on the flag and never on a guess.
    if (dossier.isMannequin && !/ordinary skin|not a mannequin|not a chrome/i.test(String(spec?.guard ?? ''))) {
      add({
        id: `mannequin-unguarded:${slot.key}`,
        rule: 7,
        severity: 'hazard',
        what: `${label} is a garment on a form, and nothing in the guard block says the wearer has ordinary skin.`,
        evidence: { key: slot.key },
        measured:
          'Without an explicit "ordinary skin, not a mannequin" line the chrome is the most salient ' +
          'thing in the reference and comes along into the render. Probe P4 proved the guard works.',
        fix: 'rewrite',
        test: null,
      });
    }

    // Rule 8. FORBID ADDED TYPE, NOT PRINTED TYPE. The contradiction is the risk: artwork that
    // legitimately carries print, against a grade block that bans text outright.
    if (dossier.burnedInText && /\bno text\b|no lettering|no signage anywhere/i.test(String(spec?.grade ?? ''))) {
      add({
        id: `type-ban-contradiction:${slot.key}`,
        rule: 8,
        severity: 'note',
        what: `${label} legitimately carries printed text ("${String(dossier.burnedInText).slice(0, 40)}"), but the grade bans text outright.`,
        evidence: { key: slot.key, burnedInText: dossier.burnedInText },
        measured:
          '"No text anywhere" fights the artwork itself — a cap with a number on it, a monogram. ' +
          'The thing worth forbidding is ADDED type: captions, subtitles, watermarks, added signage.',
        fix: 'rewrite',
        test: null,
      });
    }
  }

  // ── Anything the preflight measured. Already priced at zero; it is arithmetic, not a render. ──
  for (const violation of preflight?.violations ?? []) {
    if (violation.code === 'reference-face-at-risk') continue; // already raised, with more context
    add({
      id: `preflight:${violation.code}:${violation.key ?? 'set'}`,
      rule: 4,
      severity: violation.severity === 'floor' ? 'floor' : 'hazard',
      what: violation.detail,
      evidence: { key: violation.key, code: violation.code },
      measured:
        'H3 reports an illegal reference only AFTER the task has queued, and a queued task has ' +
        'been billed. Measured locally instead, for nothing.',
      fix: violation.code === 'reference-bad-aspect' ? 'crop' : 'trim-cast',
      test: null,
    });
  }

  // Mark what the visitor said they care about, then order: what blocks the shoot, then what
  // they asked to be sure of, then everything else. Elevation reorders and nothing more.
  for (const risk of risks) risk.elevatedBy = elevatedBy(risk, mustHold);

  const order = { floor: 0, hazard: 1, note: 2 };
  risks.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      Number(Boolean(b.elevatedBy)) - Number(Boolean(a.elevatedBy)),
  );

  return {
    risks,
    // What it would cost to settle everything that can only be settled by rendering. The
    // Director proposes a SUBSET of this; showing the ceiling first is what makes the subset
    // read as a decision rather than an upsell.
    testableUsd: Math.round(risks.reduce((sum, risk) => sum + risk.estUsd, 0) * 100) / 100,
    blocking: risks.filter((risk) => risk.severity === 'floor'),
    elevated: risks.filter((risk) => risk.elevatedBy),
    free: risks.filter((risk) => !risk.test),
  };
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
