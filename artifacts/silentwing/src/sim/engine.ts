// ─── SimEngine + DataFeedAdapter ─────────────────────────────────────────────
//
// SimEngine owns the full simulation: spawning aircraft, ticking the state
// machine at 10 Hz, and notifying subscribers.
//
// getSimAdapter() is the ONLY symbol exported for use outside /src/sim/.
// It returns a DataFeedAdapter — the typed boundary the UI may cross.
// Nothing else in this file is reachable by UI components.

import type {
  DataFeedAdapter,
  WorldSnapshot,
  AircraftDetail,
  Alert,
  Unsubscribe,
} from '../types';
import { SimAircraft } from './aircraft';
import {
  routeDomesticArrival,
  routeDomesticDeparture,
  routeIntlArrival,
  routeIntlDeparture,
} from './routes';
import {
  TICK_MS,
  DOM_GATE_Y,
  INTL_GATE_Y,
  domGateX,
  intlGateX,
} from './constants';

// ── Static data pools ─────────────────────────────────────────────────────────
const CALLSIGN_PFX = ['QFA', 'VOZ', 'JST', 'TGW', 'NZX', 'SIA', 'UAL', 'BAW', 'CPA', 'MAS'];
const AC_TYPES     = ['B738', 'A320', 'B77W', 'A333', 'B789', 'A220', 'E190', 'B763'];
const AIRPORTS     = ['YSSY', 'YMML', 'YPPH', 'YBCS', 'YPAD', 'NZAA', 'WSSS', 'VHHH', 'KLAX', 'EGLL'];

// Gate descriptors (must match ybbn.ts generators)
const DOM_GATES  = Array.from({ length: 12 }, (_, i) => ({ id: `D${i + 1}`, x: domGateX(i),  y: DOM_GATE_Y  }));
const INTL_GATES = Array.from({ length:  8 }, (_, i) => ({ id: `I${i + 1}`, x: intlGateX(i), y: INTL_GATE_Y }));

// ── Helpers ───────────────────────────────────────────────────────────────────
let _uid = 0;
const uid  = ()           => `ac${++_uid}`;
const rand = (a: number, b: number) => Math.random() * (b - a) + a;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ── SimEngine ─────────────────────────────────────────────────────────────────
class SimEngine {
  private fleet     = new Map<string, SimAircraft>();
  private alerts: Alert[] = [];
  private subs      = new Set<(s: WorldSnapshot) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private usedGates = new Set<string>();
  private nextSpawn = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this._seed();
    this.nextSpawn = Date.now() + Math.round(rand(75_000, 105_000));
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Seeding — place 4 aircraft at staggered lifecycle stages on startup ─────

  private _seed(): void {
    // Offsets: 0 s → on approach, 180 s → taxi-in, 420 s → at-gate, 660 s → departing
    for (const secs of [0, 180, 420, 660]) {
      const ac = this._spawnOne();
      if (!ac) continue;
      if (secs > 0) this._fastForward(ac, secs);
      if (ac.done) {
        this.usedGates.delete(ac.assignedGate);
        this.fleet.delete(ac.id);
      }
    }
  }

  /**
   * Fast-forward an aircraft `secs` seconds of sim time using fake timestamps
   * so the gate timer fires correctly relative to wall-clock.
   */
  private _fastForward(ac: SimAircraft, secs: number): void {
    const dtSec    = TICK_MS / 1000;
    const steps    = Math.round(secs / dtSec);
    const fakeBase = Date.now() - secs * 1000;
    for (let i = 0; i < steps && !ac.done; i++) {
      ac.tick(dtSec, fakeBase + i * TICK_MS);
    }
  }

  // ── Per-tick loop ────────────────────────────────────────────────────────────

  private _tick(): void {
    const now   = Date.now();
    const dtSec = TICK_MS / 1000;

    // Advance all aircraft
    for (const ac of this.fleet.values()) {
      ac.tick(dtSec, now);
      if (ac.done) {
        this.usedGates.delete(ac.assignedGate);
        this.fleet.delete(ac.id);
      }
    }

    // Spawn new arrivals
    if (now >= this.nextSpawn && this.fleet.size < 10) {
      this._spawnOne();
      this.nextSpawn = now + Math.round(rand(60_000, 120_000));
    }

    // Notify all subscribers
    const snap = this._buildSnapshot(now);
    for (const cb of this.subs) cb(snap);
  }

  // ── Spawning ─────────────────────────────────────────────────────────────────

  private _spawnOne(): SimAircraft | null {
    const isDom  = Math.random() < 0.6;
    const pool   = isDom ? DOM_GATES : INTL_GATES;
    const free   = pool.filter(g => !this.usedGates.has(g.id));
    if (!free.length) return null;

    const gate   = pick(free);
    this.usedGates.add(gate.id);

    const id   = uid();
    const cs   = `${pick(CALLSIGN_PFX)}${Math.floor(rand(100, 999))}`;
    const type = pick(AC_TYPES);
    const org  = pick(AIRPORTS);

    const arr = isDom
      ? routeDomesticArrival(gate.x, gate.y)
      : routeIntlArrival(gate.x, gate.y);
    const dep = isDom
      ? routeDomesticDeparture(gate.x, gate.y)
      : routeIntlDeparture(gate.x, gate.y);

    const ac = new SimAircraft(id, cs, type, org, 'YBBN', gate.id, arr, dep);
    this.fleet.set(id, ac);
    return ac;
  }

  // ── Snapshot builder ─────────────────────────────────────────────────────────

  private _buildSnapshot(t: number): WorldSnapshot {
    return {
      t,
      aircraft: [...this.fleet.values()]
        .filter(a => !a.done)
        .map(a => a.toAircraft()),
      alerts: [...this.alerts],
      weather: {
        windDir: 190,
        windSpeed: 12,
        activeRunwayDirection: '01',
        precipitationCells: [],
      },
    };
  }

  // ── DataFeedAdapter factory ───────────────────────────────────────────────────

  asAdapter(): DataFeedAdapter {
    const eng = this;
    return {
      subscribe(cb: (s: WorldSnapshot) => void): Unsubscribe {
        eng.subs.add(cb);
        // Immediately deliver the current snapshot so the UI has data before
        // the first tick fires.
        cb(eng._buildSnapshot(Date.now()));
        return () => eng.subs.delete(cb);
      },
      getSnapshotAt(t: number): WorldSnapshot {
        return eng._buildSnapshot(t);
      },
      getAircraftDetail(id: string): AircraftDetail {
        const ac = eng.fleet.get(id);
        if (!ac) throw new Error(`Aircraft ${id} not found`);
        return {
          ...ac.toAircraft(),
          waypointList:  [],
          taxiRoute:     [ac.assignedGate],
          planProgress:  0.5,
        };
      },
      getActiveAlerts(): Alert[] {
        return eng.alerts.filter(a => !a.dismissedAt);
      },
      acknowledgeAlert(id: string): void {
        const a = eng.alerts.find(x => x.id === id);
        if (a) a.acknowledgedAt = Date.now();
      },
      getFeedHealth() {
        return { status: 'live' as const, lastUpdate: Date.now() };
      },
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// One engine per browser session; safe to call getSimAdapter() multiple times.

let _instance: SimEngine | null = null;

export function getSimAdapter(): DataFeedAdapter {
  if (!_instance) {
    _instance = new SimEngine();
    _instance.start();
  }
  return _instance.asAdapter();
}
