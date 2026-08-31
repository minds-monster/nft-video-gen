import { useState } from 'react';
import { BarChart3, Brain, LifeBuoy, LogOut } from 'lucide-react';
import OwnerLogin from './OwnerLogin.jsx';
import OverviewPanel from './OverviewPanel.jsx';
import SupportPanel from './SupportPanel.jsx';
import TicketView from './TicketView.jsx';
import MindPanel from './MindPanel.jsx';
import { clearOwnerSession, getStoredOwnerSession } from '../services/owner';
import { cn } from '../lib/cn';

// The website owner's private area, at `#/owner`. Lazy-loaded from App.jsx so none of this
// reaches the visitor bundle. Three panels: Overview (analytics), Support (the inbox), Mind
// (the support Mind's health). Route segments after /owner pick the panel and, for
// support, the open ticket: `#/owner/support/<ticketId>`.

const NAV = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'support', label: 'Support', icon: LifeBuoy },
  { key: 'mind', label: 'Mind', icon: Brain },
];

const OwnerArea = ({ route }) => {
  const [session, setSession] = useState(getStoredOwnerSession);
  const panel = NAV.some((item) => item.key === route.segments[1]) ? route.segments[1] : 'overview';
  const ticketId = panel === 'support' ? route.segments[2] ?? null : null;

  if (!session) return <OwnerLogin onLogin={setSession} />;

  const signOut = () => {
    clearOwnerSession();
    setSession(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-50">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          <a href="#top" className="flex shrink-0 items-center">
            <img src="/brand/minds-monster-lockup.png" alt="minds.MONSTER" className="h-9 w-auto" />
          </a>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => route.navigate(`/owner/${item.key}`)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  panel === item.key ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white',
                )}
              >
                <item.icon className="h-3.5 w-3.5" /> {item.label}
              </button>
            ))}
          </nav>
          <button type="button" onClick={signOut} className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-300">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {panel === 'overview' && <OverviewPanel token={session.token} />}
        {panel === 'support' && !ticketId && <SupportPanel token={session.token} onOpenTicket={(id) => route.navigate(`/owner/support/${id}`)} />}
        {panel === 'support' && ticketId && <TicketView token={session.token} ticketId={ticketId} onBack={() => route.navigate('/owner/support')} />}
        {panel === 'mind' && <MindPanel token={session.token} />}
      </main>
    </div>
  );
};

export default OwnerArea;
