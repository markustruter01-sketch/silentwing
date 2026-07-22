// ── AlertEngine ────────────────────────────────────────────────────────────────
//
// Consumes WorldSnapshots (from any adapter — sim or live) and maintains the
// full alert state.  Rules:
//
//  • One active alert per unique key per kind (no per-poll spam).
//  • Alert ID is STABLE while the condition persists.
//  • clearedAt is set when the condition resolves; the alert stays in the log.
//  • Dismissed (acknowledged) alerts stay dismissed UNLESS the severity
//    ESCALATES, in which case a NEW alert is raised.
//  • Advisory alerts are included in the log but flagged so the UI can enforce
//    the no-auto-expand / no-sound rule.

import type { WorldSnapshot, Aircraft } from '../types';
import { detectSeparation }              from './detectors/separation';
import { detectPredictedConflict }       from './detectors/predictedConflict';
import { detectRunwayOccupancy }         from './detectors/runwayOccupancy';
import { detectStaleTracks }             from './detectors/staleTrack';
import type { SWAlert, SWAlertSeverity, SWAlertKind } from './types';
import { severityRank }                  from './types';
import type { AirportProfile }           from '../airports/types';

let _nextId = 1;
function newId() { return `sw-${_nextId++}`; }

// ── Generic finding shape ─────────────────────────────────────────────────────
// Every detector must produce findings that conform to this interface so the
// engine can process them uniformly.
interface DetectorFinding {
  key:          string;
  kind:         SWAlertKind;
  severity:     SWAlertSeverity;
  aircraft:     string[];
  aircraftIds:  string[];
  message:      string;
  extra?: SWAlert['extra'];
}

export class AlertEngine {
  /** One active alert per unique key.  Key encodes kind + involved IDs. */
  private activeMap = new Map<string, SWAlert>();
  /**
   * Alert log. Bounded: resolved (cleared or acknowledged) alerts beyond
   * LOG_CAP are pruned oldest-first. Unbounded growth froze long sessions —
   * every poll copied and re-rendered an ever-growing array (worst at busy
   * airports where O(n²) pairwise advisories churn constantly).
   * Live (active, un-acknowledged) alerts are NEVER pruned.
   */
  private log: SWAlert[] = [];
  private static readonly LOG_CAP = 300;
  /** Cleared conditions may reopen the SAME alert within this window (ms). */
  private static readonly REOPEN_GRACE_MS = 60_000;
  /** Active airport profile — passed to all detectors. */
  private profile: AirportProfile;

  constructor(profile: AirportProfile) {
    this.profile = profile;
  }

