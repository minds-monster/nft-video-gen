import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { ownerLogin } from '../services/owner';

const OwnerLogin = ({ onLogin }) => {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !passphrase) return;
    setBusy(true);
    setError(null);
    try {
      onLogin(await ownerLogin(passphrase));
    } catch (err) {
      setError(
        err.code === 'rate_limited'
          ? 'Too many attempts. Wait a minute.'
          : err.code === 'not_configured'
            ? 'OWNER_PASSPHRASE is not set on this deployment.'
            : 'That is not the passphrase.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 font-sans text-slate-50">
      <form onSubmit={submit} className="glass-panel w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center gap-2 text-purple-400">
          <KeyRound className="h-5 w-5" />
          <h1 className="text-lg font-semibold text-white">Website owner</h1>
        </div>
        <p className="mt-2 text-xs text-slate-500">minds.monster · support inbox and analytics</p>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          disabled={busy}
          className="mt-5 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50 disabled:opacity-50"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="sticker sticker-hover mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
        </button>
        <a href="#top" className="mt-4 block text-center text-xs text-slate-500 hover:text-slate-300">
          Back to the site
        </a>
      </form>
    </div>
  );
};

export default OwnerLogin;
