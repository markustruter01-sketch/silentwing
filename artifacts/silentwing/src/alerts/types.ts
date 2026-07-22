// ── SilentWing alert types (Phase 6A / 6B) ───────────────────────────────────
// These are INTERNAL alert types used by the AlertEngine and UI.
// They are separate from the legacy Alert type in src/types/index.ts so the
// existing adapter interfaces are not disturbed.

export type SWAlertSeverity = 'advisory' | 'caution' | 'critical';
export type SWAlertKind     =
  | 'separation'        // Phase 6A — current separation breach
  | 'predicted_conflict' // Phase 6B — straight-line projected breach
  | 'runway_occupancy'  // Phase 6B — 2+ aircraft in same runway corridor
  | 'stale_track';      // Phase 6B — track data too old to trust

export interface SWAlert {
  id:            string;
  kind:          SWAlertKind;
  severity:      SWAlertSeverity;
  /** Human-readable callsigns of the involved aircraft (for display). */
  aircraft:      string[];
  /** Internal hex / sim IDs (for 3-D view highlighting). */
  aircraftIds:   string[];
  /** One-line plain-language reason, e.g. "QFA523 & VOZ711 — 2.1 nm / 600 ft" */
  message:       string;
  raisedAt:      number;   // epoch ms
  clearedAt?:    number;   // set when the condition resolves
  acknowledged:  boolean;  // true after controller dismisses
  acknowledgedAt?: number;

  /** Phase 6B — extra data for Conflict Horizon tab */
  extra?: {
    /** Time-to-conflict in seconds (predicted_conflict only) */
    ttcSeconds?:    number;
    /** Predicted closest horizontal separation in nm (predicted_conflict only) */
    predClosestNm?: number;
    /** Predicted closest vertical separation in ft (predicted_conflict only) */
    predClosestFt?: number;
  };
}

/** Numeric rank so severities can be compared: critical > caution > advisory. */
export function severityRank(s: SWAlertSeverity): number {
  return s === 'critical' ? 3 : s === 'caution' ? 2 : 1;
}
