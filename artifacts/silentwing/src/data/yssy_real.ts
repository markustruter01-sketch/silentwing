// YSSY (Sydney Airport) ground geometry — equirectangular projection.
// Origin: YSSY_ORIGIN = { lat: -33.9461, lon: 151.1772 }
//
// Projection formula (matches adsbAdapter.ts exactly):
//   x = (lon - lon0) * 111_320 * cos(lat0_rad)   [+x = east]
//   y = (lat - lat0) * 110_540                    [+y = north, native frame]
//   cos(lat0_rad) = cos(-33.9461°) ≈ 0.82963
//   x_scale ≈ 92 353 m/°lon,  y_scale = 110 540 m/°lat
//
// Scene rendering applies flipRealY (y → −y) so Three.js +z = south, matching
// the adapter convention.  This file must NOT pre-flip: it stores native +y=north
// coordinates exactly as YBBN_real.ts does.
//
// Threshold coordinates projected from AIP ERSA YSSY (published 2024).

import type { Polyline, GatePos } from '@/data/ybbn_real';

export const YSSY_ORIGIN = { lat: -33.9461, lon: 151.1772 };

// ── Runways ───────────────────────────────────────────────────────────────────
// Convention: coords run HIGH-designator end → LOW-designator end (same as
// ybbn_real.ts).  Ten evenly-spaced points along each centreline.
//
// Threshold sources (AIP ERSA, projected with formula above):
//   34R: lat=-33.9286, lon=151.1708  →  x=−591, y=+1934
//   16L: lat=-33.9619, lon=151.1797  →  x=+231, y=−1746
//   34L: lat=-33.9281, lon=151.1786  →  x=+129, y=+1990
//   16R: lat=-33.9617, lon=151.1875  →  x=+951, y=−1724
//   25:  lat=-33.9433, lon=151.1933  →  x=+1487, y=+310
//   07:  lat=-33.9481, lon=151.1647  →  x=−1154, y=−221

export const YSSY_RUNWAYS: Polyline[] = [
  {
    // 34R → 16L  (western parallel, 337°/157°, length ≈ 3 962 m)
    // HIGH (34R) at NW end, LOW (16L) at SE end.
    ref: '16L/34R',
    coords: [
      [ -591,  1934],  // 34R threshold
      [ -500,  1525],
      [ -409,  1116],
      [ -317,   707],
      [ -226,   298],
      [ -134,  -110],
      [  -43,  -519],
      [   48,  -928],
      [  140, -1337],
      [  231, -1746],  // 16L threshold
    ],
  },
  {
    // 34L → 16R  (eastern parallel, 337°/157°, length ≈ 3 962 m)
    // HIGH (34L) at NE end, LOW (16R) at SE end.
    ref: '16R/34L',
    coords: [
      [  129,  1990],  // 34L threshold
      [  220,  1577],
      [  312,  1165],
      [  403,   752],
      [  494,   339],
      [  586,   -73],
      [  677,  -486],
      [  768,  -899],
      [  860, -1311],
      [  951, -1724],  // 16R threshold
    ],
  },
  {
    // 25 → 07  (cross runway, 253°/073°, length ≈ 2 530 m)
    // HIGH (25) at east end, LOW (07) at west end.
    ref: '07/25',
    coords: [
      [ 1487,   310],  // 25 threshold
      [ 1194,   251],
      [  901,   192],
      [  607,   133],
      [  314,    74],
      [   20,    15],
      [ -273,   -44],
      [ -567,  -103],
      [ -860,  -162],
      [-1154,  -221],  // 07 threshold
    ],
  },
];

// ── Taxiways ──────────────────────────────────────────────────────────────────
// Taxiways run PARALLEL to the runways (heading ~167°/347°, ≈23° east of N-S).
// Positions derived from live ADS-B observations:
//   JST403 (gs=22kt, trk=348°) taxied at scene (x≈-127, z≈-916) → Alpha taxiway
//   QFA429 (gs=20kt, trk=166°) taxied at scene (x≈ -18, z≈-911) → Bravo taxiway
// Perpendicular east offset from 16L/34R centreline:
//   Alpha ≈ 250 m  → shift (+195, -44) in Three.js (x,z)
//   Bravo ≈ 350 m  → shift (+273, -61) in Three.js (x,z)
// Native y_native = -Three.js_z; coords below are in native +y=north frame.