  /**
   * Process a snapshot.  Accepts optional extra Aircraft[] for test injection.
   * Returns ALL alerts (active + cleared + acknowledged) for the Alert Log.
   */
  process(snapshot: WorldSnapshot, extra: Aircraft[] = []): SWAlert[] {
    const allAircraft = [...snapshot.aircraft, ...extra];
    const now = snapshot.t;

    // ── 1. Separation (Phase 6A) ──────────────────────────────────────────────
    const sepFindings = detectSeparation(allAircraft, this.profile).map(f => ({
      ...f,
      kind: 'separation' as SWAlertKind,
    }));

    // Build a set of uncleared separation-alert pair keys so the predicted-conflict
    // detector can suppress double-alerting the same pair.
    // Rule: "current breach wins" — suppress predicted_conflict whenever a separation
    // breach is geometrically active (clearedAt unset), regardless of acknowledgment.
    const activeSepKeys = new Set<string>(
      [...this.activeMap.entries()]
        .filter(([, a]) => a.kind === 'separation' && !a.clearedAt)
        .map(([key]) => key),
    );
    // Also include freshly-found separation findings (they become active this tick)
    for (const f of sepFindings) activeSepKeys.add(f.key);

    // ── 2. Predicted conflict (Phase 6B) ──────────────────────────────────────
    const predFindings = detectPredictedConflict(allAircraft, activeSepKeys, this.profile).map(f => ({
      key:         f.key,
      kind:        'predicted_conflict' as SWAlertKind,
      severity:    f.severity,
      aircraft:    f.aircraft,
      aircraftIds: f.aircraftIds,
      message:     f.message,
      extra: {
        ttcSeconds:    f.ttcSeconds,
        predClosestNm: f.predClosestNm,
        predClosestFt: f.predClosestFt,
      },
    }));

    // ── 3. Runway occupancy (Phase 6B) ────────────────────────────────────────
    const rwyFindings = detectRunwayOccupancy(allAircraft, this.profile).map(f => ({
      ...f,
      kind: 'runway_occupancy' as SWAlertKind,
    }));

    // ── 4. Stale tracks (Phase 6B) ────────────────────────────────────────────
    const staleFindings = detectStaleTracks(allAircraft).map(f => ({
      ...f,
      kind: 'stale_track' as SWAlertKind,
    }));

    // ── 5. Merge all findings and process uniformly ───────────────────────────
    const allFindings: DetectorFinding[] = [
      ...sepFindings,
      ...predFindings,
      ...rwyFindings,
      ...staleFindings,
    ];

    const seen = new Set<string>();

    for (const f of allFindings) {
      seen.add(f.key);
      const existing = this.activeMap.get(f.key);

      if (!existing) {
        // Brand-new breach
        const alert: SWAlert = {
          id:           newId(),
          kind:         f.kind,
          severity:     f.severity,
          aircraft:     f.aircraft,
          aircraftIds:  f.aircraftIds,
          message:      f.message,
          raisedAt:     now,
          acknowledged: false,
          extra:        f.extra,
        };
        this.activeMap.set(f.key, alert);
        this.log.push(alert);

      } else if (existing.acknowledged) {
        // Previously dismissed — re-raise ONLY on escalation
        if (severityRank(f.severity) > severityRank(existing.severity)) {
          const newAlert: SWAlert = {
            id:           newId(),
            kind:         f.kind,
            severity:     f.severity,
            aircraft:     f.aircraft,
            aircraftIds:  f.aircraftIds,
            message:      f.message,
            raisedAt:     now,
            acknowledged: false,
            extra:        f.extra,
          };
          this.activeMap.set(f.key, newAlert);
          this.log.push(newAlert);
        } else {
          // Same or lower severity — update message/extra silently
          existing.message = f.message;
          existing.extra   = f.extra;
        }

      } else {
        // Existing live alert — update in-place
        existing.severity  = f.severity;
        existing.message   = f.message;
        existing.extra     = f.extra;
        // Update aircraft list (runway occupancy may gain/lose occupants)
        existing.aircraft    = f.aircraft;
        existing.aircraftIds = f.aircraftIds;
        existing.clearedAt   = undefined; // reopen if briefly cleared
      }
    }

    // ── 6. Clear resolved conditions ──────────────────────────────────────────
    for (const [key, alert] of this.activeMap) {
      if (!seen.has(key) && !alert.clearedAt) {
        alert.clearedAt = now;
      }
    }

    // ── 7. Bounded state — long sessions must not grow memory unbounded ──────
    //
    // activeMap: cleared entries stay for REOPEN_GRACE_MS so a briefly-cleared
    // condition reopens the SAME alert (rule above). After the grace window the
    // condition is genuinely over; a recurrence is a NEW event and may raise a
    // new alert (even if the old one was dismissed — dismissal applies to the
    // persisting condition, not to future occurrences).
    //
    // Entries whose condition is still active (clearedAt unset) are NEVER
    // evicted, acknowledged or not — this preserves both the
    // "dismissed stays dismissed unless severity escalates" rule and ID
    // stability for live alerts.
    for (const [key, alert] of this.activeMap) {
      if (alert.clearedAt !== undefined && now - alert.clearedAt > AlertEngine.REOPEN_GRACE_MS) {
        this.activeMap.delete(key);
      }
    }

    // log: prune oldest-first, but ONLY alerts that are cleared AND no longer
    // resident in activeMap (i.e. fully finished — cannot reopen in place).
    if (this.log.length > AlertEngine.LOG_CAP) {
      const resident = new Set([...this.activeMap.values()]);
      let excess = this.log.length - AlertEngine.LOG_CAP;
      this.log = this.log.filter(a => {
        if (excess <= 0) return true;
        if (a.clearedAt !== undefined && !resident.has(a)) { excess--; return false; }
        return true;
      });
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
