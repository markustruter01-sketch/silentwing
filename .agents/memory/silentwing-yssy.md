---
name: Sydney YSSY addition
description: How YSSY was added as the second airport profile; switcher, live-only guard, WeatherWidget fix
---

## Key decisions

**Files created/modified:**
- `src/data/yssy_real.ts` — copied from attached asset; imports Polyline/GatePos from `./ybbn_real`
- `src/airports/yssy.ts` — YSSY profile; `sim: undefined` (live-only); 3 runways (16L/34R, 16R/34L, 07/25); headingDeg 157/157/73; calmWindDefaultDir `34L`; viewbox minX:-1440 minY:-2890 w:3070 h:5150
- `src/airports/index.ts` — `AIRPORTS` registry `{ YBBN, YSSY }`; `DEFAULT_AIRPORT_ICAO = 'YBBN'`
- `src/airports/types.ts` — added `timezone: string` to AirportProfile
- `src/airports/ybbn.ts` — added `timezone: 'Australia/Brisbane'`

**App.tsx switcher pattern:**
- `const [activeProfile, setActiveProfile] = useState<AirportProfile>(YBBN)` at top of App
- `handleAirportSwitch` defined inline after active profile state; clears selection/alerts, forces `live` if `!profile.sim`
- `adapter` useMemo depends on `[dataSource, activeProfile]`; guards `dataSource === 'sim' && !activeProfile.sim`
- `alertEngineRef` reinitialised via `useEffect([activeProfile])` → new AlertEngine + clear alerts
- Airport switcher buttons rendered in 3D title area; `pointer-events-auto` re-enabled on that div
- `sectorLoad(count, capacity)` now takes capacity as arg (was hardcoded to YBBN)

**WeatherWidget:**
- Now accepts `profile: AirportProfile` prop
- `makeWeatherUrl(lat, lon, tz)` builds Open-Meteo URL dynamically
- `useEffect` deps include `profile.icao/lat/lon/timezone`; resets wx state on airport change
- Label shows `profile.icao` / `profile.nameShort` (not hardcoded YBBN/BRISBANE)

**TopBar sim toggle:**
- Added `simAvailable?: boolean` prop (default true)
- `DataSourceToggle` filters sources list: live-only airports show only `['live']`
- App.tsx also intercepts `onDataSourceChange` to ignore sim if `!activeProfile.sim`

**Why `handleAirportSwitch` before useState declarations works:**
- Callback function body only executes on user interaction (after full mount)
- setState setters are stable references; no TDZ issue at runtime
- TypeScript compiles cleanly

**YSSY geometry facts:**
- Runway refs must exactly match yssy_real.ts: `'16L/34R'`, `'16R/34L'`, `'07/25'`
- Origin: lat -33.9461, lon 151.1772 (must match YSSY_ORIGIN in yssy_real.ts)
- terminalLabelPos: { x: 600, z: -1100 } (approx centroid of terminal gate cluster)
