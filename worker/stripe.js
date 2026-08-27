import Stripe from 'stripe';
import { requireSession } from './session.js';

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });

function getStripeClient(env) {
    if (!env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY environment variable is not configured');
    }
    return new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: '2023-10-16', // Or your preferred version
        httpClient: Stripe.createFetchHttpClient(), // REQUIRED for Cloudflare Workers
    });
}

/**
 * POST /api/checkout
 * Initiates a Stripe Checkout session for $1.00.
 * Supports authenticated sessions (mindId) or anonymous checkouts (guestId).
 */
export async function handleStripeCheckout(request, env) {
    const session = await requireSession(request, env);
    const body = await request.json().catch(() => ({}));
    
    const mindId = session?.mindId || body.guestId;
    if (!mindId) return json({ error: 'Either session or guestId is required' }, 400);

    const stripe = getStripeClient(env);
    const origin = new URL(request.url).origin;

    const requestOptions = {};
    if (env.STRIPE_ACCOUNT_ID) {
        requestOptions.headers = {
            'Stripe-Context': env.STRIPE_ACCOUNT_ID,
        };
    }

    const amount = Math.max(1, Math.min(1000, Number(body.amount) || Number(body.quantity) || 1));

    try {
        const checkoutSession = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'minds.MONSTER Video Budget Top-up',
                            description: 'Budget for high-quality video generation',
                        },
                        unit_amount: Math.round(amount * 100), // dynamic amount in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            client_reference_id: mindId, // CRITICAL: This ties the payment back to the user's mindId or guestId
            success_url: `${origin}/?checkout=success`,
            cancel_url: `${origin}/?checkout=cancel`,
        }, requestOptions);

        return json({ url: checkoutSession.url });
    } catch (error) {
        console.error('Failed to create Stripe Checkout session:', error);
        return json({ error: error.message }, 500);
    }
}

/**
 * POST /api/webhook/stripe
 * Receives the Stripe payment confirmation and credits the user's budget.
 */
export async function handleStripeWebhook(request, env) {
    const stripe = getStripeClient(env);
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
        return json({ error: 'Missing stripe-signature header' }, 400);
    }

    let event;
    try {
        const rawBody = await request.text();
        // CRITICAL: Must use constructEventAsync on Cloudflare Workers to utilize Web Crypto
        event = await stripe.webhooks.constructEventAsync(
            rawBody,
            signature,
            env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return json({ error: `Webhook Error: ${err.message}` }, 400);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const checkoutSession = event.data.object;
        const sessionId = checkoutSession.id;
        const mindId = checkoutSession.client_reference_id;
        const amountTotalCents = checkoutSession.amount_total;

        if (!mindId) {
            console.warn('Webhook received checkout session without client_reference_id (mindId)');
            return json({ received: true });
        }

        const processedKey = `stripe_processed:${sessionId}`;

        try {
            // Check if this checkout session has already been processed to ensure idempotency
            const alreadyProcessed = await env.MIND_CONNECTIONS.get(processedKey);
            if (alreadyProcessed) {
                console.log(`Webhook checkout session ${sessionId} already processed. Skipping duplicate credit.`);
                return json({ received: true });
            }
        } catch (checkError) {
            console.error('Failed to check payment status in KV:', checkError);
            return json({ error: 'Database check failed' }, 500);
        }

        const dollarsPaid = amountTotalCents / 100;
        const budgetKey = `budget:${mindId}`;

        try {
            const existing = (await env.MIND_CONNECTIONS.get(budgetKey, 'json')) ?? null;
            const currentTotal = existing?.total ?? 0;
            const newTotal = currentTotal + dollarsPaid;

            const record = {
                total: newTotal,
                perRender: existing?.perRender ?? null,
                paidTier: true, // Turn on the paid tier model selection by default upon top-up
                setAt: Date.now(),
            };

            await env.MIND_CONNECTIONS.put(budgetKey, JSON.stringify(record));
            await env.MIND_CONNECTIONS.put(processedKey, 'true', { expirationTtl: 30 * 24 * 60 * 60 }); // Expire in 30 days

            console.log(`Successfully credited $${dollarsPaid} to mind:${mindId}. New total: $${newTotal}`);
        } catch (dbError) {
            console.error('Failed to write new budget to KV during webhook processing:', dbError);
            return json({ error: 'Database write failed' }, 500);
        }
    }

    return json({ received: true });
}

/**
 * POST /api/producer/claim-guest-budget
 * Transfer the budget from guestId to the authenticated session's mindId.
 */
export async function handleClaimGuestBudget(request, env) {
    const session = await requireSession(request, env);
    if (!session) return json({ error: 'unauthorized' }, 401);

    const { mindId } = session;
    const body = await request.json().catch(() => ({}));
    const guestId = body.guestId;
    if (!guestId) return json({ error: 'guestId required' }, 400);

    const guestBudgetKey = `budget:${guestId}`;
    const guestBudget = await env.MIND_CONNECTIONS.get(guestBudgetKey, 'json');

    if (guestBudget && guestBudget.total > 0) {
        const mindBudgetKey = `budget:${mindId}`;
        const existing = await env.MIND_CONNECTIONS.get(mindBudgetKey, 'json');
        const newTotal = (existing?.total ?? 0) + (guestBudget.total ?? 0);

        const record = {
            total: newTotal,
            perRender: existing?.perRender ?? null,
            paidTier: true, // Auto-enable paid tier on claim
            setAt: Date.now(),
        };

        await env.MIND_CONNECTIONS.put(mindBudgetKey, JSON.stringify(record));
        await env.MIND_CONNECTIONS.delete(guestBudgetKey);

        // Optional: transfer spent ledger if any
        const guestSpendKey = `spend:${guestId}`;
        const guestSpend = await env.MIND_CONNECTIONS.get(guestSpendKey, 'json');
        if (guestSpend) {
            const mindSpendKey = `spend:${mindId}`;
            const mindSpend = await env.MIND_CONNECTIONS.get(mindSpendKey, 'json');
            const mergedEvents = [...(mindSpend?.events ?? []), ...(guestSpend?.events ?? [])];
            await env.MIND_CONNECTIONS.put(mindSpendKey, JSON.stringify({
                events: mergedEvents,
                retiredSpentUsd: (mindSpend?.retiredSpentUsd ?? 0) + (guestSpend?.retiredSpentUsd ?? 0),
                thresholdsRelayed: mindSpend?.thresholdsRelayed ?? [],
            }));
            await env.MIND_CONNECTIONS.delete(guestSpendKey);
        }

        console.log(`Transferred $${guestBudget.total} budget from guest:${guestId} to mind:${mindId}`);
        return json({ claimed: true, budget: record });
    }

    return json({ claimed: false });
}
