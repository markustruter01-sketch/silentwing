// ─── Predefined waypoint routes ──────────────────────────────────────────────
//
// Each Waypoint carries:
//   x, y   — position in metres (SVG convention: +x east, +y south)
//   alt    — altitude in feet MSL  (0 = on the ground)
//   spd    — target speed in m/s at this waypoint
//   phase  — FlightPhase label to apply while travelling TO this waypoint
//
// Active runway direction: 01 ops (aircraft land and depart heading ~010°,
// i.e. northbound).  Arrivals approach from the south; departures climb north.

import type { FlightPhase } from '../types';
import { SIN_H, COS_H, ALPHA_CX, ALPHA_CY, RW01L_CX } from './constants';

export interface Waypoint {
  x: number;
  y: number;
  alt: number;
  spd: number;
  phase: FlightPhase;
}

// ── Speed presets (m/s) ───────────────────────────────────────────────────────
const SPD = {
  approach:  77.2,   // ≈ 150 kts  (final approach)
  touchdown: 61.7,   // ≈ 120 kts  (main gear contact)
  rollout:   10.3,   // ≈  20 kts  (exiting runway)
  taxi:       7.7,   // ≈  15 kts  (normal taxi)
  slowTaxi:   4.1,   // ≈   8 kts  (apron / gate area)
  tkofRoll:  82.3,   // ≈ 160 kts  (rotation speed)
  climb:     92.6,   // ≈ 180 kts  (initial climb)
} as const;

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Point on 01L/19R centreline at distance d south of mid-runway (d>0 → south)
function rw01L(d: number) {
  return { x: RW01L_CX - d * SIN_H, y: d * COS_H };
}

// Point on Alpha taxiway at distance d south of Alpha centre (d>0 → south)
function alpha(d: number) {
  return { x: ALPHA_CX - d * SIN_H, y: ALPHA_CY + d * COS_H };
}

// ── Named waypoints (pre-computed, verified in geometry check) ────────────────
//   APPROACH_SRC  (-1714.6,  3939.2) — off screen south, 01L extended CL
//   THR19R        (-1329.1,  1753.0) — 19R threshold (touchdown in 01 ops)
//   W3_RW         (-1141.6,   689.4) — 01L CL at W3 connector latitude
//   W2_RW         (-1020.0,     0.0) — 01L CL at W2 connector (mid-field)
//   THR01L        ( -710.9, -1753.0) — 01L threshold (liftoff point)
//   DEPART_END    ( -533.8, -2757.5) — off screen north
//   W3_ALPHA      ( -973.9,   688.5) — Alpha at W3 latitude
//   W2_ALPHA      ( -857.5,    28.7) — Alpha centre (W2 latitude)
//   ALPHA_DOM     ( -841.9,   -60.0) — Alpha just south of domestic apron
//   DOM_ENTRY     ( -720.0,   -80.0) — domestic apron gate-road entry
//   INTL_ENTRY    ( -560.0,   710.0) — international apron entry from Alpha

const APPROACH_SRC = { x: RW01L_CX - 4000 * SIN_H, y: 4000 * COS_H };
const THR19R       = rw01L(1780);
const W3_RW        = rw01L(700);
const W2_RW        = rw01L(0);
const THR01L       = rw01L(-1780);
const DEPART_END   = rw01L(-2800);
const W3_ALPHA     = alpha(670);
const W2_ALPHA     = { x: ALPHA_CX, y: ALPHA_CY };
const ALPHA_DOM    = alpha(-90);
const DOM_ENTRY    = { x: -720, y: -80 };
const INTL_ENTRY   = { x: -560, y: 710 };

// Apron approach point on the west side of the international terminal.
// The terminal's west face is at x = −450; this sits 25 m further west.
// From INTL_ENTRY → INTL_APRON_W the path travels at x ≤ −475 (west of the
// terminal polygon), then the short east run at y = 180 is north of the
// terminal's north face (y = 200) — so no leg crosses the building footprint.
const INTL_APRON_W = { x: -475, y: 180 };

// ── Route builders ────────────────────────────────────────────────────────────

