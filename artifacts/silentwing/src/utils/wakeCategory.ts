// ─── Wake turbulence category lookup ─────────────────────────────────────────
// Maps ICAO aircraft type codes to ICAO wake turbulence categories:
//   H = Heavy  (MTOW ≥ 136 000 kg)
//   M = Medium (everything else — default)
//
// Out of scope: per-aircraft category from a live database.
// Seeded with the most common Heavy/Super types seen at major international airports.

const HEAVY_TYPES: ReadonlySet<string> = new Set([
  // Airbus widebody
  'A306', 'A30B', 'A310',
  'A332', 'A333', 'A338', 'A339',
  'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K',
  'A388',
  // Boeing widebody
  'B742', 'B743', 'B744', 'B748',
  'B752', 'B753',           // 757 heavy variant (not technically but close)
  'B762', 'B763', 'B764',
  'B772', 'B773', 'B77L', 'B77W', 'B778', 'B779',
  'B788', 'B789', 'B78X',
  // Antonov
  'A124', 'A225',
  // Military / cargo
  'C17', 'C5', 'C5M',
  // Ilyushin / Tupolev
  'IL76', 'IL96', 'TU95', 'TU96',
]);

/**
 * Returns the ICAO wake turbulence category for the given aircraft type code.
 * Input is normalised to upper-case so mixed-case codes work correctly.
 */
export function wakeCategory(icaoType: string): 'H' | 'M' {
  return HEAVY_TYPES.has(icaoType.toUpperCase()) ? 'H' : 'M';
}
