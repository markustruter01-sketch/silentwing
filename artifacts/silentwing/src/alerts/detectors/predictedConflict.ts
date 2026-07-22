// ── Predicted-conflict detector (Phase 6B) ───────────────────────────────────
//
// Steps each airborne FRESH pair forward in a straight line for up to
// LOOKAHEAD_S seconds, checking whether they breach separation minima.
// Only converging pairs are flagged.  If the pair ALREADY has an active
// separation alert the caller must suppress this finding (current breach wins).

import type { Aircraft } from '../../types';
import type { SWAlertSeverity } from '../types';

// ── Tunable constants ─────────────────────────────────────────────────────────
const NM               = 1852;    // metres per nautical mile
const LOOKAHEAD_S      = 120;     // projection window (seconds)
const STEP_S           = 10;      // projection step size (seconds)
const CONFLICT_H_M     = 3.0 * NM; // horizontal breach threshold (5556 m)
const CONFLICT_V_FT    = 1000;    // vertical breach threshold (ft)
const STALE_SKIP_S     = 30;      // skip aircraft with seen_pos > this

// Severity thresholds by time-to-conflict
const CRITICAL_TTC_S   = 45;      // < 45 s → critical
const CAUTION_TTC_S    = 90;      // < 90 s → caution (≥ 45)
                                  // ≥ 90 s → advisory

// ── Genuine-airborne guard ────────────────────────────────────────────────────
// Require meaningful groundspeed so parked/slow GA at elevated aerodromes
// (Archerfield alt_geom 175–350 ft) cannot enter the airborne pool.
const MIN_AIRBORNE_GS_KT = 40;

// ── Output shape ──────────────────────────────────────────────────────────────
export interface PredictedConflictFinding {
  /** Stable dedup key — 'predicted_conflict:idA:idB' with IDs sorted. */
  key:          string;
  severity:     SWAlertSeverity;
  aircraft:     string[];   // callsigns (two)
  aircraftIds:  string[];   // IDs (two)
  message:      string;
  ttcSeconds:   number;     // time-to-conflict (seconds)
  predClosestNm: number;    // predicted closest horizontal separation (nm)
  predClosestFt: number;    // predicted closest vertical separation (ft)
}

// ── Profile shape used by this detector ───────────────────────────────────────
interface TerminalProfile {
  terminalRadiusNm:  number;
  terminalAltCeilFt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Heading (degrees, 0 = north clockwise) + ground speed (kts) → velocity vector in m/s.
 *
 * Aircraft positions use +x = east, +y = south (SVG/adapter convention).
 * Northward motion (heading 0°) decreases y, so vy = −cos(heading).
 */
function velocityMs(heading: number, groundSpeedKts: number): { vx: number; vy: number } {
  const spd = groundSpeedKts * 0.514444; // kts → m/s
  const hdgRad = (heading * Math.PI) / 180;
  return {
    vx:  spd * Math.sin(hdgRad),  // east  = +x → sin
    vy: -spd * Math.cos(hdgRad),  // south = +y → north is −y, so negate cos
  };
}

/** Projected horizontal distance (m) between two aircraft at time t (seconds). */
function projectedHDist(
  ax: number, ay: number, avx: number, avy: number,
  bx: number, by: number, bvx: number, bvy: number,
  t: number,
): number {
  const px = (ax + avx * t) - (bx + bvx * t);
  const py = (ay + avy * t) - (by + bvy * t);
  return Math.sqrt(px * px + py * py);
}

// ── Detector ──────────────────────────────────────────────────────────────────
export function detectPredictedConflict(
  aircraft: Aircraft[],
  /** Set of separation-alert pair keys active RIGHT NOW ('separation:idA:idB'). */
  activeSeparationKeys: Set<string>,
  profile: TerminalProfile,
): PredictedConflictFinding[] {
  const termRadM  = profile.terminalRadiusNm * NM;
  const termRadM2 = termRadM * termRadM;

  // Terminal-area, genuine-airborne, fresh tracks only.
  // Same exclusion logic as the separation detector — see separation.ts for rationale.
  const airborne = aircraft.filter(ac => {
    if (ac.onGround) return false;
    if (ac.position.alt <= 50) return false;
    if (ac.groundSpeed < MIN_AIRBORNE_GS_KT) return false;
    if (ac.position.alt >= profile.terminalAltCeilFt) return false;
    if (ac.position.x ** 2 + ac.position.y ** 2 > termRadM2) return false;
    if ((ac.seenPos ?? 0) > STALE_SKIP_S) return false;
    return true;
  });

  const findings: PredictedConflictFinding[] = [];

  for (let i = 0; i < airborne.length; i++) {
    for (let j = i + 1; j < airborne.length; j++) {
      const a = airborne[i];
      const b = airborne[j];

      // Sort IDs for stable key
      const [idA, idB] = [a.id, b.id].sort();
      const pcKey = `predicted_conflict:${idA}:${idB}`;
      const sepKey = `separation:${idA}:${idB}`;

      // Suppress if pair already has an active current-separation alert
      if (activeSeparationKeys.has(sepKey)) continue;

      const av = velocityMs(a.heading, a.groundSpeed);
      const bv = velocityMs(b.heading, b.groundSpeed);

      // Check if pair is converging: compare distance now vs. distance in one step
      const distNow  = projectedHDist(a.position.x, a.position.y, av.vx, av.vy,
                                      b.position.x, b.position.y, bv.vx, bv.vy, 0);
      const distSoon = projectedHDist(a.position.x, a.position.y, av.vx, av.vy,
                                      b.position.x, b.position.y, bv.vx, bv.vy, STEP_S);
      if (distSoon >= distNow) continue; // separating or stationary — skip

      // Step forward to find first breach
      let firstBreachT: number | null = null;
      let closestH = Infinity;
      let closestV = Infinity;

      for (let t = STEP_S; t <= LOOKAHEAD_S; t += STEP_S) {
        const hM = projectedHDist(a.position.x, a.position.y, av.vx, av.vy,
                                  b.position.x, b.position.y, bv.vx, bv.vy, t);
        const vFt = Math.abs(a.position.alt - b.position.alt); // altitude held

        if (hM < closestH) { closestH = hM; closestV = vFt; }

        if (firstBreachT === null && hM < CONFLICT_H_M && vFt < CONFLICT_V_FT) {
          firstBreachT = t;
        }
      }

      if (firstBreachT === null) continue; // no predicted breach in window

      const ttc = firstBreachT;
      const severity: SWAlertSeverity =
        ttc < CRITICAL_TTC_S ? 'critical' :
        ttc < CAUTION_TTC_S  ? 'caution'  : 'advisory';

      const hNm  = (closestH / NM).toFixed(1);
      const vFt  = Math.round(closestV);
      const csA  = a.id === idA ? a.callsign : b.callsign;
      const csB  = a.id === idA ? b.callsign : a.callsign;

      findings.push({
        key:         pcKey,
        severity,
        aircraft:    [a.callsign, b.callsign],
        aircraftIds: [a.id, b.id],
        message:     `${csA} & ${csB} — predicted ${hNm} nm / ${vFt} ft in ${ttc} s (straight-line)`,
        ttcSeconds:   ttc,
        predClosestNm: closestH / NM,
        predClosestFt: closestV,
      });
    }
  }

  return findings;
}
