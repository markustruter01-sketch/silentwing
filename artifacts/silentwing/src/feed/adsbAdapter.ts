// ─── ADS-B Exchange DataFeedAdapter ──────────────────────────────────────────
//
// Implements the same DataFeedAdapter interface the sim implements.
// Polls /api/adsb (server-side proxy; key never reaches the client bundle).
// Normalises raw ADS-B Exchange ac[] entries into the app's Aircraft shape.
// Pauses polling when the browser tab is hidden (Page Visibility API).
//
// Architecture note: per-aircraft trail history is maintained by the 3D view
// (AirspaceView3D) from successive WorldSnapshot deliveries — identical to how
// it works with the sim.  The adapter only needs to deliver correct current
// positions on each poll; the view accumulates the trail.

import type {
  DataFeedAdapter,
  WorldSnapshot,
  Aircraft,
  AircraftDetail,
  Alert,
  FlightPhase,
  Unsubscribe,
} from '../types';
import type { GatePos } from '../data/ybbn_real';
import type { AirportProfile } from '../airports/types';
import { deriveActiveRunwayDirection } from '../airports/helpers';

// ── Phase heuristic ───────────────────────────────────────────────────────────
// Real ADS-B carries no flight-phase field.  We derive a best-effort phase
// from altitude, groundspeed, and proximity to known gate positions.
//
// Gate proximity:  gs < AT_GATE_GS_KT  AND  within AT_GATE_DIST_M of any gate
//                  → 'at-gate'.  Otherwise ground aircraft are 'taxi-in'.
//
// Coordinate note: geometry gates use ybbn_real.ts native frame (+y = north).
// The adapter uses +y = south (SVG convention), so the gate y must be negated
// when computing the distance: dy = acY − (−gateY) = acY + gateY.

const AT_GATE_GS_KT  = 2;   // knots  — aircraft considered stationary at gate
const AT_GATE_DIST_M = 60;  // metres — gate proximity threshold

// ── angularDiff ───────────────────────────────────────────────────────────────
// Smallest angular difference between two compass headings (0–180°).
function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ── activeRunwayHeadingDegrees ────────────────────────────────────────────────
// Converts the active-direction STEM string (e.g. "01", "19") back to the
// actual compass heading in degrees that aircraft use when departing on that
// runway end.  Returns undefined if the stem cannot be matched.
function activeRunwayHeadingDegrees(
  profile: Pick<AirportProfile, 'runways'>,
  activeStem: string,
): number | undefined {
  for (const rw of profile.runways) {
    const lowStem  = rw.lowDesignator.replace(/[LRC]$/, '');
    const highStem = rw.highDesignator.replace(/[LRC]$/, '');
    if (lowStem  === activeStem) return rw.headingDeg;
    if (highStem === activeStem) return (rw.headingDeg + 180) % 360;
  }
  return undefined;
}

function derivePhase(
  altFt: number,
  gs: number,
  baroRate: number | undefined,
  acX: number,
  acY: number,
  gates: GatePos[],
  track: number,
  activeRunwayHeadingDeg: number | undefined,
): FlightPhase {
  if (altFt < 50) {
    // On the ground — distinguish at-gate from taxiing
    if (gs < AT_GATE_GS_KT) {
      const d2 = AT_GATE_DIST_M * AT_GATE_DIST_M;
      for (const gate of gates) {
        const dx = acX - gate.pos[0];
        const dy = acY + gate.pos[1]; // y-axis flip: ybbn_real +y=north ↔ adapter +y=south
        if (dx * dx + dy * dy <= d2) return 'at-gate';
      }
    }
    return 'taxi-in';
  }

  // Use vertical rate to distinguish departure (climbing) from arrival (descending).
  // baro_rate > 200 ft/min = clearly climbing; < -200 = clearly descending.
  //
  // Many transponders omit baro_rate at low altitude (fresh ADS-B lock right
  // after rotation is the most common case).  When baro_rate is absent below
  // 500 ft we use the aircraft's track relative to the active runway to
  // distinguish departures from arrivals.  The active runway heading is the
  // landing heading (aircraft land INTO the wind), so departures use its
  // reciprocal:
  //   • Track within ±45° of the DEPARTURE heading → climbing (takeoff)
  //   • Track within ±45° of the LANDING heading → not climbing
  //   • Ambiguous / no runway data → assume descent (safer default; arrivals
  //     dominate terminal snapshots and a false "landing" label is less
  //     alarming than a false "takeoff").
  //
  // Above 500 ft the ambiguity matters less (both phases are well-separated by
  // altitude trend), so we keep the conservative "assume descent" fallback there.
  let climbing: boolean;
  if (baroRate !== undefined) {
    climbing = baroRate > 200;
  } else if (altFt < 500 && gs >= 80 && activeRunwayHeadingDeg !== undefined) {
    // activeRunwayHeadingDeg is the landing heading; departures use its reciprocal.
    const landingHdg   = activeRunwayHeadingDeg;
    const departureHdg = (activeRunwayHeadingDeg + 180) % 360;
    const diffDep      = angularDiff(track, departureHdg);
    const diffLand     = angularDiff(track, landingHdg);
    // Within 45° of departure heading → assume takeoff; otherwise → landing/approach
    climbing = diffDep < 45 && diffDep < diffLand;
  } else {
    // Default: assume descent (statistically more arrivals than departures in
    // the terminal area at any given snapshot).
    climbing = false;
  }

  if (altFt <   500) return climbing ? 'takeoff'   : 'landing';
  if (altFt < 3_000) return climbing ? 'departure' : 'approach';
  return                              climbing ? 'enroute-departure' : 'enroute-arrival';
}

