import { Fragment } from 'react';
import { SUBJECT_TAG, subjectKey } from '../../lib/h3Script';
import { resolveNftThumb, resolveNftName } from '../../services/alchemy';

// The treatment's prose is written for a video model, not for a person: it refers to the cast
// as <Subject 1> and <Picture 2>, because that binding is what makes H3 put the right
// character in the right place (verified by probe P8). Shown raw it reads as broken markup.
//
// So the tags get resolved back into the artwork they point at. The scaffolding that makes
// the render work becomes the thing that makes the treatment readable — and it is the reason
// the cast arc stays on screen underneath, as the legend these chips refer to.

/** The piece a tag points at, or null when the Screenwriter numbered past its own plan. */
const resolve = (spec, cast, n) => {
  const key = subjectKey(spec, n);
  return key ? (cast?.find((entry) => entry.key === key) ?? null) : null;
};

const Chip = ({ entry, n }) => {
  // An unresolvable tag is left visible on purpose. Silently deleting it would hide a real
  // defect — a spec numbering a subject it never planned a reference slot for.
  if (!entry) {
    return (
      <span className="rounded bg-amber-400/15 px-1 py-0.5 font-mono text-[10px] text-amber-200">
        Subject {n}?
      </span>
    );
  }

  const thumb = resolveNftThumb(entry.nft);
  const name = resolveNftName(entry.nft);

  return (
    <span
      title={name}
      className="mx-0.5 inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-white/10 bg-white/[0.06] py-0.5 pl-0.5 pr-1.5 align-baseline"
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 rounded-sm bg-slate-800 bg-cover bg-center"
        style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
      />
      <span className="truncate text-xs font-medium text-slate-200">{name}</span>
    </span>
  );
};

/**
 * Prose with every `<Subject N>` / `<Picture N>` replaced by the piece it names.
 *
 * Falls back to plain text when there are no tags, which is most fields — only `staging` and
 * the beats routinely carry them.
 */
const SubjectText = ({ text, spec, cast }) => {
  if (!text) return null;

  // Fresh lastIndex per call: SUBJECT_TAG is a module-level /g regex, and split() with a
  // global regex is stateless but the shared object is not something to rely on.
  const parts = text.split(new RegExp(SUBJECT_TAG.source, 'g'));
  if (parts.length === 1) return text;

  // String.split with one capture group alternates: text, capture, text, capture, …
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <Chip key={index} n={Number(part)} entry={resolve(spec, cast, Number(part))} />
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
};

export default SubjectText;
