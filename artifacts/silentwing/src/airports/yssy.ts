// ─── YSSY Airport Profile ─────────────────────────────────────────────────────
//
// This file is the SINGLE place that knows about Sydney Airport specifics.
// Sydney is LIVE-ONLY — sim is undefined.  No consumer may hardcode YSSY
// literals; they receive an AirportProfile and remain airport-agnostic.
//
// Import graph (one-way, no cycles):
//   airports/yssy.ts
//     ← data/yssy_real.ts    (OSM-derived geometry — never imported by consumers)

import { YSSY_RUNWAYS, YSSY_TAXIWAYS, YSSY_APRONS, YSSY_GATES } from '@/data/yssy_real';
import type { AirportProfile } from './types';

export const YSSY: AirportProfile = {
  // ── Identity ────────────────────────────────────────────────────────────────
  icao:      'YSSY',
  name:      'Sydney Airport',
  nameShort: 'SYDNEY INTL',
  timezone:  'Australia/Sydney',

  // ── Projection origin ────────────────────────────────────────────────────────
  // Must match YSSY_ORIGIN in yssy_real.ts — projection origin for all scene coords.
  origin: { lat: -33.9461, lon: 151.1772 },

  // ── ADS-B feed ──────────────────────────────────────────────────────────────
  fetchRadiusNm: 50,

  // ── Geometry — imported once here, distributed via profile ──────────────────
  geometry: {
    runways:     YSSY_RUNWAYS,
    taxiways:    YSSY_TAXIWAYS,
    aprons:      YSSY_APRONS,
    gates:       YSSY_GATES,
    geoPolygons: [],   // Botany Bay context can be added in a later iteration
  },

  // ── 2D SVG view ─────────────────────────────────────────────────────────────
  // Spans X: −1340..1530, Y: −2790..2160 with 100 m margin on each side.
  viewbox: { minX: -1440, minY: -2890, width: 3070, height: 5150 },

  // ── Runway configuration ─────────────────────────────────────────────────────
  // Three runways: two parallel (16L/34R, 16R/34L) and one crosswind (07/25).
  // headingDeg = compass heading of the LOW designator end.
  // Refs must match yssy_real.ts runway refs for computeRunwayThresholds().
  runways: [
    { ref: '16L/34R', lowDesignator: '16L', highDesignator: '34R', headingDeg: 157 },
    { ref: '16R/34L', lowDesignator: '16R', highDesignator: '34L', headingDeg: 157 },
    { ref: '07/25',   lowDesignator: '07',  highDesignator: '25',  headingDeg: 73  },
  ],

  // Calm-wind default: 34 configuration (northbound landing) — common at YSSY.
  calmWindDefaultDir: '34L',

  // ── Alert filter ─────────────────────────────────────────────────────────────
  terminalRadiusNm:  7.5,
  terminalAltCeilFt: 15_000,
  airspaceRadiusM:   55_560,   // ≈ 30 nm
  sectorCapacity:    25,        // Sydney is busier than Brisbane

  // ── 3D annotation ────────────────────────────────────────────────────────────
  // Approximate centroid of Sydney's domestic terminal gate cluster in scene coords.
  terminalLabelPos: { x: 600, z: -1100 },

  // ── Simulation scaffold ──────────────────────────────────────────────────────
  // Sydney is LIVE-ONLY.  sim is intentionally absent.
  // getSimAdapter() will refuse to start when sim is undefined.
};
