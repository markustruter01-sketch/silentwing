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
  badge?: number;
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
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-1 top-1 flex min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold leading-3 text-white">
          {badge > 99 ? '99+' : badge}
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
        ◉
      </button>
      <CommandItem label="ALERTS" icon="!" onClick={onAlerts} badge={alertCount} />
      <CommandItem label="GROUND" icon="⌂" onClick={onGround} active={groundEnabled} />
      <CommandItem label="MORE" icon="•••" onClick={onMore} />
    </nav>
  );
}