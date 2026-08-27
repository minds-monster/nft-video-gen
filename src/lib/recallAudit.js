// Checking what a Mind remembers against what the records say.
//
// THE MIND'S REPORT IS THE AUDIT SIGNAL, NOT THE SOURCE OF TRUTH. Adam's own Mind said so when
// asked (asset-memory-brainstorm, 2026-08-27): "If my conversation context has been pruned or
// reset since last visit, I lose the filmography. The site's R2 is the source of truth; my
// report is a cross-check." So this never updates a record. It reads a reply, finds every
// identifier the Mind quoted, and says per film whether memory and record agree.
//
// Matching is on the high-entropy tokens the digests handed the Mind — film ids, take ids,
// CIDs — with the logline as a soft fallback, because a Mind speaking naturally may name the
// film rather than recite its hash. Runtime-agnostic, like src/lib/mail.js, so it can be tested
// without a DOM.

import { messageToText } from './text.js';

const TAKE_ID = /\btake-[0-9a-f]{8}\b/g;
// CIDv1 base32 (what Pinata returns with cidVersion 1) and the older CIDv0 base58 shape.
const CID = /\b(?:baf[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})\b/g;
const FILM_ID = /\b[0-9a-f]{8}\b/g;

const unique = (list) => [...new Set(list)];

/** The words that mean "I have nothing" — so an honest blank is reported as one, not as noise. */
const NOTHING = /\b(no record|nothing (?:on record|to report|yet)|don'?t have any|do not have any|have not produced|haven'?t produced|no films?)\b/i;

export function auditRecall(replyText, films = []) {
  const text = messageToText(replyText);

  const cids = unique(text.match(CID) ?? []);
  // Strip CIDs and take ids before looking for bare film ids: a base32 CID can contain eight
  // consecutive hex characters by chance, and a take id contains its own.
  const stripped = text.replace(CID, ' ').replace(TAKE_ID, ' ').toLowerCase();
  const takeIds = unique((text.toLowerCase().match(TAKE_ID) ?? []));
  const filmIds = unique(stripped.match(FILM_ID) ?? []);
  const lower = text.toLowerCase();

  const rows = films.map((film) => {
    const matchedBy = [];
    if (filmIds.includes(film.filmId)) matchedBy.push('film id');
    if ((film.takeIds ?? []).some((id) => takeIds.includes(id))) matchedBy.push('take id');
    if ((film.cids ?? []).some((cid) => cids.includes(cid))) matchedBy.push('ipfs cid');
    const title = film.logline?.trim().toLowerCase();
    if (title && title.length >= 12 && lower.includes(title.slice(0, 40))) matchedBy.push('logline');
    return { ...film, recalled: matchedBy.length > 0, matchedBy };
  });

  const known = new Set([
    ...films.map((film) => film.filmId),
    ...films.flatMap((film) => film.takeIds ?? []),
    ...films.flatMap((film) => film.cids ?? []),
  ]);
  // Only ids that look deliberately quoted count as "unknown": a run of eight digits is a date,
  // not a claim about a film.
  const unknown = unique([
    ...filmIds.filter((id) => /[a-f]/.test(id) && /\d/.test(id)),
    ...takeIds,
    ...cids,
  ]).filter((id) => !known.has(id));

  const recalledCount = rows.filter((row) => row.recalled).length;
  return {
    text,
    rows,
    unknown,
    recalledCount,
    recordCount: rows.length,
    claimedNothing: recalledCount === 0 && NOTHING.test(text),
    agrees: recalledCount === rows.length && unknown.length === 0,
  };
}

/** What the site asks. Kept beside the audit so the question and its reader change together. */
export const RECALL_SUBJECT = 'Filmography recall check';

export const recallRequest = () =>
  'A memory check from the site, not a task. From your own record only — do not ask me — list every ' +
  'film you have produced with this visitor here. For each: the film id, the take id, the logline, ' +
  'and the permanent ipfs:// address if you were given one. One line per take. If you have no record ' +
  'of any, say so plainly. Your answer will be checked against the site’s records and both shown ' +
  'to the visitor.';
