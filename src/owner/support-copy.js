// Shared by SupportPanel and TicketView. A plain module rather than an export from a
// component file, so React Fast Refresh keeps working for both.

export const STATUS_COPY = {
  received: { label: 'Received', className: 'text-slate-300' },
  seen: { label: 'Seen', className: 'text-amber-300' },
  awaiting: { label: 'Visitor wrote back', className: 'text-amber-300' },
  replied: { label: 'Replied', className: 'text-purple-300' },
  'replied-unmarked': { label: 'Replied, no marker', className: 'text-red-300' },
  escalated: { label: 'Escalated to you', className: 'text-amber-300' },
  forwarded: { label: 'Forwarded your answer', className: 'text-purple-300' },
  resolved: { label: 'Resolved', className: 'text-emerald-300' },
  reopened: { label: 'Reopened', className: 'text-amber-300' },
};

export const formatAge = (ms) => {
  if (ms == null) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

export const formatCount = (value) => {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
};
