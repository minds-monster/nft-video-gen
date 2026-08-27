/**
 * How a take reads at a glance: the colour of its status, and the colour of its answer.
 *
 * These live outside the panels because a take is now shown in two places at once — as a card in
 * the timeline and playing large in the viewer — and a take that is amber on the card and green
 * in the viewer would be a bug nobody could see until they compared the two.
 */

/** Lifecycle of any take. `pending` reads as "running" because that is what it is doing. */
export const TAKE_STATUS = {
  ready: { label: 'ready', className: 'text-emerald-300' },
  failed: { label: 'failed', className: 'text-amber-300' },
  unsettled: { label: 'unsettled', className: 'text-amber-300' },
  pending: { label: 'running', className: 'text-purple-300' },
};

/** A screen test's verdict. Keyed by the answer ids in worker/screen-test.js. */
export const ANSWER_TONE = {
  held: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200',
  failed: 'border-amber-400/25 bg-amber-500/5 text-amber-200',
  unclear: 'border-white/10 bg-white/5 text-slate-300',
};

/** An unjudged test is money spent and nothing learned; it should not look neutral. */
export const UNANSWERED_TONE =
  'border-amber-400/25 bg-amber-500/5 text-amber-200';
