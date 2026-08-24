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
 */
export const sseResponse = (run, ctx) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;

  /** Best-effort. Returns whether the client actually received it, for callers that care. */
  const emit = async (type, data) => {
    if (clientGone) return false;
    try {
      await writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      return true;
    } catch {
      clientGone = true;
      return false;
    }
  };

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
