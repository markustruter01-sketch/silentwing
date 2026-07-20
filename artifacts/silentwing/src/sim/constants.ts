// ─── Simulation geometry constants ───────────────────────────────────────────
// Must stay in sync with src/data/ybbn.ts — these are the shared numeric roots.

export const RUNWAY_HEADING_DEG = 10;
export const H_RAD  = (RUNWAY_HEADING_DEG * Math.PI) / 180;
export const SIN_H  = Math.sin(H_RAD);   // ≈ 0.17365
export const COS_H  = Math.cos(H_RAD);   // ≈ 0.98481

export const RW01L_CX = -1020;   // 01L/19R centreline x (m)
export const RW01R_CX =  980;    // 01R/19L centreline x (m)

// Parallel taxiway centres (match ybbn.ts offsets exactly)
export const ALPHA_CX = RW01L_CX + 165 * COS_H;   // ≈ -857.5
export const ALPHA_CY = 165 * SIN_H;                // ≈  28.7
export const BRAVO_CX = RW01R_CX - 160 * COS_H;   // ≈  822.6
export const BRAVO_CY = -160 * SIN_H;               // ≈  -27.8

// Unit conversions
export const KTS_TO_MS = 0.5144;
export const MS_TO_KTS = 1 / KTS_TO_MS;

// Simulation tick rate
export const TICK_MS = 100; // 10 Hz

// Gate geometry — must match ybbn.ts gate generators
export const DOM_GATE_Y  = -185;
export const INTL_GATE_Y =  215;
export function domGateX(i: number)  { return -580 + i * 68; }
export function intlGateX(i: number) { return -410 + i * 75; }
