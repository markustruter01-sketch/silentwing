// ─── SequenceLadder ───────────────────────────────────────────────────────────
//
// Compact panel showing the next 3 arriving and 3 departing aircraft.
// Positioned in the right-side panel stack, below the DirectorFocusPanel.
// Always visible regardless of director / camera mode.

import type { Aircraft } from '@/types';

// ── Phase display metadata ─────────────────────────────────────────────────────
const PHASE_LABEL: Record<string, string> = {
  'enroute-arrival':   'EN ROUTE',
  'approach':          'APPROACH',
  'landing':           'LANDING',
  'taxi-in':           'TAXI IN',
  'at-gate':           'AT GATE',
  'taxi-out':          'TAXI OUT',
  'takeoff':           'TAKEOFF',
  'departure':         'DEPART',
  'enroute-departure': 'DEPARTING',
};

const PHASE_COLOR: Record<string, string> = {
  'enroute-arrival':   '#38BDF8',
  'approach':          '#38BDF8',
  'landing':           '#60A5FA',
  'taxi-in':           '#F59E0B',
  'at-gate':           '#4ADE80',
  'taxi-out':          '#FB923C',
  'takeoff':           '#818CF8',
  'departure':         '#C084FC',
  'enroute-departure': '#C084FC',
};

// ── Arrival phases (sorted by ascending altitude — lower = closer to threshold) ──
export const ARRIVAL_PHASES = new Set<Aircraft['phase']>([
  'approach', 'landing', 'enroute-arrival',
]);

// ── Departure phases (sorted by time-in-phase ascending — youngest first) ───────
export const DEPARTURE_PHASES = new Set<Aircraft['phase']>([
  'taxi-out', 'takeoff', 'departure',
]);

// ── Props ──────────────────────────────────────────────────────────────────────
export interface SequenceLadderProps {
  arrivalsQueue:   Aircraft[];
  departuresQueue: Aircraft[];
  onSelectAc: (id: string) => void;
  pinnedAcIds: Set<string>;
  onTogglePin: (id: string) => void;
  /** Top offset in px — allows caller to push panel below DirectorFocusPanel */
  topOffset?: number;
  /** Use the light glass surface while photoreal ground is enabled. */
  photorealGroundEnabled?: boolean;
}

