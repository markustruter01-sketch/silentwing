// ── Runway-occupancy detector (Phase 6B) ─────────────────────────────────────
//
// Flags when 2+ aircraft occupy the same YBBN runway corridor simultaneously.
// Uses real YBBN runway polylines from ybbn_real.ts.
// Applies to ground + low-altitude aircraft only (alt < ALT_CUTOFF_FT).

import type { Aircraft } from '../../types';
import { REAL_RUNWAYS }  from '../../data/ybbn_real';
import type { SWAlertSeverity } from '../types';

// ── Tunable constants ─────────────────────────────────────────────────────────
const RUNWAY_HALF_WIDTH_M = 60;   // metres each side of centreline
const END_EXTENSION_M     = 500;  // metres beyond each runway end
const ALT_CUTOFF_FT       = 500;  // max altitude to be "on/near" runway
const MOVING_SPD_KTS      = 5;    // ground speed above which aircraft is "moving"

// ── Terminal-area filter ───────────────────────────────────────────────────────
// Runway-occupancy intentionally includes ground aircraft (that is its job), but
// only for aircraft within the YBBN terminal area.  This prevents Archerfield
// runway pairings from generating spurious occupancy alerts.
const NM                  = 1852;
const TERMINAL_RADIUS_NM  = 7.5;
const TERMINAL_RADIUS_M   = TERMINAL_RADIUS_NM * NM;
const TERMINAL_RADIUS_M2  = TERMINAL_RADIUS_M * TERMINAL_RADIUS_M;

// ── Output shape ──────────────────────────────────────────────────────────────
export interface RunwayOccupancyFinding {
  /** Stable dedup key — 'runway_occupancy:<ref>'. */
  key:          string;
  severity:     SWAlertSeverity;
  aircraft:     string[];   // callsigns of ALL occupants
  aircraftIds:  string[];   // IDs of ALL occupants
  message:      string;
  runwayRef:    string;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Squared distance between two points. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

/**
 * Shortest distance from point P to line segment AB.
 * Returns distance in metres.
 */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt(dist2(px, py, ax, ay));

  // Project P onto the line, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(dist2(px, py, cx, cy));
}

/**
 * Extend a polyline at both ends by extM metres along the outward direction.
 * Returns a new array of [x, y] coordinates with the extended endpoints.
 */
function extendPolyline(coords: [number, number][], extM: number): [number, number][] {
  if (coords.length < 2) return coords;

  // Extend start: direction away from the second point
  const [sx, sy] = coords[0];
  const [sx2, sy2] = coords[1];
  const startDx = sx - sx2;
  const startDy = sy - sy2;
  const startLen = Math.sqrt(startDx ** 2 + startDy ** 2) || 1;
  const extStart: [number, number] = [
    sx + (startDx / startLen) * extM,
    sy + (startDy / startLen) * extM,
  ];

  // Extend end: direction away from the second-to-last point
  const [ex, ey] = coords[coords.length - 1];
  const [ex2, ey2] = coords[coords.length - 2];
  const endDx = ex - ex2;
  const endDy = ey - ey2;
  const endLen = Math.sqrt(endDx ** 2 + endDy ** 2) || 1;
  const extEnd: [number, number] = [
    ex + (endDx / endLen) * extM,
    ey + (endDy / endLen) * extM,
  ];

  return [extStart, ...coords, extEnd];
}

/**
 * Test whether a point (px, py) is within halfWidth metres of ANY segment in
 * the given polyline (already extended at both ends).
 */
function isInCorridor(
  px: number, py: number,
  coords: [number, number][],
  halfWidth: number,
): boolean {
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    if (pointToSegmentDist(px, py, ax, ay, bx, by) <= halfWidth) return true;
  }
  return false;
}

/**
 * REAL_RUNWAYS from ybbn_real.ts are in the native OSM/geo frame where +y = north.
 * Aircraft positions from the ADS-B adapter use +y = south (SVG convention).
 * Apply the same Y-flip the 3D view uses so geometry and aircraft share one frame.
 */
function flipY(coords: [number, number][]): [number, number][] {
  return coords.map(([x, y]) => [x, -y] as [number, number]);
}

// Pre-compute extended runway polylines once (module-level, not per-call).
// Flip Y first so coords match the aircraft position frame (+y = south).
const EXTENDED_RUNWAYS = REAL_RUNWAYS.map(rwy => ({
  ref:    rwy.ref,
  coords: extendPolyline(flipY(rwy.coords), END_EXTENSION_M),
}));

// ── Detector ──────────────────────────────────────────────────────────────────
export function detectRunwayOccupancy(aircraft: Aircraft[]): RunwayOccupancyFinding[] {
  // Ground + low-altitude aircraft within the YBBN terminal area.
  // seenPos check is intentionally relaxed (≤ 60 s) because ground radar may
  // update more slowly, but truly ancient tracks are still skipped.
  // The terminal-area radius filter prevents Archerfield runway pairings from
  // generating spurious occupancy alerts.
  const nearGround = aircraft.filter(ac =>
    ac.position.alt < ALT_CUTOFF_FT &&
    ac.position.x ** 2 + ac.position.y ** 2 <= TERMINAL_RADIUS_M2 &&
    (ac.seenPos ?? 0) <= 60,
  );

  const findings: RunwayOccupancyFinding[] = [];

  for (const rwy of EXTENDED_RUNWAYS) {
    // Skip unnamed stubs
    if (!rwy.ref) continue;

    const occupants = nearGround.filter(ac =>
      isInCorridor(ac.position.x, ac.position.y, rwy.coords, RUNWAY_HALF_WIDTH_M),
    );

    if (occupants.length < 2) continue;

    // Severity: critical if both/all are moving toward each other (converging),
    // otherwise caution for any 2+ occupancy.
    const movingCount = occupants.filter(ac => ac.groundSpeed > MOVING_SPD_KTS).length;
    const severity: SWAlertSeverity = movingCount >= 2 ? 'critical' : 'caution';

    const callsigns = occupants.map(ac => ac.callsign);
    const ids       = occupants.map(ac => ac.id);
    const listStr   = callsigns.join(', ');

    findings.push({
      key:         `runway_occupancy:${rwy.ref}`,
      severity,
      aircraft:    callsigns,
      aircraftIds: ids,
      message:     `Runway ${rwy.ref} — ${listStr} in runway corridor`,
      runwayRef:   rwy.ref,
    });
  }

  return findings;
}
