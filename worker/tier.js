// Which model writes the storyboard, how many beats it may write, and what that costs — decided
// BEFORE generation starts, never after.
//
// THREE INDEPENDENT INPUTS. Adam's round-8 read, and conflating any two of them is the mistake
// this file exists to prevent:
//
//   1. `budget.paidTier` — a checkbox. Selects the MODEL. Default false.
//   2. `budget.total` / `budget.perRender` — a spending CAP. Applies to both tiers equally.
//   3. "a budget exists at all" — Producer oversight ACTIVATION, the rule from the inbox round,
//      unchanged and deliberately untouched here. The Zero Budget tier with a budget still gets a
//      Producer watching it.
//
// The paid tier additionally REQUIRES a total, because spending real money with no ceiling is the
// exact failure mode this project's whole budget system was built to prevent. So the checkbox
// selects, the budget permits, and neither one alone can start paid generation.
//
// THE CAP IS ENFORCED AT THE OPEN, NOT AT THE END. A visitor with a six-beat spec on the free
// path is told at the open that this is a longer story than free covers — they never start a
// render they cannot finish. Same principle as the cost badge: visibility as information, not
// authority.

import { getBudget, getSpend } from './budget.js';
import { GPT5_MODEL, TOKEN_PRICES } from './openai.js';
import { FREE_FILM_MODEL, FREE_MAX_BEATS } from './openrouter.js';

/** Six is the Screenwriter's own ceiling (SHOT_SPEC_SCHEMA in worker/rulebook.js), and round 7's
 * paid failures were all on the six-beat fixture too — six subjects on a continuous travelling
 * camera is the hardest thing anything in this repo has been asked to do. */
export const PAID_MAX_BEATS = 6;

/**
 * Measured, not estimated, and reported as a real distribution rather than a comforting number —
 * Adam's rule for the wait surface: "a visitor who waits 4 minutes for a working product is
 * patient; a visitor who waits 4 minutes wondering if it's broken is not."
 *
 * Paid: round 7's whole-film runs, p50 194s / max 280s across 14 films on sol.
 * Free: 236s for a five-beat film in round 7, and 390s for the five-beat film run through this
 *   very code path on 2026-08-24. Two samples that far apart mean the honest thing to quote is a
 *   RANGE, so p50 sits between them and the ceiling is generous. Narrow this when there are more
 *   than two numbers behind it — do not narrow it because it looks better.
 */
export const LATENCY_SECONDS = { free: { p50: 330, max: 600 }, paid: { p50: 195, max: 300 } };

/** ~4.4k prompt + ~12k completion tokens for a whole film, from round 7's own ledger. An
 * estimate, and labelled as one everywhere it surfaces — the real figure is recorded from actual
 * token counts once the call returns, and recomputed at read time after that. */
const ESTIMATE_TOKENS = { promptTokens: 4500, completionTokens: 12000 };

export const estimateFilmUsd = (model) => {
  const price = TOKEN_PRICES[model];
  if (!price) return 0;
  return (ESTIMATE_TOKENS.promptTokens / 1e6) * price.in + (ESTIMATE_TOKENS.completionTokens / 1e6) * price.out;
};

/** Adam's copy, used verbatim. It frames the cap as a property of the story rather than of our
 * infrastructure, and it offers two legitimate options without implying either is the wrong one.
 * "Five beats free, six paid" is engineering language and the visitor would feel the seam. */
export const OVER_CAP_COPY =
  'This story runs a little longer than free allows. Want to trim a beat, or switch to paid to keep the full scene?';

/** The quiet always-on indicator. Duration, not beat count — same reason as above. */
export const TIER_LABEL = {
  free: 'Zero Budget · ~30-second scenes',
  paid: 'Paid tier · full scenes',
};

/**
 * Resolve everything a storyboard run needs to know about itself, and everything the visitor
 * needs to see before starting one.
 *
 * `downgraded` is a distinct state from "never chose paid", and keeping them distinct is the
 * point: a visitor whose budget ran dry mid-production gets told their remaining beats moved to
 * the free model, whereas a visitor who never ticked the box was never on paid at all. Collapsing
 * the two would make an exhausted budget look like a silent paid default, which is the exact
 * accusation this design exists to be able to refute.
 */
export async function resolveTier(env, mindId, beatCount = 0) {
  const budget = await getBudget(env, mindId);
  const spend = await getSpend(env, mindId);

  const wantsPaid = Boolean(budget?.paidTier);
  const hasCeiling = budget?.total != null;
  const remaining = hasCeiling ? budget.total - spend.totalSpent : null;
  const paidEstimate = estimateFilmUsd(GPT5_MODEL.sol);

  const affordable = remaining == null ? false : remaining >= paidEstimate;
  const tier = wantsPaid && hasCeiling && affordable ? 'paid' : 'free';

  let downgradeReason = null;
  if (wantsPaid && tier === 'free') {
    downgradeReason = !hasCeiling
      ? 'Paid generation needs a total budget set, so there is always a ceiling on it.'
      : `Paid generation needs about $${paidEstimate.toFixed(2)}, and $${Math.max(0, remaining).toFixed(2)} is left of the $${budget.total} cap. This scene runs on the free model instead.`;
  }

  const maxBeats = tier === 'paid' ? PAID_MAX_BEATS : FREE_MAX_BEATS;

  return {
    tier,
    model: tier === 'paid' ? (env.STORYBOARDER_MODEL ?? GPT5_MODEL.sol) : (env.FREE_STORYBOARD_MODEL ?? FREE_FILM_MODEL),
    effort: env.STORYBOARDER_EFFORT ?? 'high',
    maxBeats,
    beatCount,
    // The two numbers the visitor decides on, together, before anything runs.
    estimateUsd: tier === 'paid' ? paidEstimate : 0,
    estimateSeconds: LATENCY_SECONDS[tier].p50,
    label: TIER_LABEL[tier],
    overCap: beatCount > maxBeats,
    overCapCopy: beatCount > maxBeats && tier === 'free' ? OVER_CAP_COPY : null,
    downgraded: Boolean(downgradeReason),
    downgradeReason,
    budget,
    spentUsd: spend.totalSpent,
  };
}
