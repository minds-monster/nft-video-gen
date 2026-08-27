// x402 payment terms, surfaced in the UI.
//
// These values mirror the sibling service at ../x402-nft-licensing
// (REQUIRED_AMOUNT_WEI in api/index.js — 0.0001 ETH on Base, paid directly to the
// NFT's current holder). Nothing here performs a request yet: this pass presents
// payment state and copy only. When the integration lands, `apiBase` is the
// single place the client needs to point at.
export const PAYMENT = {
  protocol: 'x402',
  chain: 'Base',
  token: '$TEST402',
  priceEth: '1',
  // Unused until the x402 integration lands — see .env.example.
  apiBase: import.meta.env.VITE_X402_API_BASE ?? '',
};

export const PAYMENT_STATUS = {
  PAYABLE: 'payable',
  PENDING: 'pending',
  DEMO: 'demo',
};

export const PAYMENT_COPY = {
  [PAYMENT_STATUS.PAYABLE]: {
    label: `Payable · ${PAYMENT.priceEth} ETH`,
    detail: `Payment settled on generation via ${PAYMENT.protocol} on ${PAYMENT.chain}. The fee goes to the piece's current holder.`,
  },
  [PAYMENT_STATUS.PENDING]: {
    label: 'Payment pending',
    detail: 'This brand is being onboarded. Its collection will be payable soon.',
  },
  [PAYMENT_STATUS.DEMO]: {
    label: 'Demo data',
    detail:
      'No Alchemy API key is configured, so these are placeholder pieces. Add VITE_ALCHEMY_API_KEY to load real collections.',
  },
};
