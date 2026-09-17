interface CommandBarProps {
  activeView: 'airspace' | 'airfield';
  directorMode: boolean;
  groundEnabled: boolean;
  alertCount: number;
  onView: () => void;
  onRewind: () => void;
  onLayers: () => void;
  onDirector: () => void;
  onAlerts: () => void;
  onGround: () => void;
  onMore: () => void;
  groundTileCount: number;
  groundTileLimit: number;
}

function CommandItem({
  label,
  icon,
  onClick,
  active = false,
  badge,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  badge?: number | string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={[
        'relative flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl px-2',
        'font-mono text-[8px] tracking-[0.18em] text-white/70 transition-colors',
        'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300',
        active && 'bg-white/10 text-cyan-200',
      ].filter(Boolean).join(' ')}
    >
      <span aria-hidden className="text-[17px] leading-none text-white/90">{icon}</span>
      <span>{label}</span>
      {badge !== undefined && (
        <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold leading-3 text-white">
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export default function CommandBar({
  activeView,
  directorMode,
  groundEnabled,
  alertCount,
  onView,
  onRewind,
  onLayers,
  onDirector,
  onAlerts,
  onGround,
  onMore,
  groundTileCount,
  groundTileLimit,
}: CommandBarProps) {
  return (
    <nav
      aria-label="Command bar"
      className="fixed bottom-4 left-1/2 z-[180] flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/15 bg-slate-950/75 px-2 py-1.5 shadow-2xl backdrop-blur-xl"
    >
      <CommandItem label="VIEW" icon={activeView === 'airspace' ? '◉' : '▦'} onClick={onView} />
      <CommandItem label="REWIND" icon="↶" onClick={onRewind} />
      <CommandItem label="LAYERS" icon="◈" onClick={onLayers} />
      <button
        type="button"
        onClick={onDirector}
        aria-label="Toggle director"
        aria-pressed={directorMode}
        title="Toggle camera director"
        className={[
          'relative -mt-7 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2',
          'font-mono text-[22px] text-white shadow-xl transition-all focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-amber-200',
          directorMode
            ? 'border-amber-200 bg-amber-400 text-slate-950 shadow-amber-400/40'
            : 'border-amber-500/80 bg-amber-500 text-slate-950 hover:bg-amber-300',
        ].join(' ')}
      >
        <svg aria-hidden width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.5h4.6L15.5 6h2A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z" />
          <circle cx="12" cy="12" r="3.25" />
        </svg>
      </button>
      <CommandItem label="ALERTS" icon="!" onClick={onAlerts} badge={alertCount} />
      <CommandItem
        label="GROUND"
        icon="⌂"
        onClick={onGround}
        active={groundEnabled}
        badge={`${groundTileCount}/${groundTileLimit}`}
      />
      <CommandItem label="MORE" icon="•••" onClick={onMore} />
    </nav>
  );
}