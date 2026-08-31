// The first third-party mailer in this repo, and the reason it exists is Adam's, not ours:
// "Site-relayed email, not my outbound." A visitor's support thread is with minds.monster,
// so the reply they get comes FROM minds.monster — one brand in their inbox, not a surprise
// `adam@hellominds.ai` — with SPF/DKIM discipline the site controls and a send the site can
// log, which is what lets the owner area say "this reply went out" instead of guessing.
//
// Resend over plain fetch (no SDK — a Worker has fetch, and the API is one POST). Needs:
//   RESEND_API_KEY   secret — `wrangler secret put RESEND_API_KEY`; .dev.vars locally
//   SUPPORT_FROM     var    — the sender, on a domain Resend has verified (SPF/DKIM DNS)
//
// Missing key is a DEGRADED state, never a crash: every caller gets `{ status:
// 'unconfigured' }` back, records it, and the owner area shows "not emailed — mailer
// unconfigured" beside the reply that should have gone. The site keeps measuring; it just
// cannot deliver yet.

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'minds.monster Support <support@minds.monster>';

export const isMailerConfigured = (env) => Boolean(env.RESEND_API_KEY);

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Plain text in, a minimal readable HTML alternative out. No template engine, no tracking. */
export const textToHtml = (text) =>
  `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111">${escapeHtml(text)
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 1em">${para.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;

/**
 * Send one email. Resolves to `{ status: 'sent', providerId }`, `{ status: 'unconfigured' }`,
 * or throws with the provider's message — callers decide whether a failure is fatal (an
 * owner notification never is; see worker/support.js).
 */
export async function sendEmail(env, { to, subject, text, html, replyTo, fetchImpl = fetch }) {
  if (!isMailerConfigured(env)) return { status: 'unconfigured' };
  if (!to || !subject) throw new Error('email_needs_to_and_subject');

  const response = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.SUPPORT_FROM || DEFAULT_FROM,
      to: [to],
      subject,
      text,
      html: html ?? textToHtml(text),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`resend_${response.status}: ${data?.message ?? data?.error ?? 'unknown error'}`);
  }
  return { status: 'sent', providerId: data?.id ?? null };
}
