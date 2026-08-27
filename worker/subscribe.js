// POST /api/subscribe — the "coming soon" mailing list. Moved out of worker/index.js, where
// it was the only handler defined inline (between the import statements), and given the
// rate limit it never had: it accepted unlimited anonymous writes into the same namespace
// that holds every visitor's budget.

import { rateLimited, clientIp } from './rate-limit.js';
import { record } from './analytics.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function handleSubscribe(request, env) {
  if (await rateLimited(env, 'subscribe', clientIp(request), { limit: 5, windowSec: 3600 })) {
    return json({ error: 'rate_limited' }, 429);
  }
  const { email } = await request.json().catch(() => ({}));
  if (typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return json({ error: 'Invalid email address' }, 400);
  }
  if (env.MIND_CONNECTIONS) {
    await env.MIND_CONNECTIONS.put(`subscriber:${email.trim().toLowerCase()}`, new Date().toISOString());
  }
  record(env, 'subscribe');
  return json({ success: true });
}
