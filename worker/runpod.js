// The mesh path's transport: a serverless GPU endpoint, billed by the second.
//
// WHY THIS EXISTS AT ALL, given every other model in this build arrives over OpenRouter. Because
// image-to-3D does not. The full OpenRouter catalogue was searched for 3d/mesh/tripo/hunyuan3d/
// rodin/meshy and returned NOTHING — so unlike every other capability here, this one cannot be
// bought as an API call and has to be hosted.
//
// WHAT THE MESH IS FOR, which decides how this is judged. It is not a rendering upgrade that has
// to beat the impostor to justify itself. It is a product asset: the thing an x402 bundle sells,
// alongside the impostor, the Casting Director's notes and the ownership record. So the bar is
// not "does it look better than a cardboard cut-out" but "is it valid to sell as a portable,
// identity-bearing artifact someone downstream can rely on" — which is a question about
// correctness, not beauty. A mesh that loses a rendering comparison can still be a good asset; a
// mesh with invented geometry cannot, however good it looks.
//
// THE MEDIUM GATE IS ENFORCED ABOVE THIS MODULE, in the caller, and it is not negotiable: a piece
// whose medium does not admit volumetric reconstruction never reaches here. A flat 2D vector has
// no back, a reconstruction model will invent one, and an invented back shipped inside a bundle
// someone paid for is a fabrication wearing the source artwork's name.

/** RunPod bills cold start as well as execution — both arrive in the job status as milliseconds,
 * so cost is measurable per job rather than estimated per month. */
const RUN_URL = (endpointId, path) => `https://api.runpod.ai/v2/${endpointId}/${path}`;

export class RunPodError extends Error {
  constructor(status, message) {
    super(`RunPod ${status}: ${message}`);
    this.name = 'RunPodError';
    this.status = status;
    // A negative balance is the one failure worth naming separately: it is not a bug, it is an
    // account state, and it needs a person rather than a retry.
    this.outOfCredit = status === 402 || /balance|credit|payment/i.test(message);
  }
}

const requireConfig = (env) => {
  const apiKey = env.RUNPOD_API_KEY;
  const endpointId = env.RUNPOD_MESH_ENDPOINT_ID;
  if (!apiKey) throw new Error('RUNPOD_API_KEY is not set. Locally it lives in .env and .dev.vars; in production use `wrangler secret put`.');
  if (!endpointId) throw new Error('RUNPOD_MESH_ENDPOINT_ID is not set — no mesh endpoint has been deployed yet.');
  return { apiKey, endpointId };
};

/**
 * What a job actually cost.
 *
 * Both halves are billed and both are reported, because they behave completely differently:
 * execution scales with the work, and delay is cold start, which is paid once per worker
 * spin-up and then not at all until it scales back to zero. A per-piece cost quoted from warm
 * executions alone is a number that will be wrong in production, where a library backfilled
 * overnight pays cold start far more often than a busy afternoon does.
 */
export const jobCost = (status, usdPerSecond) => {
  const executionMs = status?.executionTime ?? 0;
  const delayMs = status?.delayTime ?? 0;
  return {
    executionSeconds: executionMs / 1000,
    coldStartSeconds: delayMs / 1000,
    costUsd: ((executionMs + delayMs) / 1000) * usdPerSecond,
  };
};

const POLL_INTERVAL_MS = 2000;

/**
 * One image in, one mesh out.
 *
 * Submitted with /run and polled rather than /runsync, deliberately. A cold worker has to pull a
 * multi-gigabyte container and load weights before it does any work at all, and runsync's request
 * timeout is shorter than that — so the synchronous call fails exactly when the endpoint has
 * scaled to zero, which for a per-asset job cached forever is most of the time.
 */
export const generateMesh = async (env, { imageDataUri, timeoutMs = 300_000, signal, onPhase } = {}) => {
  const { apiKey, endpointId } = requireConfig(env);
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const startedAt = Date.now();

  const submitted = await fetch(RUN_URL(endpointId, 'run'), {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ input: { image: imageDataUri } }),
  });
  if (!submitted.ok) throw new RunPodError(submitted.status, await submitted.text());
  const { id } = await submitted.json();
  if (!id) throw new RunPodError(502, 'the endpoint accepted the job but returned no id');

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      // Best effort: a job left running is a job still being billed.
      await fetch(RUN_URL(endpointId, `cancel/${id}`), { method: 'POST', headers }).catch(() => {});
      throw new RunPodError(504, `job ${id} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    }

    const polled = await fetch(RUN_URL(endpointId, `status/${id}`), { headers, signal });
    if (!polled.ok) throw new RunPodError(polled.status, await polled.text());
    const status = await polled.json();

    if (status.status === 'COMPLETED') return { id, output: status.output, status };
    if (status.status === 'FAILED') throw new RunPodError(500, status.error ?? 'the job failed with no reason given');
    if (status.status === 'CANCELLED') throw new RunPodError(499, 'the job was cancelled');

    onPhase?.({ status: status.status, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};

/** Whether the account can actually run anything, asked before a job rather than discovered
 * through one. A negative balance is why nothing has been deployed here yet. */
export const accountState = async (env) => {
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) return { ok: false, reason: 'RUNPOD_API_KEY is not set' };
  const response = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query { myself { clientBalance currentSpendPerHr } }' }),
  });
  if (!response.ok) return { ok: false, reason: `RunPod ${response.status}` };
  const me = (await response.json())?.data?.myself;
  const balance = me?.clientBalance ?? 0;
  return {
    ok: balance > 0,
    balanceUsd: balance,
    spendPerHrUsd: me?.currentSpendPerHr ?? 0,
    reason: balance > 0 ? null : `RunPod balance is $${balance.toFixed(4)} — workers will not run until the account is topped up.`,
  };
};
