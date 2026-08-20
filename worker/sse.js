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
 */
export const sseResponse = (run) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emit = (type, data) =>
    writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

  // Deliberately not awaited: the Response has to be returned immediately or the client
  // sees nothing until the work is done, which is the entire problem being solved.
  (async () => {
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
