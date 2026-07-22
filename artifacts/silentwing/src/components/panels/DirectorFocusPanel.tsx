// ─── Director Focus Panel ──────────────────────────────────────────────────────
//
// Single popup that replaces both the old AircraftDetailPanel and the director
// flight-info box.  Rendered ONLY while the director is actively following
// an aircraft (directorMode && cameraMode === 'follow').
//
// Left accent bar uses purple (director) when following.
// Close button and Esc both call onClose which drops out of director follow mode.

import type { Aircraft } from '@/types';
import { isAirborne } from '@/types';

// ── Phase display metadata ─────────────────────────────────────────────────────
const PHASE_LABEL: Record<string, string> = {
  'enroute-arrival':   'EN ROUTE ARR',
  'approach':          'APPROACH',
  'landing':           'LANDING',
  'taxi-in':           'TAXI IN',
  'at-gate':           'AT GATE',
  'taxi-out':          'TAXI OUT',
  'takeoff':           'TAKEOFF',
  'departure':         'DEPARTURE',
  'enroute-departure': 'EN ROUTE DEP',
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

// ── Seeded RNG — same seed as before so manifest values stay stable ───────────
function seededRng(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (Math.imul(2654435769, h) ^ (h >>> 16)) | 0;
    return (h >>> 0) / 0xFFFFFFFF;
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[8px] text-slate-600 tracking-widest uppercase leading-none">
        {label}
      </div>
      <div className={[
        'font-mono text-[11px] tracking-wide mt-0.5 leading-none',
        highlight ? 'text-amber-400' : 'text-slate-200',
      ].join(' ')}>
        {value}
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────
export interface DirectorFocusPanelProps {
  ac:      Aircraft;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function DirectorFocusPanel({ ac, onClose }: DirectorFocusPanelProps) {
  const phaseLabel = PHASE_LABEL[ac.phase] ?? ac.phase.toUpperCase().replace(/-/g, ' ');
  const phaseColor = PHASE_COLOR[ac.phase] ?? '#94A3B8';
  const airborne   = isAirborne(ac);

  // Stable manifest values seeded from the aircraft hex ID
  const rng        = seededRng(ac.id);
  const pax        = Math.round(rng() * 150 + 50);
  const crew       = Math.round(rng() * 5  + 2);
  const hasDG      = rng() < 0.15;
  const hasAnimals = rng() < 0.10;

  const orig = ac.origin      ?? '—';
  const dest = ac.destination ?? '—';

  return (
    <div
      className="absolute top-4 right-4 w-64 z-50 pointer-events-auto select-none overflow-hidden rounded-lg shadow-2xl"
      style={{
        background:     'rgba(7,10,22,0.95)',
        border:         '1px solid rgba(168,85,247,0.35)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Purple accent bar — signals director mode */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-purple-500" />

      {/* ── Header ── */}
      <div className="pl-5 pr-3 pt-3 pb-2 flex items-start justify-between"
           style={{ borderBottom: '1px solid rgba(168,85,247,0.15)' }}>
        <div>
          <div className="font-mono text-base font-bold tracking-widest text-purple-200 leading-none">
            {ac.callsign}
          </div>
          <div className="font-mono text-[10px] text-slate-500 tracking-wider mt-0.5">
            {ac.type || '—'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-200 text-lg leading-none mt-0.5 transition-colors px-1"
          title="Close [Esc]"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* ── Phase badge + route ── */}
      <div className="pl-5 pr-3 py-2 flex items-center justify-between"
           style={{ borderBottom: '1px solid rgba(168,85,247,0.10)' }}>
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
        <span className="font-mono text-[11px] text-sky-300/80 tracking-wide">
          {orig} <span className="text-slate-600 mx-1">›</span> {dest}
        </span>
      </div>

      {/* ── Flight data — 2-column grid ── */}
      <div className="pl-5 pr-3 py-3 grid grid-cols-2 gap-y-3 gap-x-4"
           style={{ borderBottom: '1px solid rgba(168,85,247,0.10)' }}>
        <Field label="ALT"
               value={airborne ? `${Math.round(ac.position.alt).toLocaleString()} ft` : 'GND'} />
        <Field label="GS"
               value={ac.groundSpeed > 0 ? `${ac.groundSpeed} kt` : '0 kt'} />
        <Field label="HDG"
               value={`${Math.round(ac.heading).toString().padStart(3, '0')}°`} />
        <Field label="SQUAWK" value="7001" />
        <Field label="GATE"
               value={ac.assignedGate ?? '—'} />
        <Field label="RWY"
               value={ac.assignedRunway ? ac.assignedRunway.replace('_', '/') : '—'} />
      </div>

      {/* ── Manifest ── */}
      <div className="pl-5 pr-3 py-3 grid grid-cols-[44px_1fr] gap-y-1.5 text-xs font-mono"
           style={{ borderBottom: '1px solid rgba(168,85,247,0.10)' }}>
        <span className="text-slate-600 uppercase text-[8px] tracking-widest pt-px">PAX</span>
        <span className="text-slate-300 text-[11px]">{pax} passengers</span>
        <span className="text-slate-600 uppercase text-[8px] tracking-widest pt-px">CREW</span>
        <span className="text-slate-300 text-[11px]">{crew} crew</span>
        <span className="text-slate-600 uppercase text-[8px] tracking-widest pt-px">DG</span>
        <span className={['text-[11px]', hasDG ? 'text-amber-400' : 'text-slate-500'].join(' ')}>
          {hasDG ? '⚠ Dangerous goods' : 'None declared'}
        </span>
        <span className="text-slate-600 uppercase text-[8px] tracking-widest pt-px">ANIM</span>
        <span className={['text-[11px]', hasAnimals ? 'text-green-300' : 'text-slate-500'].join(' ')}>
          {hasAnimals ? '🐾 Live animals' : 'None declared'}
        </span>
      </div>

      {/* ── Position line ── */}
      <div className="pl-5 pr-3 pt-2 pb-1 font-mono text-[9px] text-slate-700 tracking-wider">
        {ac.position.x.toFixed(0)} E &nbsp;·&nbsp; {ac.position.y.toFixed(0)} S
        {airborne ? ` · ${Math.round(ac.position.alt)} ft` : ''}
      </div>

      {/* ── Following button ── */}
      <div className="pl-5 pr-3 pb-3">
        <button
          onClick={onClose}
          className="w-full font-mono text-[10px] tracking-widest py-1.5 rounded border transition-colors
                     bg-purple-900/40 border-purple-500/50 text-purple-300 hover:bg-purple-900/60"
        >
          ⬤ FOLLOWING &nbsp; [Esc EXIT]
        </button>
      </div>
    </div>
  );
}
