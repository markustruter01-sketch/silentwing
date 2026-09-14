// ─── OpenSky Network DataFeedAdapter ─────────────────────────────────────────
//
// Implements the SAME DataFeedAdapter interface as AdsbAdapter so it can be
// dropped in as an alternative live feed without any changes to the render
// pipeline.
//
// Data source: OpenSky Network anonymous REST API (non-commercial use only).
//   Proxy endpoint: /api/opensky?lat=&lon=&dist=   (server-side; see routes/opensky.ts)
//   State-vector docs: https://openskynetwork.github.io/opensky-api/rest.html
//
// LICENSING NOTE: The OpenSky Network data is provided for non-commercial
// research and personal use only.  Commercial deployment requires a separate
// data-use agreement with The OpenSky Network gGmbH.
// See https://opensky-network.org/about/terms-of-use
//
// Unit conversions from OpenSky (SI) to app domain (imperial/knots):
//   altitude:      meters   → feet     (× 3.28084)
//   velocity:      m/s      → knots    (× 1.94384)
//   vertical_rate: m/s      → ft/min   (× 196.85)
//
// Limitations vs ADS-B Exchange:
//   • No aircraft type/category field → isGroundVehicle always false.
//     (Ground vehicles are rare in OpenSky coverage anyway.)
//   • No registration field.
//   • Anonymous rate limit: ~400 requests/day; adapter polls at 10 s.
//
// NOTE: phase heuristics below are intentionally parallel to adsbAdapter.ts.
// If a third adapter is added, extract them to feed/phaseUtils.ts.

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
import { HEALTH_LAGGING_MS, HEALTH_STALLED_MS } from './adsbAdapter';

// ── Poll interval ─────────────────────────────────────────────────────────────
// OpenSky anonymous access resolves state vectors at ≤ 10 s intervals;
// polling more often than this wastes requests without fresher data.
export const OPENSKY_POLL_MS = 10_000;

// ── Phase heuristics (mirrors adsbAdapter.ts) ─────────────────────────────────

const AT_GATE_GS_KT  = 2;
const AT_GATE_DIST_M = 60;

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function activeRunwayHeadingDeg(
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
  altFt:         number,
  gs:            number,
  baroRate:      number | undefined,
  acX:           number,
  acY:           number,
  gates:         GatePos[],
  track:         number,
  activeHdg:     number | undefined,
): FlightPhase {
  if (altFt < 50) {
    if (gs < AT_GATE_GS_KT) {
      const d2 = AT_GATE_DIST_M * AT_GATE_DIST_M;
      for (const gate of gates) {
        const dx = acX - gate.pos[0];
        const dy = acY + gate.pos[1];
        if (dx * dx + dy * dy <= d2) return 'at-gate';
      }
    }
    return 'taxi-in';
  }

  let climbing: boolean;
  if (baroRate !== undefined) {
    climbing = baroRate > 200;
  } else if (altFt < 500 && gs >= 80 && activeHdg !== undefined) {
    // activeHdg is the landing heading; departures use its reciprocal.
    const landHdg = activeHdg;
    const depHdg = (activeHdg + 180) % 360;
    const dDep = angularDiff(track, depHdg);
    const dLnd = angularDiff(track, landHdg);
    climbing = dDep < 45 && dDep < dLnd;
  } else {
    climbing = false;
  }

  if (altFt <   500) return climbing ? 'takeoff'   : 'landing';
  if (altFt < 3_000) return climbing ? 'departure' : 'approach';
  return                              climbing ? 'enroute-departure' : 'enroute-arrival';
}

// ── OpenSky state-vector tuple indices ────────────────────────────────────────
// https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors
const IDX_ICAO24       = 0;  // string
const IDX_CALLSIGN     = 1;  // string | null (trailing spaces)
const IDX_TIME_POS     = 3;  // number | null (unix s; last position update)
const IDX_LON          = 5;  // number | null (degrees)
const IDX_LAT          = 6;  // number | null (degrees)
const IDX_BARO_ALT     = 7;  // number | null (METERS)
const IDX_ON_GROUND    = 8;  // boolean
const IDX_VELOCITY     = 9;  // number | null (m/s)
const IDX_TRUE_TRACK   = 10; // number | null (degrees)
const IDX_VERT_RATE    = 11; // number | null (m/s)

