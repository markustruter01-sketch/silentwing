# SILENTWING — ADD SYDNEY (YSSY) AS SECOND AIRPORT

**ENVIRONMENT:** Existing SilentWing Replit dev project. The multi-airport
refactor is done (Brisbane is now a profile; the app reads from the active
profile). This task ADDS Sydney (YSSY) as a second profile and a top-bar airport
switcher. Sydney is LIVE-ONLY (ADS-B) — no sim. Do NOT rebuild the profile
system. Stop and report.

**A file named `yssy_real.ts` has been uploaded** to the project (in src/data/).
It contains Sydney's real geometry (3 runways: 16L/34R, 16R/34L, 07/25; taxiways;
aprons; gates), pre-projected to Sydney's ARP origin (-33.9461, 151.1772) using
the same equirectangular formula as Brisbane. It imports Polyline/GatePos types
from ybbn_real.ts.

---

## SYDNEY FACTS (for the profile)

- **icao:** "YSSY"
- **name:** "Sydney Airport"
- **nameShort:** "SYDNEY INTL"
- **origin:** { lat: -33.9461, lon: 151.1772 }   (must match yssy_real.ts YSSY_ORIGIN)
- **fetchRadiusNm:** 50
- **Runways (THREE — note the crosswind runway):**
  - 16L/34R — low designator 16L, high 34R, heading of 16L ≈ 157°
  - 16R/34L — low designator 16R, high 34L, heading of 16R ≈ 157°
  - 07/25   — low designator 07,  high 25,  heading of 07 ≈ 073°
  (Sydney's magnetic runway headings: the parallels are ~157°/337°, the cross
  is ~073°/253°. Use these for wind-derived active-runway selection.)
- **calmWindDefaultDir:** "34L" (Sydney commonly lands on 34 in calm/typical
  conditions — a reasonable default; tune later)
- **terminalRadiusNm:** 7.5
- **terminalAltCeilFt:** 15000
- **airspaceRadiusM:** 55560
- **sectorCapacity:** 25  (Sydney is busier than Brisbane; higher capacity)
- **sim:** undefined  (Sydney is live-only — no sim routes)
- **geometry:** from yssy_real.ts (YSSY_RUNWAYS, YSSY_TAXIWAYS, YSSY_APRONS, YSSY_GATES)
- **geoPolygons:** none for now (no hand-drawn water/land context for Sydney —
  empty array is fine; Botany Bay context can be added later)
- **viewbox:** compute from the Sydney geometry extents (the yssy data spans
  roughly X: -1340..1530, Y: -2790..2160 — fit a viewbox around this with a
  small margin, same approach as Brisbane's viewbox).

---

## TASKS

### 1. Build the YSSY profile
Create `src/airports/yssy.ts` mirroring the structure of `src/airports/ybbn.ts`,
populated with the facts above and the geometry imported from yssy_real.ts.
- runwayThresholds and approachCorridors are COMPUTED from geometry via the
  existing helper functions (computeRunwayThresholds / computeApproachCorridors)
  — do NOT hardcode them. With three runways there will be more thresholds; the
  helpers should handle N runways already.
- deriveActiveRunway must work with three runways: it picks the designator whose
  heading best points into the wind across ALL runway ends (parallels + cross).

### 2. Register Sydney
In `src/airports/index.ts`, add YSSY to the AIRPORTS registry:
`{ YBBN: <ybbn>, YSSY: <yssy> }`. Brisbane remains the default active airport.

### 3. Top-bar airport switcher
Add a dropdown/selector in the top bar (near the ICAO/name display) listing the
registered airports (Brisbane, Sydney). Selecting one switches the active
profile. On switch:
- The projection origin changes to the selected airport's origin.
- The ADS-B adapter re-points: the client requests the new airport's origin +
  radius from the /api/adsb proxy (query params), so live traffic is now the
  selected airport's traffic.
- The geometry, viewbox, runway config, alert filter, sector capacity, and UI
  labels all update from the new profile.
- The 3D camera re-frames to the new airport (reset to orbit around the new
  origin/geometry).
- Trails/aircraft state from the previous airport are cleared (don't carry
  Brisbane aircraft into the Sydney view).

### 4. Sydney is LIVE-ONLY
- When Sydney is the active airport, the SIM toggle should be disabled or hidden
  (Sydney has no sim config). If the user is in Sim mode and switches to Sydney,
  force Live mode. State how you handled this.
- Brisbane retains full Sim + Live.

### 5. Fix the weather widget (carried-over Brisbane hardcode)
The WeatherWidget has hardcoded Brisbane values that survived the refactor:
- Open-Meteo URL latitude/longitude → use the active profile's origin.
- timezone → derive from the airport (Brisbane and Sydney are both
  Australia/Brisbane vs Australia/Sydney — note Sydney observes DST, Brisbane
  does not, so use the correct tz per airport; add a `timezone` field to the
  profile: YBBN "Australia/Brisbane", YSSY "Australia/Sydney").
- The "YBBN"/display label → use the active profile's icao/name.
So weather follows the selected airport.

---

## HARD RULES

1. Reuse the existing profile system, helpers, and switcher context. Do NOT
   rebuild them or fork Brisbane-specific logic.
2. No `if (icao === 'YSSY')` branches — Sydney is just another profile.
3. Thresholds/corridors COMPUTED from geometry (helpers already exist).
4. Sydney is live-only (sim undefined); handle the Sim toggle gracefully.
5. Switching airports must re-point the ADS-B feed, re-frame the camera, clear
   old aircraft, and update all labels/geometry/weather.
6. Brisbane must still work exactly as before, including its sim.
7. The weather widget must follow the active airport (fix the hardcode).

---

## REPORT AFTER BUILDING (raw, no summaries)

1. Raw file list created/modified.
2. The YSSY profile object (abbreviate geometry arrays).
3. Confirm computeRunwayThresholds produced sensible positions for all THREE
   Sydney runways (list them).
4. Confirm deriveActiveRunway picks a sensible runway for wind FROM 340°
   (should favour 34), FROM 160° (favour 16), and FROM 070° (favour 07).
5. Confirm switching to Sydney: re-points ADS-B (show the new request URL with
   Sydney's coords), clears Brisbane aircraft, re-frames camera.
6. Confirm on a LIVE Sydney poll: how many aircraft returned, and do they
   project onto the Sydney runways sensibly (spot-check one aircraft's scene
   coords vs a runway position).
7. Confirm Sim toggle handling when Sydney is active.
8. Confirm the weather widget now uses Sydney's coords + timezone when Sydney is
   selected.
9. Confirm Brisbane still works fully (sim + live) after the change.
