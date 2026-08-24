import { useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { MousePointerClick, Sparkles, Stamp } from 'lucide-react';
import HeroSection from './components/HeroSection';
import FeaturedMarquee from './components/FeaturedMarquee';
import BrandRail, { SECTOR_ALL } from './components/BrandRail';
import CollectionGrid from './components/CollectionGrid';
import StudioOverlay from './components/StudioOverlay';
import PromptCanvas from './components/canvas/PromptCanvas';
import ConnectMindModal from './components/ConnectMindModal';
import MindChatProvider from './context/MindChatContext';
import { useMindChatContext } from './context/mindChat';
import { useStudioSelection } from './hooks/useStudioSelection';
import { useCanvasComposer } from './hooks/useCanvasComposer';
import { useScreenwriter } from './hooks/useScreenwriter';
import { useStoryboarder } from './hooks/useStoryboarder';
import { BRANDS, LIVE_COLLECTIONS, SECTORS, hasLiveCollection, searchBrands } from './data/brands';
import { LICENSE } from './config/licensing';

const STEPS = [
  {
    icon: MousePointerClick,
    title: 'Pick a piece',
    body: 'Browse work from the brands below — or search any collection ever minted.',
  },
  {
    icon: Sparkles,
    title: 'Describe your film',
    body: 'Tell the mind what you want to see. Direct it in conversation until it lands.',
  },
  {
    icon: Stamp,
    title: 'It licenses itself',
    body: `${LICENSE.priceEth} ${LICENSE.token} via ${LICENSE.protocol} on ${LICENSE.chain}, paid to the piece's holder as it's made.`,
  },
];

const AppShell = () => {
  const { session, openModal } = useMindChatContext();
  const { selection, open, close, pendingPrompt } = useStudioSelection();
  const [sector, setSector] = useState(SECTOR_ALL);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(null);

  const composer = useCanvasComposer();
  // The other half of the canvas. useCanvasComposer owns the prompt and the cast and says
  // outright that it owns no submit behaviour; this is what that seam was left for.
  const screenwriter = useScreenwriter();
  // A third, independent hook rather than folded into useScreenwriter: it owns a later,
  // separate phase (image generation against a real budget) with its own run/regenerate
  // lifecycle — see src/hooks/useStoryboarder.js.
  const storyboarder = useStoryboarder();

  // Restore a storyboard generated in an earlier visit, as soon as there is a session to fetch it
  // with. The frames have always been safe server-side (MIND_CONNECTIONS, `storyboard:<mindId>`,
  // no TTL) — nothing was ever asking for them back, so a reload looked like data loss when it
  // was only a missing read. Keyed on the token alone, not on the spec: a returning visitor
  // should see their storyboard before they have re-run anything.
  const { hydrate: hydrateStoryboard } = storyboarder;
  useEffect(() => {
    if (!session?.token) return;
    hydrateStoryboard({ token: session.token, spec: screenwriter.spec, cast: composer.cast });
  }, [session?.token, screenwriter.spec, composer.cast, hydrateStoryboard]);

  // The Studio is the deeper surface. The only way to reach it while the canvas is up is
  // the browser restoring an old #/studio hash, and when that happens the canvas yields.
  const { closeCanvas, setAnchor, openCanvas, setPrompt, open: canvasOpen } = composer;
  useEffect(() => {
    if (selection) closeCanvas();
  }, [selection, closeCanvas]);

  const selectPrompt = (idea) => {
    setPrompt(idea);
    openCanvas();
  };

  const openContract = ({ chain, address, name }) => {
    setCustom({
      slug: `custom-${address.toLowerCase()}`,
      name: name || 'Custom collection',
      sector: 'Search result',
      accent: '#951EF5',
      blurb: `Opened by contract address on ${chain}.`,
      collections: [{ name: name || 'Collection', chain, address }],
    });
    setQuery('');
  };

  const sections = useMemo(() => {
    const matched = searchBrands(query);
    const pool = sector === SECTOR_ALL ? matched : matched.filter((b) => b.sector === sector);
    // Live brands first: a visitor should hit real, licensable work immediately.
    const ordered = [...pool].sort(
      (a, b) => Number(hasLiveCollection(b)) - Number(hasLiveCollection(a)),
    );

    return (sector === SECTOR_ALL ? SECTORS : [sector])
      .map((name) => ({ sector: name, brands: ordered.filter((brand) => brand.sector === name) }))
      .filter((group) => group.brands.length > 0);
  }, [query, sector]);

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
            <a href="#brands" className="transition-colors hover:text-white">
              Brands
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-white">
              How it works
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
          backdropPaused={canvasOpen || Boolean(selection)}
          onPromptSelect={selectPrompt}
        />

        <FeaturedMarquee onOpen={open} />

        <BrandRail
          sector={sector}
          onSectorChange={setSector}
          query={query}
          onQueryChange={setQuery}
          onOpenContract={openContract}
        />

        <div className="mx-auto max-w-7xl space-y-16 px-6 py-12">
          {custom && (
            <div>
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-xs uppercase tracking-widest text-slate-500">Search result</p>
                <button
                  type="button"
                  onClick={() => setCustom(null)}
                  className="text-xs text-slate-500 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
              <CollectionGrid brand={custom} onOpen={open} />
            </div>
          )}

          {sections.map((group) => (
            <div key={group.sector} className="space-y-10">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {group.sector}
                </h2>
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-slate-600">{group.brands.length}</span>
              </div>

              {group.brands.map((brand) => (
                <CollectionGrid key={brand.slug} brand={brand} onOpen={open} />
              ))}
            </div>
          ))}

          {!sections.length && !custom && (
            <p className="py-16 text-center text-sm text-slate-500">
              Nothing matches “{query}”. Try a brand name, a collection, or paste a contract address.
            </p>
          )}
        </div>

        {/* The one purple tear on the page. It sits at the seam where the browsing wall
            ends and the explainer begins, so it reads as an event rather than as wallpaper.
            aria-hidden and outside the section: it is the section's top edge, drawn. */}
        <span aria-hidden="true" className="torn torn-brand block w-full" />

        <section id="how-it-works" className="bg-black/20 py-16">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="text-3xl uppercase tracking-tight shadow-type md:text-4xl">
              Licensing, handled as you create
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              No contracts to negotiate, no rights desk to email. The licence settles on-chain the
              moment the work is generated.
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
          </div>
        </section>
      </main>

      <footer inert={canvasOpen} className="relative z-20 mt-auto py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-6 text-center text-sm text-slate-500">
          <p>
            {BRANDS.length} brands · {LIVE_COLLECTIONS.length} collections live · licensing via{' '}
            <span className="text-purple-300">{LICENSE.protocol}</span>
          </p>
          <p>
            Powered by <span className="text-purple-400"><a href="https://www.munerate.com">Munerate</a></span>
          </p>
        </div>
      </footer>

      {/* Both overlays sit at z-50. They're never both open in practice, and rendering
          the canvas first means the Studio wins any overlap during exit animations. */}
      <PromptCanvas
        composer={composer}
        screenwriter={screenwriter}
        storyboarder={storyboarder}
        onLaunch={screenwriter.launch}
      />

      <StudioOverlay
        selection={selection}
        onSelect={open}
        onClose={close}
        initialPrompt={pendingPrompt}
      />

      <ConnectMindModal />
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