// ── Normalise one OpenSky state vector → Aircraft (or null) ──────────────────
function normaliseState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sv:          any[],
  responseTime: number,    // data.time (unix seconds)
  projectFn:   (lat: number, lon: number) => { x: number; y: number },
  gates:       GatePos[],
  destIcao:    string,
  activeHdg:   number | undefined,
): Aircraft | null {
  const lat = sv[IDX_LAT] as number | null;
  const lon = sv[IDX_LON] as number | null;
  if (lat == null || lon == null) return null;

  const icao24 = (sv[IDX_ICAO24] as string | null)?.toLowerCase() ?? '';
  if (!icao24) return null;

  // Callsign — trim whitespace; fall back to hex if empty/null
  const rawCs   = sv[IDX_CALLSIGN] as string | null;
  const callsign = rawCs?.trim() || icao24;

  // Altitude: OpenSky returns METERS; convert to feet. Null when on_ground or unknown.
  const onGround = sv[IDX_ON_GROUND] as boolean;
  const baroAltM = sv[IDX_BARO_ALT] as number | null;
  // onGround is the authoritative signal. A noisy barometric altitude must
  // never promote a ground aircraft to airborne. Mirrors adsbAdapter.ts,
  // where alt_baro === 'ground' forces 0.
  const altFt = onGround ? 0 : (baroAltM != null ? baroAltM * 3.28084 : 0);

  // Speed: m/s → knots
  const velMs    = sv[IDX_VELOCITY] as number | null;
  const gs       = velMs != null ? Math.round(velMs * 1.94384) : 0;

  // Track
  const track    = (sv[IDX_TRUE_TRACK] as number | null) ?? 0;

  // Vertical rate: m/s → ft/min
  const vrMs     = sv[IDX_VERT_RATE] as number | null;
  const vertRate = vrMs != null ? vrMs * 196.85 : undefined;

  // seenPos: seconds since position was last updated
  const timePosS  = sv[IDX_TIME_POS] as number | null;
  const seenPos   = timePosS != null ? Math.max(0, responseTime - timePosS) : 0;

  const { x, y } = projectFn(lat, lon);

  const phase = derivePhase(altFt, gs, vertRate, x, y, gates, track, activeHdg);

  return {
    id:             icao24,
    callsign,
    type:           'UNKN',  // OpenSky does not provide aircraft type
    phase,
    position:       { x, y, alt: altFt },
    heading:        track,
    groundSpeed:    gs,
    assignedRunway: undefined,
    assignedGate:   undefined,
    origin:         undefined,
    destination:    destIcao,
    confidence:     1.0,
    seenPos,
    verticalRate:   vertRate,
    isGroundVehicle: false,  // OpenSky has no category field for ground vehicles
    onGround,
  };
}

// ── OpenSkyAdapter ─────────────────────────────────────────────────────────────

export class OpenSkyAdapter implements DataFeedAdapter {
  private subs      = new Set<(s: WorldSnapshot) => void>();
  private latest:   WorldSnapshot;
  private lastPoll  = 0;
  private lastError: string | null = null;
  private timer:    ReturnType<typeof setInterval> | null = null;
  private visHandler: (() => void) | null = null;
  private inFlight  = false;
  private latestNow = -Infinity;

  private readonly profile:   AirportProfile;
  private readonly projectFn: (lat: number, lon: number) => { x: number; y: number };
  private readonly apiUrl:    string;

