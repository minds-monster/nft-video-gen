// The API half of the app. The other half is `dist/`, served as static assets by the
// same deploy — see the `assets` block in wrangler.jsonc.
//
// This exists because the SPA cannot make these calls itself. Vite inlines every VITE_
// variable into the client bundle (.env.example warns about exactly that), so an NVIDIA
// key put anywhere the browser can reach it is a published key; and
// integrate.api.nvidia.com sends no CORS headers to a browser origin anyway. Same two
// reasons the Minds API is proxied through the dev server in vite.config.js — this is
// that idea, made to work in production too.

import { castPiece } from './casting-director.js';
import { handleCastArt, handleCastList } from './cast-art.js';
import { handleCastMesh, handleCastMeshGenerate } from './mesh.js';
import { screenwrite } from './screenwriter.js';
import { handleSubscribe } from './subscribe.js';
import { handlePrevisDossierReview } from './previs-supervisor.js';
import { handleConnectInit, handleConnectStatus } from './connect.js';
import { mindChatInit, mindChatSend, mindChatPoll } from './mind-chat.js';
import { handleAssistantMessage, handleAssistantHistory, handleAssistantStatus } from './assistant.js';
import { handleBudgetSet } from './budget.js';
import { handleProducerState } from './producer-state.js';
import { handleStripeCheckout, handleStripeWebhook, handleClaimGuestBudget } from './stripe.js';
import {
  handleDirectorPlan,
  handleDirectorStart,
  handleDirectorApprove,
  handleDirectorJobStatus,
  handleDirectorJobEvents,
  handleDirectorGet,
  handleDirectorMedia,
  handleDirectorClose,
  handleDirectorRemember,
  handleDirectorTest,
  handleDirectorVerdict,
  handleDirectorBrief,
  handleDirectorAssess,
} from './director.js';
import { handleDirectorQueue } from './director-job.js';
import {
  handleStoryboard,
  handleStoryboardSketch,
  handleStoryboardGet,
  handleStoryboardImage,
  handleStoryboardPlan,
  handleStoryboardBeatRegenerate,
  handleStoryboardBeatOverride,
  handleStoryboardJobStatus,
  handleStoryboardJobEvents,
  handleStoryboardQueue,
} from './storyboarder.js';
import { handleSupportSubmit, handleSupportReply, handleSupportTicket } from './support.js';
import { syncOpenTickets } from './support-sync.js';
import { handleOwnerLogin, isOwnerConfigured } from './owner-auth.js';
import {
  handleOwnerSupportList,
  handleOwnerSupportStats,
  handleOwnerSupportGet,
  handleOwnerSupportNote,
  handleOwnerOverview,
  handleOwnerMind,
  refreshMindSnapshot,
} from './owner.js';
import { handleAnalyticsEvent, rollupDay, dayOf, isAnalyticsReadable } from './analytics.js';
import { isMailerConfigured } from './email.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

// Surfaced to the client so a rate-limited run can say so, rather than reading as a bug.
// The Zero Budget's ~40 RPM ceiling makes 429 an expected outcome, not an exceptional one.
const failure = (error) => {
  const status = error?.status === 429 ? 429 : 500;
  return json({ error: error?.message ?? 'Unknown error', retryable: status === 429 }, status);
};

