import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { MousePointerClick, Sparkles, Stamp } from 'lucide-react';
import { useHashRoute } from './hooks/useHashRoute';
import { track } from './services/analytics';
import { SupportModal } from './components/SupportForm';

// Two pages that are not the marketing shell, both lazy so they never reach the visitor
// bundle: the owner area (private, behind a passphrase) and a visitor's ticket page (reached
// from the link in a support email).
const OwnerArea = lazy(() => import('./owner/OwnerArea.jsx'));
const SupportTicketPage = lazy(() => import('./components/SupportTicketPage.jsx'));
import HeroSection from './components/HeroSection';
import FeaturedMarquee from './components/FeaturedMarquee';
import PromptCanvas from './components/canvas/PromptCanvas';
import ConnectMindModal from './components/ConnectMindModal';
import PricingSection from './components/PricingSection';
import SupportSection from './components/SupportSection';
import SwarmDiagram from './components/SwarmDiagram';
import CheckoutModal from './components/CheckoutModal';
import MindChatProvider from './context/MindChatContext';
import { useMindChatContext } from './context/mindChat';
import { setProductionState } from './lib/productionState';
import { resolveNftName } from './lib/nftMedia';
import { useCanvasComposer } from './hooks/useCanvasComposer';
import { useScreenwriter } from './hooks/useScreenwriter';
import { useStoryboarder } from './hooks/useStoryboarder';
import { useDirector } from './hooks/useDirector';
import { assetKey } from './lib/assetKey';
import { BRANDS, LIVE_COLLECTIONS } from './data/brands';
import { PAYMENT } from './config/payment';

const STEPS = [
  {
    icon: MousePointerClick,
    title: 'Pick a piece',
    body: 'Browse work from the brands below — or add the contract address of any collection ever minted.',
  },
  {
    icon: Sparkles,
    title: 'Connect your mind',
    body: (
      <>
        Your{' '}
        <a
          href="https://hellominds.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline"
        >
          mind
        </a>{' '}
        is the producer, and helps you manage the creative output and project budget.
      </>
    ),
  },
  {
    icon: Stamp,
    title: 'Craft your movie with the swarm',
    body: `Your crew of agents springs into action, executing your creative vision from concept to final cut.`,
  },
];

