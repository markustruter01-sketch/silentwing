// ─── SID / STAR ghost route data ─────────────────────────────────────────────
//
// Static waypoint sequences for the most common departure (SID) and arrival
// (STAR) routes at each supported airport.  Coordinates are in scene-space
// metres (x = east of airport origin, y = south of airport origin) using the
// same equirectangular projection as the ADS-B adapter.  altFt is feet MSL
// and is used to slope the ribbons through the correct altitude band.
//
// Only 4–5 representative routes per direction are included — enough to give
// controllers a spatial mental model of expected flow without cluttering the
// 3D airspace view.

export interface RouteWaypoint {
  name:  string;
  x:     number;   // metres east of airport origin (sim-space, +x = east)
  y:     number;   // metres south of airport origin (sim-space, +y = south)
  altFt: number;   // feet MSL — drives the Y (altitude) axis in Three.js
}

export interface Route {
  id:        string;
  airport:   string;           // ICAO code — matches AirportProfile.icao
  kind:      'SID' | 'STAR';
  name:      string;           // published procedure name
  waypoints: RouteWaypoint[];
}

// ── YBBN (Brisbane International) ────────────────────────────────────────────
// Scene origin: lat −27.384, lon 153.117.
// Runway 01/19 axis runs roughly N–S (runway 01 heading ≈ 010°).
// Scene conventions: +x = east, +y (sim) = south → Three.js z.