export const YSSY_TAXIWAYS: Polyline[] = [
  {
    // Alpha — primary inter-runway taxiway, ~250 m east of 16L/34R, parallel to runways.
    // Confirmed by live JST403 position at (x=-127, z=-916): centreline matches.
    ref: 'A',
    coords: [
      [ -347,  1989],   // near 34R northern end
      [ -230,  1463],
      [ -113,   937],
      [    4,   411],
      [  121,  -115],
      [  238,  -641],
      [  355, -1167],
      [  475, -1691],   // near 16L southern end
    ],
  },
  {
    // Bravo — secondary inter-runway taxiway, ~350 m east of 16L/34R, parallel to runways.
    // Confirmed by live QFA429 position at (x=-18, z=-911): centreline matches.
    ref: 'B',
    coords: [
      [ -249,  2010],   // near 34R end
      [ -130,  1475],
      [   -9,   942],
      [  110,   408],
      [  231,  -125],
      [  352,  -659],
      [  473, -1192],
      [  573, -1670],   // near 16L end
    ],
  },
  {
    // N1 — northern cross-connector: 34R → Alpha → 34L
    ref: 'N1',
    coords: [
      [ -610,  1940],   // just west of 34R threshold
      [ -480,  1960],
      [ -347,  1989],   // Alpha north end
      [    0,  1990],
      [  129,  1990],   // 34L threshold
    ],
  },
  {
    // S1 — southern cross-connector: 16L → Alpha → 16R
    ref: 'S1',
    coords: [
      [  231, -1746],   // 16L threshold
      [  380, -1720],
      [  475, -1691],   // Alpha south end
      [  700, -1710],
      [  951, -1724],   // 16R threshold
    ],
  },
  {
    // Charlie — mid-field E-W connector at y_native ≈ 400
    // Links Alpha (x≈4) across to eastern runway zone (x≈481)
    ref: 'C',
    coords: [
      [    4,   411],   // Alpha mid-point
      [  100,   400],
      [  200,   390],
      [  300,   385],
      [  400,   380],
      [  481,   376],
    ],
  },
  {
    // Terminal — E-W access across northern terminal precinct at y_native ≈ 1100
    // (VOZ/QFA gates cluster at x≈150-200, native y≈985-1200 in live data)
    ref: 'T',
    coords: [
      [ -347,  1100],   // from Alpha at y≈1100
      [ -200,  1090],
      [    4,  1075],
      [  110,  1085],
      [  231,  1095],
      [  355,  1075],
      [  475,  1058],
    ],
  },
  {
    // W1 — RWY 07 threshold connector (western end to terminal area)
    ref: 'W1',
    coords: [
      [-1154,  -221],   // 07 threshold
      [ -900,  -220],
      [ -650,  -215],
      [ -400,  -210],
      [ -200,  -205],
      [  121,  -115],   // joins Alpha
    ],
  },
  {
    // E1 — RWY 25 threshold connector (eastern end)
    ref: 'E1',
    coords: [
      [ 1487,   310],   // 25 threshold
      [ 1300,   310],
      [ 1100,   310],
      [  900,   310],
      [  700,   310],
    ],
  },
  {
    // M — southern freight/maintenance connector
    ref: 'M',
    coords: [
      [  231, -1746],   // 16L threshold
      [  100, -1770],
      [  -50, -1790],
      [ -200, -1800],
      [ -400, -1790],
    ],
  },
];

// ── Aprons ────────────────────────────────────────────────────────────────────
// Simplified terminal apron outlines (closed polygons, native +y=north frame).

export const YSSY_APRONS: [number, number][][] = [
  // T1 International terminal apron (between runways, eastern side)
  [
    [ 250, -450],
    [ 250,  350],
    [ 700,  350],
    [ 700, -450],
  ],
  // T2/T3 Domestic terminal apron (between runways, central-western)
  [
    [-350,  -50],
    [-350,  600],
    [ 100,  600],
    [ 100,  -50],
  ],
  // Cargo / freight apron (north-west, west of western runway)
  [
    [-900,  400],
    [-900,  900],
    [-600,  900],
    [-600,  400],
  ],
];

// ── Gate positions ─────────────────────────────────────────────────────────────
// Native +y=north frame.  The ADS-B adapter negates y when computing gate-
// proximity distances (dy = acY + gate.pos[1]).

export const YSSY_GATES: GatePos[] = [
  // T1 International (eastern apron)
  { ref: 'A1',  pos: [ 400, -100] },
  { ref: 'B1',  pos: [ 550, -200] },
  { ref: 'C1',  pos: [ 650,  100] },
  // T2 Domestic (central)
  { ref: 'D1',  pos: [-100,  150] },
  { ref: 'E1',  pos: [-200,  300] },
  // T3 / QantasLink
  { ref: 'F1',  pos: [-300,  450] },
];
