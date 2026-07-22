// ─── Airport helper functions ─────────────────────────────────────────────────
//
// Pure functions that DERIVE runway threshold positions and approach corridor
// parameters from an AirportProfile's geometry.  Nothing here is YBBN-specific:
// these helpers work for any airport whose geometry is described by the profile.
//
// Exported and used by:
//   AirspaceView3D — threshold sprite positions, ILS cone geometry
//   AdsbAdapter    — projection
//   SimEngine      — active runway derivation for sim weather

import type { AirportProfile } from './types';
import type { Polyline } from '@/data/ybbn_real';

// ── computeRunwayThresholds ────────────────────────────────────────────────────
//
// Derives [designator, x, z] positions for runway threshold sprites in Three.js
// scene coordinates (x = east, z = scene_y = -native_y after flipRealY).
//
// For each runway the function identifies which polyline endpoint is the LOW
// designator threshold and which is the HIGH designator threshold by comparing
// the direction of the polyline axis to the low-designator heading.
//
// Verification (YBBN):
//   01L/19R: computed first→low(-1007.7,-102.8), high(490.6,-3032.4)
//            hardcoded:  01L(-1007.7,-102.8)  19R(490.6,-3032.4)  ✓
//   01R/19L: computed first→low(120.3,2079.9), high(1710.8,-1030.6)
//            hardcoded:  01R(120.3,2079.9)    19L(1710.8,-1030.6) ✓
export function computeRunwayThresholds(
  runwayDefs: AirportProfile['runways'],
  geometryRunways: Polyline[],
): Array<[string, number, number]> {
  const results: Array<[string, number, number]> = [];

  for (const rwDef of runwayDefs) {
    const geom = geometryRunways.find(g => g.ref === rwDef.ref);
    if (!geom || geom.coords.length < 2) continue;

    const first = geom.coords[0];
    const last  = geom.coords[geom.coords.length - 1];

    // Compute the bearing from first→last and from last→first (compass degrees).
    const dx = last[0] - first[0];
    const dy = last[1] - first[1]; // native +y = north
    // atan2(dy, dx): standard math angle (east = 0°, counter-clockwise).
    // Convert to compass heading: compass = (90 - math_deg + 360) % 360
    const mathDeg      = Math.atan2(dy, dx) * (180 / Math.PI);
    const compassFirst = ((90 - mathDeg) + 360) % 360; // bearing first → last
    const compassLast  = (compassFirst + 180) % 360;    // bearing last  → first

    const lowHdg = rwDef.headingDeg;
    const angDiff = (a: number) => Math.min(
      Math.abs(a - lowHdg),
      360 - Math.abs(a - lowHdg),
    );

    // The LOW designator threshold is where you START when flying the low heading.
    // If compassLast ≈ lowHdg: flying last→first is on the low heading →
    //   last is the low threshold (the point you depart from on the low heading).
    // If compassFirst ≈ lowHdg: flying first→last is on the low heading →
    //   first is the low threshold.
    let lowCoord:  [number, number];
    let highCoord: [number, number];
    if (angDiff(compassLast) < angDiff(compassFirst)) {
      lowCoord  = last;
      highCoord = first;
    } else {
      lowCoord  = first;
      highCoord = last;
    }

    // Three.js z = -native_y  (the flipRealY convention used throughout the 3D view)
    results.push([rwDef.lowDesignator,  lowCoord[0],  -lowCoord[1]]);
    results.push([rwDef.highDesignator, highCoord[0], -highCoord[1]]);
  }

  return results;
}

