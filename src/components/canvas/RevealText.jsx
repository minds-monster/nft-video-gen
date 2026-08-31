import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/cn';

// One text treatment, used by everything the swarm writes.
//
// The point is that streamed text and finished text are *the same text* — a dossier line
// arrives character by character and then simply stops arriving. There is no separate
// console, no second surface, and no moment where a block of text appears from nowhere:
// the words the model is writing are already sitting where they will live.
//
// The reveal itself is a decode. Tokens arrive in bursts of several characters, so a plain
// append stutters; letting the newest few characters settle out of noise turns that stutter
// into something continuous, and it is closer to what is actually happening.

// Drawn from the shapes already on screen — the HUD register of the canvas — rather than
// katakana, which read as a costume borrowed from somewhere else.
const GLYPHS = '▚▞▜▟▛▙░▒▓╋╱╲│─┼·:=+*<>0123456789';
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

// How many trailing characters are still resolving. Short: long enough to read as motion,
// short enough that the sentence behind it stays legible while it lands.
const WINDOW = 12;
const PLACEHOLDER_LEN = 18;

// ONE CLOCK FOR EVERY REVEAL ON THE PAGE.
//
// This used to be a `setInterval` per instance. During a run there are two casting lanes, the
// Previs Supervisor and the Screenwriter all streaming at once, each with its own 14fps timer
// re-rendering its own per-character <span> map on its own schedule — four independent
// animation loops competing over the same frames. Sharing a single ticker costs one timer for
// the whole app, and it also means every reveal on screen scrambles on the same beat, which
// reads as one machine working rather than four things twitching.
const TICK_MS = 70;
const subscribers = new Set();
let ticker = null;

const subscribe = (fn) => {
  subscribers.add(fn);
  if (!ticker) {
    ticker = setInterval(() => {
      for (const notify of subscribers) notify();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(fn);
    // Nothing is settling any more; stop the clock rather than leaving it running behind an
    // idle canvas for the rest of the session.
    if (!subscribers.size && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
};

/**
 * @param text        the text so far — grows as it streams
 * @param settling    true while more is still arriving
 * @param placeholder when true and text is empty, render a cycling glyph field instead of nothing
 */
const RevealText = ({ text, settling = false, placeholder = false, className }) => {
  const [, tick] = useState(0);
  const reduceMotion = useReducedMotion();
  const active = settling && !reduceMotion;
  const showPlaceholder = placeholder && !text && settling;

  useEffect(() => {
    if (!active) return undefined;
    // ~14fps. The stream itself updates only when a token lands, which is far too lumpy to
    // animate against, so the noise runs on its own clock — one clock, shared (see above).
    return subscribe(() => tick((n) => n + 1));
  }, [active]);

  if (!text && !showPlaceholder) return null;
  if (!active) return <span className={className}>{text || ''}</span>;

  const visible = showPlaceholder
    ? Array.from({ length: PLACEHOLDER_LEN }, glyph).join('')
    : text;
  const cut = Math.max(0, visible.length - WINDOW);

  return (
    <span className={className}>
      {visible.slice(0, cut)}
      {visible
        .slice(cut)
        .split('')
        .map((character, index, all) => {
          // Nearer the end = more likely still noise. Whitespace is never scrambled, so word
          // shapes hold and the line stays readable the whole way through.
          const heat = 1 - index / all.length;
          const noisy = !/\s/.test(character) && Math.random() < heat * 0.5;
          return (
            <span key={index} className={noisy ? 'reveal-glow text-purple-300' : undefined}>
              {noisy ? glyph() : character}
            </span>
          );
        })}
      {!showPlaceholder && (
        <span
          aria-hidden="true"
          className="reveal-caret ml-0.5 inline-block h-3 w-1 translate-y-0.5 bg-purple-400 align-baseline"
        />
      )}
    </span>
  );
};

/**
 * The same treatment for a block that has just landed whole (a cached dossier, a spec
 * section). It plays the decode once on mount and then settles, so nothing ever appears
 * as an abrupt paste — which is what made the first cut look bolted together.
 */
export const RevealOnce = ({ text, delay = 0, className }) => {
  const [settling, setSettling] = useState(true);
  const reduceMotion = useReducedMotion();

  // ONCE means once. `text` was in this dependency list, so every change to the string
  // restarted the 420ms decode — which turned a one-shot flourish into a permanent shimmer on
  // anything whose text is recomputed as a run progresses, and made settled prose you were
  // halfway through reading scramble itself again.
  useEffect(() => {
    if (reduceMotion) {
      setSettling(false);
      return undefined;
    }
    const id = setTimeout(() => setSettling(false), 420 + delay);
    return () => clearTimeout(id);
  }, [reduceMotion, delay]);

  return <RevealText text={text} settling={settling} className={cn(className)} />;
};

export default RevealText;