const ROUTES = {
  'POST /api/casting': castPiece,
  'POST /api/screenwriter': screenwrite,
  'POST /api/previs/dossier': handlePrevisDossierReview,
  'POST /api/connect/init': handleConnectInit,
  'GET /api/connect/status': handleConnectStatus,
  'POST /api/mind/init': mindChatInit,
  'POST /api/mind/send': mindChatSend,
  'GET /api/mind/poll': mindChatPoll,
  'POST /api/assistant/message': handleAssistantMessage,
  'GET /api/assistant/history': handleAssistantHistory,
  'GET /api/assistant/status': handleAssistantStatus,
  'POST /api/producer/budget': handleBudgetSet,
  'POST /api/producer/state': handleProducerState,
  'POST /api/producer/claim-guest-budget': handleClaimGuestBudget,
  'POST /api/checkout': handleStripeCheckout,
  'POST /api/webhook/stripe': handleStripeWebhook,
  // POST rather than GET despite changing nothing: the whole spec and cast travel in the body,
  // exactly as /api/storyboard/sketch does. Spends nothing and never queues a task — it reports
  // what WOULD be sent, what it would cost, and what is already known to be wrong with it.
  'POST /api/director/plan': handleDirectorPlan,
  'POST /api/director/start': handleDirectorStart,
  'POST /api/director/approve': handleDirectorApprove,
  'POST /api/director/close': handleDirectorClose,
  // Pin an existing take and put it in the Mind's filmography — for footage shot before the
  // filmography existed, or a Mind that needs reminding.
  'POST /api/director/remember': handleDirectorRemember,
  'POST /api/director/test': handleDirectorTest,
  'POST /api/director/verdict': handleDirectorVerdict,
  'POST /api/director/brief': handleDirectorBrief,
  'POST /api/director/assess': handleDirectorAssess,
  'GET /api/director': handleDirectorGet,
  // Same-origin and signed in the query string, because <video src> cannot send a header.
  'GET /api/director/media': handleDirectorMedia,
  'GET /api/storyboard/plan': handleStoryboardPlan,
  'POST /api/storyboard': handleStoryboard,
  'POST /api/storyboard/beat/regenerate': handleStoryboardBeatRegenerate,
  'POST /api/storyboard/beat/override': handleStoryboardBeatOverride,
  'POST /api/storyboard/sketch': handleStoryboardSketch,
  'GET /api/storyboard': handleStoryboardGet,
  'GET /api/storyboard/image': handleStoryboardImage,
  // Same-origin so the renderer can READ these pixels — see worker/cast-art.js's header.
  'GET /api/cast/art': handleCastArt,
  'GET /api/cast/list': handleCastList,
  // A mesh, or an honest account of why this piece does not get one — see worker/mesh.js.
  'GET /api/cast/mesh': handleCastMesh,
  'POST /api/cast/mesh': handleCastMeshGenerate,
  'POST /api/subscribe': handleSubscribe,
  // Support — public intake and the visitor's own signed view of one ticket. See worker/support.js.
  'POST /api/support': handleSupportSubmit,
  'POST /api/support/reply': handleSupportReply,
  'GET /api/support/ticket': handleSupportTicket,
  // Analytics — a closed allowlist of browser events; everything else is recorded server-side.
  'POST /api/analytics/event': handleAnalyticsEvent,
  // The owner area. Every route below the login asserts an owner-kind token (worker/owner-auth.js).
  'POST /api/owner/login': handleOwnerLogin,
  'GET /api/owner/support': handleOwnerSupportList,
  // Flat rather than /api/owner/support/stats, so the id branch below can never mistake it for a ticket.
  'GET /api/owner/support-stats': handleOwnerSupportStats,
  'GET /api/owner/overview': handleOwnerOverview,
  'GET /api/owner/mind': handleOwnerMind,
};

// The two cron expressions in wrangler.jsonc, matched by string. A cron that is not one of
// these runs nothing, loudly — a silent no-op is how a renamed schedule stops the emails.
const CRON_SYNC = '*/5 * * * *';
const CRON_NIGHTLY = '0 3 * * *';