// ── computeApproachCorridors ───────────────────────────────────────────────────
//
// Derives the ILS approach corridor centre and approach direction for
// buildApproachCone() in AirspaceView3D.
//
// `activeDir` is the runway designator STEM (without L/R suffix), e.g. "01" or
// "19".  The function averages all matching threshold positions.
//
// Returns:
//   cx, cz — Three.js (x, z) midpoint of the active-direction thresholds
//   dz     — +1 = cone opens toward +Z (south, approach from south)
//            -1 = cone opens toward -Z (north, approach from north)
//
// Verification (YBBN, windDir=190 → activeDir="19"):
//   19R(490.6, -3032.4) + 19L(1710.8, -1030.6)
//   cx = 1100.7 ≈ 1101,  cz = -2031.5 ≈ -2032,  dz = -1
export function computeApproachCorridors(
  runwayDefs: AirportProfile['runways'],
  geometryRunways: Polyline[],
  activeDir: string,
): { cx: number; cz: number; dz: 1 | -1 } {
  const thresholds = computeRunwayThresholds(runwayDefs, geometryRunways);

  let sumX = 0, sumZ = 0, count = 0;
  let matchedIsLow = true;

  for (const [label, x, z] of thresholds) {
    // Strip L/R/C suffix to get the stem, e.g. "01L" → "01", "19R" → "19"
    const stem = label.replace(/[LRC]$/, '');
    if (stem !== activeDir) continue;
    sumX += x; sumZ += z; count++;
    matchedIsLow = runwayDefs.some(rw => rw.lowDesignator === label);
  }

  if (!count) return { cx: 0, cz: 0, dz: 1 };

  // Determine approach direction.
  // Low designator heading < 180° → runway faces roughly northward →
  //   landing on low designator means approach from south → dz = +1.
  // Landing on high designator (opposite) → approach from north → dz = -1.
  const headingDeg = runwayDefs.find(rw =>
    rw.lowDesignator.replace(/[LRC]$/, '')  === activeDir ||
    rw.highDesignator.replace(/[LRC]$/, '') === activeDir,
  )?.headingDeg ?? 0;

  let dz: 1 | -1;
  if (matchedIsLow) {
    dz = headingDeg < 180 ? 1 : -1;
  } else {
    dz = headingDeg < 180 ? -1 : 1;
  }

  return { cx: sumX / count, cz: sumZ / count, dz };
}

// ── deriveActiveRunwayDirection ────────────────────────────────────────────────
//
// Picks the active landing runway designator STEM ("01", "19", etc.) from the
// current wind direction.  Aircraft land INTO the wind, so we choose the runway
// end whose heading is closest to the wind direction.
//
// `windDirDeg` is the direction FROM which the wind blows (aviation convention).
// Returns the designator STEM (without L/R suffix) to stay compatible with the
// `activeRunwayDirection` field in WorldSnapshot.weather.
//
// In calm wind (< calmThresholdKt) returns the profile's calm-wind default.
//
// Verification (YBBN, windDir=190, windSpeed=12):
//   lowHdg=10, highHdg=190; diff(190 from 190) = 0 → stem "19"
export function deriveActiveRunwayDirection(
  profile: Pick<AirportProfile, 'runways' | 'calmWindDefaultDir'>,
  windDirDeg: number,
  windSpeedKt: number,
  calmThresholdKt = 3,
): string {
  if (windSpeedKt < calmThresholdKt) {
    return profile.calmWindDefaultDir.replace(/[LRC]$/, '');
  }

  let bestStem = profile.calmWindDefaultDir.replace(/[LRC]$/, '');
  let bestDiff = Infinity;

  for (const rw of profile.runways) {
    const lowHdg  = rw.headingDeg;
    const highHdg = (rw.headingDeg + 180) % 360;

    const diff = (hdg: number) => Math.min(
      Math.abs(hdg - windDirDeg),
      360 - Math.abs(hdg - windDirDeg),
    );

    if (diff(lowHdg) < bestDiff) {
      bestDiff = diff(lowHdg);
      bestStem = rw.lowDesignator.replace(/[LRC]$/, '');
    }
    if (diff(highHdg) < bestDiff) {
      bestDiff = diff(highHdg);
      bestStem = rw.highDesignator.replace(/[LRC]$/, '');
    }
  }

  return bestStem;
}

// ── projectLatLon ──────────────────────────────────────────────────────────────
//
// Equirectangular projection: WGS-84 lat/lon → scene metres.
// +x = east, +y = south (SVG convention — same frame the sim uses).
// Mirrors the formula in adsbAdapter.ts exactly.
export function projectLatLon(
  origin: { lat: number; lon: number },
  lat: number,
  lon: number,
): { x: number; y: number } {
  const lat0Rad = origin.lat * (Math.PI / 180);
  const x =  (lon - origin.lon) * 111_320 * Math.cos(lat0Rad);
  const y = -(lat - origin.lat) * 110_540;
  return { x, y };
}
