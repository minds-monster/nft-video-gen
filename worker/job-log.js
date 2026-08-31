// The append-only event log a long-running job writes its progress to.
//
// Extracted from worker/storyboarder.js when the Director needed the same log over a different
// record. The ONLY thing that differed was where the record is persisted, so that is the only
// thing injected — `save` — and everything below it is the storyboarder's own hard-won behaviour,
// moved verbatim rather than rewritten.
//
// Read the doc comment on `createJobLogger` before touching any of it. It documents three
// separate ways KV was being misused at once, all of them silent, and the fix is the reason this
// log never reads itself back.
//
// ⚠️ THE DIRECTOR MUST NOT IMPORT THIS FROM worker/storyboarder.js, which is where it used to
// live. The whole premise of the Director is that the Storyboarder is OPTIONAL — a film can be
// shot straight from the screenplay — so a hard dependency pointing that way would be backwards.
// It also had a concrete bug: the logger persisted to `storyboard-job:<mindId>:<jobId>` whatever
// record it was handed, so every status the Director wrote landed on a storyboard job that did
// not exist, and a failed render silently stayed "queued" forever.

/**
 * Append-only event log for one generation job.
 *
 * REWRITTEN 2026-08-26 AFTER A VISITOR WATCHED A PASS SIT AT 18 MINUTES. Most of that wait was
 * not the model — it was this. The previous shape flushed every 250ms and each flush was a full
 * READ-MODIFY-WRITE of one KV key, which is unsound on KV in three separate ways at once:
 *
 *   1. **KV rate-limits writes to the same key to roughly one per second.** At 4 Hz most writes
 *      were throttled. The failure was caught and logged as "dropped progress narration" — but
 *      the batch had ALREADY been spliced off `pending` before the round trip, so those events
 *      were gone for good rather than retried.
 *   2. **The read-back could be up to 60 seconds stale.** KV `get` caches at the edge and there
 *      is no way to ask for less than that. Pushing a fresh batch onto a stale `events` array and
 *      writing it back OVERWRITES every event recorded in between. The log could go backwards.
 *   3. **Streaming multiplied both.** One reasoning delta per event, ~937 of them per film, each
 *      appended to a record rewritten in full on every flush.
 *
 * The fix is to stop reading. The Queue consumer is ONE continuous invocation that owns this job
 * for its whole life, so it can hold the authoritative record in memory and only ever write. No
 * read means no staleness window and no lost-batch race, and the write rate is something we
 * control rather than something we hope KV tolerates.
 *
 * THE LOG IS APPEND-ONLY AND NOTHING IS EVER REMOVED FROM THE MIDDLE, and that is load-bearing
 * rather than tidiness: the client resumes with `?lastEvent=N`, a positional INDEX into this
 * array (`handleStoryboardJobEvents`). Eliding an old event to save space would shift every index
 * after it and silently make a reconnecting client skip or replay. Growth is bounded by refusing
 * to append more NARRATION past a ceiling instead — indices stay stable, and the events that are
 * actually load-bearing (`plan`, `phase`, `frame`, `result`, `error`) are never refused.
 */
const JOB_FLUSH_MS = 1000;
const JOB_NARRATION_CAP = 300;
/** Liveness and narration. Droppable under pressure; everything else is the answer. */
const NARRATION = new Set(['reasoning', 'heartbeat']);

export function createJobLogger({ record, save }) {
  let pending = [];
  let flushTimer = null;
  let closed = false;
  let queue = Promise.resolve();
  let lastWriteAt = 0;
  let narrationCount = 0;
  let refusedNarration = 0;

  record.events = record.events ?? [];

  const enqueue = (fn) => {
    queue = queue.then(fn).catch(() => {});
    return queue;
  };

  /**
   * Consecutive reasoning deltas collapse into one event before they are appended.
   *
   * Exactly equivalent for the client, which concatenates deltas onto a rolling string either
   * way — but at a 1s flush this turns ~15 events into 1, and the log is the thing that has to
   * be rewritten in full on every write. Cheap, and it is the difference between a record that
   * grows to 900 entries and one that grows to 60.
   */
  const coalesce = (batch) => {
    const out = [];
    for (const event of batch) {
      const last = out[out.length - 1];
      if (event.type === 'reasoning' && last?.type === 'reasoning') {
        last.data = { delta: (last.data.delta ?? '') + (event.data.delta ?? ''), beatIndex: event.data.beatIndex };
        last.at = event.at;
        continue;
      }
      out.push({ ...event });
    }
    return out;
  };

  const write = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    record.events.push(...coalesce(batch));
    try {
      await save(record);
      lastWriteAt = Date.now();
    } catch (error) {
      // The batch is already IN the in-memory record, so nothing is lost — the next write
      // carries it. This is the whole point of not reading the record back: a failed write is a
      // delayed write rather than a hole in the log.
      console.warn(`Job ${record.jobId} event write failed (will retry on next flush):`, error.message);
    }
  };

  const scheduleFlush = () => {
    if (closed || flushTimer) return;
    // Never faster than KV's per-key write ceiling. Going faster does not make progress arrive
    // sooner; it makes it arrive as a 429 and not arrive at all.
    const wait = Math.max(0, JOB_FLUSH_MS - (Date.now() - lastWriteAt));
    flushTimer = setTimeout(() => {
      flushTimer = null;
      enqueue(write);
    }, wait);
  };

  return {
    log: (type, data) => {
      if (closed) return;
      if (NARRATION.has(type)) {
        if (narrationCount >= JOB_NARRATION_CAP) {
          refusedNarration += 1;
          return;
        }
        narrationCount += 1;
      }
      pending.push({ type, data, at: Date.now() });
      scheduleFlush();
    },
    /** Terminal events cannot wait for the throttle — losing a `result` is the one failure this
     * whole file exists to prevent. */
    flush: () => enqueue(write),
    setStatus: (status, extra = {}) =>
      enqueue(async () => {
        record.status = status;
        Object.assign(record, extra);
        if (refusedNarration) record.refusedNarration = refusedNarration;
        // Status changes ride along with whatever is pending, so a terminal status and the events
        // that explain it land in the same write.
        record.events.push(...coalesce(pending.splice(0)));
        try {
          await save(record);
          lastWriteAt = Date.now();
        } catch (error) {
          console.warn(`Job ${record.jobId} status write failed:`, error.message);
        }
      }),
    close: () => {
      closed = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      return enqueue(write);
    },
  };
}