// ── Callsign sanitisation ─────────────────────────────────────────────────────
// flight field has trailing spaces, may be all '@', may be absent.
const GARBAGE_RE = /^[@\s]+$/;

function sanitiseCallsign(flight: unknown, hex: string): string {
  if (typeof flight !== 'string') return hex;
  const t = flight.trim();
  if (!t || GARBAGE_RE.test(t)) return hex;
  return t;
}

// ── Raw ADS-B entry shape ─────────────────────────────────────────────────────
// Only the fields we actually read are typed; extra fields are ignored.
interface RawAc {
  hex:           string;
  flight?:       string;
  r?:            string;
  t?:            string;
  lat?:          number;
  lon?:          number;
  track?:        number;
  true_heading?: number;
  mag_heading?:  number;
  gs?:           number;
  alt_baro?:     number | 'ground';  // ← CRITICAL: string "ground" when on ground
  alt_geom?:     number;
  baro_rate?:    number;             // ft/min, positive = climbing; absent on many entries
  category?:     string;
  seen_pos?:     number;  // seconds since this entry's position was last updated
  seen?:         number;  // seconds since any message from this aircraft
}


// ── Normalise one raw entry → Aircraft (or null if invalid) ──────────────────
function normalise(
  raw: RawAc,
  projectFn: (lat: number, lon: number) => { x: number; y: number },
  gates: GatePos[],
  destinationIcao: string,
  activeRunwayHeadingDeg: number | undefined,
): (Aircraft & { isGroundVehicle: boolean }) | null {
  // Rule 3: skip entries with no position
  if (raw.lat == null || raw.lon == null) return null;

  // Rule 1 (CRITICAL — written first): alt_baro may be string "ground"
  let altFt: number;
  if (raw.alt_baro === 'ground') {
    altFt = 0;
  } else if (typeof raw.alt_baro === 'number') {
    altFt = raw.alt_baro;
  } else {
    // alt_baro missing — fall back to alt_geom, then assume ground
    altFt = typeof raw.alt_geom === 'number' ? raw.alt_geom : 0;
  }

  // Rule 4: ground-vehicle tagging (C2 category, or t/r = TWR)
  const isGroundVehicle =
    raw.category === 'C2' ||
    raw.t === 'TWR'       ||
    raw.r === 'TWR';

  // Rule 2: callsign
  const callsign = sanitiseCallsign(raw.flight, raw.hex);

  // Heading fallback chain
  const heading = raw.track ?? raw.true_heading ?? raw.mag_heading ?? 0;

  const { x, y } = projectFn(raw.lat, raw.lon);

  return {
    id:             raw.hex,
    callsign,
    type:           raw.t ?? 'UNKN',
    phase:          isGroundVehicle ? 'taxi-in' : derivePhase(altFt, Math.round(raw.gs ?? 0), raw.baro_rate, x, y, gates, heading, activeRunwayHeadingDeg),
    position:       { x, y, alt: altFt },
    heading,
    groundSpeed:    Math.round(raw.gs ?? 0),
    assignedRunway: undefined,
    assignedGate:   undefined,
    origin:         undefined,
    destination:    destinationIcao,
    confidence:     1.0,
    // FIX B: pass seen_pos through so the 3D view can flag stale tracks
    seenPos:        raw.seen_pos ?? 0,
    // Vertical rate for 3D velocity extrapolation (ft/min; absent on many entries)
    verticalRate:   raw.baro_rate,
    isGroundVehicle,
    // Authoritative on-ground signal — true only when alt_baro is the string
    // "ground".  alt_geom must never promote a ground aircraft to airborne.
    onGround:       raw.alt_baro === 'ground',
  };
}