// ── PhaseBadge ────────────────────────────────────────────────────────────────
function PhaseBadge({ phase }: { phase: Aircraft['phase'] }) {
  const label = PHASE_LABEL[phase] ?? phase.toUpperCase().replace(/-/g, ' ');
  const color = PHASE_COLOR[phase] ?? '#94A3B8';
  return (
    <span
      className="font-mono text-[8px] tracking-widest px-1 py-px rounded flex-shrink-0"
      style={{
        color,
        background: color + '22',
        border:     `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

// ── PinButton ─────────────────────────────────────────────────────────────────
function PinButton({ pinned, onPin }: { pinned: boolean; onPin: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onPin}
      title={pinned ? 'Unpin aircraft' : 'Pin aircraft — holds director on this flight'}
      className={[
        'flex-shrink-0 flex items-center justify-center',
        'w-5 h-5 rounded transition-colors',
        pinned
          ? 'text-cyan-300 bg-cyan-900/40 hover:bg-cyan-800/50'
          : 'text-slate-600 hover:text-slate-400 hover:bg-slate-700/30',
      ].join(' ')}
    >
      {/* Pin icon — filled when active */}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
        {pinned ? (
          /* filled pin */
          <path d="M8.5 1A.5.5 0 0 0 8 1.5v.293L5.854 3.939A2.5 2.5 0 0 0 2.146 7.647L.647 9.146a.5.5 0 0 0 .707.707L2.854 8.354l.293.293A2.5 2.5 0 0 0 6.854 5.646l2.293-2.293H9.5a.5.5 0 0 0 0-1H8.5z" />
        ) : (
          /* outline pin */
          <>
            <path d="M8 1.5a.5.5 0 0 1 .5-.5H9.5a.5.5 0 0 1 0 1h-.793l-2.293 2.293A2.5 2.5 0 0 1 2.707 7.5l-1.5 1.5a.5.5 0 0 1-.707-.707L2 6.793A2.5 2.5 0 0 1 5.707 3.086L8 .793V1.5zm-.647 2.5L5.646 5.707A1.5 1.5 0 1 0 7.354 7.414L9.06 5.707 7.354 4z" opacity="0.6"/>
          </>
        )}
      </svg>
    </button>
  );
}

// ── ArrivalRow ────────────────────────────────────────────────────────────────
function ArrivalRow({
  ac,
  pinned,
  onClick,
  onPin,
}: {
  ac: Aircraft;
  pinned: boolean;
  onClick: () => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  const altFt = Math.round(ac.position.alt);
  const etaLabel =
    altFt < 1000 ? '<1k ft' :
    altFt < 5000 ? `${(altFt / 1000).toFixed(1)}k ft` :
    `FL${Math.round(altFt / 100).toString().padStart(3, '0')}`;

  return (
    <div
      className={[
        'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
        pinned ? 'bg-cyan-950/40 border-l border-cyan-600/50' : 'hover:bg-slate-700/20',
      ].join(' ')}
    >
      <PinButton pinned={pinned} onPin={onPin} />
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer group py-0.5"
      >
        <PhaseBadge phase={ac.phase} />
        <span className={[
          'font-mono text-[10px] tracking-wide flex-1 min-w-0 truncate',
          pinned ? 'text-cyan-200' : 'text-slate-200 group-hover:text-white',
        ].join(' ')}>
          {ac.callsign}
        </span>
        <span className="font-mono text-[9px] text-sky-400/70 tabular-nums shrink-0 w-[42px] text-right">{etaLabel}</span>
      </button>
    </div>
  );
}

// ── DepartureRow ──────────────────────────────────────────────────────────────
function DepartureRow({
  ac,
  pinned,
  onClick,
  onPin,
}: {
  ac: Aircraft;
  pinned: boolean;
  onClick: () => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  const gsLabel = ac.groundSpeed > 0 ? `${ac.groundSpeed}kt` : 'GND';

  return (
    <div
      className={[
        'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
        pinned ? 'bg-cyan-950/40 border-l border-cyan-600/50' : 'hover:bg-slate-700/20',
      ].join(' ')}
    >
      <PinButton pinned={pinned} onPin={onPin} />
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer group py-0.5"
      >
        <PhaseBadge phase={ac.phase} />
        <span className={[
          'font-mono text-[10px] tracking-wide flex-1 min-w-0 truncate',
          pinned ? 'text-cyan-200' : 'text-slate-200 group-hover:text-white',
        ].join(' ')}>
          {ac.callsign}
        </span>
        <span className="font-mono text-[9px] text-orange-400/70 tabular-nums shrink-0 w-[42px] text-right">{gsLabel}</span>
      </button>
    </div>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────
function ColHeader({ label, color }: { label: string; color: string }) {
  return (
    <div
      className="font-mono text-[8px] tracking-[0.2em] uppercase px-2 pb-1 flex items-center gap-1.5"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {label}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SequenceLadder({
  arrivalsQueue,
  departuresQueue,
  onSelectAc,
  pinnedAcIds,
  onTogglePin,
  topOffset = 440,
  photorealGroundEnabled = false,
}: SequenceLadderProps) {
  const isEmpty = arrivalsQueue.length === 0 && departuresQueue.length === 0;

  const pinnedCount = arrivalsQueue.filter(ac => pinnedAcIds.has(ac.id)).length
    + departuresQueue.filter(ac => pinnedAcIds.has(ac.id)).length;

  return (
    <div
      className={[
        'absolute right-4 w-[300px] z-40 pointer-events-auto select-none overflow-hidden rounded-lg',
        photorealGroundEnabled ? 'sw-glass-panel sw-glass-panel-dense' : 'shadow-2xl',
      ].join(' ')}
      style={{
        top: topOffset,
        ...(photorealGroundEnabled ? {} : {
          background:    'rgba(7,10,22,0.92)',
          border:        '1px solid rgba(148,163,184,0.15)',
          backdropFilter: 'blur(8px)',
        }),
      }}
    >
      {/* Header */}
      <div
        className="px-3 pt-2 pb-1.5 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.10)' }}
      >
        <span className="font-mono text-[9px] tracking-[0.25em] text-slate-500 uppercase">
          Sequence
        </span>
        <div className="flex items-center gap-2">
          {pinnedCount > 0 && (
            <span className="font-mono text-[8px] text-cyan-500/80 tabular-nums">
              {pinnedCount} pinned
            </span>
          )}
          <span className="font-mono text-[8px] text-slate-700 tabular-nums">
            {arrivalsQueue.length} arr · {departuresQueue.length} dep
          </span>
        </div>
      </div>

      {isEmpty ? (
        /* Empty state */
        <div className="py-4 text-center font-mono text-[10px] text-slate-700 tracking-wide">
          No active traffic
        </div>
      ) : (
        <div className="flex gap-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
          {/* ── Arrivals column ── */}
          <div className="flex-1 py-1.5 min-w-0" style={{ borderRight: '1px solid rgba(148,163,184,0.08)' }}>
            <ColHeader label="Arriving" color="#38BDF8" />
            {arrivalsQueue.length === 0 ? (
              <div className="px-2 py-1 font-mono text-[9px] text-slate-700">—</div>
            ) : (
              arrivalsQueue.map(ac => (
                <ArrivalRow
                  key={ac.id}
                  ac={ac}
                  pinned={pinnedAcIds.has(ac.id)}
                  onClick={() => onSelectAc(ac.id)}
                  onPin={(e) => { e.stopPropagation(); onTogglePin(ac.id); }}
                />
              ))
            )}
          </div>

          {/* ── Departures column ── */}
          <div className="flex-1 py-1.5 min-w-0">
            <ColHeader label="Departing" color="#FB923C" />
            {departuresQueue.length === 0 ? (
              <div className="px-2 py-1 font-mono text-[9px] text-slate-700">—</div>
            ) : (
              departuresQueue.map(ac => (
                <DepartureRow
                  key={ac.id}
                  ac={ac}
                  pinned={pinnedAcIds.has(ac.id)}
                  onClick={() => onSelectAc(ac.id)}
                  onPin={(e) => { e.stopPropagation(); onTogglePin(ac.id); }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
