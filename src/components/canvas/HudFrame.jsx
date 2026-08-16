import { cn } from '../../lib/cn';

/**
 * The canvas chrome: lattice, ambient bloom and a one-shot scanline.
 *
 * Purely decorative and `pointer-events-none`, so it can sit over the whole panel
 * without eating clicks. No backdrop-blur anywhere — the panel behind it is opaque, so
 * a blur would cost a full-screen recomposite every frame and change not one pixel.
 */
const HudFrame = ({ sweep = true, className }) => (
  <div
    aria-hidden="true"
    className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
  >
    <div className="hud-grid absolute inset-0 opacity-70" />

    {/* Same ambient wash the page uses, kept inside the panel. */}
    <div className="absolute left-[-12%] top-[6%] h-[45%] w-[45%] rounded-full bg-purple-600/10 blur-[120px]" />
    <div className="absolute bottom-[-12%] right-[-12%] h-[45%] w-[45%] rounded-full bg-purple-700/10 blur-[120px]" />

    {sweep && <div className="hud-sweep absolute inset-x-0 top-0 h-20" />}
  </div>
);

export default HudFrame;
