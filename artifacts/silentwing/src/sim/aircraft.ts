// ─── SimAircraft — internal state machine ────────────────────────────────────
//
// Moves a single aircraft through its full lifecycle by interpolating along a
// sequence of Waypoints.  The at-gate phase is handled separately: the aircraft
// parks until a wall-clock timer fires, then switches to the departure route.
//
// UI code must NOT import this file.  Only engine.ts touches SimAircraft, and
// the engine surfaces data exclusively through the DataFeedAdapter interface.

import type { Aircraft, FlightPhase } from '../types';
import type { Waypoint } from './routes';
import { MS_TO_KTS } from './constants';

const GATE_TIME_MS = 4 * 60 * 1000; // 4-minute turnaround

export class SimAircraft {
  // ── Identity (immutable) ────────────────────────────────────────────────────
  readonly id: string;
  readonly callsign: string;
  readonly type: string;
  readonly origin: string;
  readonly destination: string;
  readonly assignedRunway = '01L_19R';
  readonly assignedGate: string;

  // ── Route state ─────────────────────────────────────────────────────────────
  private route: Waypoint[];
  private depRoute: Waypoint[] | null;
  /** Index of the TARGET waypoint (aircraft is travelling from legIdx-1 → legIdx). */
  private legIdx  = 1;
  /** 0.0–1.0 progress along the current leg. */
  private legT    = 0;

  private gateUntil = 0; // ms timestamp — zero until aircraft first parks

  // ── Interpolated state (readable by engine for toAircraft()) ───────────────
  x       = 0;
  y       = 0;
  alt     = 0;
  heading = 10;   // degrees true from north, clockwise
  speedMs = 0;    // m/s
  phase: FlightPhase;

  done = false;

  constructor(
    id: string,
    callsign: string,
    type: string,
    origin: string,
    destination: string,
    assignedGate: string,
    arrivalRoute: Waypoint[],
    departureRoute: Waypoint[],
  ) {
    this.id          = id;
    this.callsign    = callsign;
    this.type        = type;
    this.origin      = origin;
    this.destination = destination;
    this.assignedGate = assignedGate;
    this.route    = arrivalRoute;
    this.depRoute = departureRoute;

    // Initialise at the first waypoint
    this.x       = arrivalRoute[0].x;
    this.y       = arrivalRoute[0].y;
    this.alt     = arrivalRoute[0].alt;
    this.speedMs = arrivalRoute[0].spd;
    this.phase   = arrivalRoute[0].phase;
  }

  // ── tick ────────────────────────────────────────────────────────────────────

  tick(dtSec: number, nowMs: number): void {
    if (this.done) return;

    // ── At-gate phase ────────────────────────────────────────────────────────
    if (this.phase === 'at-gate') {
      if (this.gateUntil === 0) {
        this.gateUntil = nowMs + GATE_TIME_MS;
        this.speedMs   = 0;
      }
      if (nowMs < this.gateUntil) return; // still parked

      // Turnaround complete — switch to departure route
      if (!this.depRoute) { this.done = true; return; }
      this.route    = this.depRoute;
      this.depRoute = null;
      this.legIdx   = 1;
      this.legT     = 0;
      // Fall through into the movement block to start taxiing this same tick
    }

    if (this.legIdx >= this.route.length) { this.done = true; return; }

    const from = this.route[this.legIdx - 1];
    const to   = this.route[this.legIdx];

    const dx     = to.x - from.x;
    const dy     = to.y - from.y;
    const legLen = Math.sqrt(dx * dx + dy * dy);

    // Heading from movement direction: atan2(Δeast, −Δsouth) → bearing from north
    if (legLen > 0.1) {
      this.heading = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
    }

    // Speed: linearly interpolate from→to across the leg
    const targetSpd = from.spd + (to.spd - from.spd) * this.legT;
    this.speedMs    = Math.max(targetSpd, 0);

    // Advance: use max(targetSpd, 1) so the aircraft never stalls on a zero-spd waypoint
    const advance = Math.max(this.speedMs, 1.0) * dtSec;
    const dT      = legLen > 0 ? advance / legLen : 1;
    this.legT     = Math.min(this.legT + dT, 1.0);

    // Interpolated state
    this.x    = from.x   + dx          * this.legT;
    this.y    = from.y   + dy          * this.legT;
    this.alt  = from.alt + (to.alt - from.alt) * this.legT;
    this.phase = to.phase;

    // ── Reached target waypoint ───────────────────────────────────────────────
    if (this.legT >= 1.0) {
      // Snap exactly to waypoint
      this.x   = to.x;
      this.y   = to.y;
      this.alt = to.alt;

      if (to.phase === 'at-gate') {
        // Stay parked; gate handler will fire on the next tick
        this.speedMs = 0;
        return;
      }

      this.legIdx++;
      this.legT = 0;

      if (this.legIdx >= this.route.length) {
        this.done = true;
      }
    }
  }

  // ── Public snapshot ─────────────────────────────────────────────────────────

  toAircraft(): Aircraft {
    return {
      id:             this.id,
      callsign:       this.callsign,
      type:           this.type,
      phase:          this.phase,
      position:       { x: this.x, y: this.y, alt: this.alt },
      heading:        this.heading,
      groundSpeed:    Math.round(this.speedMs * MS_TO_KTS),
      assignedRunway: this.assignedRunway,
      assignedGate:   this.assignedGate,
      origin:         this.origin,
      destination:    this.destination,
      confidence:     1.0,
    };
  }
}
