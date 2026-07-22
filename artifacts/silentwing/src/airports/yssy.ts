// ─── YSSY Airport Profile ─────────────────────────────────────────────────────
//
// Sydney Airport — the second airport in the SilentWing multi-airport system.
// All consumers receive an AirportProfile and remain airport-agnostic; no
// component imports YSSY constants directly.
//
// Import graph (one-way, no cycles):
//   airports/yssy.ts
//     ← data/yssy_real.ts   (derived runway / taxiway / apron / gate geometry)

import { YSSY_RUNWAYS, YSSY_TAXIWAYS, YSSY_APRONS, YSSY_GATES } from '@/data/yssy_real';
import type { AirportProfile } from './types';

export const YSSY: AirportProfile = {
  // ── Identity ────────────────────────────────────────────────────────────────
  icao:      'YSSY',
  name:      'Sydney Airport',
  nameShort: 'SYDNEY INTL',

  // ── Projection origin ────────────────────────────────────────────────────────
  // Must match YSSY_ORIGIN in yssy_real.ts exactly.
  origin: { lat: -33.9461, lon: 151.1772 },

  // ── ADS-B feed ──────────────────────────────────────────────────────────────
  fetchRadiusNm: 50,

  // ── Geometry ─────────────────────────────────────────────────────────────────
  geometry: {
    runways:     YSSY_RUNWAYS,
    taxiways:    YSSY_TAXIWAYS,
    aprons:      YSSY_APRONS,
    gates:       YSSY_GATES,
    geoPolygons: [],
  },

  // ── 2D SVG viewbox ──────────────────────────────────────────────────────────
  // Covers the full runway + apron extents with generous margin.
  // In SVG coords y is flipped relative to real-y (south = +y_svg).
  viewbox: { minX: -2200, minY: -2200, width: 4600, height: 5500 },

  // ── Runway configuration ─────────────────────────────────────────────────────
  // headingDeg = compass bearing of the LOW designator end.
  runways: [
    { ref: '16L/34R', lowDesignator: '16L', highDesignator: '34R', headingDeg: 157 },
    { ref: '16R/34L', lowDesignator: '16R', highDesignator: '34L', headingDeg: 157 },
    { ref: '07/25',   lowDesignator: '07',  highDesignator: '25',  headingDeg:  73 },
  ],

  // Preferred calm-wind runway at YSSY is northbound 34.
  calmWindDefaultDir: '34L',

  // ── Alert filter ─────────────────────────────────────────────────────────────
  terminalRadiusNm:  7.5,
  terminalAltCeilFt: 15_000,
  airspaceRadiusM:   55_560,  // ≈ 30 NM
  sectorCapacity:    25,

  // ── 3D annotation position ───────────────────────────────────────────────────
  // Three.js (x, z) centroid of the combined terminal precinct.
  // z = −real_y (Three.js z-axis is south-positive in this scene).
  terminalLabelPos: { x: 250, z: 100 },

  // ── Simulation scaffold ──────────────────────────────────────────────────────
  // YSSY is live-only — no sim configuration.
  sim: undefined,
};
