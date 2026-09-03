import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import HeroBackdrop from '../../HeroBackdrop';
import { cn } from '../../../lib/cn';

const LoginPanel = ({ id, className }) => {
  const { signInWithOtp, verifyOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email'); // 'email' or 'otp'
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    const { error } = await signInWithOtp(email);
    if (!error) {
      setMsg('OTP sent to your email!');
      setStep('otp');
    } else {
      setMsg('Error: ' + error.message);
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    const { error } = await verifyOtp(email, otp);
    if (error) {
      setMsg('Error: ' + error.message);
    }
    setLoading(false);
  };

  return (
    <div id={id} className={cn("flex-1 min-h-0 flex flex-col relative overflow-hidden bg-black/40 rounded-xl border border-white/10", className)}>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        
        {/* Left Side: Login Form */}
        <div className="w-full md:w-1/2 p-6 flex flex-col justify-center items-center z-10 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-sm">
            <h3 className="text-2xl font-bold text-white mb-2">Sign In</h3>
            <p className="text-sm text-slate-400 mb-6">Sign in to save your projects and tasks across devices.</p>
            {msg && <div className="mb-4 text-xs text-purple-300">{msg}</div>}
            
            {step === 'email' ? (
              <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                  required
                />
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white rounded-lg px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">{email}</span>
                  <button type="button" onClick={() => setStep('email')} className="text-purple-400 hover:text-purple-300">Change</button>
                </div>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit OTP"
                  className="w-full rounded-lg bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500 tracking-widest text-center"
                  required
                />
                <button
                  type="submit"
                  disabled={loading || !otp}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white rounded-lg px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify OTP'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Right Side: Media Backdrop */}
        <div className="hidden md:block md:w-1/2 relative min-h-[200px]">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-[75%] h-[75%]">
              <HeroBackdrop className="rounded-[2rem] shadow-2xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPanel;
