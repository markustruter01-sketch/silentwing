# SilentWing — Complete Project Context for Claude

## Purpose

SilentWing is a real-time airport and terminal-area air-traffic situational-awareness platform. It is designed as an operational-style display for controllers or aviation observers rather than as a consumer flight tracker. Its central idea is to combine live aircraft surveillance, accurate airport geometry, weather, automated conflict detection, sequencing, and an intelligent cinematic camera into one coherent 2D/3D traffic picture.

SilentWing is not certified surveillance equipment and must not be used as the sole source for aircraft separation. The interface explicitly warns the operator when the feed is stale.

## Current airport coverage

The product currently supports:

- YBBN — Brisbane Airport.
- YSSY — Sydney Airport.

Each airport is represented by an `AirportProfile` that contains:

- ICAO code, display name, short name, and timezone.
- Geographic projection origin.
- Live-feed search radius.
- Runway, taxiway, apron, gate, building, and optional terrain geometry.
- 2D map bounds.
- Runway designators and magnetic/true heading metadata.
- Calm-wind runway preference.
- Terminal alert radius, terminal altitude ceiling, broader airspace radius, and nominal sector capacity.
- 3D terminal label location.
- Optional simulator configuration.

YBBN includes simulator traffic, buildings, and a static terrain grid. YSSY is currently live-only, includes rebuilt runway/taxiway/apron/gate/building geometry, and does not currently have a terrain grid.

## User experience

### Main shell

The application opens into the 3D airspace view. The main header provides:

- 3D Airspace and 2D Airfield view selection.
- Airport selection.
- Aircraft, alert, ground-contact, and approximate sector-load statistics.
- Display filters for ground vehicles, anonymous contacts, buildings, and terrain.
- Automated Director on/off control.
- Data-source selection.
- Feed-health state.
- UTC clock.

The default source is ADS-B Exchange. OpenSky is available as a secondary live source. Simulator mode is available only for airports that define simulator data.

### 3D Airspace view

The 3D view is a hand-managed Three.js scene. It renders:

- Runways, taxiways, aprons, gates, and airport labels.
- Live aircraft with phase-based colours and labels.
- OSM-derived building footprints.
- Optional coarse terrain.
- Aircraft trails with age-based fading.
- Short-term position extrapolation.
- Velocity/predicted-path visual aids.
- Heavy-aircraft wake ribbons.
- Ground-aircraft sonar rings.
- SID/STAR-style route ribbons.
- Alert highlights, threat beams, and conflict bubbles.

Camera states are:

- `orbit`: automatic airport overview.
- `manual`: user-controlled orbit/pan/zoom.
- `inspect`: camera flies to a selected aircraft.
- `follow`: camera follows an aircraft.
- `returning`: smooth transition back to the overview.

Typical transitions are orbit → click aircraft → inspect → double-click → follow. Escape unwinds follow to inspect, inspect to manual/returning, and manual to orbit. Mouse drag enters manual control.

### Automated Director

Director is an automatic camera-attention system. It prioritises:

1. Active alerts.
2. Aircraft in approach, landing, takeoff, or other operationally important phases.
3. Return to the airport overview when the priority event is finished.

For an alert, Director flies toward the conflict, holds the view briefly, and returns. New alerts can interrupt the existing sequence. Director ignores alerts outside its useful visual radius. A “NOW WATCHING” strip and Director focus panel explain what is being followed.

The Director focus panel displays real feed-derived aircraft data but also contains deterministic illustrative manifest values such as passenger count, crew, dangerous goods, and animals. Those manifest values are not supplied by ADS-B and must not be treated as authoritative.

### 2D Airfield view

The 2D view is an interactive SVG airport plan. It includes:

- Runway surfaces, centre lines, threshold designators, and airport labels.
- Taxiway surfaces and centre lines.
- Aprons and gates.
- Land/water context, north arrow, and distance scale.
- Aircraft symbols rotated to heading.
- Callsign, speed, and altitude tags.
- Selection halo.

The user can pan, zoom, select aircraft, deselect with Escape, and open the aircraft detail panel.

### Aircraft details and sequencing

The detail panel shows:

- Callsign and aircraft type.
- Operational phase.
- Altitude, groundspeed, heading, and displayed squawk.
- Assigned runway and gate when available.
- Origin and destination when available.
- Current projected position.

Some displayed values are placeholders; for example, the current squawk display is not feed-authoritative.

The right-side sequence ladder displays the next three arrivals and departures. Rows show phase plus altitude or groundspeed. Aircraft may be pinned, and pinning can hold Director on that aircraft.

### Alerts workspace

The left-side operational notebook has tabs for:

- Alerts.
- Conflict Horizon.
- Traffic Forecast.
- Weather Impact.
- Alert Log.

The Alerts tab is currently the fully populated surface. Alerts are sorted by severity and age and show:

- Severity: advisory, caution, or critical.
- Detector type.
- Involved callsigns.
- Human-readable message.
- Age.

Clicking an alert focuses the 3D camera. Critical alerts can generate a Web Audio chime. The bell control mutes/unmutes the chime.

## Live data sources and API links

The browser never receives provider credentials. A separate Express API artifact proxies external services under `/api`.

### ADS-B Exchange through RapidAPI

Frontend endpoint:

`GET /api/adsb?lat={latitude}&lon={longitude}&dist={radiusNm}`

Upstream pattern:

`https://adsbexchange-com1.p.rapidapi.com/v2/lat/{lat}/lon/{lon}/dist/{dist}/`

Secret name:

- `ADSBX_API_KEY`

The proxy passes successful upstream JSON through unchanged. It preserves upstream HTTP errors and returns a 502 for network failures.

The frontend polls immediately and then every 8 seconds. Polling pauses while the browser tab is hidden and resumes immediately when visible. A request-in-flight guard prevents overlap. Out-of-order snapshots are ignored. On an error, the last valid snapshot remains visible and feed health degrades.

ADS-B fields actually consumed include:

- `hex`: ICAO transponder address and internal aircraft ID.
- `flight`: callsign.
- `r`: registration.
- `t`: aircraft type code.
- `lat`, `lon`: geographic position.
- `track`, `true_heading`, `mag_heading`: heading fallbacks.
- `gs`: groundspeed in knots.
- `alt_baro`: barometric altitude or the literal `ground`.
- `alt_geom`: geometric altitude fallback.
- `baro_rate`: vertical rate.
- `category`: used in ground-vehicle classification.
- `seen_pos`, `seen`: track age.
- Response-level `ac` aircraft array and `now` timestamp.

Derived application fields include callsign fallback, projected local x/y coordinates, altitude, heading, rounded groundspeed, phase, on-ground status, ground-vehicle status, vertical rate, destination airport, feed confidence, and track age.

### OpenSky Network

Frontend endpoint:

`GET /api/opensky?lat={latitude}&lon={longitude}&dist={radiusNm}`

Upstream:

`https://opensky-network.org/api/states/all`

The server converts the requested centre/radius to a WGS84 bounding box and supplies it as `lamin`, `lomin`, `lamax`, and `lomax`.

Secret names:

- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`

The request uses Basic authentication and a 20-second timeout. The client polls every 10 seconds with the same hidden-tab, in-flight, stale-data, and ordering protections as ADS-B.

OpenSky tuple fields consumed are:

- ICAO24.
- Callsign.
- Position timestamp.
- Longitude and latitude.
- Barometric altitude in metres.
- On-ground boolean.
- Velocity in metres/second.
- True track.
- Vertical rate in metres/second.

The adapter converts altitude to feet, speed to knots, and vertical rate to feet/minute. OpenSky is identified in the UI as a non-commercial source.

### AviationWeather.gov METAR and TAF

Frontend endpoint:

`GET /api/metar?icao={ICAO}`

Upstreams:

- `https://aviationweather.gov/api/data/metar?ids={ICAO}&format=json`
- `https://aviationweather.gov/api/data/taf?ids={ICAO}&format=json`

The API fetches METAR and TAF in parallel and returns:

`{ metar, taf }`

No credential is required. The server sets a five-minute public cache. The main weather panel polls immediately and every five minutes, pauses while hidden, uses a client timeout, and retains the last good result on failure.

METAR data displayed or used includes:

- Raw observation.
- Temperature and dewpoint.
- Wind direction, sustained wind, and gust.
- Visibility.
- Altimeter/QNH.
- Cloud layers and ceiling.
- Flight category: VFR, MVFR, IFR, or LIFR.

TAF currently displays primarily the raw forecast text.

Fresh METAR wind overrides the feed adapter’s fallback weather and influences active-runway selection.

### AviationWeather.gov NOTAM proxy

Frontend/API endpoint:

`GET /api/notam?icao={ICAO}`

Upstream:

`https://aviationweather.gov/api/data/notam?ids={ICAO}&format=json`

No credential is required. The route returns raw JSON with a ten-minute public cache. However, the current user interface does not correctly consume this route. The component named `NotamWidget` actually calls the METAR endpoint and behaves as a second compact METAR panel. Real NOTAM presentation is therefore incomplete.

### Open-Meteo weather forecast

The client uses Open-Meteo for current conditions and a 12-hour forecast. It refreshes every 15 minutes and displays:

