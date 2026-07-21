// ─── YBBN Airport — shared non-geometry exports ───────────────────────────────
//
// The imagined runway/taxiway/apron/gate geometry has been REMOVED.
// Real airport geometry is now in src/data/ybbn_real.ts (OSM-derived).
//
// ⚠ SIM-SCAFFOLD NOTE ──────────────────────────────────────────────────────────
// The sim engine (src/sim/) still uses its OWN internal waypoints defined in
// src/sim/constants.ts and src/sim/routes.ts.  Those waypoints are deliberately
// imagined/approximate and are clearly marked as sim-scaffold.  They do NOT
// affect visual rendering; only ybbn_real.ts data is drawn on screen.
// When real taxi-route alignment is needed, replace sim/routes.ts and
// sim/constants.ts — not this file.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Airspace boundary ────────────────────────────────────────────────────────
// 30 nm radius ≈ 55,560 m
export const AIRSPACE_RADIUS_M = 55_560;

// ─── Geography polygons (approximate, for visual context) ─────────────────────
// These are in scene coordinates (+x east, +y south) and are approximate.
// They provide water/land context around the airport.

export interface GeoPolygon {
  id: string;
  type: 'water' | 'land';
  points: [number, number][];
}

// Moreton Bay — to the NE (approximate)
export const GEO_POLYGONS: GeoPolygon[] = [
  {
    id: 'moreton-bay',
    type: 'water',
    points: [
      [2200, -4000],
      [9000, -8000],
      [9000,  5000],
      [2200,  2000],
    ],
  },
  {
    id: 'brisbane-river',
    type: 'water',
    points: [
      [-9000, 2400],
      [ 1600, 2100],
      [ 1600, 2600],
      [-9000, 2900],
    ],
  },
];

// ─── SVG ViewBox ──────────────────────────────────────────────────────────────
// Encompasses real YBBN geometry (ybbn_real.ts) after Y-flip into scene coords.
// Real geometry extents (scene, +y=south):
//   x:       −2200 → +2200  (EW: both runways + taxiways + margins)
//   y_scene: −3300 → +4200  (NS: 01L north threshold → far south taxiways)
export const VIEWBOX = {
  minX:   -2200,
  minY:   -3300,
  width:   4400,
  height:  7500,
} as const;

export const VIEWBOX_STR = `${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`;
