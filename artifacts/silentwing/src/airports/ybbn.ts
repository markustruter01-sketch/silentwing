// ─── YBBN Airport Profile ─────────────────────────────────────────────────────
//
// This file is the SINGLE place that knows about Brisbane Airport specifics.
// All consumers (adapters, engines, views) receive an AirportProfile and remain
// unaware of YBBN in particular — they work with any profile that fits the type.
//
// Import graph (one-way, no cycles):
//   airports/ybbn.ts
//     ← data/ybbn_real.ts    (OSM-derived geometry — never imported by consumers)
//     ← data/ybbn.ts         (airspace radius, geography polygons, viewbox)
//     ← sim/constants.ts     (gate geometry — shared with sim routes)

import { REAL_RUNWAYS, REAL_TAXIWAYS, REAL_APRONS, REAL_GATES } from '@/data/ybbn_real';
import { GEO_POLYGONS, VIEWBOX, AIRSPACE_RADIUS_M } from '@/data/ybbn';
import { DOM_GATE_Y, INTL_GATE_Y, domGateX, intlGateX } from '@/sim/constants';
import { YBBN_BUILDINGS } from '@/data/ybbn_buildings';
import { TERRAIN_YBBN }   from '@/data/terrain_ybbn';
import type { AirportProfile } from './types';

export const YBBN: AirportProfile = {
  // ── Identity ────────────────────────────────────────────────────────────────
  icao:      'YBBN',
  name:      'Brisbane Airport',
  nameShort: 'BRISBANE INTL',
  timezone:  'Australia/Brisbane',

  // ── Projection origin ────────────────────────────────────────────────────────
  // All scene coordinates (metres) are relative to this WGS-84 point.
  origin: { lat: -27.384, lon: 153.117 },

  // ── ADS-B feed ──────────────────────────────────────────────────────────────
  fetchRadiusNm: 50,

  // ── Geometry — imported once here, distributed via profile ──────────────────
  geometry: {
    runways:     REAL_RUNWAYS,
    taxiways:    REAL_TAXIWAYS,
    aprons:      REAL_APRONS,
    gates:       REAL_GATES,
    geoPolygons: GEO_POLYGONS,
  },

  // ── 2D SVG view ─────────────────────────────────────────────────────────────
  viewbox: { ...VIEWBOX },

  // ── Runway configuration ─────────────────────────────────────────────────────
  // headingDeg = compass heading of the LOW designator end (01L heading ≈ 010°).
  // The ref must match the corresponding geometry.runways entry's ref so
  // computeRunwayThresholds() can pair them.
  runways: [
    { ref: '01L/19R', lowDesignator: '01L', highDesignator: '19R', headingDeg: 10 },
    { ref: '01R/19L', lowDesignator: '01R', highDesignator: '19L', headingDeg: 10 },
  ],

  // Active runway in calm wind (< 3 kt).  Stem after stripping L/R is "19".
  // In real operations YBBN uses southbound (19) configuration as the preferred
  // calm-wind direction.  deriveActiveRunwayDirection() strips the suffix.
  calmWindDefaultDir: '19R',

  // ── Alert filter ─────────────────────────────────────────────────────────────
  terminalRadiusNm:  7.5,
  terminalAltCeilFt: 15_000,
  airspaceRadiusM:   AIRSPACE_RADIUS_M,   // 55 560 m ≈ 30 nm
  sectorCapacity:    20,

  // ── 3D view ─────────────────────────────────────────────────────────────────
  // Three.js (x, z) position for the TERMINAL floating label.  Derived offline
  // from the domestic gate cluster centroid.
  terminalLabelPos: { x: 420, z: -250 },

  // ── Simulation scaffold ──────────────────────────────────────────────────────
  sim: {
    domGates:  Array.from({ length: 12 }, (_, i) => ({ id: `D${i + 1}`, x: domGateX(i),  y: DOM_GATE_Y  })),
    intlGates: Array.from({ length:  8 }, (_, i) => ({ id: `I${i + 1}`, x: intlGateX(i), y: INTL_GATE_Y })),
    defaultWindDir:   190,
    defaultWindSpeed: 12,
  },

  // ── Building footprints (OSM ODbL) ──────────────────────────────────────────
  buildings: YBBN_BUILDINGS,

  // ── Coarse terrain elevation mesh (Open-Meteo, fetched once at build time) ──
  terrain: TERRAIN_YBBN,
};