- Current temperature and apparent temperature.
- Weather code/icon.
- Wind.
- Relative humidity.
- Precipitation.
- Hourly forecast values.

### Open-Meteo elevation data

Terrain is not fetched at runtime. YBBN terrain is a static 30×30 grid generated by a project script using Open-Meteo elevation data. It covers the airport region and is rendered as a coarse Three.js mesh.

### Static geospatial data

Airport runways, taxiways, aprons, gates, buildings, route ribbons, and airspace polygons are shipped as local TypeScript/JSON data.

Sources and provenance include:

- OpenStreetMap-derived taxiway/building geometry.
- OurAirports data and lookup tooling.
- AIP/ERSA-derived or validated runway-threshold information where documented.
- Locally generated terrain JSON from Open-Meteo.

Third-party geospatial data must retain appropriate attribution and licensing notices.

## Aircraft phase classification

The adapters derive operational phase from:

- Altitude.
- Groundspeed.
- On-ground state.
- Vertical rate.
- Gate proximity.
- Active-runway alignment.

Phases cover gate, taxi, takeoff, departure, enroute, approach, landing, and taxi-in behaviour. The exact classification is heuristic rather than flight-plan authoritative.

## Alert engine

Every live snapshot is passed through an in-memory `AlertEngine`. The engine keeps one active alert per stable detector key and also maintains an append-only event log.

Alert types are:

- `separation`.
- `predicted-conflict`.
- `runway-occupancy`.
- `stale-track`.

Severity values are:

- `advisory`.
- `caution`.
- `critical`.

A dismissed alert remains suppressed unless it returns at a higher severity. Active alerts are cleared when detector conditions disappear.

### Current separation detector

The detector compares fresh, airborne terminal traffic pairwise.

It excludes aircraft that are:

- On the ground.
- At or below roughly 50 feet.
- Slower than roughly 40 knots.
- Above the airport terminal ceiling.
- Outside the airport terminal radius.
- Older than the acceptable position-age threshold.

Approximate thresholds:

- Advisory: under 5 NM horizontally and 1,500 ft vertically.
- Caution: under 3 NM and 1,000 ft.
- Critical: under 1.5 NM and 700 ft.

### Predicted conflict detector

The detector projects straight-line velocity for 120 seconds in 10-second steps. It looks for a future breach below approximately 3 NM horizontal and 1,000 ft vertical separation.

Severity is based on time to conflict:

- Under 45 seconds: critical.
- Under 90 seconds: caution.
- Otherwise: advisory.

It suppresses pairs already covered by the current-separation detector.

Limitations: constant heading, constant speed, fixed altitude trend assumptions, and coarse sampling. It is an awareness aid, not a certified trajectory predictor.

### Runway occupancy detector

Runway corridors use an approximate 60-metre half-width plus a 500-metre extension beyond each end. Candidate tracks must be below roughly 500 feet and not excessively stale.

Two or more runway occupants create an alert:

- Critical when at least two are moving faster than approximately 5 knots.
- Otherwise caution.

### Stale-track detector

Stale tracking begins around 30 seconds and escalates to caution around 60 seconds. It is limited to nearby traffic and suppresses very slow anonymous ground contacts.

## Feed health and safety presentation

Feed health is:

- Live.
- Lagging after roughly 12 seconds.
- Stalled after roughly 25 seconds or on failure.

When stalled, SilentWing adds a red viewport treatment and a prominent:

`DATA STALE — DO NOT USE FOR SEPARATION`

banner. Last-known aircraft may remain visible, but extrapolation is conservative and capped.

## Architecture

SilentWing is a pnpm TypeScript monorepo.

### Main packages

- `artifacts/silentwing`: React 19, Vite 7, TypeScript frontend.
- `artifacts/api-server`: Express 5 API proxy, bundled for production.
- `artifacts/mockup-sandbox`: Replit design/component preview artifact, not part of the operating application.
- `lib/api-client-react`: shared generated/client infrastructure.
- `lib/api-spec`: API specification package scaffold.
- `lib/api-zod`: shared Zod response models.
- `lib/db`: Drizzle/PostgreSQL scaffold.
- `scripts`: terrain and project utilities.

### Frontend stack

- React 19.
- TypeScript.
- Vite.
- Three.js.
- Tailwind CSS.
- Radix UI primitives.
- Lucide icons.
- Zustand is available, although main orchestration currently lives in React state/effects.

`App.tsx` is the primary coordinator. Data flow is:

