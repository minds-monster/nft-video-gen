import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildDraft,
  clearLocalDraft,
  currentDraft,
  draftToHookState,
  flushDraft,
  isEmptyDraft,
  readLocalDraft,
  setDraft,
  subscribeDraft,
} from '../lib/draftStore';
import { deleteDraft, getDraft as fetchServerDraft, putDraft } from '../services/mindConnect';

// Same cadence useMindChat uses for the production snapshot: the draft changes on every prompt
// keystroke and every cast edit, and the Worker does not need to hear about each one.
const SERVER_DEBOUNCE_MS = 4 * 1000;

/**
 * What a draft IS, for the purpose of "has the visitor changed anything since it came back":
 * the text and the identities, never the timestamp. Two snapshots of the same work built a
 * second apart must compare equal or every restore would count as an edit.
 */
const signature = (draft) =>
  draft
    ? JSON.stringify({
        prompt: draft.prompt,
        cast: draft.cast.map((entry) => entry.key),
        primaryKey: draft.primaryKey,
        stage: draft.stage,
        filmId: draft.filmId,
      })
    : null;

/**
 * Keeps the composer and the Screenwriter's state in the draft store (src/lib/draftStore.js), and
 * puts it back on the next page load — locally for everyone, and from the Worker for a connected
 * Mind. The one hook that knows the order these things have to happen in:
 *
 *   1. The local draft is read synchronously and restored on mount, before any effect that
 *      keys on "does this tab have a spec" gets to run with the wrong answer.
 *   2. When there is a session, the Worker's copy is fetched. It wins only when it is newer AND
 *      the visitor has not touched anything since the local restore; otherwise the local copy is
 *      what gets pushed up, which is also how a guest's draft follows them into a Mind connect.
 *   3. Only after that does the server sync start listening — a first-render empty snapshot
 *      must never race the fetch and delete the copy it was about to restore.
 *
 * `pending` is true until step 2 settles, and App.jsx uses it to hold off the one hydration that
 * would otherwise pull the Mind's LAST production into a tab whose own draft is about to land.
 */
export const useDraftPersistence = ({ composer, screenwriter, session }) => {
  const token = session?.token ?? null;
  const { restore: restoreComposer, clearComposition, prompt, cast, primaryKey } = composer;
  const { restore: restoreScreenwriter, reset: resetScreenwriter, stage, spec, writtenCast, caps } = screenwriter;

  const [local] = useState(() => readLocalDraft());
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState(() => !isEmptyDraft(local) || Boolean(token));
  // What was last put back, so an edit can be told apart from the restore's own re-render.
  const restoredSigRef = useRef(null);
  const editedRef = useRef(false);
  const syncReadyRef = useRef(false);

  const apply = useCallback(
    (draft) => {
      const state = draftToHookState(draft);
      if (!state) return;
      restoredSigRef.current = signature(draft);
      editedRef.current = false;
      setDraft(draft);
      restoreComposer(state.composer);
      restoreScreenwriter(state.screenwriter);
      setRestored(true);
    },
    [restoreComposer, restoreScreenwriter],
  );

  // The write path: every meaningful change becomes a snapshot. The store debounces the local
  // write; the server sync below applies its own, longer one.
  //
  // Declared BEFORE the restore effects on purpose — effects run in order, and this one fires on
  // the first render with the hooks' empty initial state. Run after the restore it would overwrite
  // the snapshot the restore just published and count the empty state as an edit. An empty
  // snapshot is never an edit: it is either the state before a restore or the state after "New
  // film", and neither is something a newer server copy should lose to.
  useEffect(() => {
    const draft = buildDraft({ prompt, cast, primaryKey, stage, spec, writtenCast, caps });
    if (draft && signature(draft) !== restoredSigRef.current) editedRef.current = true;
    setDraft(draft);
  }, [prompt, cast, primaryKey, stage, spec, writtenCast, caps]);

  // 1. The local copy, once.
  useEffect(() => {
    if (!isEmptyDraft(local)) apply(local);
    if (!token) {
      syncReadyRef.current = true;
      setPending(false);
    }
    // Mount only: `local` is a one-time read and `token` is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. The Worker's copy, whenever a session appears.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    syncReadyRef.current = false;
    setPending(true);

    (async () => {
      let server = null;
      try {
        server = await fetchServerDraft(token);
      } catch {
        // Unreachable or unauthorised: the local copy stands and the sync below retries later.
      }
      if (cancelled) return;

      const mine = currentDraft();
      const mineAt = isEmptyDraft(mine) ? 0 : mine.savedAt ?? 0;
      const serverAt = isEmptyDraft(server) ? 0 : server.savedAt ?? 0;

      if (serverAt > mineAt && !editedRef.current) {
        apply(server);
        flushDraft();
      } else if (mineAt > serverAt) {
        putDraft(token, mine).catch(() => {});
      }
    })().finally(() => {
      if (cancelled) return;
      syncReadyRef.current = true;
      setPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [token, apply]);

  // 3. The server sync, gated on the fetch above having settled.
  useEffect(() => {
    if (!token) return undefined;
    let timer = null;
    const push = (draft) => {
      if (!syncReadyRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const call = isEmptyDraft(draft) ? deleteDraft(token) : putDraft(token, draft);
        call.catch(() => {
          // Best-effort: the local copy is authoritative for this browser, and the next change
          // retries anyway.
        });
      }, SERVER_DEBOUNCE_MS);
    };
    const unsubscribe = subscribeDraft(push);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [token]);

  // Belt and braces for any navigation the checkout flush does not cover: a closed tab, a link
  // followed, a reload mid-debounce.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPageHide = () => flushDraft();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  /** The "New film" action: everything back to empty, here and on the Worker. */
  const startFresh = useCallback(() => {
    resetScreenwriter();
    clearComposition();
    clearLocalDraft();
    restoredSigRef.current = null;
    editedRef.current = false;
    setRestored(false);
    if (token) deleteDraft(token).catch(() => {});
  }, [resetScreenwriter, clearComposition, token]);

  return { pending, restored, startFresh };
};
