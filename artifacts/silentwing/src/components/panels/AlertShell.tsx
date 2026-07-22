// ── AlertShell — Phase 6A / Task #15 ─────────────────────────────────────────
//
// Left-edge vertical tab strip with 5 tabs.  Active-alert tab glows / pulses.
// Clicking the ALERTS tab opens a sorted alert-list panel; clicking an alert
// row fires onAlertFocus(alertId) so the 3-D camera can focus on it.

import { useEffect, useRef, useState } from 'react';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';
import { severityRank } from '@/alerts/types';

// ── Audio chime (Web Audio API — zero file dependencies) ──────────────────────
function playChime(ctxRef: React.MutableRefObject<AudioContext | null>): void {
  try {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx  = ctxRef.current;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.20, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.70);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.70);
  } catch {
    /* silently ignore — AudioContext may not be available yet */
  }
}

// ── Tab definitions ───────────────────────────────────────────────────────────
type TabId = 'alerts' | 'conflicts' | 'traffic' | 'weather' | 'log';
interface TabDef { id: TabId; icon: string; label: string; shortLabel: string }

const TABS: TabDef[] = [
  { id: 'alerts',    icon: '⚠',  label: 'Alerts',           shortLabel: 'ALERTS'    },
  { id: 'conflicts', icon: '◆',  label: 'Conflict Horizon', shortLabel: 'CONFLICT'  },
  { id: 'traffic',   icon: '↕',  label: 'Traffic Forecast', shortLabel: 'TRAFFIC'   },
  { id: 'weather',   icon: '☁',  label: 'Weather Impact',   shortLabel: 'WEATHER'   },
  { id: 'log',       icon: '≡',  label: 'Alert Log',        shortLabel: 'LOG'       },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const KIND_LABEL: Record<string, string> = {
  separation:         'SEP',
  predicted_conflict: 'PRED',
  runway_occupancy:   'RWY',
  stale_track:        'STALE',
};

const KIND_ICON: Record<string, string> = {
  separation:         '◆',
  predicted_conflict: '△',
  runway_occupancy:   '▬',
  stale_track:        '⌛',
};

function fmtAge(raisedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - raisedAt) / 1000));
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h`;
}

// Severity display config
const SEV_CFG = {
  critical: {
    bar:   'bg-red-500',
    pill:  'bg-red-950/80 text-red-300 ring-1 ring-red-700/50',
    label: 'CRITICAL',
    text:  'text-red-300',
    hover: 'hover:bg-red-950/15',
  },
  caution: {
    bar:   'bg-amber-500',
    pill:  'bg-amber-950/80 text-amber-300 ring-1 ring-amber-700/50',
    label: 'CAUTION',
    text:  'text-amber-300',
    hover: 'hover:bg-amber-950/15',
  },
  advisory: {
    bar:   'bg-yellow-500',
    pill:  'bg-yellow-950/60 text-yellow-300',
    label: 'ADVISORY',
    text:  'text-yellow-300',
    hover: 'hover:bg-yellow-950/10',
  },
} as const;

// ── Props ─────────────────────────────────────────────────────────────────────
interface AlertShellProps {
  activeAlerts:  SWAlert[];
  onAlertFocus?: (alertId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AlertShell({ activeAlerts, onAlertFocus }: AlertShellProps) {
  const [activeTab,    setActiveTab]    = useState<TabId | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [nowMs,        setNowMs]        = useState(() => Date.now());

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const chimmedRef     = useRef(new Set<string>());   // alert IDs already chimed
  const prevHighestRef = useRef<SWAlertSeverity | null>(null);

  // ── Highest severity of active alerts ───────────────────────────────────────
  const highest: SWAlertSeverity | null =
    activeAlerts.length === 0                              ? null
    : activeAlerts.some(a => a.severity === 'critical')   ? 'critical'
    : activeAlerts.some(a => a.severity === 'caution')    ? 'caution'
    : 'advisory';

  // ── Live age ticker — only runs while the alerts panel is open ──────────────
  useEffect(() => {
    if (activeTab !== 'alerts') return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [activeTab]);

  // ── Audio chime — critical alerts only ─────────────────────────────────────
  useEffect(() => {
    prevHighestRef.current = highest;
    if (!highest) return;

    if (audioEnabled && highest === 'critical') {
      for (const alert of activeAlerts) {
        if (alert.severity === 'critical' && !chimmedRef.current.has(alert.id)) {
          chimmedRef.current.add(alert.id);
          playChime(audioCtxRef);
          break;
        }
      }
    }
  }, [highest, activeAlerts, audioEnabled]);

  // ── Tab glow class (Alerts tab only) ────────────────────────────────────────
  const alertsTabClass =
    highest === 'critical' ? 'alert-glow-critical' :
    highest === 'caution'  ? 'alert-glow-caution'  :
    highest === 'advisory' ? 'alert-glow-advisory'  : '';

  const toggleTab = (id: TabId) => setActiveTab(t => (t === id ? null : id));

  // ── Sorted alert list (critical → caution → advisory, newest first within tier)
  const sortedAlerts = [...activeAlerts].sort((a, b) => {
    const rankDiff = severityRank(b.severity) - severityRank(a.severity);
    return rankDiff !== 0 ? rankDiff : b.raisedAt - a.raisedAt;
  });

  // ── Alert panel badge colour ─────────────────────────────────────────────────
  const badgeCls =
    highest === 'critical' ? 'text-red-300 bg-red-950/80 ring-1 ring-red-700/50' :
    highest === 'caution'  ? 'text-amber-300 bg-amber-950/80 ring-1 ring-amber-700/50' :
    highest === 'advisory' ? 'text-yellow-300 bg-yellow-950/60' :
    'text-sky-400 bg-sky-950/70';

  return (
    <div className="absolute left-0 inset-y-0 z-[120] flex pointer-events-none select-none">

      {/* ── Notebook tab spine (always visible) ──────────────────────────────── */}
      <div
        className="w-11 flex flex-col h-fit bg-[#06090D]/95 border-r border-b border-slate-800/40 pointer-events-auto rounded-br"
        style={{ boxShadow: '3px 0 14px rgba(0,0,0,0.65)' }}
      >
        {TABS.map((tab, idx) => {
          const isActive  = activeTab === tab.id;
          const count     = tab.id === 'alerts' ? activeAlerts.length : 0;
          const glowCls   = tab.id === 'alerts' ? alertsTabClass : '';

          const accentRgb =
            tab.id === 'alerts' && highest === 'critical' ? '239,68,68'    :
            tab.id === 'alerts' && highest === 'caution'  ? '245,158,11'   :
            tab.id === 'alerts' && highest === 'advisory' ? '250,204,21'   :
            isActive                                       ? '56,189,248'   : '51,65,85';

          const labelColor =
            tab.id === 'alerts' && highest === 'critical' ? 'text-red-400'    :
            tab.id === 'alerts' && highest === 'caution'  ? 'text-amber-400'  :
            tab.id === 'alerts' && highest === 'advisory' ? 'text-yellow-400' :
            isActive ? 'text-sky-400' : 'text-slate-500';

          return (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.id)}
              title={tab.label}
              className={[
                'relative flex flex-col items-center justify-center py-[14px] px-0 w-full',
                'cursor-pointer transition-colors duration-150 group',
                idx < TABS.length - 1 ? 'border-b border-slate-800/40' : '',
                isActive ? 'bg-slate-800/45' : 'hover:bg-slate-800/20',
                glowCls,
              ].join(' ')}
            >
              {/* ── Coloured left accent bar ─────────────────────────────────── */}
              <div
                className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full transition-all duration-200"
                style={{
                  background: `rgb(${accentRgb})`,
                  opacity:     isActive || count > 0 ? 0.9 : 0.25,
                }}
              />

              {/* ── Count badge (Alerts tab only, when non-zero) ─────────────── */}
              {count > 0 && (
                <span className={[
                  'text-[8px] font-mono font-bold leading-none mb-2 min-w-[16px] text-center',
                  'px-1 py-px rounded-sm',
                  tab.id === 'alerts' && highest === 'critical' ? 'text-red-300 bg-red-950/80 ring-1 ring-red-700/50' :
                  tab.id === 'alerts' && highest === 'caution'  ? 'text-amber-300 bg-amber-950/80 ring-1 ring-amber-700/50' :
                  tab.id === 'alerts' && highest === 'advisory' ? 'text-yellow-300 bg-yellow-950/80' :
                  'text-sky-400 bg-sky-950/70',
                ].join(' ')}>
                  {count}
                </span>
              )}

              {/* ── Section label — rotated, notebook-tab style ──────────────── */}
              <span
                className={`font-mono uppercase font-medium tracking-[0.2em] text-[8px] leading-none transition-colors duration-150 ${labelColor}`}
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {tab.shortLabel}
              </span>

              {/* ── Icon below the label ──────────────────────────────────────── */}
              <span className={`text-[11px] leading-none mt-2 transition-colors duration-150 ${labelColor}`}>
                {tab.icon}
              </span>

              {/* ── Right edge — active indicator ─────────────────────────────── */}
              {isActive && (
                <div
                  className="absolute right-0 top-0 bottom-0 w-[2px]"
                  style={{ background: `rgb(${accentRgb})`, opacity: 0.5 }}
                />
              )}
            </button>
          );
        })}

        {/* ── Audio mute toggle ──────────────────────────────────────────────── */}
        <button
          onClick={() => setAudioEnabled(v => !v)}
          title={audioEnabled ? 'Mute alert audio' : 'Enable alert audio'}
          className="py-3 w-full text-center text-[13px] text-slate-700 hover:text-slate-400 cursor-pointer transition-colors"
        >
          {audioEnabled ? '🔔' : '🔕'}
        </button>
      </div>

      {/* ── Alert list panel — appears to the right of the spine ─────────────── */}
      {activeTab === 'alerts' && (
        <div
          className="w-72 h-full bg-[#05080D]/98 border-r border-slate-800/40 pointer-events-auto flex flex-col"
          style={{ boxShadow: '6px 0 24px rgba(0,0,0,0.75)' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/50 shrink-0">
            <span className="font-mono text-[9px] tracking-[0.25em] text-slate-500 uppercase">
              Active Alerts
            </span>
            <span className={`font-mono text-[8px] font-bold px-1.5 py-px rounded-sm ${badgeCls}`}>
              {activeAlerts.length}
            </span>
          </div>

          {/* Alert rows */}
          <div className="flex-1 overflow-y-auto">
            {sortedAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
                <span className="text-slate-700 text-xl">✓</span>
                <span className="font-mono text-[9px] tracking-[0.2em] text-slate-700 uppercase">
                  No active alerts
                </span>
              </div>
            ) : (
              sortedAlerts.map(alert => {
                const cfg = SEV_CFG[alert.severity];
                return (
                  <button
                    key={alert.id}
                    onClick={() => {
                      onAlertFocus?.(alert.id);
                      setActiveTab(null); // close panel so the view is unobstructed
                    }}
                    title="Click to focus camera on this alert for 10 seconds"
                    className={[
                      'relative w-full text-left border-b border-slate-800/30',
                      'transition-colors duration-100 cursor-pointer group',
                      'pl-4 pr-3 py-2.5',
                      cfg.hover,
                    ].join(' ')}
                  >
                    {/* Left severity bar */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${cfg.bar}`} />

                    {/* Top row: severity pill + kind badge + age */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`font-mono text-[7px] font-bold tracking-widest px-1.5 py-px rounded-sm ${cfg.pill}`}>
                        {cfg.label}
                      </span>
                      <span className="font-mono text-[7px] tracking-widest text-slate-600 px-1 py-px rounded-sm bg-slate-900/60">
                        {KIND_ICON[alert.kind]} {KIND_LABEL[alert.kind] ?? alert.kind.toUpperCase()}
                      </span>
                      <span className="ml-auto font-mono text-[8px] text-slate-600 tabular-nums">
                        {fmtAge(alert.raisedAt, nowMs)}
                      </span>
                    </div>

                    {/* Middle row: involved aircraft callsigns */}
                    <div className={`font-mono text-[11px] font-bold tracking-wider leading-tight ${cfg.text}`}>
                      {alert.aircraft.join(' & ')}
                    </div>

                    {/* Bottom row: alert message */}
                    <div className="font-mono text-[8px] text-slate-500 mt-0.5 leading-tight break-words whitespace-normal line-clamp-3">
                      {alert.message}
                    </div>

                    {/* Hover focus hint — right edge arrow */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className={`text-[10px] ${cfg.text}`}>→</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Panel footer */}
          <div className="px-3 py-2 border-t border-slate-800/30 shrink-0">
            <span className="font-mono text-[8px] text-slate-700 leading-tight">
              Click an alert to focus the camera for 10 s
            </span>
          </div>
        </div>
      )}

      {/* ── Placeholder panels for other tabs (to be built out in later phases) ─ */}
      {activeTab !== null && activeTab !== 'alerts' && (
        <div
          className="w-64 h-full bg-[#05080D]/98 border-r border-slate-800/40 pointer-events-auto flex flex-col items-center justify-center gap-2"
          style={{ boxShadow: '6px 0 24px rgba(0,0,0,0.75)' }}
        >
          <span className="text-slate-700 text-2xl">
            {TABS.find(t => t.id === activeTab)?.icon}
          </span>
          <span className="font-mono text-[9px] tracking-[0.25em] text-slate-700 uppercase">
            {TABS.find(t => t.id === activeTab)?.label}
          </span>
          <span className="font-mono text-[8px] text-slate-800">Coming soon</span>
        </div>
      )}
    </div>
  );
}