const YBBN_ROUTES: Route[] = [
  // ── SIDs (Departures) ─────────────────────────────────────────────────────

  // GOMOL SID — Northbound via Sunshine Coast corridor
  {
    id:      'YBBN-SID-GOMOL',
    airport: 'YBBN',
    kind:    'SID',
    name:    'GOMOL',
    waypoints: [
      { name: 'RWY',   x:       0, y:  -1_000, altFt:  1_500 },
      { name: 'WP1',   x:    -500, y:  -6_000, altFt:  5_000 },
      { name: 'WP2',   x:  -2_000, y: -14_000, altFt:  8_000 },
      { name: 'WP3',   x:  -5_000, y: -26_000, altFt: 12_000 },
      { name: 'GOMOL', x:  -8_000, y: -44_000, altFt: 15_000 },
    ],
  },

  // BIMER SID — North-eastbound toward Moreton Bay
  {
    id:      'YBBN-SID-BIMER',
    airport: 'YBBN',
    kind:    'SID',
    name:    'BIMER',
    waypoints: [
      { name: 'RWY',   x:      500, y:       0, altFt:  1_500 },
      { name: 'WP1',   x:    5_000, y:  -2_000, altFt:  5_000 },
      { name: 'WP2',   x:   13_000, y:  -5_500, altFt:  8_500 },
      { name: 'WP3',   x:   24_000, y: -11_000, altFt: 12_500 },
      { name: 'BIMER', x:   38_000, y: -19_000, altFt: 15_000 },
    ],
  },

  // SCOTT SID — Southbound toward Gold Coast
  {
    id:      'YBBN-SID-SCOTT',
    airport: 'YBBN',
    kind:    'SID',
    name:    'SCOTT',
    waypoints: [
      { name: 'RWY',   x:       0, y:     500, altFt:  1_500 },
      { name: 'WP1',   x:    -500, y:   6_000, altFt:  4_000 },
      { name: 'WP2',   x:  -2_000, y:  16_000, altFt:  8_000 },
      { name: 'WP3',   x:  -3_500, y:  30_000, altFt: 12_000 },
      { name: 'SCOTT', x:  -4_500, y:  47_000, altFt: 15_000 },
    ],
  },

  // DOSEL SID — South-eastbound toward Coolangatta / Gold Coast offshore
  {
    id:      'YBBN-SID-DOSEL',
    airport: 'YBBN',
    kind:    'SID',
    name:    'DOSEL',
    waypoints: [
      { name: 'RWY',   x:       0, y:     500, altFt:  1_500 },
      { name: 'WP1',   x:    3_000, y:   8_000, altFt:  5_000 },
      { name: 'WP2',   x:    8_000, y:  19_000, altFt:  9_000 },
      { name: 'WP3',   x:   16_000, y:  32_000, altFt: 13_000 },
      { name: 'DOSEL', x:   26_000, y:  44_000, altFt: 15_000 },
    ],
  },

  // WOOLY SID — Westbound toward Ipswich / Brisbane Valley
  {
    id:      'YBBN-SID-WOOLY',
    airport: 'YBBN',
    kind:    'SID',
    name:    'WOOLY',
    waypoints: [
      { name: 'RWY',   x:      -500, y:      0, altFt:  1_500 },
      { name: 'WP1',   x:    -6_000, y: -1_000, altFt:  5_000 },
      { name: 'WP2',   x:   -16_000, y: -3_000, altFt:  9_000 },
      { name: 'WP3',   x:   -32_000, y: -5_500, altFt: 13_000 },
      { name: 'WOOLY', x:   -50_000, y: -9_000, altFt: 15_000 },
    ],
  },

  // ── STARs (Arrivals) ──────────────────────────────────────────────────────

  // GOMOL STAR — from north (Sunshine Coast / Maroochydore)
  {
    id:      'YBBN-STAR-GOMOL',
    airport: 'YBBN',
    kind:    'STAR',
    name:    'GOMOL',
    waypoints: [
      { name: 'GOMOL', x:  -8_000, y: -44_000, altFt: 14_000 },
      { name: 'WP1',   x:  -5_000, y: -26_000, altFt: 10_000 },
      { name: 'WP2',   x:  -2_000, y: -14_000, altFt:  7_000 },
      { name: 'WP3',   x:    -500, y:  -6_000, altFt:  4_000 },
      { name: 'RWY',   x:       0, y:  -1_000, altFt:  2_000 },
    ],
  },

  // BIMER STAR — from northeast (Moreton Bay / Sunshine Coast offshore)
  {
    id:      'YBBN-STAR-BIMER',
    airport: 'YBBN',
    kind:    'STAR',
    name:    'BIMER',
    waypoints: [
      { name: 'BIMER', x:  38_000, y: -19_000, altFt: 14_000 },
      { name: 'WP1',   x:  24_000, y: -11_000, altFt: 10_000 },
      { name: 'WP2',   x:  13_000, y:  -5_500, altFt:  7_000 },
      { name: 'WP3',   x:   5_000, y:  -2_000, altFt:  4_000 },
      { name: 'RWY',   x:     500, y:       0, altFt:  2_000 },
    ],
  },

  // SCOTT STAR — from south (Gold Coast / Coolangatta)
  {
    id:      'YBBN-STAR-SCOTT',
    airport: 'YBBN',
    kind:    'STAR',
    name:    'SCOTT',
    waypoints: [
      { name: 'SCOTT', x:  -4_500, y:  47_000, altFt: 14_000 },
      { name: 'WP1',   x:  -3_500, y:  30_000, altFt: 10_000 },
      { name: 'WP2',   x:  -2_000, y:  16_000, altFt:  7_000 },
      { name: 'WP3',   x:    -500, y:   6_000, altFt:  3_500 },
      { name: 'RWY',   x:       0, y:     500, altFt:  2_000 },
    ],
  },

  // DOSEL STAR — from southeast (offshore corridor / Coolangatta area)
  {
    id:      'YBBN-STAR-DOSEL',
    airport: 'YBBN',
    kind:    'STAR',
    name:    'DOSEL',
    waypoints: [
      { name: 'DOSEL', x:  26_000, y:  44_000, altFt: 14_000 },
      { name: 'WP1',   x:  16_000, y:  32_000, altFt: 10_000 },
      { name: 'WP2',   x:   8_000, y:  19_000, altFt:  7_000 },
      { name: 'WP3',   x:   3_000, y:   8_000, altFt:  4_000 },
      { name: 'RWY',   x:       0, y:     500, altFt:  2_000 },
    ],
  },

  // WOOLY STAR — from west (Ipswich / Brisbane Valley)
  {
    id:      'YBBN-STAR-WOOLY',
    airport: 'YBBN',
    kind:    'STAR',
    name:    'WOOLY',
    waypoints: [
      { name: 'WOOLY', x: -50_000, y:  -9_000, altFt: 14_000 },
      { name: 'WP1',   x: -32_000, y:  -5_500, altFt: 10_000 },
      { name: 'WP2',   x: -16_000, y:  -3_000, altFt:  7_000 },
      { name: 'WP3',   x:  -6_000, y:  -1_000, altFt:  4_000 },
      { name: 'RWY',   x:    -500, y:       0, altFt:  2_000 },
    ],
  },
];

