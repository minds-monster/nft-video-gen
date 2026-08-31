import { useState } from 'react';
import { cn } from '../lib/cn';
import { formatCount } from './support-copy.js';

// Two small marks for the owner area, in plain SVG. Every chart here is ONE series — a
// metric over days, a count per bucket — so there is no categorical palette to validate
// and no legend to draw: the tile's title names the series, the mark wears the brand hue,
// and every number is text in text tokens. Thin marks (2px line, slim bars with a 2px
// gap), a recessive baseline, and a hover layer on every plot.

const BRAND = 'rgb(192 132 252)'; // purple-400 on slate-950: the site's one accent

/** One number, one label, one sparkline underneath. */
export const StatTile = ({ label, value, sub, series, formatter = formatCount, tone }) => (
  <div className="glass-panel flex flex-col rounded-2xl p-4">
    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
    <p className={cn('mt-1 text-2xl font-semibold tabular-nums text-white', tone)}>{formatter(value)}</p>
    {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    {series && series.length > 1 && (
      <div className="mt-3">
        <Sparkline points={series} formatter={formatter} />
      </div>
    )}
  </div>
);

/** `points`: [{ label, value }]. 2px line, faint area, hover crosshair with a tooltip. */
export const Sparkline = ({ points, height = 44, formatter = formatCount }) => {
  const [hover, setHover] = useState(null);
  const width = 240;
  const pad = 4;
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  const step = (width - pad * 2) / Math.max(1, points.length - 1);
  const x = (i) => pad + i * step;
  const y = (v) => height - pad - ((v ?? 0) / max) * (height - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0)},${height - pad} Z`;
  const current = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-11 w-full"
        role="img"
        aria-label={`${points.length}-day trend, latest ${formatter(points[points.length - 1]?.value)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const rel = ((event.clientX - rect.left) / rect.width) * width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round((rel - pad) / step))));
        }}
      >
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="rgb(255 255 255 / 0.1)" strokeWidth="1" />
        <path d={area} fill={BRAND} fillOpacity="0.12" />
        <path d={path} fill="none" stroke={BRAND} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {current && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad} y2={height - pad} stroke="rgb(255 255 255 / 0.25)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(current.value)} r="4" fill={BRAND} stroke="rgb(2 6 23)" strokeWidth="2" />
          </>
        )}
      </svg>
      {current && (
        <div className="pointer-events-none absolute -top-7 left-0 rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 shadow-lg">
          {current.label} · <span className="font-semibold text-white">{formatter(current.value)}</span>
        </div>
      )}
    </div>
  );
};

/** `buckets`: [{ label, count }]. Slim bars, 2px gaps, the count above each bar on hover. */
export const Histogram = ({ buckets, height = 96 }) => {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex items-end gap-0.5" style={{ height }} onMouseLeave={() => setHover(null)}>
      {buckets.map((bucket, i) => (
        <div key={bucket.label} className="flex flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(i)}>
          <span className={cn('text-[11px] tabular-nums', hover === i ? 'text-white' : 'text-slate-500')}>{bucket.count}</span>
          <div
            className="w-full rounded-t"
            style={{ height: `${Math.max(2, (bucket.count / max) * (height - 40))}px`, background: BRAND, opacity: hover === i ? 1 : 0.7 }}
            role="img"
            aria-label={`${bucket.label}: ${bucket.count}`}
          />
          <span className="text-[10px] text-slate-500">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
};
