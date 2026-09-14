// ─── Aircraft Detail Panel ───────────────────────────────────────────────────
//
// Rendered as an absolute overlay (inside <main>) whenever an aircraft is
// selected.  Works identically in both 2D and 3D views; follow mode controls
// are only meaningful in the 3D view.

import type { Aircraft } from '@/types';
import { isAirborne } from '@/types';

// ── Phase display metadata ────────────────────────────────────────────────────
const PHASE_LABEL: Record<string, string> = {
  'enroute-arrival':   'EN ROUTE (ARR)',
  'approach':          'APPROACH',
  'landing':           'LANDING',
  'taxi-in':           'TAXI IN',
  'at-gate':           'AT GATE',
  'taxi-out':          'TAXI OUT',
  'takeoff':           'TAKEOFF',
  'departure':         'DEPARTURE',
  'enroute-departure': 'EN ROUTE (DEP)',
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

// ── Sub-component ─────────────────────────────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] text-slate-600 tracking-widest uppercase leading-none">
        {label}
      </div>
      <div className="font-mono text-[11px] text-slate-200 tracking-wide mt-0.5 leading-none">
        {value}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface AircraftDetailPanelProps {
  ac:              Aircraft;
  /** 3D view only — false in 2D view */
  followMode:      boolean;
  onClose:         () => void;
  onToggleFollow:  () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AircraftDetailPanel({
  ac,
  followMode,
  onClose,
  onToggleFollow,
}: AircraftDetailPanelProps) {
  const phaseLabel = PHASE_LABEL[ac.phase] ?? ac.phase.toUpperCase();
  const phaseColor = PHASE_COLOR[ac.phase] ?? '#94A3B8';
  const airborne   = isAirborne(ac);

  return (
    <div
      className="absolute top-4 right-4 w-64 z-50 pointer-events-auto select-none overflow-hidden rounded-lg shadow-2xl"
      style={{
        background:   'rgba(10,14,22,0.92)',
        border:       '1px solid rgba(100,116,139,0.35)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2"
           style={{ borderBottom: '1px solid rgba(100,116,139,0.2)' }}>
        <div>
          <div className="font-mono text-base font-bold tracking-widest text-white leading-none">
            {ac.callsign}
          </div>
          <div className="font-mono text-[10px] text-slate-400 tracking-wider mt-0.5">
            {ac.type}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-200 text-lg leading-none mt-0.5 transition-colors px-1"
          title="Close [Esc]"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* ── Phase badge ── */}
      <div className="px-4 py-2" style={{ borderBottom: '1px solid rgba(100,116,139,0.12)' }}>
        <span
          className="font-mono text-[10px] tracking-widest px-2 py-0.5 rounded"
          style={{
            color:      phaseColor,
            background: phaseColor + '22',
            border:     `1px solid ${phaseColor}44`,
          }}
        >
          {phaseLabel}
        </span>
      </div>

      {/* ── Data fields — 2 columns ── */}
      {/* No squawk and no manifest: SilentWing has no feed for either. A
          hardcoded 7001 on every aircraft and a seeded-random passenger count
          are fabrications, not estimates, and must not appear on an operator
          display. Restore only when a real source exists. */}
      <div className="px-4 py-3 grid grid-cols-2 gap-y-3 gap-x-4">
        <Field label="ALT"
               value={airborne ? `${Math.round(ac.position.alt).toLocaleString()} ft` : 'GND'} />
        <Field label="GS"
               value={ac.groundSpeed > 0 ? `${ac.groundSpeed} kt` : '0 kt'} />
        <Field label="HDG"
               value={`${Math.round(ac.heading).toString().padStart(3, '0')}°`} />
        <Field label="GATE"
               value={ac.assignedGate ?? '—'} />
        <Field label="RWY"
               value={ac.assignedRunway ? ac.assignedRunway.replace('_', '/') : '—'} />
        <Field label="ORIGIN"      value={ac.origin      ?? '—'} />
        <Field label="DEST"        value={ac.destination ?? '—'} />
      </div>

      {/* ── Position (small) ── */}
      <div className="px-4 pb-2 font-mono text-[9px] text-slate-700 tracking-wider">
        {ac.position.x.toFixed(0)} E &nbsp;·&nbsp; {ac.position.y.toFixed(0)} S
        {airborne ? ` · ${Math.round(ac.position.alt)} ft` : ''}
      </div>

      {/* ── Follow button (3D view only; hidden hint in 2D) ── */}
      <div className="px-4 pb-3">
        <button
          onClick={onToggleFollow}
          className={[
            'w-full font-mono text-[10px] tracking-widest py-1.5 rounded border transition-colors',
            followMode
              ? 'bg-sky-900/60 border-sky-500/60 text-sky-300'
              : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-200 hover:border-slate-500',
          ].join(' ')}
        >
          {followMode ? '⬤ FOLLOWING  [Esc EXIT]' : '[DBLCLICK] FOLLOW'}
        </button>
      </div>
    </div>
  );
}
