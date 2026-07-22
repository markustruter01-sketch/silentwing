// ── AlertEngine ────────────────────────────────────────────────────────────────
//
// Consumes WorldSnapshots (from any adapter — sim or live) and maintains the
// full alert state.  Rules:
//
//  • One active alert per unique aircraft-pair per kind (no per-poll spam).
//  • Alert ID is STABLE while the condition persists.
//  • clearedAt is set when the condition resolves; the alert stays in the log.
//  • Dismissed (acknowledged) alerts stay dismissed UNLESS the severity
//    ESCALATES, in which case a NEW alert is raised.
//  • Advisory alerts are included in the log but flagged so the UI can enforce
//    the no-auto-expand / no-sound rule.

import type { WorldSnapshot, Aircraft } from '../types';
import { detectSeparation }              from './detectors/separation';
import type { SWAlert, SWAlertSeverity } from './types';
import { severityRank }                  from './types';

let _nextId = 1;
function newId() { return `sw-${_nextId++}`; }

export class AlertEngine {
  /** One active alert per unique pair + kind.  Key = 'kind:idA:idB'. */
  private activeMap = new Map<string, SWAlert>();
  /** Complete append-only log — alerts are never deleted. */
  private log: SWAlert[] = [];

  /**
   * Process a snapshot.  Accepts optional extra Aircraft[] for test injection.
   * Returns ALL alerts (active + cleared + acknowledged) for the Alert Log.
   */
  process(snapshot: WorldSnapshot, extra: Aircraft[] = []): SWAlert[] {
    const allAircraft = [...snapshot.aircraft, ...extra];
    const now = snapshot.t;

    const findings = detectSeparation(allAircraft);
    const seen = new Set<string>();

    for (const f of findings) {
      seen.add(f.key);
      const existing = this.activeMap.get(f.key);

      if (!existing) {
        // ── Brand-new breach ──────────────────────────────────────────────
        const alert: SWAlert = {
          id:           newId(),
          kind:         'separation',
          severity:     f.severity,
          aircraft:     f.aircraft,
          aircraftIds:  f.aircraftIds,
          message:      f.message,
          raisedAt:     now,
          acknowledged: false,
        };
        this.activeMap.set(f.key, alert);
        this.log.push(alert);

      } else if (existing.acknowledged) {
        // ── Previously dismissed — re-raise ONLY on escalation ────────────
        if (severityRank(f.severity) > severityRank(existing.severity)) {
          const newAlert: SWAlert = {
            id:           newId(),
            kind:         'separation',
            severity:     f.severity,
            aircraft:     f.aircraft,
            aircraftIds:  f.aircraftIds,
            message:      f.message,
            raisedAt:     now,
            acknowledged: false,
          };
          this.activeMap.set(f.key, newAlert);
          this.log.push(newAlert);
        } else {
          // Same or lower severity — update message only (silent)
          existing.message = f.message;
        }

      } else {
        // ── Existing live alert — update in-place ─────────────────────────
        existing.severity  = f.severity;
        existing.message   = f.message;
        existing.clearedAt = undefined; // reopen if it was briefly cleared
      }
    }

    // ── Clear resolved pairs ──────────────────────────────────────────────────
    for (const [key, alert] of this.activeMap) {
      if (!seen.has(key) && !alert.clearedAt) {
        alert.clearedAt = now;
      }
    }

    return [...this.log];
  }

  /** Dismiss (acknowledge) an alert by id.  Writes acknowledgedAt timestamp. */
  dismiss(id: string): void {
    for (const alert of this.log) {
      if (alert.id === id) {
        alert.acknowledged    = true;
        alert.acknowledgedAt  = Date.now();
        return;
      }
    }
  }

  /** Full alert history — active + cleared + acknowledged. */
  getAllAlerts(): SWAlert[] {
    return [...this.log];
  }

  /** Highest severity among currently active (non-acknowledged, non-cleared) alerts. */
  getHighestSeverity(): SWAlertSeverity | null {
    let best: SWAlertSeverity | null = null;
    for (const alert of this.log) {
      if (alert.acknowledged || alert.clearedAt) continue;
      if (!best || severityRank(alert.severity) > severityRank(best)) {
        best = alert.severity;
      }
    }
    return best;
  }
}