/**
 * 01L arrival → domestic gate
 * Approach from south → touch 19R → decelerate to W2 → Alpha north → domestic apron.
 */
export function routeDomesticArrival(gx: number, gy: number): Waypoint[] {
  return [
    { ...APPROACH_SRC, alt: 2500, spd: SPD.approach,  phase: 'approach' },
    { ...THR19R,        alt:    0, spd: SPD.touchdown,  phase: 'landing'  },
    { ...W2_RW,         alt:    0, spd: SPD.rollout,    phase: 'landing'  },
    { ...W2_ALPHA,      alt:    0, spd: SPD.taxi,       phase: 'taxi-in'  },
    { ...ALPHA_DOM,     alt:    0, spd: SPD.taxi,       phase: 'taxi-in'  },
    { ...DOM_ENTRY,     alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-in'  },
    { x: gx, y: gy,    alt:    0, spd: SPD.slowTaxi,   phase: 'at-gate'  },
  ];
}

/**
 * 01L arrival → international gate
 * Approach from south → touch 19R → decelerate to W3 → Alpha → east into intl apron.
 * Taxi north through apron to gate (gates are on north face at y=215).
 */
export function routeIntlArrival(gx: number, gy: number): Waypoint[] {
  return [
    { ...APPROACH_SRC,  alt: 2500, spd: SPD.approach,  phase: 'approach' },
    { ...THR19R,         alt:    0, spd: SPD.touchdown,  phase: 'landing'  },
    { ...W3_RW,          alt:    0, spd: SPD.rollout,    phase: 'landing'  },
    { ...W3_ALPHA,       alt:    0, spd: SPD.taxi,       phase: 'taxi-in'  },
    { ...INTL_ENTRY,     alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-in'  },
    // Route along terminal west face (x=−475, west of building at x=−450),
    // then east along the apron at y=180 (north of terminal north face at y=200).
    { ...INTL_APRON_W,   alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-in'  },
    { x: gx, y: gy,     alt:    0, spd: SPD.slowTaxi,   phase: 'at-gate'  },
  ];
}

/**
 * Domestic departure
 * Pushback → Alpha south → W3 → runway entry → takeoff roll north → climb out.
 */
export function routeDomesticDeparture(gx: number, gy: number): Waypoint[] {
  return [
    { x: gx, y: gy,    alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-out' },
    { ...DOM_ENTRY,     alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-out' },
    { ...ALPHA_DOM,     alt:    0, spd: SPD.taxi,        phase: 'taxi-out' },
    { ...W2_ALPHA,      alt:    0, spd: SPD.taxi,        phase: 'taxi-out' },
    { ...W3_ALPHA,      alt:    0, spd: SPD.taxi,        phase: 'taxi-out' },
    { ...W3_RW,         alt:    0, spd: SPD.rollout,     phase: 'taxi-out' },
    { ...THR01L,        alt:    0, spd: SPD.tkofRoll,    phase: 'takeoff'  },
    { ...DEPART_END,    alt: 3500, spd: SPD.climb,       phase: 'enroute-departure' },
  ];
}

/**
 * International departure
 * Taxi south through intl apron → INTL_ENTRY → W3_ALPHA → runway → takeoff north.
 */
export function routeIntlDeparture(gx: number, gy: number): Waypoint[] {
  return [
    { x: gx, y: gy,    alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-out' },
    // Reverse of arrival: west along apron face, then south along terminal
    // west face to INTL_ENTRY — no leg crosses the building footprint.
    { ...INTL_APRON_W,  alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-out' },
    { ...INTL_ENTRY,    alt:    0, spd: SPD.slowTaxi,   phase: 'taxi-out' },
    { ...W3_ALPHA,      alt:    0, spd: SPD.taxi,        phase: 'taxi-out' },
    { ...W3_RW,         alt:    0, spd: SPD.rollout,     phase: 'taxi-out' },
    { ...THR01L,        alt:    0, spd: SPD.tkofRoll,    phase: 'takeoff'  },
    { ...DEPART_END,    alt: 3500, spd: SPD.climb,       phase: 'enroute-departure' },
  ];
}
