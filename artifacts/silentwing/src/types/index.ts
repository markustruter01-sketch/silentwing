// ─── Core domain types ───────────────────────────────────────────────────────

export type FlightPhase =
  | 'enroute-arrival'
  | 'approach'
  | 'landing'
  | 'taxi-in'
  | 'at-gate'
  | 'taxi-out'
  | 'takeoff'
  | 'departure'
  | 'enroute-departure';

export type AlertSeverity = 'advisory' | 'caution' | 'critical';
export type AlertType =
  | 'conflict'
  | 'taxi-conflict'
  | 'route-deviation'
  | 'runway-incursion';

export interface Position {
  x: number; // meters east of airport center
  y: number; // meters south of airport center (SVG convention)
  alt: number; // feet MSL
}

export interface Aircraft {
  id: string;
  callsign: string;
  type: string;
  phase: FlightPhase;
  position: Position;
  heading: number; // degrees
  groundSpeed: number; // knots
  assignedRunway?: string;
  assignedGate?: string;
  origin?: string;
  destination?: string;
  confidence: number; // 0.4–1.0 for predictions
  /** Set by the ADS-B adapter for category-C2 entries and TWR stations.
   *  Views may optionally hide these; they are never silently dropped. */
  isGroundVehicle?: boolean;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  aircraftIds: string[];
  message: string; // one-line reason, e.g. "QFA523 & VOZ711 converging..."
  raisedAt: number; // unix ms
  acknowledgedAt?: number;
  dismissedAt?: number;
}

export interface WeatherCell {
  id: string;
  polygon: Array<{ x: number; y: number }>;
  intensity: number; // 0–1
}

export interface WorldSnapshot {
  t: number; // unix ms
  aircraft: Aircraft[];
  alerts: Alert[];
  weather: {
    windDir: number; // degrees
    windSpeed: number; // knots
    activeRunwayDirection: '01' | '19';
    precipitationCells: WeatherCell[];
  };
}

export interface AircraftDetail extends Aircraft {
  waypointList: Array<{ name: string; plannedEta: number }>;
  taxiRoute: string[];
  planProgress: number; // 0–1
}

export type Unsubscribe = () => void;

// ─── Single source of truth for airborne/ground classification ───────────────
// Classified by altitude, NOT phase, so it stays correct regardless of what
// phase the sim currently reports. 50 ft threshold sits safely above all
// ground waypoints (alt = 0) while remaining below any airborne segment.
export function isAirborne(ac: Aircraft): boolean {
  return ac.position.alt > 50;
}

// ─── DataFeedAdapter — the ONLY interface between sim and UI ──────────────────

export interface DataFeedAdapter {
  subscribe(cb: (snapshot: WorldSnapshot) => void): Unsubscribe;
  getSnapshotAt(t: number): WorldSnapshot;
  getAircraftDetail(id: string): AircraftDetail;
  getActiveAlerts(): Alert[];
  acknowledgeAlert(id: string): void;
  getFeedHealth(): { status: 'live' | 'lagging' | 'stalled'; lastUpdate: number };
}
