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
  /** Top offset in px — allows caller to push panel below DirectorFocusPanel */
  topOffset?: number;
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

// ── ArrivalRow ────────────────────────────────────────────────────────────────
function ArrivalRow({ ac, onClick }: { ac: Aircraft; onClick: () => void }) {
  // ETA proxy: format altitude as a rough "distance to threshold" indicator.
  // Lower altitude → closer to runway.  Displayed as "FLxxx" or "≤1000 ft".
  const altFt = Math.round(ac.position.alt);
  const etaLabel =
    altFt < 1000 ? '≤1k ft' :
    altFt < 5000 ? `${(altFt / 1000).toFixed(1)}k ft` :
    `FL${Math.round(altFt / 100).toString().padStart(3, '0')}`;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-2 py-1 rounded
                 hover:bg-slate-700/40 transition-colors text-left cursor-pointer group"
    >
      <PhaseBadge phase={ac.phase} />
      <span className="font-mono text-[10px] text-slate-200 tracking-wide flex-1 truncate group-hover:text-white">
        {ac.callsign}
      </span>
      <span className="font-mono text-[9px] text-slate-500 shrink-0">{ac.type}</span>
      <span className="font-mono text-[9px] text-sky-400/70 tabular-nums shrink-0">{etaLabel}</span>
    </button>
  );
}

// ── DepartureRow ──────────────────────────────────────────────────────────────
function DepartureRow({ ac, onClick }: { ac: Aircraft; onClick: () => void }) {
  // For departures show ground speed as activity indicator
  const gsLabel = ac.groundSpeed > 0 ? `${ac.groundSpeed}kt` : 'GND';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-2 py-1 rounded
                 hover:bg-slate-700/40 transition-colors text-left cursor-pointer group"
    >
      <PhaseBadge phase={ac.phase} />
      <span className="font-mono text-[10px] text-slate-200 tracking-wide flex-1 truncate group-hover:text-white">
        {ac.callsign}
      </span>
      <span className="font-mono text-[9px] text-slate-500 shrink-0">{ac.type}</span>
      <span className="font-mono text-[9px] text-orange-400/70 tabular-nums shrink-0">{gsLabel}</span>
    </button>
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
  topOffset = 440,
}: SequenceLadderProps) {
  const isEmpty = arrivalsQueue.length === 0 && departuresQueue.length === 0;

  return (
    <div
      className="absolute right-4 w-64 z-40 pointer-events-auto select-none overflow-hidden rounded-lg shadow-2xl"
      style={{
        top:            topOffset,
        background:     'rgba(7,10,22,0.92)',
        border:         '1px solid rgba(148,163,184,0.15)',
        backdropFilter: 'blur(8px)',
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
        <span className="font-mono text-[8px] text-slate-700 tabular-nums">
          {arrivalsQueue.length} arr · {departuresQueue.length} dep
        </span>
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
                <ArrivalRow key={ac.id} ac={ac} onClick={() => onSelectAc(ac.id)} />
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
                <DepartureRow key={ac.id} ac={ac} onClick={() => onSelectAc(ac.id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
