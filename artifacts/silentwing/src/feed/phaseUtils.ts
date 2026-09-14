import type { GatePos } from '../data/ybbn_real';
import type { AirportProfile } from '../airports/types';
import type { FlightPhase } from '../types';

// ── Phase heuristic ───────────────────────────────────────────────────────────
// Real ADS-B carries no flight-phase field.  We derive a best-effort phase
// from altitude, groundspeed, and proximity to known gate positions.
//
// Gate proximity:  gs < AT_GATE_GS_KT  AND  within AT_GATE_DIST_M of any gate
//                  → 'at-gate'.  Otherwise ground aircraft are 'taxi-in'.
//
// Coordinate note: geometry gates use ybbn_real.ts native frame (+y = north).
// The adapter uses +y = south (SVG convention), so the gate y must be negated
// when computing the distance: dy = acY − (−gateY) = acY + gateY.

const AT_GATE_GS_KT  = 2;   // knots  — aircraft considered stationary at gate
const AT_GATE_DIST_M = 60;  // metres — gate proximity threshold

// ── angularDiff ───────────────────────────────────────────────────────────────
// Smallest angular difference between two compass headings (0–180°).
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── activeRunwayHeadingDegrees ────────────────────────────────────────────────
// Converts the active-direction STEM string (e.g. "01", "19") back to the
// actual compass heading in degrees that aircraft use when departing on that
// runway end.  Returns undefined if the stem cannot be matched.
export function activeRunwayHeadingDegrees(
  profile: Pick<AirportProfile, 'runways'>,
  activeStem: string,
): number | undefined {
  for (const rw of profile.runways) {
    const lowStem  = rw.lowDesignator.replace(/[LRC]$/, '');
    const highStem = rw.highDesignator.replace(/[LRC]$/, '');
    if (lowStem  === activeStem) return rw.headingDeg;
    if (highStem === activeStem) return (rw.headingDeg + 180) % 360;
  }
  return undefined;
}

export function derivePhase(
  altFt: number,
  gs: number,
  baroRate: number | undefined,
  acX: number,
  acY: number,
  gates: GatePos[],
  track: number,
  activeRunwayHeadingDeg: number | undefined,
): FlightPhase {
  if (altFt < 50) {
    // On the ground — distinguish at-gate from taxiing
    if (gs < AT_GATE_GS_KT) {
      const d2 = AT_GATE_DIST_M * AT_GATE_DIST_M;
      for (const gate of gates) {
        const dx = acX - gate.pos[0];
        const dy = acY + gate.pos[1]; // y-axis flip: ybbn_real +y=north ↔ adapter +y=south
        if (dx * dx + dy * dy <= d2) return 'at-gate';
      }
    }
    return 'taxi-in';
  }

  // Use vertical rate to distinguish departure (climbing) from arrival (descending).
  // baro_rate > 200 ft/min = clearly climbing; < -200 = clearly descending.
  //
  // Many transponders omit baro_rate at low altitude (fresh ADS-B lock right
  // after rotation is the most common case).  When baro_rate is absent below
  // 500 ft we use the aircraft's track relative to the active runway to
  // distinguish departures from arrivals.  The active runway heading is the
  // landing heading (aircraft land INTO the wind), so departures use its
  // reciprocal:
  //   • Track within ±45° of the DEPARTURE heading → climbing (takeoff)
  //   • Track within ±45° of the LANDING heading → not climbing
  //   • Ambiguous / no runway data → assume descent (safer default; arrivals
  //     dominate terminal snapshots and a false "landing" label is less
  //     alarming than a false "takeoff").
  //
  // Above 500 ft the ambiguity matters less (both phases are well-separated by
  // altitude trend), so we keep the conservative "assume descent" fallback there.
  let climbing: boolean;
  if (baroRate !== undefined) {
    climbing = baroRate > 200;
  } else if (altFt < 500 && gs >= 80 && activeRunwayHeadingDeg !== undefined) {
    // activeRunwayHeadingDeg is the landing heading; departures use its reciprocal.
    const landingHdg   = activeRunwayHeadingDeg;
    const departureHdg = (activeRunwayHeadingDeg + 180) % 360;
    const diffDep      = angularDiff(track, departureHdg);
    const diffLand     = angularDiff(track, landingHdg);
    // Within 45° of departure heading → assume takeoff; otherwise → landing/approach
    climbing = diffDep < 45 && diffDep < diffLand;
  } else {
    // Default: assume descent (statistically more arrivals than departures in
    // the terminal area at any given snapshot).
    climbing = false;
  }

  if (altFt <   500) return climbing ? 'takeoff'   : 'landing';
  if (altFt < 3_000) return climbing ? 'departure' : 'approach';
  return                              climbing ? 'enroute-departure' : 'enroute-arrival';
}