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
// Simplified principal taxiway network.  Positions consistent with corrected
// runway geometry above.

export const YSSY_TAXIWAYS: Polyline[] = [
  {
    // Northern cross-connector — links north ends of both parallel runways
    ref: 'N1',
    coords: [
      [-610, 1940],
      [-420, 1955],
      [-230, 1960],
      [ -40, 1965],
      [  90, 1975],
      [ 150, 1990],
    ],
  },
  {
    // Main N-S centreline taxiway between runways (~x = 200)
    ref: 'A',
    coords: [
      [ 200,  1900],
      [ 200,  1400],
      [ 200,   900],
      [ 200,   400],
      [ 200,  -100],
      [ 200,  -600],
      [ 200, -1100],
      [ 200, -1600],
    ],
  },
  {
    // Mid-field east-west connector (roughly y = 0, between runways)
    ref: 'B',
    coords: [
      [-200,  -20],
      [   0,  -20],
      [ 200,  -20],
      [ 400,  -20],
      [ 560,  -20],
    ],
  },
  {
    // Southern cross-connector — links south ends of parallel runways
    ref: 'S1',
    coords: [
      [ 200, -1750],
      [ 400, -1745],
      [ 600, -1740],
      [ 800, -1735],
      [ 960, -1725],
    ],
  },
  {
    // Terminal access taxiway — E-W through the terminal precinct (y ≈ 250)
    ref: 'T',
    coords: [
      [-200,  300],
      [   0,  290],
      [ 200,  280],
      [ 400,  270],
      [ 580,  260],
    ],
  },
  {
    // RWY 07 threshold connector (western end)
    ref: 'W1',
    coords: [
      [-1154,  -221],
      [-1000,  -240],
      [ -800,  -250],
      [ -600,  -220],
      [ -400,  -200],
    ],
  },
  {
    // RWY 25 threshold connector (eastern end)
    ref: 'E1',
    coords: [
      [ 1487,   310],
      [ 1300,   300],
      [ 1100,   290],
      [  900,   275],
      [  700,   260],
    ],
  },
  {
    // Southern freight / maintenance apron connector
    ref: 'M',
    coords: [
      [-400, -1800],
      [-200, -1810],
      [   0, -1820],
      [ 200, -1810],
      [ 400, -1790],
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
