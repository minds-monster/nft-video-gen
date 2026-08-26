import { useEffect, useState } from 'react';

const TIERS = [
  { value: 1, label: '$1.00', title: 'Starter', desc: 'Test drive storyboarding' },
  { value: 5, label: '$5.00', title: 'Popular', desc: 'A few short video drafts' },
  { value: 20, label: '$20.00', title: 'Recommended', desc: 'Complete high-quality storyboard', recommended: true },
  { value: 50, label: '$50.00', title: 'Pro', desc: 'Heavy production with GPT-5.6-Sol' },
];

const CheckoutModal = ({ isOpen, onClose, onConfirm }) => {
  const [selectedAmount, setSelectedAmount] = useState(20); // Default to $20 recommended tier
  const [customAmount, setCustomAmount] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentTotal = isCustomMode ? Number(customAmount) || 0 : selectedAmount;
  const isProceedDisabled = currentTotal < 1 || currentTotal > 1000;

  const handleSelectTier = (val) => {
    setIsCustomMode(false);
    setSelectedAmount(val);
  };

  const handleCustomChange = (val) => {
    setIsCustomMode(true);
    setCustomAmount(val);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isProceedDisabled) return;
    onConfirm(currentTotal);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      {/* Backdrop click close handler */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-slate-900/90 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-scale-up">
        {/* Glow Effects */}
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-6 top-6 text-slate-400 hover:text-white transition-colors"
          aria-label="Close modal"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-extrabold text-white tracking-tight">Choose Your Storyboard Budget</h2>
          <p className="mt-2 text-sm text-slate-400">
            Allocate video credits to your project. Credits never expire and go directly toward high-fidelity storyboard generation.
          </p>
        </div>

        {/* Tiers Grid */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            {TIERS.map((tier) => (
              <button
                key={tier.value}
                type="button"
                onClick={() => handleSelectTier(tier.value)}
                className={`relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200 ${
                  !isCustomMode && selectedAmount === tier.value
                    ? 'border-purple-500 bg-purple-600/10 ring-1 ring-purple-500'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                }`}
              >
                {tier.recommended && (
                  <span className="absolute right-3 top-3 bg-purple-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white rounded-full">
                    Best Value
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{tier.title}</span>
                <span className="mt-1 text-2xl font-extrabold text-white">{tier.label}</span>
                <span className="mt-1 text-[11px] text-slate-400 leading-tight">{tier.desc}</span>
              </button>
            ))}
          </div>

          {/* Custom Input */}
          <div className={`rounded-2xl border p-4 transition-all duration-200 ${
            isCustomMode
              ? 'border-purple-500 bg-purple-600/10 ring-1 ring-purple-500'
              : 'border-white/10 bg-white/5 hover:border-white/20'
          }`}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Top-up</label>
              {isCustomMode && <span className="text-[10px] text-purple-400 font-medium">Active</span>}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-2xl font-bold text-white">$</span>
              <input
                type="number"
                min="1"
                max="1000"
                placeholder="Enter custom amount"
                value={customAmount}
                onChange={(e) => handleCustomChange(e.target.value)}
                className="w-full bg-transparent text-xl font-bold text-white outline-none placeholder-slate-600"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">Min $1.00 · Max $1,000.00 USD</p>
          </div>

          {/* Action Button & Secure info */}
          <div className="space-y-4 pt-2">
            <button
              type="submit"
              disabled={isProceedDisabled}
              className="w-full py-4 rounded-2xl bg-purple-600 text-sm font-semibold text-white hover:bg-purple-500 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(168,85,247,0.35)]"
            >
              Proceed to Checkout (${currentTotal.toFixed(2)})
            </button>

            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <svg className="h-3.5 w-3.5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span>Secure checkout powered by </span>
              <span className="font-bold text-slate-400">stripe</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CheckoutModal;
