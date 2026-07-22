// ─── Airport registry ─────────────────────────────────────────────────────────
//
// The single place that lists every airport SilentWing knows about.
// Import AIRPORTS here — never import individual profiles outside their own
// profile file and this registry.

import { YBBN } from './ybbn';
import { YSSY } from './yssy';
import type { AirportProfile } from './types';

export const AIRPORTS: Record<string, AirportProfile> = { YBBN, YSSY };

/** ICAO of the airport shown on first load. */
export const DEFAULT_AIRPORT_ICAO = 'YBBN';