export default {
  async queue(batch, env, ctx) {
    // One Worker, two queues. `batch.queue` is the only thing that says which, and getting it
    // wrong would hand a director message to the storyboarder's handler, which would not find a
    // storyboard job and would ack it — losing a paid render silently.
    if (batch.queue === 'director-jobs') return handleDirectorQueue(batch, env, ctx);
    return handleStoryboardQueue(batch, env, ctx);
  },

  // Workers have no background timer. The support watcher (worker/support-sync.js) and the
  // analytics rollup (worker/analytics.js) run here, on the schedules in wrangler.jsonc.
  async scheduled(controller, env, ctx) {
    const cron = controller?.cron ?? CRON_SYNC;
    if (cron === CRON_SYNC) {
      const summary = await syncOpenTickets(env);
      console.log('support sync:', JSON.stringify(summary));
      return;
    }
    if (cron === CRON_NIGHTLY) {
      const yesterday = dayOf(new Date(Date.now() - 86_400_000));
      const rollup = isAnalyticsReadable(env)
        ? await rollupDay(env, yesterday).catch((error) => ({ error: error?.message ?? String(error) }))
        : { skipped: 'analytics_not_readable' };
      console.log('analytics rollup:', yesterday, JSON.stringify(rollup));
      ctx?.waitUntil?.(refreshMindSnapshot(env).catch((error) => console.warn('mind snapshot failed:', error?.message ?? error)));
      return;
    }
    console.warn(`scheduled: no job for cron "${cron}"`);
  },

  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      // Reports configuration, never values — enough to tell "the key is missing" apart
      // from "the model rejected the request", which are otherwise the same 500.
      return json({
        ok: true,
        hasNvidiaKey: Boolean(env.NVIDIA_API_KEY),
        hasAssistantApiKey: Boolean(env.ASSISTANT_API_KEY),
        hasMindsBuilderKey: Boolean(env.MINDS_BUILDER_API_KEY),
        hasSessionSecret: Boolean(env.SESSION_SIGNING_SECRET),
        hasDossierStore: Boolean(env.DOSSIERS),
        hasConnectionsStore: Boolean(env.MIND_CONNECTIONS),
        hasOpenAiKey: Boolean(env.OPENAI_API_KEY),
        hasStoryboardStore: Boolean(env.STORYBOARD_IMAGES),
        hasStoryboardQueue: Boolean(env.STORYBOARD_JOBS),
        // The Zero Budget storyboard tier's key. Distinct from OPENAI_API_KEY on purpose: a visitor
        // with no budget set still gets a storyboard, and this is the key that pays for it
        // (with time rather than money). Missing it means Zero Budget is dead, which is the
        // failure that looks like "the site is broken" to everyone who has not set a budget.
        hasOpenRouterKey: Boolean(env.OPENROUTER_API_KEY),
        // The Director's key, and the only one in this file that buys VIDEO rather than tokens.
        // Missing it means the render step is dead while every other agent still works, which
        // presents as "the last button does nothing" rather than as an outage — so it is worth a
        // line here. It lives in .dev.vars locally and `wrangler secret put MINIMAX_API_KEY` in
        // production; until this round it existed only in .env for the build-time scripts.
        hasMinimaxKey: Boolean(env.MINIMAX_API_KEY),
        // The pinning key. Missing it means finished takes still reach the Mind's filmography, but
        // with a 7-day link and no permanent ipfs:// address — degraded, not dead.
        hasPinataKey: Boolean(env.PINATA_JWT),
        // Support and the owner area. Each missing piece degrades one thing, visibly, rather than
        // failing the whole: no passphrase = no owner login; no mailer = replies measured but not
        // delivered; no analytics read token = the overview shows only lifetime seeds.
        hasOwnerPassphrase: isOwnerConfigured(env),
        hasResendKey: isMailerConfigured(env),
        hasSupportMind: Boolean(env.SUPPORT_MIND_ID),
        hasAnalyticsBinding: Boolean(env.ANALYTICS?.writeDataPoint),
        hasAnalyticsRead: isAnalyticsReadable(env),
        castingModel: env.CASTING_MODEL,
        screenwriterModel: env.SCREENWRITER_MODEL,
        storyboarderModel: env.STORYBOARDER_MODEL ?? 'gpt-5.6-sol (default)',
        freeStoryboardModel: env.FREE_STORYBOARD_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free (default)',
        hasAssistantModel: Boolean(env.ASSISTANT_MODEL),
      });
    }

    if (pathname.startsWith('/api/director/job/')) {
      const parts = pathname.split('/');
      const jobId = parts[4];
      if (request.method === 'GET' && jobId) {
        return parts[5] === 'events'
          ? handleDirectorJobEvents(request, env, ctx)
          : handleDirectorJobStatus(request, env);
      }
      return json({ error: `No route for ${request.method} ${pathname}` }, 404);
    }

    if (pathname.startsWith('/api/storyboard/job/')) {
      const parts = pathname.split('/');
      const jobId = parts[4];
      if (request.method === 'GET' && jobId) {
        if (parts[5] === 'events') {
          return handleStoryboardJobEvents(request, env, ctx);
        }
        return handleStoryboardJobStatus(request, env);
      }
      return json({ error: `No route for ${request.method} ${pathname}` }, 404);
    }

    // /api/owner/support/<ticketId>[/note] — the one owner path with an id segment.
    if (pathname.startsWith('/api/owner/support/')) {
      const parts = pathname.split('/');
      const ticketId = parts[4];
      if (ticketId && /^[a-z0-9]{4,16}$/i.test(ticketId)) {
        try {
          if (request.method === 'GET' && !parts[5]) return await handleOwnerSupportGet(request, env, ticketId);
          if (request.method === 'POST' && parts[5] === 'note') return await handleOwnerSupportNote(request, env, ticketId);
        } catch (error) {
          console.error(`${request.method} ${pathname} failed:`, error);
          return failure(error);
        }
      }
      return json({ error: `No route for ${request.method} ${pathname}` }, 404);
    }

    const handler = ROUTES[`${request.method} ${pathname}`];
    if (!handler) return json({ error: `No route for ${request.method} ${pathname}` }, 404);

    try {
      return await handler(request, env, ctx);
    } catch (error) {
      console.error(`${request.method} ${pathname} failed:`, error);
      return failure(error);
    }
  },
};