const AppShell = () => {
  const { session, openModal, checkout } = useMindChatContext();
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const route = useHashRoute();

  // One page_view per page, where a page is a hash route — the anchors on the home page
  // (#pricing etc.) all count as '/'.
  useEffect(() => {
    track('page_view');
  }, [route.path]);

  const composer = useCanvasComposer();
  // The other half of the canvas. useCanvasComposer owns the prompt and the cast and says
  // outright that it owns no submit behaviour; this is what that seam was left for.
  const screenwriter = useScreenwriter();
  // A third, independent hook rather than folded into useScreenwriter: it owns a later,
  // separate phase (image generation against a real budget) with its own run/regenerate
  // lifecycle — see src/hooks/useStoryboarder.js.
  const storyboarder = useStoryboarder();
  // A fourth, again independent. The Director is the first stage that spends REAL money per
  // action rather than fractions of a cent, so its lifecycle is genuinely different: it opens a
  // production, asks before spending, and survives this tab closing mid-render. Folding it into
  // useStoryboarder would have meant one hook with two budgets and two failure models.
  const director = useDirector();

  // Restore THIS film's storyboard once there is both a session to fetch it with and a spec
  // saying which film we are looking at.
  //
  // Both conditions matter. The frames have always been safe server-side, and nothing was asking
  // for them back, so a reload looked like data loss when it was only a missing read — but the
  // first version of this asked on the token alone, which pulled whatever the Mind produced LAST
  // into whatever tab happened to connect. A visitor mid-way through a second film saw the first
  // film's storyboard appear the moment they connected.
  const { hydrate: hydrateStoryboard, loadFilms } = storyboarder;
  useEffect(() => {
    if (!session?.token || !screenwriter.spec) return;
    hydrateStoryboard({ token: session.token, spec: screenwriter.spec, cast: composer.cast });
  }, [session?.token, screenwriter.spec, composer.cast, hydrateStoryboard]);

  // The list of past films needs no spec, and is what a returning visitor lands on after a reload
  // — without it, scoping the storyboard to the current film would make earlier work unreachable
  // rather than merely un-leaked.
  useEffect(() => {
    if (!session?.token) return;
    loadFilms(session.token);
  }, [session?.token, loadFilms]);

  // The Director's productions come back the same way — and the newest one that has footage is
  // opened outright, because a returning visitor's dailies were never lost, only unaddressed:
  // filmId is a hash of the screenplay and the screenplay lives nowhere but this tab.
  //
  // Only when the tab has no spec of its own. The storyboard note above is the reason: pulling
  // the Mind's LAST film into a tab that is mid-way through a different one is the exact
  // leak this app already refused once.
  const { loadFilms: loadProductions, openProduction } = director;
  useEffect(() => {
    if (!session?.token || screenwriter.spec) return;
    let cancelled = false;
    loadProductions(session.token).then((films) => {
      if (cancelled) return;
      const newest = films.find((film) => film.takeCount > 0);
      if (newest) openProduction({ token: session.token, filmId: newest.filmId });
    });
    return () => {
      cancelled = true;
    };
  }, [session?.token, screenwriter.spec, loadProductions, openProduction]);

  // Publish how far this visitor has actually got, for the Producer briefing.
  //
  // Connecting a Mind is optional and frequently late: a visitor can arrive holding a cast,
  // a screenplay, or a finished storyboard, because all three run on Zero Budget. None of
  // that is visible to the Worker — the prompt, cast and screenplay never leave the browser
  // until a storyboard is submitted — so without this the Mind's first message can only ever
  // greet everyone as a beginner, which is exactly the moment a visitor stops believing it
  // is really theirs. Published to a registry rather than passed down, because the hook that
  // sends it lives inside MindChatProvider, which wraps this component; see
  // src/lib/productionState.js.
  useEffect(() => {
    setProductionState({
      hasPrompt: Boolean(composer.prompt?.trim()),
      castCount: composer.cast.length,
      castNames: composer.cast.map((entry) => resolveNftName(entry.nft)).filter(Boolean),
      primaryName: composer.primary ? resolveNftName(composer.primary.nft) : null,
      screenplayStage: screenwriter.stage,
      beatCount: screenwriter.spec?.beats?.length ?? 0,
      logline: screenwriter.spec?.logline ?? null,
    });
  }, [composer.prompt, composer.cast, composer.primary, screenwriter.stage, screenwriter.spec]);

  const { closeCanvas, setAnchor, openCanvas, setPrompt, open: canvasOpen } = composer;

  const handleToggleAsset = useCallback(
    ({ nft, collection }) => {
      const key = assetKey(collection.chain, collection.address, nft.tokenId);
      if (composer.castKeys.has(key)) {
        composer.removeAsset(key);
      } else {
        composer.addAsset({ nft, collection }, 'curated', composer.isMock);
      }
    },
    [composer],
  );

  const selectPrompt = (idea) => {
    setPrompt(idea);
    openCanvas();
  };

  // The routes that replace the shell entirely. Hooks above have all run, so this is safe.
  if (route.segments[0] === 'owner') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <OwnerArea route={route} />
      </Suspense>
    );
  }
  if (route.segments[0] === 'support' && route.segments[1] && route.segments[2]) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <SupportTicketPage ticketId={route.segments[1]} token={route.segments.slice(2).join('/')} />
      </Suspense>
    );
  }
  const supportOpen = route.path === '/support';

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-950 font-sans text-slate-50">
      {/* Background elements */}
      {/* Ambient wash for the page below the fold. The top blob is dialled well back and
          pushed down the page: the hero now has its own background film (HeroBackdrop),
          and a 120px purple blur sitting on top of it just muddied the footage. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[30%] h-[40%] w-[40%] rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-purple-700/15 blur-[120px]" />
      </div>

      {/* `inert` on the three content regions while the canvas is up: no tab stops, no
          pointer events, and the whole subtree hidden from screen readers, in one
          attribute. The overlays are siblings, so they stay reachable. */}
      <header
        inert={canvasOpen}
        className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-md"
      >
        <div className="mx-auto flex h-24 max-w-7xl items-center justify-between px-6">
          {/* One artwork: the mark and wordmark are locked up together with their own
              keyline and spacing, so don't reposition the parts — scale the whole thing. */}
          <a href="#top" className="group flex items-center">
            <img
              src="/brand/minds-monster-lockup.png"
              alt="minds.MONSTER"
              width={485}
              height={200}
              className="h-11 w-auto drop-shadow-[0_0_18px_rgb(var(--brand-rgb)/0.35)] transition-transform group-hover:scale-[1.03] sm:h-[4.5rem]"
            />
          </a>

          <nav className="hidden gap-8 text-sm font-medium text-slate-400 md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-white">
              How it works
            </a>
            <a href="#explore" className="transition-colors hover:text-white">
              Assets
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing
            </a>
            <a href="#support" className="transition-colors hover:text-white">
              Support
            </a>
          </nav>

          <button
            type="button"
            onClick={openModal}
            title={session ? `Connected · ${session.mindName || session.mindId}` : 'Bring your own Mind in as the Producer'}
            className={
              session
                ? 'chip px-5 py-2 text-sm font-semibold text-emerald-300 hover:text-emerald-200'
                : 'chip px-5 py-2 text-sm font-semibold text-slate-200 hover:text-white'
            }
          >
            {session ? `Connected · ${session.mindName || session.mindId.slice(0, 8) + '…'}` : 'Connect Mind'}
          </button>
        </div>
      </header>

      <main inert={canvasOpen} className="relative z-10 flex-1">
        <HeroSection
          setAnchor={setAnchor}
          backdropPaused={canvasOpen}
          onPromptSelect={selectPrompt}
        />

        <FeaturedMarquee
          onToggle={handleToggleAsset}
          selectedKeys={composer.castKeys}
        />


        {/* The one purple tear on the page. It sits at the seam where the browsing wall
            ends and the explainer begins, so it reads as an event rather than as wallpaper.
            aria-hidden and outside the section: it is the section's top edge, drawn. */}
        <span aria-hidden="true" className="torn torn-brand block w-full" />

        <section id="how-it-works" className="bg-black/20 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="text-3xl uppercase tracking-tight shadow-type md:text-4xl">
              Automatic Attribution
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Create with content which has it's ownership data intact,
              from some of the world's leading brands.
            </p>

            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <div key={step.title} className="glass-panel rounded-2xl p-6">
                  <div className="flex items-center gap-3">
                    <span className="keyline flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/25 text-purple-300">
                      <step.icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-16">
              <SwarmDiagram />
            </div>
          </div>
        </section>

        <PricingSection onConnectMind={() => setCheckoutModalOpen(true)} />
        <SupportSection />
      </main>

      <footer inert={canvasOpen} className="relative z-20 mt-auto py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-6 text-center text-sm text-slate-500">
          <p>
            {BRANDS.length} brands · {LIVE_COLLECTIONS.length} collections featured · agentic payments via{' '}
            <span className="text-purple-300">{PAYMENT.protocol}</span>
          </p>
          <p>
            Powered by <span className="text-purple-400"><a href="https://www.munerate.com">Munerate</a></span>
            {' · '}
            <a href="#support" className="text-slate-400 transition-colors hover:text-white">
              Support
            </a>
          </p>
        </div>
      </footer>

      <SupportModal open={supportOpen} onClose={() => route.navigate('/')} />

      {/* Both overlays sit at z-50. They're never both open in practice, and rendering
          the canvas first means the Studio wins any overlap during exit animations. */}
      <PromptCanvas
        composer={composer}
        screenwriter={screenwriter}
        storyboarder={storyboarder}
        director={director}
        onLaunch={screenwriter.launch}
      />

      <ConnectMindModal />
      <CheckoutModal
        isOpen={checkoutModalOpen}
        onClose={() => setCheckoutModalOpen(false)}
        onConfirm={(amount) => {
          setCheckoutModalOpen(false);
          checkout(amount);
        }}
      />
    </div>
  );
};

/* The @media (prefers-reduced-motion) block in index.css is CSS-only, so it reaches the
   two marquees and the hud keyframes but NOT framer-motion, which animates inline styles
   from JS. Only four components called useReducedMotion() individually, leaving ~30
   motion elements ignoring the OS flag. This covers all of them in one place. */
const App = () => (
  <MotionConfig reducedMotion="user">
    <MindChatProvider>
      <AppShell />
    </MindChatProvider>
  </MotionConfig>
);

export default App;
