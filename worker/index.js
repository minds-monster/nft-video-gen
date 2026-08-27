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

async function handleSubscribe(request, env) {
  try {
    const { email } = await request.json();
    if (!email || !email.includes('@')) {
      return json({ error: 'Invalid email address' }, 400);
    }
    if (env.MIND_CONNECTIONS) {
      await env.MIND_CONNECTIONS.put(`subscriber:${email.trim().toLowerCase()}`, new Date().toISOString());
    }
    return json({ success: true });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
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
};

export default {
  async queue(batch, env, ctx) {
    // One Worker, two queues. `batch.queue` is the only thing that says which, and getting it
    // wrong would hand a director message to the storyboarder's handler, which would not find a
    // storyboard job and would ack it — losing a paid render silently.
    if (batch.queue === 'director-jobs') return handleDirectorQueue(batch, env, ctx);
    return handleStoryboardQueue(batch, env, ctx);
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
