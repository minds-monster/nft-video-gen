// Server-sent events, for endpoints that talk while they work.
//
// The alternative was returning JSON at the end, and that is what the first cut did — but a
// cold cast takes 50-80 seconds, and the honest fix for a wait that long is to show the work
// rather than to hide it behind a spinner. What these endpoints stream is the model's own
// reasoning channel, which is genuinely the thing being waited for.
//
// Not EventSource on the client, despite the format: EventSource is GET-only and these
// endpoints take a cast and a prompt in the body. The client reads the response stream by
// hand instead — same wire format, and it gets AbortController for free.

/**
 * Wrap a generator-shaped handler in an SSE response.
 *
 * `run` is called with an `emit(type, data)` it can await. Anything it throws becomes a
 * terminal `error` event rather than a dead connection, so the UI can say what went wrong
 * instead of just stopping.
 *
 * A CLOSED TAB MUST NOT DESTROY FINISHED WORK. Two guarantees, both added 2026-08-25 after a
 * real visitor lost a completed film by closing the page while it generated:
 *
 *   1. **`emit` never throws.** Writing to a hung-up client used to reject, and that rejection
 *      propagated out of the handler and skipped everything after it — including the KV write
 *      that was the only durable copy of the work. A dead client is now a no-op, so the handler
 *      runs to completion and persists what it produced. The spend had already been recorded, so
 *      the failure mode was the worst possible shape: charged for, generated, and discarded.
 *   2. **`ctx.waitUntil` keeps the work alive.** Without it the runtime is free to cancel the
 *      whole invocation the moment the response stream is abandoned, which can kill a
 *      four-minute model call seconds before it would have been saved.
 *
 * Callers whose work is worth keeping should pass `ctx`. Callers whose output is only meaningful
 * live (a chat reply nobody is reading any more) can leave it out.
 *
 * NOT EVERY WRITE IS WORTH THE SAME, and conflating them is one of two ways a cast member ended
 * up marked unreadable on 2026-08-25 while its finished dossier sat in KV. What was MEASURED that
 * day is the mismatch itself: three pieces reported "/api/casting ended without a result" — which
 * only happens when a stream closes carrying neither `result` nor `error` — and all three had
 * complete, valid v5 dossiers, one of which the running Worker served from cache instantly when
 * asked again. So the work finished and the delivery did not.
 *
 * The mechanism was not pinned to one of the two candidates, and both are closed here. The first
 * is this latch: `emit` kept a single `clientGone` flag that ANY failed write set, after which
 * every later write — including the terminal `result` — was a silent no-op. The Casting Director
 * fires HUNDREDS of un-awaited `delta` writes per run, so one transient failure in that firehose
 * was enough. The second is a plain truncation by something in the path, which the heartbeat
 * below addresses.
 *
 * So the rule is now inverted, and the inversion is the load-bearing part. Rather than listing
 * which frames are allowed to fail — a list that was wrong within a day, because it named the
 * Casting Director's `delta` and not the Storyboarder's `reasoning`, `ghost` or `heartbeat` —
 * only the TERMINAL frames may conclude anything from a failed write. Everything else is progress
 * narration: attempted, logged if it fails, and never permitted to silence what comes after.
 *
 * That way a new progress event added later is safe by default. Under the old shape it would have
 * been treated as terminal and could latch; the cost of the new shape is only that a genuinely
 * dead client keeps getting cheap write attempts that fail fast, which is a much better trade
 * than losing a finished film to a dropped heartbeat.
 */

/** The frames that ARE the answer. Only these may conclude the client is gone. */
const TERMINAL = new Set(['result', 'error']);

/** How often to write a keep-alive comment. See the heartbeat note below. */
const HEARTBEAT_MS = 15_000;

export const sseResponse = (run, ctx) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;
  let warned = false;

  /** One place that knows the wire format, so the heartbeat and the events cannot drift. */
  const write = (frame) => writer.write(encoder.encode(frame));

  /** Said once per stream. A silently swallowed write failure is why this bug took a session
   * to find rather than a log line. */
  const note = (type, error) => {
    if (warned) return;
    warned = true;
    console.warn(`SSE write failed on "${type}":`, error?.message ?? error);
  };

  /** Best-effort. Returns whether the client actually received it, for callers that care. */
  const emit = async (type, data) => {
    const terminal = TERMINAL.has(type);
    // A terminal frame is always attempted, however the narration went. Progress frames skip
    // once the client is known gone, purely to stop a dead connection spinning a token loop.
    if (!terminal && clientGone) return false;
    try {
      await write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (error) {
      note(type, error);
      // Only a failed TERMINAL write proves anything. A failed reasoning token says nothing —
      // and acting as if it did is precisely what threw away finished dossiers and storyboards.
      if (terminal) clientGone = true;
      return false;
    }
  };

  // A LONG SILENCE IS INDISTINGUISHABLE FROM A DEAD CONNECTION, and something in the path
  // always eventually decides it is the second one. The Casting Director's formalising pass is
  // a forced tool call that cannot stream (see worker/nvidia.js), sitting on top of a retry
  // ladder that can sleep 15s at a time — so minutes can pass between two events with nothing on
  // the wire. A comment frame every 15s keeps the connection provably alive.
  //
  // Comments rather than a `heartbeat` event on purpose: both readers of this format already
  // ignore a frame with no `data:` line (src/services/swarm.js, scripts/backfill-profiles.mjs),
  // so this needed no client change and cannot be mistaken for content.
  const heartbeat = setInterval(() => {
    write(':hb\n\n').catch(() => {});
  }, HEARTBEAT_MS);

  // Deliberately not awaited: the Response has to be returned immediately or the client
  // sees nothing until the work is done, which is the entire problem being solved.
  const task = (async () => {
    try {
      await run(emit);
    } catch (error) {
      console.error('SSE handler failed:', error);
      try {
        await emit('error', {
          error: error?.message ?? 'Unknown error',
          // The free tier's ~40 RPM ceiling makes 429 an expected outcome, and the UI says
          // "busy" rather than "broken" for those.
          retryable: error?.status === 429,
        });
      } catch {
        // The client hung up mid-failure. Nothing left to tell.
      }
    } finally {
      clearInterval(heartbeat);
      await writer.close().catch(() => {});
    }
  })();

  // Survives the client hanging up, when the caller opted in.
  ctx?.waitUntil?.(task);

  return new Response(readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer would defeat the point. Vite's dev proxy is already told not to
      // (see the `/api` entry in vite.config.js); this covers nginx-alikes in front of prod.
      'x-accel-buffering': 'no',
    },
  });
};