// ── Feed health thresholds ────────────────────────────────────────────────────
// Same intent as the sim's getFeedHealth() — drives the existing LIVE / LAGGING
// / STALLED indicator in TopBar without any changes to that component.
export const HEALTH_LAGGING_MS = 12_000;   // > 12 s since last good poll → lagging
export const HEALTH_STALLED_MS = 25_000;   // > 25 s                      → stalled

// ── ADS-B adapter ─────────────────────────────────────────────────────────────

export const POLL_INTERVAL_MS = 8_000; // configurable; exposed for callers

export class AdsbAdapter implements DataFeedAdapter {
  private subs      = new Set<(s: WorldSnapshot) => void>();
  private latest:   WorldSnapshot;
  private lastPoll  = 0;             // ms timestamp of last successful poll
  private lastError: string | null = null;
  private timer:    ReturnType<typeof setInterval> | null = null;
  private visHandler: (() => void) | null = null;
  // FIX 1: out-of-order guard — server epoch (seconds) of last accepted snapshot
  private latestNow = -Infinity;
  // FIX 1: in-flight guard — prevents concurrent overlapping requests
  private inFlight  = false;

  private readonly profile: AirportProfile;
  /** Equirectangular project function bound to the profile's origin. */
  private readonly projectFn: (lat: number, lon: number) => { x: number; y: number };
  /** API endpoint URL built from profile.origin + fetchRadiusNm. */
  private readonly apiUrl: string;

  constructor(profile: AirportProfile) {
    this.profile = profile;

    // Build projection closure from profile origin once
    const { lat: lat0, lon: lon0 } = profile.origin;
    const lat0Rad = lat0 * (Math.PI / 180);
    this.projectFn = (lat: number, lon: number) => ({
      x:  (lon - lon0) * 111_320 * Math.cos(lat0Rad),
      y: -(lat - lat0) * 110_540,
    });

    // Build API URL with query params so the server-side proxy can forward
    // requests to any airport without hardcoded YBBN coordinates.
    this.apiUrl = `/api/adsb?lat=${lat0}&lon=${lon0}&dist=${profile.fetchRadiusNm}`;

    this.latest = this._empty(Date.now());
    this._start();
  }

  // ── DataFeedAdapter implementation ─────────────────────────────────────────

  subscribe(cb: (s: WorldSnapshot) => void): Unsubscribe {
    this.subs.add(cb);
    cb(this.latest); // immediate delivery of whatever we have
    return () => this.subs.delete(cb);
  }

  getSnapshotAt(_t: number): WorldSnapshot {
    return this.latest;
  }

  getAircraftDetail(id: string): AircraftDetail {
    const ac = this.latest.aircraft.find(a => a.id === id);
    if (!ac) throw new Error(`[AdsbAdapter] Aircraft ${id} not in latest snapshot`);
    return {
      ...ac,
      waypointList: [],
      taxiRoute:    [],
      planProgress: 0,
    };
  }

  getActiveAlerts(): Alert[] { return []; }

  acknowledgeAlert(_id: string): void { /* no alerts to acknowledge */ }

  getFeedHealth(): { status: 'live' | 'lagging' | 'stalled'; lastUpdate: number } {
    const age = Date.now() - this.lastPoll;
    let status: 'live' | 'lagging' | 'stalled';

    if (this.lastPoll === 0 || this.lastError !== null) {
      status = 'stalled';
    } else if (age > HEALTH_STALLED_MS) {
      status = 'stalled';
    } else if (age > HEALTH_LAGGING_MS) {
      status = 'lagging';
    } else {
      status = 'live';
    }

    return { status, lastUpdate: this.lastPoll };
  }

