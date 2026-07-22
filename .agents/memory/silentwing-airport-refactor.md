---
name: SilentWing multi-airport refactor
description: AirportProfile architecture, wind convention, approach corridor derivation, key decisions
---

## Rule
All airport-specific constants flow through one `AirportProfile` object.  No `if (icao === 'YBBN')` anywhere.  Adding a second airport means creating one new profile file — nothing else changes.

**Why:** The old code scattered YBBN literals across 8+ files.  The profile acts as a typed, per-airport record that every consumer reads from context or direct import.

## Wind convention
`windDir` in this codebase is the **FROM** direction (aviation standard).  
- Wind FROM 190° → blowing northward → aircraft land SOUTHWARD → runway 19 active.  
- `deriveActiveRunwayDirection` picks the runway heading closest to `windDirDeg`.
- With default wind 190°/12kt the active stem is "19" (not "01" — the old hardcode was wrong aeronautically).

## Key files
- `src/airports/types.ts` — `AirportProfile` interface  
- `src/airports/helpers.ts` — `computeRunwayThresholds`, `computeApproachCorridors`, `deriveActiveRunwayDirection`, `projectLatLon`  
- `src/airports/ybbn.ts` — single YBBN profile; imports from `ybbn_real`, `ybbn`, `sim/constants`  
- `src/airports/context.tsx` — `AirportProvider`, `useAirport()` hook  

## AirportProvider placement
Wraps only the view section of App's JSX (not the whole tree).  App imports `YBBN` directly for non-React consumers (AlertEngine, AdsbAdapter, getSimAdapter).

## sectorLoad formula
`Math.min(99, Math.round(count / profile.sectorCapacity * 100))` — YBBN capacity = 20.

## Approach corridor derivation
`computeApproachCorridors(runwayDefs, geometryRunways, activeStem)` averages threshold positions of matching designators to get `cx, cz` (Three.js scene coords), then derives `dz` (±1) from whether the active stem is the low or high designator and the runway heading.

## How to apply
When adding a new airport: create `src/airports/<icao>.ts`, export a const satisfying `AirportProfile`, import it in `App.tsx` next to `YBBN`, and pass it to the provider/engine/adapter constructors.
