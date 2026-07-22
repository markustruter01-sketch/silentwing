// ─── Airport profile type ─────────────────────────────────────────────────────
//
// A single AirportProfile describes EVERYTHING needed to run SilentWing for
// one airport.  Consumers read from the active profile instead of importing
// YBBN-specific constants directly.
//
// ybbn.ts is the only place that constructs an AirportProfile for Brisbane.
// Adding a second airport (e.g. Sydney) means creating yssy.ts — no scattered
// `if (icao === 'YBBN')` branches anywhere in the codebase.

import type { Polyline, GatePos } from '@/data/ybbn_real';
import type { GeoPolygon } from '@/data/ybbn';

// ── Sim-scaffold config ────────────────────────────────────────────────────────
// Values that drive the SimEngine but are not used by the live ADS-B adapter.
// When an airport has no sim config the sim simply refuses to start for that
// airport (handled in getSimAdapter).
export interface SimAirportConfig {
  domGates:         Array<{ id: string; x: number; y: number }>;
  intlGates:        Array<{ id: string; x: number; y: number }>;
  defaultWindDir:   number;   // degrees FROM — fallback until Open-Meteo lands
  defaultWindSpeed: number;   // knots
}

// ── Airport profile ────────────────────────────────────────────────────────────
export interface AirportProfile {
  // ── Identity ────────────────────────────────────────────────────────────────
  icao:      string;   // "YBBN"
  name:      string;   // "Brisbane Airport"
  nameShort: string;   // "BRISBANE INTL"

  // ── Projection ──────────────────────────────────────────────────────────────
  // The equirectangular projection origin.  All scene coordinates are relative
  // to this point.  THIS IS THE MASTER KEY — changing it moves every rendered
  // element simultaneously, so coordinates in geometry and the live feed stay
  // aligned without any per-consumer fixup.
  origin: { lat: number; lon: number };

  // ── ADS-B feed ──────────────────────────────────────────────────────────────
  fetchRadiusNm: number;   // 50 — upstream query radius sent as a query param

  // ── Real airport geometry ────────────────────────────────────────────────────
  // Imported ONCE by the registry (airports/ybbn.ts), then distributed through
  // the active profile.  No consumer imports ybbn_real.ts directly.
  geometry: {
    runways:     Polyline[];
    taxiways:    Polyline[];
    aprons:      [number, number][][];
    gates:       GatePos[];
    geoPolygons: GeoPolygon[];
  };

  // ── 2D SVG view ─────────────────────────────────────────────────────────────
  viewbox: { minX: number; minY: number; width: number; height: number };

  // ── Runway config ────────────────────────────────────────────────────────────
  // One entry per physical runway (not per designator).  Each entry covers both
  // ends.  headingDeg is the heading of the LOW designator (the one with the
  // smaller number, e.g. "01L").
  //
  // The ACTIVE runway direction is NOT stored here — it is derived at runtime
  // by deriveActiveRunwayDirection() in airports/helpers.ts so that the active
  // end always reflects actual wind rather than a hardcoded constant.
  runways: Array<{
    ref:            string;   // "01L/19R"
    lowDesignator:  string;   // "01L"
    highDesignator: string;   // "19R"
    headingDeg:     number;   // heading of the low designator (e.g. 10 for "01")
  }>;
  calmWindDefaultDir: string;   // designator active in calm wind, e.g. "19R"

  // ── Alert + sector filter ────────────────────────────────────────────────────
  terminalRadiusNm:  number;   // 7.5 — alert filter radius (centre = origin)
  terminalAltCeilFt: number;   // 15 000
  airspaceRadiusM:   number;   // 55 560 — outer boundary ring render radius
  sectorCapacity:    number;   // 20 — aircraft count at 100% load

  // ── 3D annotation position ───────────────────────────────────────────────────
  // Three.js (x, z) position of the "TERMINAL" floating label.  Derived
  // offline from the gate cluster centroid for each airport.
  terminalLabelPos: { x: number; z: number };

  // ── Simulation scaffold ──────────────────────────────────────────────────────
  sim?: SimAirportConfig;
}
