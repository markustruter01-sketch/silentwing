// ─── OurAirports lookup ───────────────────────────────────────────────────────
//
// Static lookup backed by the OurAirports public-domain dataset
// (https://ourairports.com/data/).  Data was downloaded once and stored as
// artifacts/silentwing/public/data/ourairports.json — a filtered extract of
// large_airport + medium_airport records with attached runway data.
//
// The JSON is NOT bundled — it is fetched lazily from the /data/ static path
// on first use and cached in memory.  This keeps the main bundle lean; the
// file is only loaded when a caller (DEV panel or future airport-setup code)
// actually needs it.
//
// Usage:
//   import { getAirportInfo } from '@/airports/ourairports';
//   const info = await getAirportInfo('YMML');
//
// This module is ADDITIVE infrastructure.  It does NOT touch any rendering,
// geometry, or AirportProfile construction — those remain unchanged.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OurAirportRunway {
  /** Low-end designator, e.g. "01L" */
  le:        string;
  /** High-end designator, e.g. "19R" */
  he:        string;
  /** True heading of the low end (degrees true), null if not surveyed */
  leHdg:     number | null;
  /** True heading of the high end */
  heHdg:     number | null;
  /** Lat/lon of the low-end threshold */
  leLat:     number | null;
  leLon:     number | null;
  /** Lat/lon of the high-end threshold */
  heLat:     number | null;
  heLon:     number | null;
  /** Declared length in feet */
  lengthFt:  number | null;
  /** Width in feet */
  widthFt:   number | null;
  /** Surface type code, e.g. "ASP" */
  surface:   string;
  /** Whether the runway has lighting */
  lighted:   boolean;
}

export interface OurAirportInfo {
  /** ICAO identifier */
  icao:     string;
  /** Official English name from OurAirports */
  name:     string;
  /** OurAirports type: "large_airport" | "medium_airport" */
  type:     string;
  /** Airport Reference Point latitude (WGS-84) */
  lat:      number;
  /** Airport Reference Point longitude (WGS-84) */
  lon:      number;
  /** Elevation in feet MSL */
  elevFt:   number;
  /** ISO 3166-1 alpha-2 country code */
  country:  string;
  /** ISO 3166-2 region code */
  region:   string;
  /** IATA code, empty string if none */
  iata:     string;
  /** Open (non-closed) runways from OurAirports */
  runways:  OurAirportRunway[];
}

// ── Lazy-load cache ───────────────────────────────────────────────────────────

type AirportMap = Record<string, OurAirportInfo>;

let _cache: AirportMap | null = null;
let _loading: Promise<AirportMap> | null = null;

/** Resolve the data file URL, respecting Vite's base path. */
function dataUrl(): string {
  // import.meta.env.BASE_URL always ends with '/'; trim trailing slash so we
  // don't produce double slashes in the path.
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  return `${base}/data/ourairports.json`;
}

async function loadData(): Promise<AirportMap> {
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = fetch(dataUrl())
    .then(r => {
      if (!r.ok) throw new Error(`OurAirports fetch failed: HTTP ${r.status}`);
      return r.json() as Promise<AirportMap>;
    })
    .then(data => {
      _cache = data;
      _loading = null;
      return data;
    })
    .catch(err => {
      _loading = null;    // allow retry on next call
      throw err;
    });

  return _loading;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up official airport data by ICAO code.
 *
 * Returns `null` when the ICAO is not found in the dataset (e.g. a small
 * aerodrome below large/medium threshold, or an unknown code).
 *
 * The first call triggers a one-time fetch of the static JSON; subsequent
 * calls resolve instantly from the in-memory cache.
 *
 * @param icao - ICAO airport identifier (case-insensitive)
 */
export async function getAirportInfo(icao: string): Promise<OurAirportInfo | null> {
  const data = await loadData();
  return data[icao.toUpperCase()] ?? null;
}

/**
 * Synchronous version — only safe to call AFTER the data has been loaded
 * (e.g. inside a component that already awaited `getAirportInfo`).
 * Returns `null` if the cache is empty or the ICAO is not found.
 */
export function getAirportInfoSync(icao: string): OurAirportInfo | null {
  if (!_cache) return null;
  return _cache[icao.toUpperCase()] ?? null;
}

/**
 * Pre-warm the cache in the background.  Call once at app startup so the
 * first `getAirportInfo()` call doesn't block on a cold fetch.
 */
export function prefetchOurAirports(): void {
  void loadData().catch(() => { /* silent — will retry on first actual use */ });
}
