import { BadgeCheck, Clock, FlaskConical } from 'lucide-react';
import { LICENSE, LICENSE_COPY, LICENSE_STATUS } from '../config/licensing';
import { cn } from '../lib/cn';

const ICONS = {
  [LICENSE_STATUS.LICENSABLE]: BadgeCheck,
  [LICENSE_STATUS.PENDING]: Clock,
  [LICENSE_STATUS.DEMO]: FlaskConical,
};

const TONES = {
  [LICENSE_STATUS.LICENSABLE]: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  [LICENSE_STATUS.PENDING]: 'border-white/10 bg-white/5 text-slate-400',
  [LICENSE_STATUS.DEMO]: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
};

/**
 * The licensing signal, shown on cards and in the Studio. Presentation only —
 * the x402 request is not wired up yet (see src/config/licensing.js).
 */
const LicenseBadge = ({ status = LICENSE_STATUS.LICENSABLE, size = 'sm', className }) => {
  const Icon = ICONS[status] ?? BadgeCheck;
  const copy = LICENSE_COPY[status];

  return (
    <span
      title={copy.detail}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        TONES[status],
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {copy.label}
    </span>
  );
};

/** The fuller explanation used in the Studio. */
export const LicenseSummary = ({ status = LICENSE_STATUS.LICENSABLE, className }) => (
  <div className={cn('rounded-2xl border border-white/10 bg-white/[0.03] p-4', className)}>
    <div className="flex items-center justify-between gap-3">
      <LicenseBadge status={status} size="md" />
      {status === LICENSE_STATUS.LICENSABLE && (
        <span className="text-xs text-slate-500">
          {LICENSE.protocol} · {LICENSE.chain}
        </span>
      )}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">{LICENSE_COPY[status].detail}</p>
  </div>
);

export default LicenseBadge;
