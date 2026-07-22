// ── AlertShell — Phase 6A ─────────────────────────────────────────────────────
//
// Left-edge vertical tab strip with 5 tabs.  Active-alert tab glows / pulses /
// auto-expands based on severity.  Respects advisory = no auto-expand / no sound.

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

// ── Small helpers ─────────────────────────────────────────────────────────────
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

const SEV_COLORS: Record<SWAlertSeverity, { badge: string; text: string; dot: string }> = {
  critical: {
    badge: 'bg-red-950/80 text-red-300 border-red-700/60',
    text:  'text-red-300',
    dot:   'bg-red-400',
  },
  caution: {
    badge: 'bg-amber-950/80 text-amber-300 border-amber-700/60',
    text:  'text-amber-300',
    dot:   'bg-amber-400',
  },
  advisory: {
    badge: 'bg-yellow-950/60 text-yellow-400 border-yellow-700/40',
    text:  'text-yellow-400',
    dot:   'bg-yellow-400',
  },
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface AlertShellProps {
  activeAlerts: SWAlert[];
  allAlerts:    SWAlert[];
  onDismiss:    (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AlertShell({ activeAlerts, allAlerts, onDismiss }: AlertShellProps) {
  const [expandedTab,  setExpandedTab]  = useState<TabId | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const chimmedRef     = useRef(new Set<string>());   // alert IDs already chimed
  const prevHighestRef = useRef<SWAlertSeverity | null>(null);

  // ── Highest severity of active (non-acked, non-cleared) alerts ──────────────
  const highest: SWAlertSeverity | null =
    activeAlerts.length === 0                              ? null
    : activeAlerts.some(a => a.severity === 'critical')   ? 'critical'
    : activeAlerts.some(a => a.severity === 'caution')    ? 'caution'
    : 'advisory';

  // ── Auto-expand + audio ─────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevHighestRef.current;
    prevHighestRef.current = highest;

    if (!highest) return;

    // Auto-expand Alerts tab for CAUTION or CRITICAL (not advisory — spec rule)
    if (highest === 'caution' || highest === 'critical') {
      setExpandedTab(t => (t === 'alerts' ? t : 'alerts'));
    }

    // Audio: single chime per critical alert ID, only when audioEnabled
    // ADVISORY: no sound — enforced by the severity check below
    if (audioEnabled && highest === 'critical') {
      for (const alert of activeAlerts) {
        if (alert.severity === 'critical' && !chimmedRef.current.has(alert.id)) {
          chimmedRef.current.add(alert.id);
          playChime(audioCtxRef);
          break; // one chime per event
        }
      }
    }
    // Suppress: advisory changes never trigger audio — no additional code needed
  }, [highest, activeAlerts, audioEnabled]);

  // ── Tab glow class (applied to Alerts tab only) ─────────────────────────────
  const alertsTabClass =
    highest === 'critical' ? 'alert-glow-critical' :
    highest === 'caution'  ? 'alert-glow-caution'  :
    highest === 'advisory' ? 'alert-glow-advisory'  : '';

  const toggleTab = (id: TabId) => setExpandedTab(t => (t === id ? null : id));

  return (
    <div className="absolute left-0 inset-y-0 z-[120] flex pointer-events-none select-none">

      {/* ── Icon strip (always visible) ───────────────────────────────────── */}
      <div className="w-9 flex flex-col bg-[#060A0F]/92 border-r border-slate-800/50 pointer-events-auto">
        {TABS.map(tab => {
          const isActive = expandedTab === tab.id;
          const count    = tab.id === 'alerts' ? activeAlerts.length
                         : tab.id === 'log'    ? allAlerts.length
                         : 0;
          const glowCls  = tab.id === 'alerts' ? alertsTabClass : '';
          const iconColor =
            tab.id === 'alerts' && highest === 'critical' ? 'text-red-400' :
            tab.id === 'alerts' && highest === 'caution'  ? 'text-amber-400' :
            tab.id === 'alerts' && highest === 'advisory' ? 'text-yellow-400' :
            isActive ? 'text-sky-400' : 'text-slate-500';

          return (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.id)}
              title={tab.label}
              className={[
                'relative flex flex-col items-center justify-center gap-0.5 py-3 px-0 w-full',
                'cursor-pointer transition-colors duration-150',
                isActive ? 'bg-slate-800/60' : 'hover:bg-slate-800/30',
                glowCls,
              ].join(' ')}
            >
              {/* Icon */}
              <span className={`text-[15px] leading-none ${iconColor}`}>{tab.icon}</span>

              {/* Rotated label */}
              <span
                className={`text-[6.5px] tracking-widest uppercase font-mono leading-none mt-0.5 ${isActive ? 'text-sky-400' : 'text-slate-600'}`}
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {tab.shortLabel}
              </span>

              {/* Count badge */}
              {count > 0 && (
                <span className={[
                  'text-[7px] font-mono font-bold leading-none mt-0.5 px-0.5 rounded-sm',
                  tab.id === 'alerts' && highest === 'critical' ? 'text-red-300 bg-red-950/70' :
                  tab.id === 'alerts' && highest === 'caution'  ? 'text-amber-300 bg-amber-950/70' :
                  tab.id === 'alerts' && highest === 'advisory' ? 'text-yellow-300 bg-yellow-950/70' :
                  'text-sky-400 bg-sky-950/60',
                ].join(' ')}>
                  {count}
                </span>
              )}

              {/* Active edge indicator */}
              {isActive && (
                <div className="absolute right-0 inset-y-0 w-[2px] bg-sky-600/60 rounded-l" />
              )}
            </button>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Audio toggle */}
        <button
          onClick={() => setAudioEnabled(v => !v)}
          title={audioEnabled ? 'Mute alert audio' : 'Enable alert audio'}
          className="flex items-center justify-center py-2 w-full text-[13px] text-slate-700 hover:text-slate-400 cursor-pointer transition-colors"
        >
          {audioEnabled ? '🔔' : '🔕'}
        </button>
      </div>

      {/* ── Expanded panel ─────────────────────────────────────────────────── */}
      {expandedTab && (
        <div className="w-[280px] flex flex-col bg-[#060A0F]/96 border-r border-slate-800/50 h-full overflow-hidden pointer-events-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/40 shrink-0">
            <span className="text-[9px] tracking-[0.22em] uppercase font-mono text-slate-400">
              {TABS.find(t => t.id === expandedTab)?.label}
            </span>
            <button
              onClick={() => setExpandedTab(null)}
              className="text-slate-600 hover:text-slate-300 text-base leading-none cursor-pointer transition-colors ml-2"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {expandedTab === 'alerts'    && <AlertsPanel alerts={activeAlerts} onDismiss={onDismiss} />}
            {expandedTab === 'conflicts' && <PlaceholderPanel message="No predicted conflicts" note="Phase 6B — Conflict Horizon" />}
            {expandedTab === 'traffic'   && <PlaceholderPanel message="No forecast data"       note="Phase 7 — Traffic Forecast" />}
            {expandedTab === 'weather'   && <PlaceholderPanel message="No weather impact"      note="Phase 7 — Weather Impact"   />}
            {expandedTab === 'log'       && <LogPanel alerts={allAlerts} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Alerts panel ──────────────────────────────────────────────────────────────
function AlertsPanel({ alerts, onDismiss }: { alerts: SWAlert[]; onDismiss: (id: string) => void }) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 gap-1 text-slate-600 font-mono text-[10px]">
        <span className="text-2xl opacity-20 mb-1">✓</span>
        No active alerts
      </div>
    );
  }

  const sorted = [...alerts].sort((a, b) => {
    const d = severityRank(b.severity) - severityRank(a.severity);
    return d !== 0 ? d : b.raisedAt - a.raisedAt;
  });

  return (
    <div className="flex flex-col">
      {sorted.map(alert => {
        const { badge, text, dot } = SEV_COLORS[alert.severity];
        return (
          <div
            key={alert.id}
            className="px-3 py-2.5 border-b border-slate-800/30 flex flex-col gap-1.5"
          >
            {/* Severity + callsigns */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-[7px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded border uppercase ${badge}`}>
                <span className={`w-1 h-1 rounded-full ${dot}`} />
                {alert.severity}
              </span>
              <span className="font-mono text-[11px] text-slate-200 tracking-wide">
                {alert.aircraft.join(' & ')}
              </span>
            </div>

            {/* Live numbers */}
            <p className={`text-[10px] font-mono leading-snug ${text}`}>
              {alert.message}
            </p>

            {/* Time + dismiss */}
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[9px] font-mono text-slate-700 tabular-nums">
                ↑ {fmtTime(alert.raisedAt)}
              </span>
              <button
                onClick={() => onDismiss(alert.id)}
                className="text-[8px] font-mono uppercase tracking-widest
                           px-2 py-0.5 rounded border border-slate-700/50
                           text-slate-500 hover:text-slate-200 hover:border-slate-500
                           cursor-pointer transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Log panel ────────────────────────────────────────────────────────────────
function LogPanel({ alerts }: { alerts: SWAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-28 text-slate-600 font-mono text-[10px]">
        No alerts logged yet
      </div>
    );
  }

  const sorted = [...alerts].sort((a, b) => b.raisedAt - a.raisedAt);

  return (
    <div className="flex flex-col">
      {sorted.map(alert => {
        const { badge } = SEV_COLORS[alert.severity];
        const status    = alert.acknowledged ? 'DISMISSED'
                        : alert.clearedAt    ? 'CLEARED'
                        :                      'ACTIVE';
        const statusColor =
          status === 'ACTIVE'     ? 'text-amber-600' :
          status === 'CLEARED'    ? 'text-green-700'  : 'text-slate-600';
        return (
          <div key={alert.id} className="px-3 py-2 border-b border-slate-800/20 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`text-[6.5px] font-mono font-bold tracking-widest px-1 py-px rounded border uppercase ${badge}`}>
                {alert.severity}
              </span>
              <span className="font-mono text-[9px] text-slate-400 tracking-wide">
                {alert.aircraft.join(' & ')}
              </span>
              <span className={`ml-auto text-[7px] font-mono tracking-wider ${statusColor}`}>
                {status}
              </span>
            </div>
            <p className="text-[9px] font-mono text-slate-600 leading-snug">{alert.message}</p>
            <div className="flex flex-wrap gap-x-3 text-[8px] font-mono text-slate-700 tabular-nums">
              <span>↑ {fmtTime(alert.raisedAt)}</span>
              {alert.clearedAt     && <span>↓ {fmtTime(alert.clearedAt)}</span>}
              {alert.acknowledgedAt && <span>✓ {fmtTime(alert.acknowledgedAt)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Placeholder panel ────────────────────────────────────────────────────────
function PlaceholderPanel({ message, note }: { message: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-28 gap-1">
      <span className="font-mono text-[10px] text-slate-500">{message}</span>
      <span className="font-mono text-[8px] text-slate-700">{note}</span>
    </div>
  );
}
