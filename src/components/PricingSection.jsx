import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

const PricingSection = ({ onConnectMind }) => {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (!email) return;
    setSubscribed(true);
    setEmail('');
  };

  return (
    <section id="pricing" className="relative bg-black/10 py-20 border-t border-white/5">
      {/* Glow effects in background */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-96 h-96 rounded-full bg-purple-900/10 blur-[120px]" />
        <div className="absolute top-1/2 left-3/4 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-900/5 blur-[120px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center">
          <h2 className="headline-monster headline-keyline text-3xl tracking-tight md:text-5xl">
            Simple Pricing
          </h2>
          <p className="mt-4 text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            Choose the workflow that fits your needs. Start draft-blocking for free, or power full-quality production with a connected Mind.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3 items-stretch">
          {/* Card 1: Zero Budget */}
          <div className="glass-panel flex flex-col justify-between rounded-3xl p-8 relative transition-all duration-300 hover:scale-[1.01] hover:border-white/20">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-200">Zero Budget</h3>
              </div>
              <p className="mt-4 text-3xl font-extrabold text-slate-200 tracking-tight">$0</p>
              <p className="mt-6 text-sm text-slate-400 leading-relaxed">
                You can do a lot with nothing... including refining an entire prompt you can feed into any video gen model. Feel free to copy paste away, just let us know how you get on!
              </p>
            </div>
            <div className="mt-8">
              <a
                href="#top"
                className="block w-full text-center chip py-3 text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/10"
              >
                Try now for free!
              </a>
            </div>
          </div>

          {/* Card 2: Budget with your mind (Featured Card!) */}
          <div className="glass-panel flex flex-col justify-between rounded-3xl p-8 relative border-purple-500/30 transition-all duration-300 hover:scale-[1.02] hover:border-purple-500/50 bg-slate-900/60 shadow-[0_14px_40px_-12px_rgb(var(--brand-rgb)/0.15)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-purple-600 text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full border border-purple-400/50 shadow-[0_0_12px_rgb(168_85_247_/_0.4)]">
                RECOMMENDED
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white">Budget with your mind</h3>
              </div>
              <p className="mt-4 text-3xl font-extrabold text-purple-400 tracking-tight">Scale as you grow</p>
              <p className="mt-6 text-sm text-slate-300 leading-relaxed">
                Work with your{' '}
                <a
                  href="https://hellominds.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 underline decoration-purple-500/50 underline-offset-4 hover:text-purple-300 transition-colors"
                >
                  mind
                </a>{' '}
                to determine a realistic budget for your project. You can get an awesome video together for less than a dollar when you&apos;ve got the right team.
              </p>
            </div>
            <div className="mt-8">
              <button
                type="button"
                onClick={onConnectMind}
                className="w-full text-center chip py-3 text-sm font-semibold text-white bg-purple-600/30 hover:bg-purple-600/50 border-purple-500/40 hover:border-purple-500/60 transition-all duration-200"
              >
                Start for a dollar
              </button>
            </div>
          </div>

          {/* Card 3: Subscriptions (Coming Soon) */}
          <div className="glass-panel flex flex-col justify-between rounded-3xl p-8 relative transition-all duration-300 hover:scale-[1.01] hover:border-white/20">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-400 flex items-center gap-2">
                  Subscriptions
                </h3>
                <span className="text-[9px] font-bold text-slate-500 border border-slate-500/30 px-2 py-0.5 rounded uppercase tracking-wider">
                  Coming soon
                </span>
              </div>
              <p className="mt-4 text-3xl font-extrabold text-slate-400 tracking-tight">—</p>
              <p className="mt-6 text-sm text-slate-500 leading-relaxed">
                A subscription with minds.MONSTER will save you money on your existing vid gen requirements. Compatible with local models and third party APIs.
              </p>
            </div>
            <div className="mt-8">
              {subscribed ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                  <Check className="w-4 h-4" /> Joined list!
                </div>
              ) : (
                <form onSubmit={handleSubscribe} className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="Enter email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                    className="chip px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10"
                  >
                    Join
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