  /**
   * Tear down the polling timer and the visibility listener.
   * Must be called when swapping back to the sim adapter so there are no
   * dangling intervals or listeners.
   */
  destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.visHandler) {
      document.removeEventListener('visibilitychange', this.visHandler);
      this.visHandler = null;
    }
    console.log('[ADSB] adapter destroyed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _start(): void {
    // Page Visibility: pause when tab is hidden, resume (and immediately poll)
    // when it becomes visible again.  Protects the RapidAPI request quota.
    this.visHandler = () => {
      if (document.visibilityState === 'visible') {
        this._poll();
        if (!this.timer) this._startTimer();
      } else {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
      }
    };
    document.addEventListener('visibilitychange', this.visHandler);

    if (document.visibilityState === 'visible') {
      this._poll();
      this._startTimer();
    }
  }

  private _startTimer(): void {
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') this._poll();
    }, POLL_INTERVAL_MS);
  }

  private async _poll(): Promise<void> {
    // FIX 1: in-flight guard — skip if a previous request has not yet resolved
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const res = await fetch(this.apiUrl);

      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`;
        console.warn(`[ADSB] poll failed: HTTP ${res.status} (${res.statusText})`);
        return;
      }

      const data = await res.json() as { ac?: RawAc[]; now?: number; total?: number };

      // FIX 1: timestamp guard — discard snapshots older than the last accepted one.
      // data.now is a Unix epoch in seconds from the ADS-B Exchange server.
      const snapshotNow = data.now ?? (Date.now() / 1000);
      if (snapshotNow <= this.latestNow) {
        console.warn(`[ADSB] discarding stale snapshot (now=${snapshotNow} <= accepted=${this.latestNow})`);
        return;
      }
      this.latestNow = snapshotNow;

      this.lastError = null;
      this.lastPoll  = Date.now();

      const rawList: RawAc[] = data.ac ?? [];
      const gates = this.profile.geometry.gates;
      const icao  = this.profile.icao;

      // Derive active runway direction before normalising aircraft so the phase
      // classifier can use it as a track-alignment tie-breaker.
      const sim = this.profile.sim;
      const windDir   = sim?.defaultWindDir   ?? 190;
      const windSpeed = sim?.defaultWindSpeed ?? 12;
      const activeDir = deriveActiveRunwayDirection(this.profile, windDir, windSpeed);
      const activeHdg = activeRunwayHeadingDegrees(this.profile, activeDir);

      const aircraft: Aircraft[] = [];
      let gvCount = 0, anonCount = 0, atGateCount = 0;

      for (const raw of rawList) {
        const norm = normalise(raw, this.projectFn, gates, icao, activeHdg);
        if (!norm) continue;
        if (norm.isGroundVehicle)    gvCount++;
        if (norm.callsign === norm.id) anonCount++;  // callsign fell back to hex
        if (norm.phase === 'at-gate') atGateCount++;
        aircraft.push(norm);
      }

      const airborne = aircraft.filter(a => a.position.alt > 50).length;

      console.log(
        `[ADSB] poll ok — raw=${rawList.length} ingested=${aircraft.length}` +
        ` airborne=${airborne} ground-vehicle=${gvCount}` +
        ` anonymous=${anonCount} at-gate=${atGateCount}`,
      );

      this.latest = {
        t:       data.now ?? Date.now(),
        aircraft,
        alerts:  [],
        weather: {
          windDir,
          windSpeed,
          activeRunwayDirection: activeDir,
          precipitationCells:    [],
        },
      };

      for (const cb of this.subs) cb(this.latest);
    } catch (err) {
      this.lastError = String(err);
      console.warn('[ADSB] poll error:', err);
    } finally {
      // Always clear the in-flight flag so the next scheduled poll can proceed
      this.inFlight = false;
    }
  }

  private _empty(t: number): WorldSnapshot {
    const sim     = this.profile.sim;
    const windDir = sim?.defaultWindDir   ?? 190;
    const windSpd = sim?.defaultWindSpeed ?? 12;
    return {
      t,
      aircraft: [],
      alerts:   [],
      weather:  {
        windDir,
        windSpeed:             windSpd,
        activeRunwayDirection: deriveActiveRunwayDirection(this.profile, windDir, windSpd),
        precipitationCells:    [],
      },
    };
  }
}
