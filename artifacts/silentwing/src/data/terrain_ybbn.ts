// Coarse terrain elevation grid for YBBN (Brisbane Airport).
// Fetched once from the Open-Meteo Elevation API (build-time, ODbL / open data).
// 30×30 = 900 points, ±0.15° lat/lon from origin (-27.384, 153.117).
// Grid origin matches ybbn.ts scene origin exactly.
import type { TerrainGrid } from '@/airports/types';
import raw from './terrain_YBBN.json';
export const TERRAIN_YBBN: TerrainGrid = raw as TerrainGrid;
