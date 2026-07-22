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

// ── Genuine-airborne guard ────────────────────────────────────────────────────
// An aircraft must have both positive altitude AND meaningful groundspeed to be
// treated as airborne.  This prevents on-ground GA aircraft whose alt_geom
// reads 175–350 ft (Archerfield elevation) from being promoted to airborne.
const MIN_AIRBORNE_GS_KT = 40;

// ── Output shape ──────────────────────────────────────────────────────────────
export interface SeparationFinding {
  /** Stable dedup key — 'separation:idA:idB' with IDs sorted. */
  key:          string;
  severity:     SWAlertSeverity;
  aircraft:     string[];  // callsigns (two entries)
  aircraftIds:  string[];  // IDs (two entries)
  message:      string;
}

// ── Profile shape used by this detector ───────────────────────────────────────
interface TerminalProfile {
  terminalRadiusNm:  number;
  terminalAltCeilFt: number;
}

// ── Detector ──────────────────────────────────────────────────────────────────
export function detectSeparation(
  aircraft: Aircraft[],
  profile: TerminalProfile,
): SeparationFinding[] {
  const termRadM  = profile.terminalRadiusNm * NM;
  const termRadM2 = termRadM * termRadM;

  // Filter to terminal-area, genuine-airborne, fresh tracks only.
  // Exclusions (in order):
  //   1. onGround = true  → alt_baro was the string "ground"; never airborne
  //   2. alt ≤ 50 ft      → existing altitude floor
  //   3. gs < 40 kt       → parked/slow GA whose alt_geom reads elevated
  //   4. alt ≥ ceiling    → above terminal area ceiling
  //   5. distance > radius → Archerfield, Caboolture, and other out-of-area traffic
  //   6. seenPos > 30 s   → stale track
  const airborne = aircraft.filter(ac => {
    if (ac.onGround) return false;
    if (ac.position.alt <= 50) return false;
    if (ac.groundSpeed < MIN_AIRBORNE_GS_KT) return false;
    if (ac.position.alt >= profile.terminalAltCeilFt) return false;
    if (ac.position.x ** 2 + ac.position.y ** 2 > termRadM2) return false;
    if ((ac.seenPos ?? 0) > STALE_SKIP_S) return false;
    return true;
  });

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