1. Selected adapter polls its provider.
2. Adapter converts provider data into a common `WorldSnapshot`.
3. App stores the snapshot.
4. Fresh METAR wind overlays snapshot weather.
5. AlertEngine processes the snapshot.
6. App derives active alerts and per-aircraft severity.
7. 2D/3D views, panels, Director, and sequence ladder receive the derived state.

### Backend stack

- Express 5.
- TypeScript bundled to ESM.
- Pino/pino-http logging.
- CORS and JSON/form parsing.
- Zod-backed health response.
- Drizzle/PostgreSQL packages are present as scaffold.

The server requires `PORT` and exposes `/api/healthz` for startup checks.

### Routing and publishing

Replit artifact routing serves:

- Static SilentWing frontend at `/`.
- Runnable API server under `/api`.

Production builds:

- Bundle the API server.
- Run Vite production build.
- Serve `artifacts/silentwing/dist/public` as static content.
- Run the API server with Node on port 8080.
- Probe `/api/healthz`.

## Persistence, authentication, and database status

There is currently:

- No user authentication.
- No account system.
- No production application database schema.
- No durable server-side alert history.
- No durable pins, selections, or controller preferences apart from limited UI local storage.

`lib/db` contains a PostgreSQL/Drizzle connection scaffold using `DATABASE_URL`, but the schema is effectively empty and SilentWing does not use it for its operational state.

Most state is in browser memory. The alert log is currently append-only for the lifetime of the session and can grow without bound.

## Development and verification

Common commands:

- `pnpm --filter @workspace/silentwing run dev`
- `pnpm --filter @workspace/silentwing run build`
- `pnpm --filter @workspace/silentwing run typecheck`
- `pnpm --filter @workspace/api-server run dev`
- `pnpm --filter @workspace/api-server run build`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm build`
- `pnpm typecheck`

There is no established unit/integration test suite or browser test suite. Development-only UI controls can inject a converging aircraft conflict and simulate feed loss, but detector coverage is not automated.

## Known limitations and unfinished areas

- Sector load is a rough aircraft-count placeholder, not a real workload/demand metric.
- Predicted conflicts use a simple straight-line model.
- Alert log is unbounded during long sessions.
- Current NOTAM UI is not wired to the actual NOTAM route.
- Several aircraft-detail and Director manifest values are illustrative.
- YSSY has no terrain grid.
- OpenSky terms make it unsuitable as a commercial primary data source.
- There is no auth, database-backed persistence, audit history, role model, or multi-controller coordination.
- There are no automated tests.
- The Three.js view is large and imperative, making it a major review/refactoring target.
- Altitude and ground-state sanitisation require more defensive handling.
- Camera/Director behaviour around dismissed alerts and overview visibility has open edge cases.
- Alert trend, filtering, aggregation, and richer detector test scenarios remain planned.
- Route ribbon naming, route assignment display, density fading, takeoff animation, and resizable weather remain planned.

## Important instructions for a Claude Code review

When reviewing this repository:

1. Treat SilentWing as a safety-adjacent awareness prototype, not certified ATC equipment.
2. Distinguish feed-authoritative values from heuristic, synthetic, and illustrative values.
3. Trace all data-source fields through adapter conversion into the shared aircraft model.
4. Check that 2D rendering, 3D rendering, and alert detectors agree on projection, ground state, altitude, runway occupancy, and staleness.
5. Review alert thresholds and detector deduplication separately from UI severity presentation.
6. Review the camera state machine and Director interruption rules for race conditions.
7. Review stale-feed behaviour and ensure failures remain visible rather than silently falling back.
8. Review `AirspaceView3D.tsx` for lifecycle leaks, duplicated mutable state, WebGL resource disposal, and opportunities to split focused modules.
9. Review external API proxying for timeouts, rate limits, response validation, privacy, and licensing.
10. Do not assume the database scaffold is in use.
11. Do not assume the component named `NotamWidget` displays NOTAMs.
12. Do not treat synthetic manifest or placeholder squawk values as real surveillance data.
13. Preserve airport-profile abstraction and avoid reintroducing airport-specific constants into generic components.
14. Add automated tests around coordinate projection, phase classification, each detector, stale-feed transitions, and camera-state transitions before major behavioural refactors.

## Suggested initial Claude project prompt

Use this file as the source of truth for the current product context. Begin by auditing the repository without changing code. Produce:

1. A component and data-flow map.
2. A source-of-truth matrix for every aircraft/weather/alert field.
3. A prioritized correctness and safety-risk register.
4. A test strategy focused on projection, phase classification, alert detectors, stale data, and camera transitions.
5. A staged refactoring plan that preserves current visible behaviour.
6. A list of claims in the UI that are synthetic, placeholder, unsupported, or not yet wired.

Only after presenting that audit should you propose code changes.