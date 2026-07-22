import React, { useEffect, useState } from 'react';import type { DataSource } from '@/App';

type View = 'airspace' | 'airfield';

interface TopBarProps {
  activeView: View;
  onViewChange: (v: View) => void;
  feedStatus?: 'live' | 'lagging' | 'stalled';
  feedLastUpdate?: number;
  dataSource: DataSource;
  onDataSourceChange: (s: DataSource) => void;
  /** When false the SIM button is hidden (live-only airports). Default true. */
  simAvailable?: boolean;
}

function SimClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = time.getUTCHours().toString().padStart(2, '0');
  const m = time.getUTCMinutes().toString().padStart(2, '0');
  const s = time.getUTCSeconds().toString().padStart(2, '0');

  return (
    <div className="flex items-baseline gap-1">
      <span className="font-mono text-sm text-slate-200 tracking-widest">
        {h}:{m}:{s}
      </span>
      <span className="font-mono text-[10px] text-slate-500 tracking-wider">UTC</span>
    </div>
  );
}

function FeedHealthIndicator({
  status,
  lastUpdate,
}: {
  status: 'live' | 'lagging' | 'stalled';
  lastUpdate: number;
}) {
  // Live countdown — shown when lagging so the controller can see how stale the data is
  const [ageSec, setAgeSec] = useState(() =>
    lastUpdate > 0 ? Math.round((Date.now() - lastUpdate) / 1000) : 0,
  );
  useEffect(() => {
    if (status !== 'lagging') return;
    const id = setInterval(
      () => setAgeSec(Math.round((Date.now() - lastUpdate) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [status, lastUpdate]);

  const config = {
    live:    { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'LIVE' },
    lagging: { dot: 'bg-amber-400',   text: 'text-amber-400',   label: `LAGGING — ${ageSec}s since update` },
    stalled: { dot: 'bg-red-500',     text: 'text-red-500',     label: 'STALLED' },
  }[status];

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.dot} ${status === 'live' ? 'animate-pulse' : ''}`}
      />
      <span className={`font-mono text-[11px] tracking-widest font-medium ${config.text}`}>
        {config.label}
      </span>
    </div>
  );
}

/**
 * Data source toggle — swaps between the simulation and the live ADS-B feed.
 * This is the architectural proof-point: the same view components render
 * regardless of which DataFeedAdapter is active.
 */
function DataSourceToggle({
  value,
  onChange,
  simAvailable = true,
}: {
  value: DataSource;
  onChange: (s: DataSource) => void;
  simAvailable?: boolean;
}) {
  const sources = simAvailable ? (['sim', 'live'] as const) : (['live'] as const);
  return (
    <div
      className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded p-0.5"
      title="Data source"
    >
      {sources.map(src => {
        const active = value === src;
        const activeClass =
          src === 'live'
            ? 'bg-emerald-900/70 text-emerald-300 border border-emerald-700/50'
            : 'bg-slate-700 text-slate-100 border border-slate-600';
        return (
          <button
            key={src}
            onClick={() => onChange(src)}
            className={[
              'px-2 py-0.5 rounded text-[10px] font-mono tracking-widest uppercase transition-all duration-150',
              active ? activeClass : 'text-slate-500 hover:text-slate-300 border border-transparent',
            ].join(' ')}
          >
            {src === 'sim' ? 'SIM' : 'LIVE'}
          </button>
        );
      })}
    </div>
  );
}

const TopBar: React.FC<TopBarProps> = ({
  activeView,
  onViewChange,
  feedStatus = 'live',
  feedLastUpdate = 0,
  dataSource,
  onDataSourceChange,
  simAvailable = true,
}) => {
  return (
    <header
      className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm z-50"
    >
      {/* Wordmark */}
      <div className="flex items-center gap-3 min-w-[180px]">
        <div className="flex items-center gap-2">
          {/* Logo mark — simple geometric shape */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <polygon
              points="10,1 19,10 10,19 1,10"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="1.5"
            />
            <circle cx="10" cy="10" r="2.5" fill="#3B82F6" />
          </svg>
          <span className="text-slate-100 font-semibold tracking-[0.15em] text-sm uppercase">
            Silent<span className="text-blue-400">Wing</span>
          </span>
        </div>
        <span className="text-slate-700 text-xs font-mono">v1.0</span>
      </div>

      {/* View tabs (centred) */}
      <nav className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded p-0.5">
        {(['airspace', 'airfield'] as const).map(v => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            className={[
              'px-4 py-1 rounded text-xs font-mono tracking-widest uppercase transition-all duration-150',
              activeView === v
                ? 'bg-slate-700 text-slate-100 shadow-inner'
                : 'text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {v === 'airspace' ? '3D Airspace' : '2D Airfield'}
          </button>
        ))}
      </nav>

      {/* Right cluster */}
      <div className="flex items-center gap-3 min-w-[180px] justify-end">
        {/* Data source — the architectural proof toggle */}
        <DataSourceToggle value={dataSource} onChange={onDataSourceChange} simAvailable={simAvailable} />
        <div className="w-px h-4 bg-slate-800" />
        <FeedHealthIndicator status={feedStatus} lastUpdate={feedLastUpdate} />
        <div className="w-px h-4 bg-slate-800" />
        <SimClock />
        {/* Settings gear (placeholder for Phase 7) */}
        <button
          className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
          title="Settings"
          aria-label="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default TopBar;
