import { motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import HeroBackdrop from './HeroBackdrop';
import { COLLAPSED_HEIGHT } from './canvas/PromptCanvas';
import PromptSuggestions from './canvas/panels/PromptSuggestions';
import { BRANDS, LIVE_BRANDS } from '../data/brands';
import { LICENSE } from '../config/licensing';

// A type-set marquee of names — deliberately no trademark logo files.
// Live brands lead; anything still pending follows. No cap: this used to be
// `.slice(0, 14)` against a registry of 15, which silently dropped exactly one brand
// (Animoca Brands) off the end with nothing to indicate it. If the track ever needs
// slowing down as the registry grows, raise the marquee duration below — don't reintroduce
// a cap, because the failure mode is a brand quietly missing from the front page.
const WORDMARKS = [
  ...LIVE_BRANDS,
  ...BRANDS.filter((brand) => !LIVE_BRANDS.includes(brand)),
];

const HeroSection = ({ setAnchor, backdropPaused = false, onPromptSelect }) => (
  <section id="top" className="relative isolate px-6 pt-16 pb-12 md:pt-24 md:pb-16">
    <HeroBackdrop className="-z-10" paused={backdropPaused} />

    <div className="mx-auto max-w-4xl text-center">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <span className="chip inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Powered by the World&apos;s Best Brands
        </span>

        {/* The drop shadow does the work the scrim used to. HeroBackdrop's overlay was eased
            back so the race-launch film is actually visible, which costs some contrast right
            here — a shadow buys it back locally, on the type, instead of darkening the whole
            frame to protect two lines of it.
            Two shadows, in this order: the hard offset is the wordmark's own device, and the
            soft one underneath is what actually buys legibility over moving footage. A hard
            offset alone does not — it reads as style, not as contrast. */}
        <h1
          className="headline-monster headline-keyline mt-6 text-5xl leading-[1.02] md:text-7xl"
          style={{
            textShadow:
              '4px 4px 0 rgb(var(--brand-deep-rgb)), 0 2px 24px rgb(var(--ground-rgb) / 0.75), 0 1px 4px rgb(var(--ground-rgb) / 0.6)',
          }}
        >
          Make movies with{' '}
          {/* Was .text-gradient (a blue→indigo ramp). A gradient reads as almost nothing
              against a purple identity; the lit purple tier carries it far better and is
              7:1 on the ground, so it stays legible at any size. */}
          <span className="text-purple-400">your mind</span>
        </h1>

        <p
          className="mx-auto mt-6 max-w-2xl text-lg text-slate-400 md:text-xl"
          style={{ textShadow: '0 1px 12px rgb(var(--ground-rgb) / 0.7)' }}
        >
          Every frame automatically attributed, from the brands that own it. Choose a hero, describe
          the film, and bring your imagination to life.
        </p>
      </motion.div>

      <div className="mx-auto mt-10 max-w-2xl">
        {/* The composer itself is rendered at root level — it has to escape this section's
            `isolate` to be able to cover the header — so the hero just reserves its slot
            and the composer tracks this box until it expands.
            Deliberately outside any `motion` wrapper: a transformed ancestor would move
            this element without firing a resize, so the measured rect would be stale for
            the whole entrance and the composer would sit offset from its slot. The
            composer runs its own matching fade instead. */}
        <div
          ref={setAnchor}
          aria-hidden="true"
          className="w-full"
          style={{ height: COLLAPSED_HEIGHT }}
        />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-4"
        >
          <PromptSuggestions
            onSelect={onPromptSelect}
            count={4}
            showRefresh
            className="justify-center"
            label="Try"
          />
        </motion.div>
      </div>
    </div>

    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.25 }}
      className="mx-auto mt-14 max-w-6xl"
    >
      <div className="marquee-mask overflow-hidden">
        <div className="marquee-track flex w-max animate-[marquee_45s_linear_infinite] items-center gap-10">
          {[...WORDMARKS, ...WORDMARKS].map((brand, index) => (
            <span
              key={`${brand.slug}-${index}`}
              className="whitespace-nowrap text-lg font-semibold tracking-tight text-slate-500/80 transition-colors hover:text-slate-200 md:text-xl"
              style={{ textShadow: '0 0 24px rgb(var(--brand-rgb) / 0.16)' }}
            >
              {brand.name}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-col items-center gap-2 text-xs text-slate-500">
        <a href="#brands" className="flex items-center gap-2 hover:text-slate-300 transition-colors">
          <ArrowDown className="w-3.5 h-3.5" />
          Explore the work
        </a>
        <span>
          {LICENSE.priceEth} {LICENSE.token} per licence · {LICENSE.protocol} on {LICENSE.chain}
        </span>
      </div>
    </motion.div>
  </section>
);

export default HeroSection;
