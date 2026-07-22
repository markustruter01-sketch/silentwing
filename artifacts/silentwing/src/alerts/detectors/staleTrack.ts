// ── Stale-track detector (Phase 6B) ──────────────────────────────────────────
//
// Raises an alert for each aircraft whose position data is too old to trust.
// This is the ONLY detector that operates ON stale tracks — all other detectors
// skip them.  Clears automatically when fresh data resumes.

import type { Aircraft } from '../../types';
import type { SWAlertSeverity } from '../types';

// ── Tunable constants ─────────────────────────────────────────────────────────
const STALE_ALERT_S    = 30;   // seconds before we alert (advisory tier starts)
const STALE_CAUTION_S  = 60;   // seconds before escalating to caution
/** Nearby-traffic radius for adding "near other traffic" note in the message. */
const NEARBY_RADIUS_M  = 10 * 1852; // 10 nm in metres

// ── Output shape ──────────────────────────────────────────────────────────────
export interface StaleTrackFinding {
  /** Stable dedup key — 'stale_track:<aircraftId>'. */
  key:          string;
  severity:     SWAlertSeverity;
  aircraft:     string[];   // single callsign in an array (engine interface consistency)
  aircraftIds:  string[];   // single id in an array
  message:      string;
}

// ── Detector ──────────────────────────────────────────────────────────────────
export function detectStaleTracks(aircraft: Aircraft[]): StaleTrackFinding[] {
  const findings: StaleTrackFinding[] = [];

  // Collect fresh aircraft for nearby-traffic checks
  const freshAircraft = aircraft.filter(ac => (ac.seenPos ?? 0) < STALE_ALERT_S);

  for (const ac of aircraft) {
    const staleSecs = ac.seenPos ?? 0;
    // Sim aircraft have seenPos undefined → treated as 0 (always fresh)
    if (staleSecs < STALE_ALERT_S) continue;

    const severity: SWAlertSeverity = staleSecs >= STALE_CAUTION_S ? 'caution' : 'advisory';
    const staleRounded = Math.round(staleSecs);

    // Check if any fresh aircraft are nearby (within NEARBY_RADIUS_M)
    const nearbyCount = freshAircraft.filter(other => {
      if (other.id === ac.id) return false;
      const dx = ac.position.x - other.position.x;
      const dy = ac.position.y - other.position.y;
      return dx * dx + dy * dy < NEARBY_RADIUS_M ** 2;
    }).length;

    const nearbyNote = nearbyCount > 0
      ? `, ${nearbyCount} aircraft nearby`
      : '';

    findings.push({
      key:         `stale_track:${ac.id}`,
      severity,
      aircraft:    [ac.callsign],
      aircraftIds: [ac.id],
      message:     `${ac.callsign} — track stale ${staleRounded} s, position may be unreliable${nearbyNote}`,
    });
  }

  return findings;
}
