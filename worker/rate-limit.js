// A KV-backed rate limit for PUBLIC, unauthenticated routes.
//
// worker/connect.js and worker/assistant.js keep their limits in module-level Maps, which is
// fine for routes a visitor reaches after a handshake: the Map resets whenever the isolate is
// evicted, and the cost of that is a few extra messages. A support form and an owner login
// are different — anyone on the internet can hit them, and a limit that forgets itself on
// every cold start is a limit that a burst walks straight through.
//
// KV's own limits shape this: the minimum TTL is 60 seconds and a read-modify-write is not
// atomic, so a genuine burst leaks a few requests over the cap before the count catches up.
// Acceptable for the two routes this guards; the Workers Rate Limiting binding is the upgrade
// if it ever is not.

const windowKey = (scope, id, windowSec) => `rl:${scope}:${id}:${Math.floor(Date.now() / 1000 / windowSec)}`;

/**
 * Count one hit against `scope:id` in the current window and say whether the cap is exceeded.
 * Never throws: a KV failure fails OPEN (returns false), because refusing every visitor when
 * the store hiccups is worse than letting a burst through once.
 */
export async function rateLimited(env, scope, id, { limit, windowSec }) {
  const store = env.MIND_CONNECTIONS;
  if (!store || !id) return false;
  const key = windowKey(scope, id, windowSec);
  try {
    const count = Number(await store.get(key)) || 0;
    if (count >= limit) return true;
    // TTL is the window plus a margin so a bucket outlives its own window and never has to
    // be reasoned about after; KV refuses anything under 60s.
    await store.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSec * 2) });
    return false;
  } catch (error) {
    console.warn(`Rate limit read/write failed for ${scope}:`, error?.message ?? error);
    return false;
  }
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';
