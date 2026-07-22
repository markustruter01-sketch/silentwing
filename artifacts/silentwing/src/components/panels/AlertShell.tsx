// ── AlertShell — Phase 6A / Task #15 ─────────────────────────────────────────
//
// Left-edge vertical tab strip with 5 tabs.  Active-alert tab glows / pulses.
// Alerts are now displayed as 3D sprites directly in the airspace scene — the
// expanding card panel has been removed.

import { useEffect, useRef, useState } from 'react';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';

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

// ── Props ─────────────────────────────────────────────────────────────────────
interface AlertShellProps {
  activeAlerts: SWAlert[];
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AlertShell({ activeAlerts }: AlertShellProps) {
  const [activeTab,    setActiveTab]    = useState<TabId | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const chimmedRef     = useRef(new Set<string>());   // alert IDs already chimed
  const prevHighestRef = useRef<SWAlertSeverity | null>(null);

  // ── Highest severity of active alerts ───────────────────────────────────────
  const highest: SWAlertSeverity | null =
    activeAlerts.length === 0                              ? null
    : activeAlerts.some(a => a.severity === 'critical')   ? 'critical'
    : activeAlerts.some(a => a.severity === 'caution')    ? 'caution'
    : 'advisory';

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

  return (
    <div className="absolute left-0 inset-y-0 z-[120] flex pointer-events-none select-none">

      {/* ── Notebook tab spine (always visible, never expands) ───────────────── */}
      <div
        className="w-11 flex flex-col bg-[#06090D]/95 border-r border-slate-800/40 pointer-events-auto"
        style={{ boxShadow: '3px 0 14px rgba(0,0,0,0.65)' }}
      >
        {TABS.map((tab, idx) => {
          const isActive  = activeTab === tab.id;
          const count     = tab.id === 'alerts' ? activeAlerts.length : 0;
          const glowCls   = tab.id === 'alerts' ? alertsTabClass : '';

          // Left accent colour — drives the "section colour" of this notebook tab
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

        {/* ── Rest of the "page" below the tabs ──────────────────────────────── */}
        <div className="flex-1 border-b border-slate-800/30" />

        {/* ── Audio mute toggle ──────────────────────────────────────────────── */}
        <button
          onClick={() => setAudioEnabled(v => !v)}
          title={audioEnabled ? 'Mute alert audio' : 'Enable alert audio'}
          className="py-3 w-full text-center text-[13px] text-slate-700 hover:text-slate-400 cursor-pointer transition-colors"
        >
          {audioEnabled ? '🔔' : '🔕'}
        </button>
      </div>
    </div>
  );
}
