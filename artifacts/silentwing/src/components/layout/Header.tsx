// ─── Unified SilentWing Header ────────────────────────────────────────────────
//
// Single 48-px bar that consolidates what was previously three stacked bars:
//   • TopBar      — wordmark, view switcher, data-source toggle, feed health, clock
//   • StatusStrip — aircraft/alert/ground/sector-load stats, hotkey hints
//   • Filter bar  — airport selector, display filters, hidden count, director toggle
//
// Layout (left → right):
//   Logo | View tabs | Airport | Stats ──flex── Filters | Director | Source | Health | Clock ⚙

import React, { useEffect, useState } from 'react';
import type { DataSource } from '@/App';
import type { AirportProfile } from '@/airports/types';

// ── Sub-components ─────────────────────────────────────────────────────────────

function Sep() {
  return <span className="w-px h-5 bg-slate-800 shrink-0 mx-2" aria-hidden />;
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
    <div className="flex items-baseline gap-1 shrink-0">
      <span className="font-mono text-sm text-slate-200 tracking-widest">{h}:{m}:{s}</span>
      <span className="font-mono text-[9px] text-slate-600 tracking-wider">UTC</span>
    </div>
  );
}

function FeedHealth({
  status,
  lastUpdate,
}: {
  status: 'live' | 'lagging' | 'stalled';
  lastUpdate: number;
}) {
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

  const cfg = {
    live:    { dot: 'bg-emerald-400',             text: 'text-emerald-400', label: 'LIVE' },
    lagging: { dot: 'bg-amber-400',               text: 'text-amber-400',   label: `${ageSec}s` },
    stalled: { dot: 'bg-red-500 animate-pulse',   text: 'text-red-400',     label: 'STALLED' },
  }[status];

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cfg.dot} ${status === 'live' ? 'animate-pulse' : ''}`} />
      <span className={`font-mono text-[10px] tracking-widest font-medium ${cfg.text}`}>
        {cfg.label}
      </span>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface HeaderProps {
  // View
  activeView: 'airspace' | 'airfield';
  onViewChange: (v: 'airspace' | 'airfield') => void;
  // Feed
  feedStatus: 'live' | 'lagging' | 'stalled';
  feedLastUpdate: number;
  // Data source
  dataSource: DataSource;
  onDataSourceChange: (s: DataSource) => void;
  simDisabled?: boolean;
  // Airport
  airports: AirportProfile[];
  activeProfile: AirportProfile;
  onSwitchAirport: (p: AirportProfile) => void;
  // Stats
  aircraftCount: number;
  alertCount: number;
  groundCount: number;
  sectorLoad: number;
  // Filters
  hideGroundVehicles: boolean;
  onHideGroundVehicles: React.Dispatch<React.SetStateAction<boolean>>;
  hideAnonymous: boolean;
  onHideAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  hiddenCount: number;
  // Buildings toggle (3D only)
  showBuildings: boolean;
  onShowBuildings: React.Dispatch<React.SetStateAction<boolean>>;
  // Director
  directorMode: boolean;
  onDirectorMode: React.Dispatch<React.SetStateAction<boolean>>;
  // DEV slot — rendered at the right edge, DEV-only content from App.tsx
  devSlot?: React.ReactNode;
}

// ── Header ─────────────────────────────────────────────────────────────────────

const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  feedStatus,
  feedLastUpdate,
  dataSource,
  onDataSourceChange,
  simDisabled = false,
  airports,
  activeProfile,
  onSwitchAirport,
  aircraftCount,
  alertCount,
  groundCount,
  sectorLoad,
  hideGroundVehicles,
  onHideGroundVehicles,
  hideAnonymous,
  onHideAnonymous,
  hiddenCount,
  showBuildings,
  onShowBuildings,
  directorMode,
  onDirectorMode,
  devSlot,
}) => {
  const loadColor =
    sectorLoad >= 80 ? 'text-red-400' :
    sectorLoad >= 60 ? 'text-amber-400' :
    'text-emerald-400';

  // ── Source labels ──────────────────────────────────────────────────────────
  const sources: { src: DataSource; label: string; title: string }[] = [
    { src: 'sim',     label: 'SIM',   title: simDisabled ? 'Simulation not available for this airport' : 'Simulation' },
    { src: 'live',    label: 'ADSBX', title: 'ADS-B Exchange live feed' },
    { src: 'opensky', label: 'OS',    title: 'OpenSky Network — non-commercial use only' },
  ];

  return (
    <header className="flex items-center h-12 px-3 shrink-0 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm z-50 overflow-hidden">

      {/* ── 1. Wordmark ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0 min-w-[148px]">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
          <polygon points="10,1 19,10 10,19 1,10" fill="none" stroke="#3B82F6" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.5" fill="#3B82F6" />
        </svg>
        <span className="text-slate-100 font-semibold tracking-[0.15em] text-sm uppercase">
          Silent<span className="text-blue-400">Wing</span>
        </span>
        <span className="text-slate-700 text-[10px] font-mono">v1.0</span>
      </div>

      <Sep />

      {/* ── 2. View tabs ─────────────────────────────────────────────────────── */}
      <nav
        className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded p-0.5 shrink-0"
        aria-label="View"
      >
        {(['airspace', 'airfield'] as const).map(v => (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            className={[
              'px-3 py-0.5 rounded text-[10px] font-mono tracking-widest uppercase transition-all duration-150',
              activeView === v
                ? 'bg-slate-700 text-slate-100 shadow-inner'
                : 'text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            {v === 'airspace' ? '3D Airspace' : '2D Airfield'}
          </button>
        ))}
      </nav>

      <Sep />

      {/* ── 3. Airport selector (dropdown) ───────────────────────────────────── */}
      <select
        value={activeProfile.icao}
        onChange={e => {
          const p = airports.find(a => a.icao === e.target.value);
          if (p) onSwitchAirport(p);
        }}
        title="Switch airport"
        className="h-7 px-2 pr-6 rounded bg-slate-900 border border-slate-800 text-sky-300
                   font-mono text-[10px] tracking-widest uppercase shrink-0
                   appearance-none cursor-pointer
                   hover:border-slate-700 focus:outline-none focus:border-sky-700/60
                   transition-colors"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
      >
        {airports.map(prof => (
          <option key={prof.icao} value={prof.icao}
            style={{ background: '#0f172a', color: '#cbd5e1' }}
          >
            {prof.icao} — {prof.name ?? prof.icao}
          </option>
        ))}
      </select>

      <Sep />

      {/* ── 4. Stats ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 shrink-0">
        {[
          { label: 'AC',   value: aircraftCount, accent: 'text-slate-300' },
          { label: 'AL',   value: alertCount,    accent: alertCount > 0 ? 'text-amber-400' : 'text-slate-500' },
          { label: 'GND',  value: groundCount,   accent: 'text-slate-300' },
          { label: 'LOAD', value: `${sectorLoad}%`, accent: loadColor },
        ].map(({ label, value, accent }, i, arr) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-mono text-[9px] tracking-widest uppercase">{label}</span>
              <span className={`font-mono text-xs font-semibold tabular-nums ${accent}`}>{value}</span>
            </div>
            {i < arr.length - 1 && (
              <span className="text-slate-800 font-mono text-[10px] select-none">·</span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ── Flex spacer ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-[8px]" />

      {/* ── 5. Display filters ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[8px] tracking-[0.2em] text-slate-700 uppercase select-none font-mono">
          Filters
        </span>
        {([
          ['Vehicles', hideGroundVehicles, onHideGroundVehicles],
          ['Anon',     hideAnonymous,       onHideAnonymous],
          ['Bldgs',    showBuildings,        onShowBuildings],
        ] as [string, boolean, React.Dispatch<React.SetStateAction<boolean>>][]).map(([label, on, set]) => (
          <button
            key={label}
            onClick={() => set(v => !v)}
            className={[
              'flex items-center gap-1 px-2 py-[2px] text-[8px] tracking-widest uppercase rounded',
              'border transition-colors select-none cursor-pointer font-mono',
              on
                ? 'border-cyan-700/60 text-cyan-400 bg-cyan-900/15'
                : 'border-slate-700/50 text-slate-500 hover:text-slate-400',
            ].join(' ')}
          >
            <span className={on ? 'text-cyan-500' : 'text-slate-600'}>{on ? '●' : '○'}</span>
            {label}
          </button>
        ))}
        {hiddenCount > 0 && (
          <span className="text-[8px] text-slate-600 font-mono tabular-nums select-none">
            {hiddenCount} hidden
          </span>
        )}
      </div>

      <Sep />

      {/* ── 6. Director ──────────────────────────────────────────────────────── */}
      <button
        onClick={() => onDirectorMode(v => !v)}
        title="Director Mode — auto-switches camera to the most interesting event"
        className={[
          'flex items-center gap-1.5 px-3 py-[3px]',
          'text-[9px] tracking-widest uppercase rounded border font-mono',
          'transition-colors select-none cursor-pointer shrink-0',
          directorMode
            ? 'border-amber-500/70 text-amber-300 bg-amber-900/25'
            : 'border-slate-600/50 text-slate-400 hover:text-slate-300 hover:border-slate-500',
        ].join(' ')}
      >
        <span className={directorMode ? 'relative flex h-2 w-2 shrink-0' : 'text-slate-600 text-[8px]'}>
          {directorMode ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </>
          ) : '▶'}
        </span>
        Director
      </button>

      {/* ── DEV slot (injected from App.tsx in development builds only) ──────── */}
      {devSlot}

      <Sep />

      {/* ── 7. Data source toggle ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded p-0.5 shrink-0"
        title="Data source"
      >
        {sources.map(({ src, label, title }) => {
          const active   = dataSource === src;
          const disabled = src === 'sim' && simDisabled;
          const activeClass =
            src === 'sim'     ? 'bg-slate-700 text-slate-100 border border-slate-600' :
            src === 'live'    ? 'bg-emerald-900/70 text-emerald-300 border border-emerald-700/50' :
                                'bg-sky-900/70 text-sky-300 border border-sky-700/50';
          return (
            <button
              key={src}
              onClick={() => !disabled && onDataSourceChange(src)}
              title={title}
              className={[
                'px-2 py-0.5 rounded text-[9px] font-mono tracking-widest uppercase transition-all duration-150',
                disabled
                  ? 'text-slate-700 border border-transparent cursor-not-allowed'
                  : active
                    ? activeClass
                    : 'text-slate-500 hover:text-slate-300 border border-transparent',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      <Sep />

      {/* ── 8. Feed health ───────────────────────────────────────────────────── */}
      <FeedHealth status={feedStatus} lastUpdate={feedLastUpdate} />

      <Sep />

      {/* ── 9. Clock ─────────────────────────────────────────────────────────── */}
      <SimClock />

      {/* ── 10. Settings (placeholder) ───────────────────────────────────────── */}
      <button
        className="ml-2 p-1 text-slate-600 hover:text-slate-400 transition-colors shrink-0"
        title="Settings"
        aria-label="Settings"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

    </header>
  );
};

export default Header;
