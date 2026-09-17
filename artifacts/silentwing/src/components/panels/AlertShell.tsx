import { useEffect, useMemo, useState } from 'react';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';
import { severityRank } from '@/alerts/types';
import type { Aircraft } from '@/types';

const SEVERITY: Record<SWAlertSeverity, {
  label: string;
  text: string;
  border: string;
  dot: string;
}> = {
  critical: { label: 'CRITICAL', text: 'text-red-100', border: 'border-red-400/60', dot: 'bg-red-400' },
  caution:  { label: 'CAUTION',  text: 'text-amber-100', border: 'border-amber-400/60', dot: 'bg-amber-400' },
  advisory: { label: 'ADVISORY', text: 'text-cyan-100', border: 'border-cyan-400/50', dot: 'bg-cyan-400' },
};

function ageLabel(raisedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - raisedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

function runwayForAlert(
  alert: SWAlert,
  aircraftById: Map<string, Aircraft>,
  activeRunwayDirection?: string,
): string | null {
  const assigned = alert.aircraftIds
    .map(id => aircraftById.get(id)?.assignedRunway)
    .find(Boolean);
  return assigned ?? activeRunwayDirection ?? null;
}

function advisoryValues(
  alert: SWAlert,
  aircraftById: Map<string, Aircraft>,
  activeRunwayDirection?: string,
): string[] {
  const values: string[] = [];

  if (alert.kind === 'stale_track') {
    const staleSeconds = alert.message.match(/track stale\s+(\d+)\s*s/i)?.[1];
    const staleAircraft = aircraftById.get(alert.aircraftIds[0]);
    const nearbyCount = staleAircraft
      ? [...aircraftById.values()].filter(other => {
          if (other.id === staleAircraft.id || (other.seenPos ?? 0) >= 30) return false;
          const dx = staleAircraft.position.x - other.position.x;
          const dy = staleAircraft.position.y - other.position.y;
          return dx * dx + dy * dy < (10 * 1852) ** 2;
        }).length.toString()
      : alert.message.match(/,\s*(\d+)\s+aircraft nearby/i)?.[1];
    if (staleSeconds) values.push(`STALE ${staleSeconds}s`);
    if (nearbyCount) values.push(`NEAR ${nearbyCount}`);
  } else if (alert.kind === 'separation') {
    const separation = alert.message.match(/—\s*([\d.]+)\s*nm\s*\/\s*(\d+)\s*ft/i);
    if (separation) {
      values.push(`SEP ${separation[1]} NM`);
      values.push(`VERT ${separation[2]} FT`);
    }
  } else if (alert.kind === 'predicted_conflict') {
    if (alert.extra?.predClosestNm != null) {
      values.push(`SEP ${alert.extra.predClosestNm.toFixed(1)} NM`);
    }
    if (alert.extra?.ttcSeconds != null) {
      values.push(`TTC ${alert.extra.ttcSeconds.toFixed(0)}s`);
    }
  } else if (alert.kind === 'runway_occupancy') {
    const runway = alert.message.match(/^Runway\s+([^\s—]+)/i)?.[1];
    if (runway) values.push(`RWY ${runway}`);
    if (alert.aircraft.length > 0) values.push(`AC ${alert.aircraft.length}`);
  }

  if (alert.kind === 'separation' || alert.kind === 'predicted_conflict') {
    const runway = runwayForAlert(alert, aircraftById, activeRunwayDirection);
    if (runway) values.push(`RWY ${runway}`);
  }

  return values;
}

function confidenceLabel(alert: SWAlert, aircraftById: Map<string, Aircraft>): string | null {
  const confidence = alert.aircraftIds
    .map(id => aircraftById.get(id)?.confidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (confidence.length === 0) return null;
  const average = confidence.reduce((sum, value) => sum + value, 0) / confidence.length;
  return `CONF ${Math.round(average * 100)}%`;
}

interface AlertShellProps {
  activeAlerts: SWAlert[];
  onAlertFocus: (alertId: string) => void;
  onDismiss: (id: string) => void;
  alertFocusId?: string | null;
  open: boolean;
  aircraft: Aircraft[];
  activeRunwayDirection?: string;
  photorealGroundEnabled?: boolean;
}

export default function AlertShell({
  activeAlerts,
  onAlertFocus,
  onDismiss,
  alertFocusId,
  open,
  aircraft,
  activeRunwayDirection,
  photorealGroundEnabled = false,
}: AlertShellProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sorted = useMemo(
    () => [...activeAlerts].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.raisedAt - a.raisedAt),
    [activeAlerts],
  );
  const aircraftById = useMemo(
    () => new Map(aircraft.map(ac => [ac.id, ac])),
    [aircraft],
  );
  const primary = sorted[0];
  if (!primary && !open) return null;

  const surface = photorealGroundEnabled
    ? 'sw-glass-panel sw-glass-panel-dense'
    : 'border border-white/15 bg-slate-950/85 backdrop-blur-xl';

  return (
    <section
      aria-label="Advisory"
      className="fixed bottom-4 left-4 z-[160] w-[430px] pointer-events-auto select-none"
    >
      {primary && (
        <article className={`${surface} overflow-hidden rounded-2xl shadow-2xl`}>
          <header className={`flex items-center gap-2 border-b ${SEVERITY[primary.severity].border} px-3 py-2`}>
            <span className={`h-2 w-2 rounded-full ${SEVERITY[primary.severity].dot}`} />
            <span className={`font-mono text-[10px] font-bold tracking-[0.2em] ${SEVERITY[primary.severity].text}`}>
              {SEVERITY[primary.severity].label}
            </span>
            {alertFocusId === primary.id && (
              <span className="rounded-full border border-amber-300/50 bg-amber-300/15 px-2 py-0.5 font-mono text-[8px] font-bold tracking-widest text-amber-100">
                CAMERA HERE
              </span>
            )}
            <button
              type="button"
              onClick={() => onDismiss(primary.id)}
              className="ml-auto rounded px-2 py-0.5 font-mono text-[9px] tracking-widest text-white/70 hover:bg-white/10 hover:text-white"
            >
              DISMISS
            </button>
          </header>
           <div className="px-3 py-2">
             <p className="whitespace-normal break-words font-mono text-[12px] leading-5 text-white" title={primary.message}>
              {primary.message}
            </p>
             {advisoryValues(primary, aircraftById, activeRunwayDirection).length > 0 && (
               <div className="mt-2 flex flex-wrap divide-x divide-white/15 border-y border-white/15 py-1.5">
               {advisoryValues(primary, aircraftById, activeRunwayDirection).map(value => (
                <span key={value} className="flex-1 px-2 text-center font-mono text-[10px] text-white first:pl-0 last:pr-0">
                  {value}
                </span>
              ))}
               </div>
             )}
             <footer className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[8px] tracking-widest text-white/70">
               {confidenceLabel(primary, aircraftById) && (
                 <span>{confidenceLabel(primary, aircraftById)}</span>
               )}
               <span className="ml-auto">AGE {ageLabel(primary.raisedAt, now)}</span>
            </footer>
          </div>
        </article>
      )}

      {open && (
        <div className={`${surface} mt-2 max-h-[310px] overflow-y-auto rounded-2xl shadow-2xl`}>
          <div className="flex items-center justify-between border-b border-white/15 px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.2em] text-white">ALERT QUEUE</span>
            <span className="font-mono text-[9px] text-white/70">{sorted.length} ACTIVE</span>
          </div>
          {sorted.length === 0 ? (
            <div className="px-3 py-4 font-mono text-[10px] text-white">No active alerts</div>
          ) : (
            sorted.map(alert => (
              <div key={alert.id} className="flex items-center gap-2 border-b border-white/10 px-3 py-2 last:border-0">
                <button
                  type="button"
                  onClick={() => onAlertFocus(alert.id)}
                  className="min-w-0 flex-1 text-left hover:bg-white/5"
                >
                  <span className={`font-mono text-[9px] font-bold tracking-widest ${SEVERITY[alert.severity].text}`}>
                    {SEVERITY[alert.severity].label}
                  </span>
                  <span className="ml-2 truncate font-mono text-[10px] text-white">{alert.message}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(alert.id)}
                  className="shrink-0 font-mono text-[8px] tracking-widest text-white/70 hover:text-white"
                >
                  DISMISS
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}