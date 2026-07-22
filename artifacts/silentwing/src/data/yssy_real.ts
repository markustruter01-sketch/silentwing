// YSSY (Sydney Airport) geometry derived from published aeronautical data and OSM aeroway data.
// Equirectangular projection to local scene metres, centred on YSSY origin.
// SAME projection frame as the ADS-B ingest adapter so live aircraft align to real runways.
//   x = (lon - lon0) * 111320 * cos(lat0_rad)   lon0 = 151.1772
//   y = (lat - lat0) * 110540                    lat0 = -33.9461  (north = +y)
// NOTE: community data; replace with official AIP survey before production.

import type { Polyline, GatePos } from '@/data/ybbn_real';

export const YSSY_ORIGIN = { lat: -33.9461, lon: 151.1772 };

// ── Runways ───────────────────────────────────────────────────────────────────
// Three parallel / cross runways. Coords run from the HIGH designator end toward
// the LOW designator end so that the ref convention matches ybbn_real.ts.

export const YSSY_RUNWAYS: Polyline[] = [
  {
    // 34R → 16L  (western parallel, ~157°/337°, length ≈ 3 960 m)
    ref: '16L/34R',
    coords: [
      [-406,  1835],
      [-574,  1339],
      [-742,   843],
      [-910,   347],
      [-1078, -149],
      [-1246, -645],
      [-1414,-1141],
      [-1582,-1637],
      [-1750,-2133],
      [-1919,-2631],
    ],
  },
  {
    // 34L → 16R  (eastern parallel, ~157°/337°, length ≈ 3 540 m)
    ref: '16R/34L',
    coords: [
      [923,  1658],
      [907,  1265],
      [890,   872],
      [874,   479],
      [857,    86],
      [841,  -307],
      [824,  -700],
      [808, -1093],
      [791, -1486],
      [775, -1879],
    ],
  },
  {
    // 07 → 25  (cross runway, ~073°/253°, length ≈ 2 530 m)
    ref: '07/25',
    coords: [
      [-1873,  -99],
      [-1454, -190],
      [-1034, -281],
      [ -615, -372],
      [ -196, -463],
      [  223, -554],
      [  642, -645],
      [ 1062, -736],
      [ 1481, -827],
      [ 1901, -917],
    ],
  },
];

// ── Taxiways ──────────────────────────────────────────────────────────────────
// Simplified principal taxiway network — key connectors only.

export const YSSY_TAXIWAYS: Polyline[] = [
  {
    // Northern cross-connector — links north ends of both parallel runways
    ref: 'N1',
    coords: [[-330, 1650], [-100, 1660], [130, 1670], [360, 1670], [590, 1665], [880, 1650]],
  },
  {
    // Main N-S centreline taxiway (between runways)
    ref: 'A',
    coords: [
      [250,  1650],
      [250,  1263],
      [250,   876],
      [250,   489],
      [250,   102],
      [250,  -285],
      [250,  -672],
      [250, -1059],
      [250, -1446],
      [250, -1800],
    ],
  },
  {
    // Mid-field cross-connector (roughly at y ≈ 0)
    ref: 'B',
    coords: [[-380, 0], [-150, 10], [80, 20], [310, 10], [540, 0], [700, -10]],
  },
  {
    // Southern cross-connector
    ref: 'S1',
    coords: [[-700, -1800], [-430, -1810], [-160, -1820], [110, -1820], [380, -1810], [700, -1800]],
  },
  {
    // Terminal access taxiway — runs E-W through the terminal precinct
    ref: 'T',
    coords: [[-600, 200], [-350, 200], [-100, 200], [150, 200], [400, 200], [650, 200], [800, 200]],
  },
  {
    // RWY 07 threshold connector (western end)
    ref: 'W1',
    coords: [[-1800, -100], [-1750, -150], [-1680, -200], [-1600, -260], [-1500, -300]],
  },
  {
    // RWY 25 threshold connector (eastern end)
    ref: 'E1',
    coords: [[1800, -750], [1750, -800], [1700, -840], [1650, -870], [1580, -900]],
  },
  {
    // Southern maintenance / freight apron connector
    ref: 'M',
    coords: [[-1600, -2100], [-1300, -2120], [-1000, -2100], [-700, -2080], [-500, -2030]],
  },
];

// ── Aprons ─────────────────────────────────────────────────────────────────────
// Simplified terminal apron outlines.  Each entry is a closed polygon (coords
// do NOT repeat the first point — buildGroundGeometry closes the loop).

export const YSSY_APRONS: [number, number][][] = [
  // T1 International terminal apron (eastern side)
  [
    [450, -350],
    [450,  150],
    [1000, 150],
    [1000, -350],
  ],
  // T2/T3 Domestic terminal apron (central)
  [
    [-600, -50],
    [-600, 350],
    [ 200, 350],
    [ 200,  -50],
  ],
  // Cargo / freight apron (northern west)
  [
    [-1050, 200],
    [-1050, 700],
    [ -600, 700],
    [ -600, 200],
  ],
];

// ── Gate positions ─────────────────────────────────────────────────────────────
// Used by the ADS-B adapter for at-gate phase heuristic.
// Coordinates in the same real-y frame (+y = north).

export const YSSY_GATES: GatePos[] = [
  // T1 International (eastern apron)
  { ref: 'A1',  pos: [ 600, -100] },
  { ref: 'B1',  pos: [ 750, -200] },
  { ref: 'C1',  pos: [ 870, -130] },
  // T2 Domestic (central)
  { ref: 'D1',  pos: [-120,  110] },
  { ref: 'E1',  pos: [-310,  170] },
  // T3 / QantasLink
  { ref: 'F1',  pos: [-460,  310] },
];
