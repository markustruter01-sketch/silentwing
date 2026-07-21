---
name: Taxi route geometry rules
description: Why international gate y changed from 215 to 180, and the INTL_APRON_W waypoint that routes around the terminal building
---

## The problem (pre-Phase 4)
International terminal polygon: x=-450..200, y=200..700.
Old gates: y=215 (inside terminal polygon). Old route went INTL_ENTRY(-560,710) → gate(gx,215) diagonally, crossing the terminal body for all 8 gates.

Verified: old I1–I8 all reported `CROSSES TERMINAL` in geometry check.

## The fix
1. `INTL_GATE_Y`: 215 → 180 (20 m north of terminal north face at y=200)
   - Changed in: `constants.ts`, `ybbn.ts` (`intlGates()`)
2. Added `INTL_APRON_W = {x: -475, y: 180}` in `routes.ts`
   - Leg INTL_ENTRY(-560,710) → INTL_APRON_W(-475,180): x stays ≤ -475, west of terminal west face (x=-450). ✓
   - Leg INTL_APRON_W(-475,180) → gate(gx,180): y=180 is north of terminal north face (y=200). ✓
3. Both `routeIntlArrival` and `routeIntlDeparture` updated to include INTL_APRON_W.

Verified: all 16 legs (8 gates × arrival + departure) report `CLEAN` in geometry check.

## Domestic routes
DOM_GATE_Y = -185 (south of terminal south face at y=-200). All domestic legs stay south of the terminal. No change needed.

**Why:** Diagonal paths through building polygons are visually obvious ATC errors. The fix required moving the gate y-coordinate, not just adding a waypoint, because gates at y=215 were inside the terminal polygon regardless of approach direction.
