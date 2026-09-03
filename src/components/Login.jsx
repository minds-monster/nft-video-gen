import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const { signInWithOtp, verifyOtp } = useAuth();

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    
    try {
      const { error } = await signInWithOtp(email);
      if (error) throw error;
      setMessage('OTP sent to your email!');
      setStep('otp');
    } catch (err) {
      setError(err.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    
    try {
      const { error } = await verifyOtp(email, otp);
      if (error) throw error;
    } catch (err) {
      setError(err.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-8 shadow-xl backdrop-blur-md">
        <h2 className="mb-6 text-2xl font-bold text-white">Sign In</h2>
        
        {message && (
          <div className="mb-4 rounded-lg bg-green-500/20 p-3 text-sm text-green-400">
            {message}
          </div>
        )}
        
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm text-slate-400">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-slate-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            
            <button
              type="submit"
              disabled={loading || !email}
              className={cn(
                "mt-2 flex w-full items-center justify-center rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500",
                "disabled:bg-purple-600/50 disabled:text-white/50"
              )}
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">{email}</span>
              <button type="button" onClick={() => setStep('email')} className="text-purple-400 hover:text-purple-300">Change</button>
            </div>
            <div>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                required
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-slate-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 tracking-widest text-center text-lg"
              />
            </div>
            
            <button
              type="submit"
              disabled={loading || !otp}
              className={cn(
                "mt-2 flex w-full items-center justify-center rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500",
                "disabled:bg-purple-600/50 disabled:text-white/50"
              )}
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify OTP'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
