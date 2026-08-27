// Progress for a job that is running somewhere else.
//
// The work happens in a Queue consumer that owns its own invocation and writes an append-only log
// to KV. This is the other half: a lightweight SSE stream that POLLS that log and forwards it. It
// does no work of its own, holds nothing in memory, and can be dropped and reconnected freely —
// which is the entire point, because the failure this shape exists to prevent is a visitor's
// closed tab taking a paid render with it.
//
// TWO PROPERTIES ARE LOAD-BEARING AND BOTH LIVE IN THE CALLER'S LOG, NOT HERE:
//
//   1. The log is APPEND-ONLY and nothing is ever removed from the middle. `lastEvent` is a
//      positional index into it, so eliding an old event to save space would shift every index
//      after it and silently make a reconnecting client skip or replay.
//   2. Terminal events are never refused. `emit` returning false means the client has gone, and
//      that is a reason to stop polling — but a `result` or an `error` is the answer, and it is
//      written to the record regardless of whether anyone is listening.
//
// Extracted from worker/storyboarder.js when the Director needed the same stream over a different
// record. The only thing that actually differed was how the record is loaded, so that is the only
// thing this takes as a parameter.

import { sseResponse } from './sse.js';

/** The events that end a stream. Matches `TERMINAL` in worker/sse.js. */
export const TERMINAL_EVENT = new Set(['result', 'error']);

/** 2s poll × 15 rounds = 30 seconds of silence before the stream closes. The job keeps running;
 * the client reconnects with `lastEvent` and picks up exactly where it stopped. */
const POLL_MS = 2000;
const MAX_STAGNANT_ROUNDS = 15;

export function streamJobEvents(ctx, { loadRecord, lastEvent = 0, notFound = 'Job not found' }) {
  let start = Number(lastEvent);
  if (!Number.isFinite(start) || start < 0) start = 0;

  return sseResponse(async (emit) => {
    let sent = start;
    let stagnant = 0;

    while (stagnant < MAX_STAGNANT_ROUNDS) {
      const record = await loadRecord();
      if (!record) {
        await emit('error', { error: notFound });
        return;
      }

      const events = (record.events ?? []).slice(sent);
      for (const event of events) {
        const ok = await emit(event.type, event.data);
        sent += 1;
        stagnant = 0;
        // Client gone; stop spending KV polls on a connection nobody is reading. A terminal event
        // is still worth finishing, because it is what the record itself will be read for.
        if (!ok && !TERMINAL_EVENT.has(event.type)) return;
      }

      if (record.status === 'complete' || record.status === 'failed') {
        if (!events.length && !sent) {
          await emit('error', { error: record.error ?? 'Job finished with no events' });
        }
        return;
      }

      await new Promise((done) => setTimeout(done, POLL_MS));
      stagnant += 1;
    }
    // Closed after a long silence. The client reconnects if the job is still running.
  }, ctx);
}
