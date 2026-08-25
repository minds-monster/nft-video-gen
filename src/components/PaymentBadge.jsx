import { BadgeCheck, Clock, FlaskConical } from 'lucide-react';
import { PAYMENT, PAYMENT_COPY, PAYMENT_STATUS } from '../config/payment';
import { cn } from '../lib/cn';

const ICONS = {
  [PAYMENT_STATUS.PAYABLE]: BadgeCheck,
  [PAYMENT_STATUS.PENDING]: Clock,
  [PAYMENT_STATUS.DEMO]: FlaskConical,
};

const TONES = {
  [PAYMENT_STATUS.PAYABLE]: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  [PAYMENT_STATUS.PENDING]: 'border-white/10 bg-white/5 text-slate-400',
  [PAYMENT_STATUS.DEMO]: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
};

/**
 * The payment signal, shown on cards and in the Studio. Presentation only —
 * the x402 request is not wired up yet (see src/config/payment.js).
 */
const PaymentBadge = ({ status = PAYMENT_STATUS.PAYABLE, size = 'sm', className }) => {
  const Icon = ICONS[status] ?? BadgeCheck;
  const copy = PAYMENT_COPY[status];

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
export const PaymentSummary = ({ status = PAYMENT_STATUS.PAYABLE, className }) => (
  <div className={cn('rounded-2xl border border-white/10 bg-white/[0.03] p-4', className)}>
    <div className="flex items-center justify-between gap-3">
      <PaymentBadge status={status} size="md" />
      {status === PAYMENT_STATUS.PAYABLE && (
        <span className="text-xs text-slate-500">
          {PAYMENT.protocol} · {PAYMENT.chain}
        </span>
      )}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">{PAYMENT_COPY[status].detail}</p>
  </div>
);

export default PaymentBadge;
