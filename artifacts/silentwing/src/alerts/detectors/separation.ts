// ── Separation-breach detector ────────────────────────────────────────────────
//
// Checks every pair of AIRBORNE, FRESH aircraft in a snapshot.
// "Fresh" = seenPos <= STALE_SKIP_S  (undefined / absent = sim aircraft = fresh).
//
// Horizontal distance uses the scene's metre coordinate system (x = east,
// y = south).  1 nm = 1852 m.
//
// Three severity tiers (tunable constants at top of file):
//   advisory : h < 5 nm  AND v < 1500 ft  — getting close
//   caution  : h < 3 nm  AND v < 1000 ft  — standard separation lost
//   critical : h < 1.5 nm AND v < 700 ft  — serious

import type { Aircraft } from '../../types';
import type { SWAlertSeverity } from '../types';

// ── Tunable constants ─────────────────────────────────────────────────────────
const NM = 1852; // metres per nautical mile

const ADVISORY_H_M  = 5.0  * NM; // 9260 m
const ADVISORY_V_FT = 1500;
const CAUTION_H_M   = 3.0  * NM; // 5556 m
const CAUTION_V_FT  = 1000;
const CRITICAL_H_M  = 1.5  * NM; // 2778 m
const CRITICAL_V_FT = 700;

/** Aircraft whose seen_pos exceeds this are skipped (stale track). */
const STALE_SKIP_S = 30;

// ── Output shape ──────────────────────────────────────────────────────────────
export interface SeparationFinding {
  /** Stable dedup key — 'separation:idA:idB' with IDs sorted. */
  key:          string;
  severity:     SWAlertSeverity;
  aircraft:     string[];  // callsigns (two entries)
  aircraftIds:  string[];  // IDs (two entries)
  message:      string;
}

// ── Detector ──────────────────────────────────────────────────────────────────
export function detectSeparation(aircraft: Aircraft[]): SeparationFinding[] {
  // Filter to airborne, fresh tracks only
  const airborne = aircraft.filter(
    ac => ac.position.alt > 50 && (ac.seenPos ?? 0) <= STALE_SKIP_S,
  );

  const findings: SeparationFinding[] = [];

  for (let i = 0; i < airborne.length; i++) {
    for (let j = i + 1; j < airborne.length; j++) {
      const a = airborne[i];
      const b = airborne[j];

      const dx      = a.position.x - b.position.x;
      const dy      = a.position.y - b.position.y;
      const hDistM  = Math.sqrt(dx * dx + dy * dy);
      const vDistFt = Math.abs(a.position.alt - b.position.alt);

      let severity: SWAlertSeverity | null = null;
      if      (hDistM < CRITICAL_H_M  && vDistFt < CRITICAL_V_FT)  severity = 'critical';
      else if (hDistM < CAUTION_H_M   && vDistFt < CAUTION_V_FT)   severity = 'caution';
      else if (hDistM < ADVISORY_H_M  && vDistFt < ADVISORY_V_FT)  severity = 'advisory';

      if (!severity) continue;

      const hNm = (hDistM / NM).toFixed(1);
      const vFt = Math.round(vDistFt);

      // Sort IDs for a stable key regardless of which aircraft is i vs j
      const [idA, idB] = [a.id, b.id].sort();
      const csA = a.id === idA ? a.callsign : b.callsign;
      const csB = a.id === idA ? b.callsign : a.callsign;

      findings.push({
        key:         `separation:${idA}:${idB}`,
        severity,
        aircraft:    [a.callsign, b.callsign],
        aircraftIds: [a.id,       b.id],
        message:     `${csA} & ${csB} — ${hNm} nm / ${vFt} ft`,
      });
    }
  }

  return findings;
}