  constructor(profile: AirportProfile) {
    this.profile = profile;

    const { lat: lat0, lon: lon0 } = profile.origin;
    const lat0Rad = lat0 * (Math.PI / 180);
    this.projectFn = (lat, lon) => ({
      x:  (lon - lon0) * 111_320 * Math.cos(lat0Rad),
      y: -(lat - lat0) * 110_540,
    });

    this.apiUrl =
      `/api/opensky?lat=${lat0}&lon=${lon0}&dist=${profile.fetchRadiusNm}`;

    this.latest = this._empty(Date.now());
    this._start();
  }

  // ── DataFeedAdapter ──────────────────────────────────────────────────────────

  subscribe(cb: (s: WorldSnapshot) => void): Unsubscribe {
    this.subs.add(cb);
    cb(this.latest);
    return () => this.subs.delete(cb);
  }

  getSnapshotAt(_t: number): WorldSnapshot {
    return this.latest;
  }

  getAircraftDetail(id: string): AircraftDetail {
    const ac = this.latest.aircraft.find(a => a.id === id);
    if (!ac) throw new Error(`[OpenSky] Aircraft ${id} not in latest snapshot`);
    return { ...ac, waypointList: [], taxiRoute: [], planProgress: 0 };
  }

  getActiveAlerts(): Alert[] { return []; }

  acknowledgeAlert(_id: string): void { /* no alerts to acknowledge */ }

  getFeedHealth(): { status: 'live' | 'lagging' | 'stalled'; lastUpdate: number } {
    const age = Date.now() - this.lastPoll;
    let status: 'live' | 'lagging' | 'stalled';
    if      (this.lastPoll === 0 || this.lastError !== null) status = 'stalled';
    else if (age > HEALTH_STALLED_MS)                        status = 'stalled';
    else if (age > HEALTH_LAGGING_MS)                        status = 'lagging';
    else                                                     status = 'live';
    return { status, lastUpdate: this.lastPoll };
  }

  destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.visHandler) {
      document.removeEventListener('visibilitychange', this.visHandler);
      this.visHandler = null;
    }
    console.log('[OpenSky] adapter destroyed');
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _start(): void {
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
    }, OPENSKY_POLL_MS);
  }

  private async _poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const res = await fetch(this.apiUrl);
      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`;
        console.warn(`[OpenSky] poll failed: HTTP ${res.status}`);
        return;
      }

      // OpenSky response: { time: unix_s, states: Array<state_vector[]> | null }
      const data = await res.json() as {
        time:   number;
        states: unknown[][] | null;
      };

      // Out-of-order guard using response timestamp
      const snapshotNow = data.time ?? (Date.now() / 1000);
      if (snapshotNow <= this.latestNow) {
        console.warn(`[OpenSky] discarding stale snapshot (now=${snapshotNow})`);
        return;
      }
      this.latestNow = snapshotNow;

      this.lastError = null;
      this.lastPoll  = Date.now();

      const rawStates = data.states ?? [];
      const gates     = this.profile.geometry.gates;
      const icao      = this.profile.icao;

      const sim       = this.profile.sim;
      const windDir   = sim?.defaultWindDir   ?? 190;
      const windSpeed = sim?.defaultWindSpeed ?? 12;
      const activeDir = deriveActiveRunwayDirection(this.profile, windDir, windSpeed);
      const activeHdg = activeRunwayHeadingDeg(this.profile, activeDir);

      const aircraft: Aircraft[] = [];
      let anonCount = 0, atGateCount = 0;

      for (const sv of rawStates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const norm = normaliseState(sv as any[], snapshotNow, this.projectFn, gates, icao, activeHdg);
        if (!norm) continue;
        if (norm.callsign === norm.id)  anonCount++;
        if (norm.phase === 'at-gate')   atGateCount++;
        aircraft.push(norm);
      }

      const airborne = aircraft.filter(a => a.position.alt > 50).length;
      console.log(
        `[OpenSky] poll ok — raw=${rawStates.length} ingested=${aircraft.length}` +
        ` airborne=${airborne} anonymous=${anonCount} at-gate=${atGateCount}`,
      );

      this.latest = {
        t:       snapshotNow * 1000,
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
      console.warn('[OpenSky] poll error:', err);
    } finally {
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