// ── YSSY (Sydney Kingsford Smith International) ───────────────────────────────
// Scene origin: lat −33.946, lon 151.177.
// Primary runway 16R/34L (heading ≈ 163°); parallel runway 07/25 (east–west).

const YSSY_ROUTES: Route[] = [
  // ── SIDs (Departures) ─────────────────────────────────────────────────────

  // DEENA SID — North-eastbound (toward the Central Coast)
  {
    id:      'YSSY-SID-DEENA',
    airport: 'YSSY',
    kind:    'SID',
    name:    'DEENA',
    waypoints: [
      { name: 'RWY',   x:       0, y:  -1_000, altFt:  1_500 },
      { name: 'WP1',   x:    3_000, y:  -8_000, altFt:  5_000 },
      { name: 'WP2',   x:    8_000, y: -18_000, altFt:  9_000 },
      { name: 'WP3',   x:   16_000, y: -33_000, altFt: 13_000 },
      { name: 'DEENA', x:   26_000, y: -50_000, altFt: 15_000 },
    ],
  },

  // KAMPI SID — Southbound (toward Wollongong / Illawarra)
  {
    id:      'YSSY-SID-KAMPI',
    airport: 'YSSY',
    kind:    'SID',
    name:    'KAMPI',
    waypoints: [
      { name: 'RWY',   x:       0, y:   1_000, altFt:  1_500 },
      { name: 'WP1',   x:  -1_000, y:   8_000, altFt:  5_000 },
      { name: 'WP2',   x:  -3_000, y:  21_000, altFt:  9_000 },
      { name: 'WP3',   x:  -5_000, y:  37_000, altFt: 13_000 },
      { name: 'KAMPI', x:  -8_000, y:  54_000, altFt: 15_000 },
    ],
  },

  // MARUB SID — Westbound (toward the Blue Mountains)
  {
    id:      'YSSY-SID-MARUB',
    airport: 'YSSY',
    kind:    'SID',
    name:    'MARUB',
    waypoints: [
      { name: 'RWY',   x:      -500, y:       0, altFt:  1_500 },
      { name: 'WP1',   x:    -8_000, y:  -3_000, altFt:  5_000 },
      { name: 'WP2',   x:   -21_000, y:  -8_000, altFt:  9_000 },
      { name: 'WP3',   x:   -40_000, y: -16_000, altFt: 13_000 },
      { name: 'MARUB', x:   -54_000, y: -24_000, altFt: 15_000 },
    ],
  },

  // DIPSO SID — Eastbound (over Botany Bay / Pacific)
  {
    id:      'YSSY-SID-DIPSO',
    airport: 'YSSY',
    kind:    'SID',
    name:    'DIPSO',
    waypoints: [
      { name: 'RWY',   x:      500, y:      0, altFt:  1_500 },
      { name: 'WP1',   x:    6_000, y:  2_000, altFt:  5_000 },
      { name: 'WP2',   x:   16_000, y:  5_500, altFt:  9_000 },
      { name: 'WP3',   x:   30_000, y:  9_000, altFt: 13_000 },
      { name: 'DIPSO', x:   46_000, y: 13_000, altFt: 15_000 },
    ],
  },

  // AKMIR SID — Northwest (toward Penrith / Richmond)
  {
    id:      'YSSY-SID-AKMIR',
    airport: 'YSSY',
    kind:    'SID',
    name:    'AKMIR',
    waypoints: [
      { name: 'RWY',   x:      -500, y:       0, altFt:  1_500 },
      { name: 'WP1',   x:    -5_000, y:  -4_000, altFt:  5_000 },
      { name: 'WP2',   x:   -14_000, y: -12_000, altFt:  9_000 },
      { name: 'WP3',   x:   -26_000, y: -25_000, altFt: 13_000 },
      { name: 'AKMIR', x:   -40_000, y: -40_000, altFt: 15_000 },
    ],
  },

  // ── STARs (Arrivals) ──────────────────────────────────────────────────────

  // RIVET STAR — from south (Wollongong / ACT corridor)
  {
    id:      'YSSY-STAR-RIVET',
    airport: 'YSSY',
    kind:    'STAR',
    name:    'RIVET',
    waypoints: [
      { name: 'RIVET', x:  -8_000, y:  54_000, altFt: 14_000 },
      { name: 'WP1',   x:  -5_000, y:  37_000, altFt: 10_000 },
      { name: 'WP2',   x:  -3_000, y:  21_000, altFt:  7_000 },
      { name: 'WP3',   x:  -1_000, y:   8_000, altFt:  4_000 },
      { name: 'RWY',   x:       0, y:   1_000, altFt:  2_000 },
    ],
  },

  // SOSIJ STAR — from northeast (Central Coast / offshore)
  {
    id:      'YSSY-STAR-SOSIJ',
    airport: 'YSSY',
    kind:    'STAR',
    name:    'SOSIJ',
    waypoints: [
      { name: 'SOSIJ', x:  26_000, y: -50_000, altFt: 14_000 },
      { name: 'WP1',   x:  16_000, y: -33_000, altFt: 10_000 },
      { name: 'WP2',   x:   8_000, y: -18_000, altFt:  7_000 },
      { name: 'WP3',   x:   3_000, y:  -8_000, altFt:  4_000 },
      { name: 'RWY',   x:       0, y:  -1_000, altFt:  2_000 },
    ],
  },

  // YAKKA STAR — from east (Pacific / Botany Bay approach)
  {
    id:      'YSSY-STAR-YAKKA',
    airport: 'YSSY',
    kind:    'STAR',
    name:    'YAKKA',
    waypoints: [
      { name: 'YAKKA', x:  46_000, y:  13_000, altFt: 14_000 },
      { name: 'WP1',   x:  30_000, y:   9_000, altFt: 10_000 },
      { name: 'WP2',   x:  16_000, y:   5_500, altFt:  7_000 },
      { name: 'WP3',   x:   6_000, y:   2_000, altFt:  4_000 },
      { name: 'RWY',   x:     500, y:       0, altFt:  2_000 },
    ],
  },

  // LANUM STAR — from west (Blue Mountains / inland)
  {
    id:      'YSSY-STAR-LANUM',
    airport: 'YSSY',
    kind:    'STAR',
    name:    'LANUM',
    waypoints: [
      { name: 'LANUM', x: -54_000, y: -24_000, altFt: 14_000 },
      { name: 'WP1',   x: -40_000, y: -16_000, altFt: 10_000 },
      { name: 'WP2',   x: -21_000, y:  -8_000, altFt:  7_000 },
      { name: 'WP3',   x:  -8_000, y:  -3_000, altFt:  4_000 },
      { name: 'RWY',   x:    -500, y:       0, altFt:  2_000 },
    ],
  },
];

// ── Combined export ───────────────────────────────────────────────────────────
export const ROUTES: Route[] = [...YBBN_ROUTES, ...YSSY_ROUTES];
