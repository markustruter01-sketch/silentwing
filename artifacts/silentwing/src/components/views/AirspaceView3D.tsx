// ─── AirspaceView3D — Phase 4 ────────────────────────────────────────────────
//
// Three.js 3D airspace view with full camera state machine:
//
//   orbit  →  (click aircraft)  →  inspect  →  (dblclick)  →  follow
//   follow →  [Esc]  →  inspect  →  [Esc]  →  manual  →  [Esc]  →  orbit
//   (any drag on canvas enters manual from orbit)
//
// All camera-mode transitions are logged to the browser console.
// This component never modifies React state from the rAF loop — it uses refs
// and fires callbacks so App can update the panel overlay.

import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import type { Aircraft, WorldSnapshot } from '@/types';
import { isAirborne } from '@/types';
import { wakeCategory } from '@/utils/wakeCategory';
import type { Polyline } from '@/data/ybbn_real';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';
import { useAirport } from '@/airports/context';
import type { AirportProfile } from '@/airports/types';
import { computeRunwayThresholds, computeApproachCorridors } from '@/airports/helpers';
import { ROUTES } from '@/data/routes';
import type { Route } from '@/data/routes';

// ── Camera mode — exported so App can type-check ──────────────────────────────
export type CameraMode = 'orbit' | 'manual' | 'inspect' | 'follow' | 'returning';

// ── Scene constants ────────────────────────────────────────────────────────────
const ALT_SCALE    = 0.15;
const ORBIT_RADIUS     = 2550;    // wide overview — full airport visible on load
const ORBIT_HEIGHT     = 900;     // shallower depression (~24°) so sky is visible
const ORBIT_INIT_ANGLE = Math.PI * 0.6; // starting angle (south of airport, runway visible)
const ORBIT_SPEED      = 0.00025; // rad/frame ≈ 7 min/revolution at 60 fps
/** Maximum horizontal distance from the airport centre at which the director
 *  will focus on an alert.  Set to 50% of ORBIT_RADIUS so the camera stays
 *  within the airport's visual footprint and ignores distant enroute traffic. */
const DIRECTOR_MAX_ALERT_DIST = ORBIT_RADIUS * 0.5; // 1 700 m
const LOOK_AT      = new THREE.Vector3(0, 0, 0); // airfield centre (was y=700)
const LABEL_LIFT      = 210;      // Three.js Y-units above cone
const TRAIL_MAX       = 600;      // max trail points

// ── ADS-B feed quality constants ──────────────────────────────────────────────
// Knots → m/s for trail-cap and velocity extrapolation.
const KT_TO_MPS       = 0.514444;
// Aircraft whose seen_pos exceeds this are shown dimmed — their displayed
// position may be significantly behind their true position.  SAFETY SIGNAL.
const STALE_DISPLAY_S  = 15;      // seconds
// Aircraft whose seen_pos exceeds this do NOT extrapolate (more conservative than
// the display threshold — we stop predicting before we start dimming).
const STALE_EXTRAP_S   = 10;      // seconds
// Aircraft at or below this ground speed are treated as stopped — no extrapolation.
const GS_EXTRAP_MIN_KT = 2;       // knots
// Maximum time we extrapolate ahead with no fresh poll.  Beyond this the aircraft
// holds its extrapolated position rather than flying further off into space.
const MAX_EXTRAP_S     = 9;       // seconds — just above 8 s poll gap; shrinks worst-case correction
// Duration of the smooth correction blending after each new real position arrives.
const CORR_DURATION_MS = 1000;    // ms
// If a new poll's position is within this of the last known position, the
// transponder has not transmitted a new fix — no correction needed.
const STALE_POS_M      = 1;       // metres
// Trail-cap parameters.  A new trail point is dropped if it is further from the
// previous point than: gs_mps × pollInterval_s × TRAIL_SLACK + TRAIL_GPS_M.
// This kills starburst from seen_pos oscillation without hiding genuine motion.
const TRAIL_SLACK     = 1.5;      // 50 % margin for poll-timing jitter
const TRAIL_GPS_M     = 25;       // GPS scatter floor (metres)
// Trail fade: each point disappears TRAIL_FADE_S seconds after it was recorded.
// Opacity runs from TRAIL_OPACITY (newest point, nearest the aircraft) to 0
// (at the TRAIL_FADE_S mark).  Points past the limit are dropped each frame.
const TRAIL_FADE_S    = 20;       // seconds until a trail point fully fades
const TRAIL_FADE_MS   = TRAIL_FADE_S * 1000;
const TRAIL_OPACITY   = 0.70;     // peak opacity at the aircraft end of the trail

// ── Shared trail/wake ShaderMaterial GLSL (reused for wake ribbons) ───────────
const TRAIL_VERTEX_SHADER = `
  attribute float alpha;
  varying   float vAlpha;
  void main() {
    vAlpha      = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRAIL_FRAGMENT_SHADER = `
  uniform vec3  color;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, vAlpha);
  }
`;

// ── Velocity vector constants ─────────────────────────────────────────────────
const VEL_VEC_LOOKAHEAD_S = 90;   // seconds of look-ahead at current ground speed

// ── Separation bubble constants ───────────────────────────────────────────────
const SEP_BUBBLE_R    = 5 * 1852; // 5 NM in scene units (metres)
const SEP_BUBBLE_R_SQ = SEP_BUBBLE_R * SEP_BUBBLE_R;

// ── Wake turbulence ribbon constants ─────────────────────────────────────────
// Amber ribbon extending behind Heavy-category aircraft using the existing
// trail buffer with a perpendicular offset.
const WAKE_HALF_WIDTH  = 90;      // metres either side of track centreline
const WAKE_FADE_MS     = 90_000;  // 90-second opacity decay
const WAKE_PEAK_OPACITY = 0.45;

// ── Taxi time ring constants ───────────────────────────────────────────────────
// Expanding sonar-ping rings on the ground plane (y=1) for taxiing aircraft.
const TAXI_RING_SPAWN_MS = 3_000; // spawn a new ring every 3 s
const TAXI_RING_MAX_AGE  = 5_000; // ring fully expands in 5 s
const TAXI_RING_MIN_R    = 30;    // initial radius (scene units)
const TAXI_RING_MAX_R    = 400;   // final radius (scene units)

// Camera offset from aircraft for inspect / follow modes
// (south and above: Z=south in Three.js coordinate space)
const INSPECT_OFFSET = new THREE.Vector3(0, 700, 1400);
const FOLLOW_OFFSET  = new THREE.Vector3(0, 700, 1400);

// Minimum world-space Y the camera is ever allowed to look at.
// Ground aircraft sit at y ≈ 0, so without this the camera aim dips into the
// tarmac and the 3D view shows nothing but pavement.  50 units (≈ 50 m) keeps
// the aimpoint above the runway surface at a believable fuselage height.
const MIN_LOOK_Y = 50;

// Transition speed for fly-to animations (flyProgress increment per frame at 60 fps)
const FLY_SPEED_NORMAL = 0.0033; // ~300 frames ≈ 5 s

// Director camera offset from aircraft — wider than the normal inspect shot so
// the full approach/departure path context is visible.
const DIRECTOR_CAM_OFFSET = new THREE.Vector3(0, 1_200, 2_400);

// Maximum horizontal distance (world units ≈ metres) from the airport centre
// at which the director will pick up an aircraft.  Keeps the camera focused on
// the immediate airspace rather than following traffic 100 NM away.
// 5 000 m ≈ 2.7 NM — roughly the outer edge of the circuit / final approach.
const DIRECTOR_FOCUS_RADIUS = 5_000;

// ── Threat beam constants & shaders (Phase 6A) ───────────────────────────────

const BEAM_VERTEX_SHADER = /* glsl */`
  attribute float lineU;
  varying   float vLineU;
  void main() {
    vLineU      = lineU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT_SHADER = /* glsl */`
  uniform float time;
  uniform vec3  beamColor;
  uniform float dashFreq;
  uniform float dashSpeed;
  uniform float pulseSpeed;
  uniform float maxOpacity;
  varying float vLineU;
  void main() {
    // Sliding dash pattern along the beam
    float dash  = step(0.42, fract(vLineU * dashFreq - time * dashSpeed));
    // Overall brightness pulse
    float pulse = 0.55 + 0.45 * sin(time * pulseSpeed);
    float alpha = dash * pulse * maxOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(beamColor, alpha);
  }
`;

interface BeamSeverityParams {
  color:       THREE.Color;
  dashFreq:    number;
  dashSpeed:   number;
  pulseSpeed:  number;
  maxOpacity:  number;
}

const BEAM_PARAMS: Record<SWAlertSeverity, BeamSeverityParams> = {
  critical: { color: new THREE.Color(0xef4444), dashFreq: 18, dashSpeed: 3.5, pulseSpeed: 3.0, maxOpacity: 0.90 },
  caution:  { color: new THREE.Color(0xf59e0b), dashFreq: 14, dashSpeed: 2.5, pulseSpeed: 2.0, maxOpacity: 0.80 },
  advisory: { color: new THREE.Color(0xfbbf24), dashFreq: 10, dashSpeed: 1.5, pulseSpeed: 1.0, maxOpacity: 0.65 },
};

interface BeamEntry {
  line:      THREE.Line;
  midSphere: THREE.Mesh;
  mat:       THREE.ShaderMaterial;
  sphereMat: THREE.MeshBasicMaterial;
}

/** Build a threat beam (line + midpoint sphere) for a given severity and add it to the scene. */
function createBeamEntry(severity: SWAlertSeverity, scene: THREE.Scene): BeamEntry {
  const p = BEAM_PARAMS[severity];

  // ── Dashed line ──────────────────────────────────────────────────────────────
  // Two-vertex geometry; positions are updated each rAF frame from renderPos.
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(6);            // 2 × xyz
  const uvArr  = new Float32Array([0, 1]);       // lineU: 0 at A, 1 at B
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('lineU',    new THREE.BufferAttribute(uvArr,  1));

  const mat = new THREE.ShaderMaterial({
    vertexShader:   BEAM_VERTEX_SHADER,
    fragmentShader: BEAM_FRAGMENT_SHADER,
    uniforms: {
      time:       { value: 0 },
      beamColor:  { value: p.color },
      dashFreq:   { value: p.dashFreq },
      dashSpeed:  { value: p.dashSpeed },
      pulseSpeed: { value: p.pulseSpeed },
      maxOpacity: { value: p.maxOpacity },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false; // always render — avoids pop-in before BV update
  scene.add(line);

  // ── Midpoint sphere ──────────────────────────────────────────────────────────
  const sphereGeo = new THREE.SphereGeometry(55, 8, 6);
  const sphereMat = new THREE.MeshBasicMaterial({
    color:       p.color,
    transparent: true,
    opacity:     0.70,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
  const midSphere = new THREE.Mesh(sphereGeo, sphereMat);
  midSphere.frustumCulled = false;
  scene.add(midSphere);

  return { line, midSphere, mat, sphereMat };
}

/** Remove a BeamEntry from the scene and free its GPU resources. */
function disposeBeamEntry(entry: BeamEntry, scene: THREE.Scene): void {
  scene.remove(entry.line, entry.midSphere);
  entry.line.geometry.dispose();
  entry.mat.dispose();
  entry.midSphere.geometry.dispose();
  entry.sphereMat.dispose();
}

// ── Pulse ring constants (Task #6) ────────────────────────────────────────────
// Flat concentric rings on the ground plane (y=1) that expand outward like a
// sonar ping from the ground projection of the conflict midpoint.

/**
 * Unit circle in the XZ plane (y=0) shared across all ring meshes.
 * Scale is applied per-mesh each frame to drive expansion.
 */
const PULSE_RING_GEO = (() => {
  const N   = 64;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a        = (i / N) * Math.PI * 2;
    pts[i * 3]     = Math.cos(a); // x
    pts[i * 3 + 1] = 0;           // y — flat; position.y = 1 places it above ground
    pts[i * 3 + 2] = Math.sin(a); // z
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
})();

interface PulseRingParams {
  color:           THREE.Color;
  spawnIntervalMs: number;
  maxAgeMs:        number;
  minRadius:       number;  // scene units (metres) when ring spawns
  maxRadius:       number;  // scene units (metres) at full age
  peakOpacity:     number;
}

const PULSE_RING_PARAMS: Record<SWAlertSeverity, PulseRingParams> = {
  critical: { color: new THREE.Color(0xef4444), spawnIntervalMs:  800, maxAgeMs: 2000, minRadius:  50, maxRadius: 2000, peakOpacity: 0.85 },
  caution:  { color: new THREE.Color(0xf59e0b), spawnIntervalMs: 1200, maxAgeMs: 2500, minRadius:  50, maxRadius: 2000, peakOpacity: 0.70 },
  advisory: { color: new THREE.Color(0xfbbf24), spawnIntervalMs: 1800, maxAgeMs: 3000, minRadius:  50, maxRadius: 2000, peakOpacity: 0.55 },
};

interface ActiveRing {
  mesh:    THREE.LineLoop;
  mat:     THREE.LineBasicMaterial;
  startMs: number;
}

interface PulseRingEntry {
  rings:       ActiveRing[];
  lastSpawnMs: number;
  severity:    SWAlertSeverity;
}

function disposePulseRingEntry(entry: PulseRingEntry, scene: THREE.Scene): void {
  for (const ring of entry.rings) {
    scene.remove(ring.mesh);
    ring.mat.dispose();
    // PULSE_RING_GEO is shared — do NOT dispose it here
  }
  entry.rings.length = 0;
}

// ── Taxi time ring entry (Task 33) ────────────────────────────────────────────
// Expanding ground-plane rings (sonar-ping style) for taxiing aircraft.
// Ring colour transitions white → amber → red as taxi dwell time increases.

interface TaxiRingEntry {
  rings:       { mesh: THREE.LineLoop; mat: THREE.LineBasicMaterial; spawnMs: number }[];
  lastSpawnMs: number;
  /** performance.now() when the aircraft entered its current taxi phase. */
  taxiStartMs: number;
}

function disposeTaxiRingEntry(entry: TaxiRingEntry, scene: THREE.Scene): void {
  for (const ring of entry.rings) {
    scene.remove(ring.mesh);
    ring.mat.dispose();
    // PULSE_RING_GEO is shared — do NOT dispose it here
  }
  entry.rings.length = 0;
}

// ── 3D alert label sprites (Task #15) ─────────────────────────────────────────
// Canvas-texture Sprite at the 3D midpoint of each active caution/critical
// alert.  Position updates every frame; texture only when message text changes.

function makeAlertLabelTexture(
  severity:  SWAlertSeverity,
  callsigns: string,
  message:   string,
): THREE.CanvasTexture {
  // --- measure phase (size-agnostic canvas) ---
  const measureCv  = document.createElement('canvas');
  measureCv.width  = 1; measureCv.height = 1;
  const mCtx = measureCv.getContext('2d')!;

  mCtx.font = 'bold 38px "Courier New",monospace';
  const callsignW = mCtx.measureText(callsigns).width;

  const PADDING = 24;
  const W = Math.max(520, Math.ceil(callsignW) + PADDING);

  // Word-wrap the message at the same width
  mCtx.font = '22px "Courier New",monospace';
  const maxLineW = W - PADDING;
  const words = message.split(' ');
  const msgLines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (mCtx.measureText(test).width > maxLineW && current) {
      msgLines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) msgLines.push(current);

  // Layout constants
  // Message text starts at y=90; each line occupies LINE_H px; add BOTTOM_PAD below last line.
  const LINE_H     = 28;
  const MSG_Y      = 90;
  const BOTTOM_PAD = 12;
  const H = MSG_Y + msgLines.length * LINE_H + BOTTOM_PAD;

  // --- render phase ---
  const cv  = document.createElement('canvas');
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d')!;

  const accentHex =
    severity === 'critical' ? '#ef4444' :
    severity === 'caution'  ? '#f59e0b' : '#fbbf24';
  const msgHex =
    severity === 'critical' ? '#fca5a5' :
    severity === 'caution'  ? '#fcd34d' : '#fef08a';

  // Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(4,7,11,0.88)';
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 4, H);

  // Top accent line
  ctx.fillRect(0, 0, W, 2);

  // Severity badge
  ctx.font         = 'bold 14px "Courier New",monospace';
  ctx.fillStyle    = accentHex;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('\u25c6 ' + severity.toUpperCase(), 12, 8);

  // Callsigns — main line
  ctx.font         = 'bold 38px "Courier New",monospace';
  ctx.fillStyle    = '#f1f5f9';
  ctx.textBaseline = 'top';
  ctx.fillText(callsigns, 12, 34);

  // Separation message (wrapped)
  ctx.font         = '22px "Courier New",monospace';
  ctx.fillStyle    = msgHex;
  ctx.textBaseline = 'top';
  msgLines.forEach((line, i) => {
    ctx.fillText(line, 12, 90 + i * LINE_H);
  });

  return new THREE.CanvasTexture(cv);
}

interface AlertLabelEntry {
  sprite:      THREE.Sprite;
  mat:         THREE.SpriteMaterial;
  lastMessage: string;
}

function disposeAlertLabel(entry: AlertLabelEntry, scene: THREE.Scene): void {
  scene.remove(entry.sprite);
  entry.mat.map?.dispose();
  entry.mat.dispose();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Perpendicular distance from point (px, pz) to line segment (ax, az)→(bx, bz)
 * in the XZ plane only (altitude not considered for route proximity tests).
 */
function distToSegment2D(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

// ── SID/STAR route ribbon entry ────────────────────────────────────────────────
interface RouteLine {
  line:        THREE.Line;
  mat:         THREE.LineBasicMaterial;
  kind:        'SID' | 'STAR';
  baseOpacity: number;
  /** Precomputed per-segment data used for per-frame proximity + heading checks. */
  segments: Array<{
    ax: number; az: number;  // Three.js X, Z of segment start
    bx: number; bz: number;  // Three.js X, Z of segment end
    /** Compass bearing of this segment (0 = north = −Z, 90 = east = +X). */
    bearingDeg: number;
  }>;
}

// sim → Three.js  (x=east, alt ft → Y scaled, y_sim=south → Three Z)
function toV3(x: number, y: number, alt: number): THREE.Vector3 {
  return new THREE.Vector3(x, alt * ALT_SCALE, y);
}

// ── Phase colour map ──────────────────────────────────────────────────────────
const PHASE_HEX: Record<string, number> = {
  'enroute-arrival':   0x38BDF8,
  'approach':          0x38BDF8,
  'landing':           0x60A5FA,
  'taxi-in':           0xF59E0B,
  'at-gate':           0x4ADE80,
  'taxi-out':          0xFB923C,
  'takeoff':           0x818CF8,
  'departure':         0xC084FC,
  'enroute-departure': 0xC084FC,
};
const HEX_DEFAULT = 0x94A3B8;
function phaseHex(phase: string) { return PHASE_HEX[phase] ?? HEX_DEFAULT; }

// ── Combined aircraft label sprite (callsign + heading + phase) ───────────────
// Replaces the old plain-callsign label.  One sprite per aircraft positioned at
// LABEL_LIFT above the cone; refreshed per-poll when phase or heading changes.

const AC_LABEL_W = 360, AC_LABEL_H = 100;

const PHASE_LABEL: Record<string, string> = {
  'approach':           'APPROACH',
  'landing':            'LANDING',
  'takeoff':            'TAKE OFF',
  'taxi-in':            'TAXI IN',
  'taxi-out':           'TAXI OUT',
  'at-gate':            'AT GATE',
  'departure':          'DEPARTURE',
  'enroute-arrival':    'ARRIVAL',
  'enroute-departure':  'ENROUTE',
};

function _paintAcLabel(
  ctx: CanvasRenderingContext2D,
  callsign: string,
  headingDeg: number,
  phase: string,
): void {
  const W = AC_LABEL_W, H = AC_LABEL_H;
  const color = '#' + ((PHASE_HEX[phase] ?? HEX_DEFAULT) >>> 0).toString(16).padStart(6, '0');
  const phaseLabel = PHASE_LABEL[phase] ?? phase.toUpperCase();
  const hdgStr = `HDG ${Math.round(headingDeg).toString().padStart(3, '0')}°`;

  // Border only — transparent interior
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  (ctx as CanvasRenderingContext2D & { roundRect: (...a: unknown[]) => void })
    .roundRect(3, 3, W - 6, H - 6, 8);
  ctx.stroke();

  // Callsign — row 1
  ctx.font = 'bold 30px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(callsign, W / 2, H * 0.36);

  // HDG + phase — row 2, slightly dimmer
  ctx.font = '16px "JetBrains Mono","Courier New",monospace';
  ctx.globalAlpha = 0.72;
  ctx.fillText(`${hdgStr}  ·  ${phaseLabel}`, W / 2, H * 0.72);
  ctx.globalAlpha = 1.0;
}

/**
 * Returns the world-space sprite dimensions for an aircraft label based on
 * its flight phase.  Taxi aircraft are half-size; gate-parked aircraft are
 * quarter-size to reduce clutter at the terminal stand area.
 */
function labelScaleForPhase(phase: string): [number, number] {
  if (phase === 'at-gate')                              return [135, 37.5]; // 75 % smaller
  if (phase === 'taxi-in' || phase === 'taxi-out')      return [270, 75];   // 50 % smaller
  return [540, 150]; // full size (airborne, approach, landing, takeoff)
}

function makeAcLabel(callsign: string, headingDeg: number, phase: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = AC_LABEL_W; cv.height = AC_LABEL_H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, AC_LABEL_W, AC_LABEL_H);
  _paintAcLabel(ctx, callsign, headingDeg, phase);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  const [sw, sh] = labelScaleForPhase(phase);
  sp.scale.set(sw, sh, 1);
  return sp;
}

function refreshAcLabel(b: AcBundle, callsign: string, headingDeg: number, phase: string): void {
  const cv = document.createElement('canvas');
  cv.width = AC_LABEL_W; cv.height = AC_LABEL_H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, AC_LABEL_W, AC_LABEL_H);
  _paintAcLabel(ctx, callsign, headingDeg, phase);
  const sm = b.label.material as THREE.SpriteMaterial;
  sm.map?.dispose();
  sm.map = new THREE.CanvasTexture(cv);
  sm.map.needsUpdate = true;
  sm.needsUpdate = true;
  // Update sprite size when aircraft transitions between phase tiers.
  const [sw, sh] = labelScaleForPhase(phase);
  b.label.scale.set(sw, sh, 1);
  b.labelPhase = phase;
  b.labelHeadingDeg = headingDeg;
}

// ── Ring altitude label sprites ───────────────────────────────────────────────
function makeRingLabel(text: string): THREE.Sprite {
  const cv  = document.createElement('canvas');
  cv.width  = 256;
  cv.height = 56;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 56);
  ctx.font         = 'bold 22px "Courier New", monospace';
  ctx.fillStyle    = '#2d6a9f';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 28);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.80, depthWrite: false });
  const sp  = new THREE.Sprite(mat);
  sp.scale.set(480, 105, 1); // metres (scene units)
  return sp;
}

// ── Altitude reference rings (FL050 / FL100 / FL150) ──────────────────────────
// Each ring has four labels at the cardinal points (N / S / E / W).
function buildAltRings(): THREE.Group {
  const g   = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x162030, transparent: true, opacity: 0.55 });
  const N   = 128;
  const R   = 4200; // ring radius (metres in scene space)
  for (const fl of [50, 100, 150]) {
    const y     = fl * 100 * ALT_SCALE;
    const altFt = fl * 100;
    const label = `${altFt.toLocaleString()} ft`;

    // Ring line
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));

    // Cardinal labels slightly above the ring plane
    const LY = y + 110;
    for (const [lx, lz] of [
      [0, -R],  // North  (+Y = north in YBBN adapter → -Z in scene)
      [0,  R],  // South
      [R,  0],  // East
      [-R, 0],  // West
    ] as [number, number][]) {
      const sp = makeRingLabel(label);
      sp.position.set(lx, LY, lz);
      g.add(sp);
    }
  }
  return g;
}

// ── Real YBBN ground geometry — runways, taxiways, apron ─────────────────────
// ybbn_real.ts uses +y=north; scene uses +y=south (same as ADS-B adapter).
// Apply Y-flip so geometry and live aircraft share one coordinate frame.
function flipRealY(coords: [number, number][]): [number, number][] {
  return coords.map(([x, y]) => [x, -y] as [number, number]);
}

function buildGroundGeometry(
  runways:  Polyline[],
  taxiways: Polyline[],
  aprons:   [number, number][][],
): THREE.Group {
  const g = new THREE.Group();

  // Runways — 3 parallel lines (centre ± 20 m) so they read ~3× wider than taxiways
  const rwMat = new THREE.LineBasicMaterial({ color: 0xC8CDD4, transparent: true, opacity: 0.60 });
  const RW_HALF_WIDTH = 20; // metres offset each side of centreline
  for (const rw of runways) {
    const base = flipRealY(rw.coords);
    // Perpendicular direction derived from overall runway axis
    const [x0, z0] = base[0], [xN, zN] = base[base.length - 1];
    const axLen = Math.hypot(xN - x0, zN - z0) || 1;
    const px = ((zN - z0) / axLen) * RW_HALF_WIDTH; // perp X
    const pz = (-(xN - x0) / axLen) * RW_HALF_WIDTH; // perp Z
    for (const [ox, oz] of [[0, 0], [px, pz], [-px, -pz]] as [number,number][]) {
      const pts = base.map(([x, z]) => new THREE.Vector3(x + ox, 0, z + oz));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), rwMat));
    }
  }

  // Taxiways — 326 segments merged into one LineSegments draw call
  const twPos: number[] = [];
  for (const tw of taxiways) {
    const coords = flipRealY(tw.coords);
    for (let i = 0; i < coords.length - 1; i++) {
      const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
      twPos.push(ax, 0, ay, bx, 0, by);
    }
  }
  if (twPos.length) {
    const twGeo = new THREE.BufferGeometry();
    twGeo.setAttribute('position', new THREE.Float32BufferAttribute(twPos, 3));
    g.add(new THREE.LineSegments(twGeo,
      new THREE.LineBasicMaterial({ color: 0x78350F, transparent: true, opacity: 0.50 })));
  }

  // Apron polygon outline
  const apronMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.60 });
  for (const apron of aprons) {
    const coords = flipRealY(apron);
    const pts = [...coords, coords[0]].map(([x, y]) => new THREE.Vector3(x, 0, y));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), apronMat));
  }

  return g;
}

// ── Airport static annotations ────────────────────────────────────────────────

/** Canvas-sprite label styled for runway thresholds / terminal areas. */
function makeRunwayLabel(text: string): THREE.Sprite {
  const cv  = document.createElement('canvas');
  cv.width  = 320; cv.height = 80;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 320, 80);
  ctx.font         = 'bold 30px "Courier New", monospace';
  ctx.fillStyle    = '#7dd3fc';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 40);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp  = new THREE.Sprite(mat);
  sp.scale.set(640, 160, 1);
  return sp;
}

function buildAirportAnnotations(
  thresholds:       Array<[string, number, number]>,
  terminalLabelPos: { x: number; z: number },
): THREE.Group {
  const g = new THREE.Group();
  const H = 90; // hover height (scene units ≈ 600 ft)

  for (const [text, x, z] of thresholds) {
    const sp = makeRunwayLabel(text);
    sp.position.set(x, H, z);
    g.add(sp);
  }

  // Terminal label — position from profile (domestic gate cluster centroid)
  const term = makeRunwayLabel('TERMINAL');
  term.position.set(terminalLabelPos.x, H, terminalLabelPos.z);
  g.add(term);

  return g;
}

// ── ILS approach corridor ──────────────────────────────────────────────────────
// A translucent wedge descending from approach-fix altitude to runway threshold.
function buildApproachCone(corr: { cx: number; cz: number; dz: 1 | -1 }): THREE.Group {
  const g = new THREE.Group();
  const RANGE_M  = 9_000;
  const WIDTH_M  = 1_400;
  // Height at far end of corridor following a 3° glide slope
  const farY = RANGE_M * Math.tan((3 * Math.PI) / 180) * ALT_SCALE; // ≈ 71 units

  // Corridor centre and approach direction — derived from profile geometry
  const { cx, cz, dz } = corr;
  const w  = WIDTH_M / 2;
  const fz = cz + dz * RANGE_M;

  // Filled glide-slope plane
  const pos = new Float32Array([
    cx - 30, 0,    cz,
    cx + 30, 0,    cz,
    cx - w,  farY, fz,
    cx + w,  farY, fz,
  ]);
  const idx = [0, 2, 1, 1, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo,
    new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  ));

  // Outline edges
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.30, depthWrite: false });
  const outline  = [
    new THREE.Vector3(cx - 30, 0,    cz),
    new THREE.Vector3(cx - w,  farY, fz),
    new THREE.Vector3(cx + w,  farY, fz),
    new THREE.Vector3(cx + 30, 0,    cz),
    new THREE.Vector3(cx - 30, 0,    cz),
  ];
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), edgeMat));

  // Centre glide line (brighter)
  g.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx, 0, cz), new THREE.Vector3(cx, farY, fz),
    ]),
    new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.50, depthWrite: false }),
  ));

  return g;
}

// ── Wind direction indicator — windsock ───────────────────────────────────────
// A 3-D windsock grounded NW of airport.  The sock droops under gravity at
// calm wind and extends horizontally downwind as speed increases.
// Traditional alternating orange / near-white bands; open end faces INTO wind.
function buildWindIndicator(windDir: number, windSpeed: number): THREE.Group {
  const g = new THREE.Group();
  // Base sits at ground level; the group is placed NW of the airport origin.
  g.position.set(-2200, 0, -1800);

  // ── Pole ──────────────────────────────────────────────────────────────────
  const POLE_H  = 380;
  const poleGeo = new THREE.CylinderGeometry(5, 7, POLE_H, 6);
  const poleMat = new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.85 });
  const pole    = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, POLE_H / 2, 0);
  g.add(pole);

  // ── Sock orientation ──────────────────────────────────────────────────────
  // Wind FROM windDir → sock tail points downwind (TO direction).
  // Droop: calm = straight down; ≥ 25 kt = fully horizontal downwind.
  const speedKt = Math.max(0, Math.min(windSpeed, 30));
  // angle from horizontal: 90° at 0 kt, 0° at ≥ 25 kt
  const droopRad = (Math.PI / 2) * Math.max(0, 1 - speedKt / 25);

  const rad      = (windDir * Math.PI) / 180;
  // Downwind horizontal unit vector (direction wind blows TO)
  const downwindX = -Math.sin(rad);
  const downwindZ =  Math.cos(rad);
  const isCalm    = speedKt < 1;

  // Target direction for sock axis (from wide/open end → narrow tail)
  // At full droop this is straight down; at full extension it is horizontal downwind.
  const sockDir = isCalm
    ? new THREE.Vector3(0, -1, 0)
    : new THREE.Vector3(
        downwindX * Math.cos(droopRad),
        -Math.sin(droopRad),
        downwindZ * Math.cos(droopRad),
      ).normalize();

  // ── Sock bands ────────────────────────────────────────────────────────────
  // Five tapered frustum sections built along local +Y axis, then the whole
  // group is rotated so local +Y → sockDir.
  const BAND_COUNT = 5;
  const BAND_LEN   = 70;
  const R_OPEN     = 72;   // wide end (open, catches wind)
  const R_TAIL     = 10;   // narrow tail end
  const COLORS     = [0xf97316, 0xe2e8f0] as const; // orange / near-white

  const sockGrp = new THREE.Group();
  sockGrp.position.set(0, POLE_H, 0); // attach at pole top

  for (let i = 0; i < BAND_COUNT; i++) {
    const t0   = i       / BAND_COUNT;
    const t1   = (i + 1) / BAND_COUNT;
    const rTop = R_OPEN + (R_TAIL - R_OPEN) * t0; // wider toward open end
    const rBot = R_OPEN + (R_TAIL - R_OPEN) * t1;
    const bandGeo = new THREE.CylinderGeometry(rBot, rTop, BAND_LEN, 10, 1, true);
    const bandMat = new THREE.MeshBasicMaterial({
      color:      COLORS[i % 2],
      side:       THREE.DoubleSide,
      transparent: true,
      opacity:     0.88,
      depthWrite:  false,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    // Stack along local +Y (band 0 starts at y=0, extends to y=-BAND_LEN etc.)
    band.position.set(0, -(i * BAND_LEN + BAND_LEN / 2), 0);
    sockGrp.add(band);
  }

  // Rotate group so its local –Y axis aligns with sockDir
  sockGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), sockDir);
  g.add(sockGrp);

  // ── Label (wind info text, above pole top) ────────────────────────────────
  const dirStr = isCalm ? 'CALM' : `${Math.round(windDir).toString().padStart(3, '0')}°`;
  const sp = makeRingLabel(`WIND  ${dirStr} / ${Math.round(windSpeed)} kt`);
  sp.position.set(0, POLE_H + 230, 0);
  g.add(sp);

  return g;
}

// ── SID/STAR route group builder ─────────────────────────────────────────────
//
// Creates a THREE.Group containing one THREE.Line per route for the given
// airport ICAO.  SID lines are warm gold; STAR lines are cool cyan.  Both
// kinds start at very low opacity so they don't overwhelm aircraft traffic.
//
// Returns the group (ready to add to the scene) and a flat array of RouteLine
// entries used by the rAF loop for per-frame opacity adjustment.
function buildRouteGroup(
  routes: Route[],
  icao:   string,
): { group: THREE.Group; lines: RouteLine[] } {
  const group  = new THREE.Group();
  const lines: RouteLine[] = [];

  const airportRoutes = routes.filter(r => r.airport === icao);

  for (const route of airportRoutes) {
    const isSID       = route.kind === 'SID';
    const baseOpacity = isSID ? 0.10 : 0.12;
    // SID — warm gold (#F59E0B); STAR — cool cyan (#38BDF8)
    const color       = isSID ? 0xF59E0B : 0x38BDF8;

    // Convert sim-space waypoints to Three.js positions (x=east, Y=alt, z=sim_y)
    const pts: THREE.Vector3[] = route.waypoints.map(wp =>
      new THREE.Vector3(wp.x, wp.altFt * ALT_SCALE, wp.y),
    );

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity:     baseOpacity,
      depthWrite:  false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    group.add(line);

    // Pre-compute per-segment bearing for heading alignment test in the rAF loop.
    // Bearing convention: 0 = north (−Z), 90 = east (+X), same as aircraft heading.
    const segments: RouteLine['segments'] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // atan2(east, −south) → compass degrees from north (−Z)
      const bearingDeg = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, bearingDeg });
    }

    lines.push({ line, mat, kind: route.kind, baseOpacity, segments });
  }

  return { group, lines };
}

// ── Approach / landing indicator (diagonal line + sign) ──────────────────────
// One indicator per aircraft in the 'approach' or 'landing' phase.
// The line descends forward along the aircraft's heading, evoking a glide
// slope; the sprite sign at the lower end always faces the camera.

const APPROACH_LINE_DROP    = 300; // scene units below the aircraft
const APPROACH_LINE_FORWARD = 450; // scene units ahead along heading

interface ApproachIndicatorEntry {
  line:    THREE.Line;
  lineMat: THREE.LineBasicMaterial;
  /** Phase this entry was created for — used to detect approach↔landing transitions. */
  phase:   'approach' | 'landing';
}

function createApproachIndicator(_scene: THREE.Scene, phase: 'approach' | 'landing'): ApproachIndicatorEntry {
  // Line geometry is kept for disposal symmetry but NOT added to the scene —
  // the long glide-slope line already shows the approach path, so this shorter
  // forward-heading line is redundant and visually cluttered.
  const posArr = new Float32Array(6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const lineColor = phase === 'approach' ? 0x38BDF8 : 0x60A5FA;
  const lineMat = new THREE.LineBasicMaterial({
    color: lineColor, transparent: true, opacity: 0, depthWrite: false,
  });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  // Intentionally NOT added to scene — disposed normally when entry is removed.

  return { line, lineMat, phase };
}

function disposeApproachIndicator(entry: ApproachIndicatorEntry, scene: THREE.Scene): void {
  scene.remove(entry.line);
  entry.line.geometry.dispose();
  entry.lineMat.dispose();
}

// ── Glide slope projected path line (Task #26) ──────────────────────────────
// For 'approach' aircraft only: a thin line from the aircraft's renderPos to
// the nearest active runway threshold.  Opacity fades from GLIDE_PEAK_OPACITY
// at far range to 0 as the aircraft reaches the threshold.

const GLIDE_MAX_DIST    = 9_000; // scene units (≈ NM+ out) — line fully visible at this range
const GLIDE_PEAK_OPACITY = 0.55; // opacity when aircraft is at or beyond GLIDE_MAX_DIST

interface GlideSlopeEntry {
  line:     THREE.Line;
  lineMat:  THREE.LineBasicMaterial;
  label:    THREE.Sprite;
  labelMat: THREE.SpriteMaterial;
  labelKey: string; // callsign + angle string — redraw only when changed
}

// ── Glide slope threshold label canvas painter ───────────────────────────────
function _fmtEta(sec: number): string {
  if (sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function _paintGlideSlopeLabel(
  ctx: CanvasRenderingContext2D,
  callsign: string,
  angleDeg: number,
  etaSec: number,
): void {
  const W = 512, H = 160;
  ctx.clearRect(0, 0, W, H);

  // Row 1 — "GLIDE SLOPE · callsign · angle"
  ctx.font         = 'bold 24px "Share Tech Mono", monospace';
  ctx.fillStyle    = '#7dd3fc';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`GLIDE SLOPE  ${callsign}  ${angleDeg.toFixed(1)}°`, W / 2, 24);

  // Divider
  ctx.strokeStyle = 'rgba(125,211,252,0.20)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(24, 44); ctx.lineTo(W - 24, 44);
  ctx.stroke();

  // Row 2 — large ETA countdown
  ctx.font      = 'bold 80px "Share Tech Mono", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(_fmtEta(etaSec), W / 2, 110);

  // Row 3 — "ETA" sub-label
  ctx.font      = 'bold 16px "Share Tech Mono", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('ETA TO THRESHOLD', W / 2, 148);
}

function makeGlideSlopeLabel(callsign: string, angleDeg: number, etaSec: number): {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
} {
  const W = 512, H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  _paintGlideSlopeLabel(ctx, callsign, angleDeg, etaSec);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(W * 1.8, H * 1.8, 1);
  sprite.frustumCulled = false;
  return { sprite, mat };
}

function refreshGlideSlopeLabel(
  entry: GlideSlopeEntry,
  callsign: string,
  angleDeg: number,
  etaSec: number,
): void {
  const W = 512, H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  _paintGlideSlopeLabel(ctx, callsign, angleDeg, etaSec);
  const oldTex = entry.labelMat.map;
  entry.labelMat.map = new THREE.CanvasTexture(canvas);
  entry.labelMat.needsUpdate = true;
  oldTex?.dispose();
}

function createGlideSlopeLine(scene: THREE.Scene): GlideSlopeEntry {
  const posArr = new Float32Array(6); // aircraft xyz + threshold xyz
  const geo    = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color:       0x7dd3fc,
    transparent: true,
    opacity:     GLIDE_PEAK_OPACITY,
    depthWrite:  false,
  });
  const line = new THREE.Line(geo, lineMat);
  line.frustumCulled = false;
  scene.add(line);

  const { sprite, mat } = makeGlideSlopeLabel('------', 3.0, 0);
  scene.add(sprite);

  return { line, lineMat, label: sprite, labelMat: mat, labelKey: '' };
}

function disposeGlideSlopeLine(entry: GlideSlopeEntry, scene: THREE.Scene): void {
  scene.remove(entry.line);
  entry.line.geometry.dispose();
  entry.lineMat.dispose();
  scene.remove(entry.label);
  entry.labelMat.map?.dispose();
  entry.labelMat.dispose();
}

// ── Takeoff indicator (vertical line + "TAKE OFF" sign) ──────────────────────
// One indicator per aircraft in the 'takeoff' phase.  The line rises from the
// aircraft's render position; the sprite sign at the top always faces the
// camera because THREE.Sprite is inherently billboard-rendered.

const TAKEOFF_LINE_HEIGHT = 500; // scene units (~3 300 ft) above the aircraft

interface TakeoffIndicatorEntry {
  line:          THREE.Line;
  lineMat:       THREE.LineBasicMaterial;
  sign:          THREE.Sprite;
  signMat:       THREE.SpriteMaterial;
  /** Small "#N" sprite above the callsign label; hidden when aircraft is rolling. */
  queueLabel:    THREE.Sprite;
  queueLabelMat: THREE.SpriteMaterial;
  /** 1-based queue position for holding aircraft; 0 = rolling / airborne (label hidden). */
  queuePos:      number;
}

function makeQueueLabel(n: number): { sprite: THREE.Sprite; mat: THREE.SpriteMaterial } {
  const W = 130, H = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font        = 'bold 38px "Share Tech Mono", monospace';
  ctx.fillStyle   = '#818CF8';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${n}`, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(W * 1.3, H * 1.3, 1);
  sprite.frustumCulled = false;
  sprite.visible = false;
  return { sprite, mat };
}

function repaintQueueLabel(entry: TakeoffIndicatorEntry, n: number): void {
  const W = 130, H = 60;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font        = 'bold 38px "Share Tech Mono", monospace';
  ctx.fillStyle   = '#818CF8';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${n}`, W / 2, H / 2);
  entry.queueLabelMat.map?.dispose();
  entry.queueLabelMat.map = new THREE.CanvasTexture(cv);
  entry.queueLabelMat.map.needsUpdate = true;
  entry.queueLabelMat.needsUpdate = true;
  entry.queuePos = n;
}

function makeTakeoffSign(): { sprite: THREE.Sprite; mat: THREE.SpriteMaterial } {
  const W = 320, H = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);

  // Border rect
  ctx.strokeStyle = '#818CF8';
  ctx.lineWidth   = 2;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Label text
  ctx.font        = 'bold 28px "Share Tech Mono", monospace';
  ctx.fillStyle   = '#818CF8';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TAKING OFF', W / 2, H / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(W * 1.5, H * 1.5, 1);
  sprite.frustumCulled = false;
  return { sprite, mat };
}

function createTakeoffIndicator(scene: THREE.Scene): TakeoffIndicatorEntry {
  const posArr = new Float32Array(6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x818CF8, transparent: true, opacity: 0.65, depthWrite: false,
  });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  scene.add(line);

  const { sprite, mat } = makeTakeoffSign();
  scene.add(sprite);

  const { sprite: queueLabel, mat: queueLabelMat } = makeQueueLabel(1);
  scene.add(queueLabel);

  return { line, lineMat, sign: sprite, signMat: mat, queueLabel, queueLabelMat, queuePos: 0 };
}

function disposeTakeoffIndicator(entry: TakeoffIndicatorEntry, scene: THREE.Scene): void {
  scene.remove(entry.line);
  entry.line.geometry.dispose();
  entry.lineMat.dispose();
  scene.remove(entry.sign);
  entry.signMat.map?.dispose();
  entry.signMat.dispose();
  scene.remove(entry.queueLabel);
  entry.queueLabelMat.map?.dispose();
  entry.queueLabelMat.dispose();
}

// ── Per-aircraft Three.js bundle ──────────────────────────────────────────────
interface AcBundle {
  cone:     THREE.Mesh;
  stem:     THREE.Line;
  trail:    THREE.Line;
  label:    THREE.Sprite;
  /** Timestamped trail points.  Oldest at index 0, newest at the tail. */
  trailBuf: { pos: THREE.Vector3; t: number }[];

  // ── Velocity extrapolation state ─────────────────────────────────────────
  /** Rendered position — written by the tick loop, applied to visuals each frame. */
  renderPos:       THREE.Vector3;
  /** Real position from the most recent accepted poll (Three.js world coords).
   *  Overwritten on each poll, never accumulated. */
  lastKnownPos:    THREE.Vector3;
  /** performance.now() (ms) when lastKnownPos was recorded. */
  lastKnownTimeMs: number;
  /** Aircraft heading in degrees (0=north, clockwise). Updated per-poll. */
  headingDeg:      number;
  /** Horizontal ground speed in m/s.  0 when extrapolation is suppressed. */
  gsMps:           number;
  /** Vertical rate in Three.js Y-units/s (converted from baro_rate ft/min).
   *  0 when unavailable or when extrapolation is suppressed. */
  vyPerS:          number;
  /** Last seen_pos from ADS-B (seconds since position fix).  Stored so the
   *  tick loop can apply the stale guard without touching React state. */
  seenPos:         number;
  /** renderPos snapshot taken at the start of the current correction blend. */
  corrFromPos:     THREE.Vector3;
  /** performance.now() when the current correction began.  -1 = no correction. */
  corrStartMs:     number;
  /** Purple selection halo ring shown when director focuses this aircraft. */
  halo:            THREE.Mesh;
  /** Cyan pin ring — visible when this aircraft is pinned from the sequence ladder. */
  pinRing:         THREE.Mesh;
  /** Callsign string — stored so refreshAcLabel can repaint without extra props. */
  callsign:        string;
  /** Phase that was painted into the label last; used to detect change. */
  labelPhase:      string;
  /** Heading that was painted into the label last; refresh when drift > 5°. */
  labelHeadingDeg: number;
  /** Thin line drawn from the displaced label to the aircraft cone — only
   *  visible when the label has been pushed away to resolve an overlap. */
  leaderLine:    THREE.Line;
  leaderLineMat: THREE.LineBasicMaterial;

  // ── Cached per-poll aircraft properties (used by rAF loop) ───────────────
  /** Current flight phase — cached so the rAF loop can read it without acMap lookup. */
  phase:           string;
  /** True when this is a ground vehicle (hidden from some indicators). */
  isGroundVehicle: boolean;
  /** True when wake category = Heavy (gets amber wake ribbon). */
  isHeavy:         boolean;
  /** True when altitude > 50 ft (airborne classification). */
  isAirborne:      boolean;

  // ── Velocity vector (Task 33) ─────────────────────────────────────────────
  /** Thin look-ahead line extending 90 s of travel from the cone. */
  velVec:    THREE.Line;
  velVecMat: THREE.LineBasicMaterial;

  // ── Separation bubble (Task 33) ───────────────────────────────────────────
  /** Very faint translucent sphere (~5 NM radius) around airborne aircraft.
   *  Turns red when another aircraft's bubble overlaps. */
  sepBubble:    THREE.Mesh;
  sepBubbleMat: THREE.MeshBasicMaterial;

  // ── Wake turbulence ribbon (Task 33, Heavy aircraft only) ─────────────────
  /** Pair of amber lines offset ± perpendicular to heading; null for Medium/Light. */
  wakeL:    THREE.Line | null;
  wakeR:    THREE.Line | null;
  wakeLMat: THREE.ShaderMaterial | null;
  wakeRMat: THREE.ShaderMaterial | null;
}

function disposeBundle(b: AcBundle): void {
  // cone: CONE_GEO is shared — only dispose per-aircraft material
  (b.cone.material as THREE.Material).dispose();
  b.stem.geometry.dispose(); // per-aircraft (two endpoint positions vary)
  b.trail.geometry.dispose(); (b.trail.material as THREE.Material).dispose(); // per-aircraft clone
  const sm = b.label.material as THREE.SpriteMaterial;
  sm.map?.dispose(); sm.dispose();
  // halo / pinRing: HALO_GEO, PIN_RING_GEO, HALO_MAT, PIN_RING_MAT are all shared —
  // do NOT dispose geometry or material (the Mesh itself is removed from scene via scene.remove)
  if (b.leaderLine) { b.leaderLine.geometry.dispose(); b.leaderLineMat?.dispose(); }
  if (b.velVec)     { b.velVec.geometry.dispose(); b.velVecMat?.dispose(); }
  // sepBubble: SEP_BUBBLE_GEO is shared — only dispose per-aircraft material
  if (b.sepBubble)  { b.sepBubbleMat?.dispose(); }
  // wake ribbons: per-aircraft geometry + cloned material
  if (b.wakeL)      { b.wakeL.geometry.dispose(); b.wakeLMat?.dispose(); }
  if (b.wakeR)      { b.wakeR.geometry.dispose(); b.wakeRMat?.dispose(); }
}

// Shared stem material — one instance, never disposed here
const STEM_MAT = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.50 });

// ── Shared geometries — one instance referenced by many Mesh/Line objects ─────
// Never call .dispose() on these in per-aircraft teardown.
const CONE_GEO       = (() => { const g = new THREE.ConeGeometry(27.5, 85, 4, 1); g.rotateX(-Math.PI / 2); return g; })();
const HALO_GEO       = new THREE.TorusGeometry(70, 7, 8, 64);
const PIN_RING_GEO   = new THREE.TorusGeometry(110, 5, 8, 64);
const SEP_BUBBLE_GEO = new THREE.SphereGeometry(SEP_BUBBLE_R, 16, 12);

// ── Shared materials — per-aircraft objects reference (not own) these ─────────
// Never dispose these in per-aircraft teardown.
const HALO_MAT     = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.50, depthWrite: false });
const PIN_RING_MAT = new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.70, depthWrite: false });

// ── Trail / wake ShaderMaterial templates ─────────────────────────────────────
// Each aircraft calls .clone() so it gets its own uniforms.color value without
// recompiling the GL shader program (Three.js clone() reuses the compiled program).
const TRAIL_MAT_TEMPLATE = new THREE.ShaderMaterial({
  uniforms:       { color: { value: new THREE.Color(0xffffff) } },
  vertexShader:   TRAIL_VERTEX_SHADER,
  fragmentShader: TRAIL_FRAGMENT_SHADER,
  transparent:    true,
  depthWrite:     false,
});
const WAKE_MAT_TEMPLATE = new THREE.ShaderMaterial({
  uniforms:       { color: { value: new THREE.Color(0xFF8C00) } }, // amber
  vertexShader:   TRAIL_VERTEX_SHADER,
  fragmentShader: TRAIL_FRAGMENT_SHADER,
  transparent:    true,
  depthWrite:     false,
});

// ── Mutable scene state (lives in sceneRef, never in React state) ─────────────
interface SceneState {
  renderer:    THREE.WebGLRenderer;
  scene:       THREE.Scene;
  camera:      THREE.PerspectiveCamera;
  animId:      number;
  angle:       number;
  acMap:       Map<string, AcBundle>;
  coneToId:    Map<THREE.Mesh, string>; // for raycasting
  // camera mode
  cameraMode:  CameraMode;
  // fly-to animation (used during 'inspect' with flyProgress < 1)
  flyFrom:     THREE.Vector3;
  flyTo:       THREE.Vector3;
  flyLookFrom: THREE.Vector3;
  flyLookTo:   THREE.Vector3;
  flyProgress: number;              // 0 → 1; 1 = arrived
  // selection
  selectedAcId: string | null;
  // latest aircraft snapshot for camera tracking (updated each data tick)
  latestAircraftMap: Map<string, Aircraft>;
  // click tracking for double-click detection
  mouseDownX:    number;
  mouseDownY:    number;
  lastClickAcId: string | null;
  lastClickTime: number;
  // wall-clock timestamp (performance.now, ms) of the most recent poll arrival
  lastPollMs:    number;
  // measured interval between the two most recent accepted polls (ms); initially 8000
  pollDurationMs: number;
  // zoom/pan/rotate state
  orbitRadius:      number;          // mutable zoom radius (starts at ORBIT_RADIUS)
  orbitElevation:   number;          // camera height above scene origin (mutable via drag)
  orbitTarget:      THREE.Vector3;   // mutable orbit centre (panned by right-drag)
  rightDragActive:  boolean;
  rightDragLastX:   number;
  rightDragLastY:   number;
  panResumeTimer:   ReturnType<typeof setTimeout> | null;
  leftDragActive:   boolean;         // left-drag arc-rotate
  leftDragLastX:    number;
  leftDragLastY:    number;
  /** Mirror of the directorMode prop — updated each render via sync effect. */
  directorMode:     boolean;
  /** Aircraft ID → alert severity for the current snapshot (Phase 6A). */
  alertedIds: Map<string, 'advisory' | 'caution' | 'critical'>;
  /** Set of aircraft IDs currently pinned by the controller. */
  pinnedAcIds: Set<string>;
  /** Full active SWAlert list — used by the threat beam renderer. */
  activeAlerts: SWAlert[];
  /** Alert ID → live beam entry (line + midSphere). */
  beamMap: Map<string, BeamEntry>;
  /** Alert ID → expanding pulse ring cluster on the ground plane. */
  pulseRingMap: Map<string, PulseRingEntry>;
  /** Alert ID → floating 3D canvas-sprite label at the conflict midpoint. */
  labelMap: Map<string, AlertLabelEntry>;
  /** Aircraft ID → takeoff vertical-line + sign indicator. */
  takeoffMap: Map<string, TakeoffIndicatorEntry>;
  /** Aircraft ID → approach/landing diagonal-line + sign indicator. */
  approachMap: Map<string, ApproachIndicatorEntry>;
  /** Aircraft ID → glide slope projected path line (approach phase only). */
  glideSlopeMap: Map<string, GlideSlopeEntry>;
  /** All runway threshold positions [designator, x, z] in Three.js scene coords.
   *  Computed once at scene-setup and used every rAF frame for glide slope targeting. */
  allThresholds: Array<[string, number, number]>;
  /** Active landing runway direction stem (e.g. "19"), derived from weather.
   *  Kept on st so the rAF tick can filter thresholds without a stale closure. */
  activeRunwayDirection: string | null;

  // ── Task 33 — visual aids ─────────────────────────────────────────────────
  /** Mirror of the showPaths prop — controls velocity vectors, sep bubbles,
   *  wake ribbons, and taxi rings. Updated via sync effect. */
  showPaths:   boolean;
  /** Aircraft ID → expanding ground-plane rings for taxiing aircraft. */
  taxiRingMap: Map<string, TaxiRingEntry>;

  // ── Alert focus + director state ─────────────────────────────────────────
  /** Alert ID currently being shown by the director, or null. */
  alertFocusId:   string | null;
  /** Callback to fire when the director alert hold completes. */
  alertFocusDone: (() => void) | null;
  /** Self-contained director camera state machine. */
  dir: DirState;
  /** Aircraft IDs queued for deferred spawn; drained ≤ SPAWN_PER_FRAME per rAF tick. */
  spawnQueue:    string[];
  /** Fast membership check — prevents re-queuing across back-to-back polls. */
  spawnQueueIds: Set<string>;
}

// ── Director camera state machine ─────────────────────────────────────────────

/** Internal state for the director's three-priority camera state machine. */
interface DirState {
  /** Current phase. */
  phase: 'orbit' | 'fly_alert' | 'hold_alert' | 'fly_ac' | 'hold_ac';
  // Shared fly-animation vectors
  flyFrom:    THREE.Vector3;
  flyTo:      THREE.Vector3;
  lookFrom:   THREE.Vector3;
  lookTo:     THREE.Vector3;
  flyStartMs: number;  // performance.now() when fly began
  flyMs:      number;  // total fly duration (ms)
  // Alert hold
  alertId:     string | null;
  holdUntilMs: number;
  // Aircraft follow
  acId:    string | null;
  // Smooth look target lerped every frame
  lookAt:  THREE.Vector3;
}

/** Pick the highest-priority aircraft for the director.
 *  Approach/landing (closest to threshold first) > takeoff > null. */
function pickDirectorAircraft(st: SceneState): { id: string; kind: 'approach' | 'takeoff' } | null {
  const cx = st.orbitTarget.x;
  const cz = st.orbitTarget.z;
  const r2 = DIRECTOR_FOCUS_RADIUS * DIRECTOR_FOCUS_RADIUS;

  let bestId: string | null = null;
  let lowestY = Infinity;

  for (const [id, b] of st.acMap) {
    if (b.isGroundVehicle) continue;
    if (b.phase === 'approach' || b.phase === 'landing') {
      // Horizontal distance² from airport centre (ignore scaled altitude axis)
      const dx = b.renderPos.x - cx;
      const dz = b.renderPos.z - cz;
      if (dx * dx + dz * dz > r2) continue; // outside focus radius
      if (b.renderPos.y < lowestY) { lowestY = b.renderPos.y; bestId = id; }
    }
  }
  if (bestId) return { id: bestId, kind: 'approach' };

  for (const [id, b] of st.acMap) {
    if (b.isGroundVehicle) continue;
    if (b.phase === 'takeoff') {
      const dx = b.renderPos.x - cx;
      const dz = b.renderPos.z - cz;
      if (dx * dx + dz * dz > r2) continue;
      return { id, kind: 'takeoff' };
    }
  }
  return null;
}

/** Compute the 3-D conflict midpoint for the given alert. */
function alertMidpoint(st: SceneState, alertId: string): THREE.Vector3 {
  const alert = st.activeAlerts.find(a => a.id === alertId);
  if (!alert) return st.orbitTarget.clone();
  let mx = 0, my = 0, mz = 0, cnt = 0;
  for (const id of alert.aircraftIds.slice(0, 2)) {
    const b = st.acMap.get(id);
    if (b) { mx += b.renderPos.x; my += b.renderPos.y; mz += b.renderPos.z; cnt++; }
  }
  return cnt > 0
    ? new THREE.Vector3(mx / cnt, Math.max(MIN_LOOK_Y, my / cnt), mz / cnt)
    : st.orbitTarget.clone();
}

/**
 * Run the director state machine for one rAF frame.
 * Three priority levels:
 *   1. Alert (highest) — fly to conflict midpoint in 2 s, hold 10 s, back to orbit.
 *   2. Approach / takeoff — fly to aircraft in 3 s, track until phase changes, back to orbit.
 *   3. Orbit (lowest) — slow 360° rotation around airport.
 */
function runDirector(st: SceneState, camera: THREE.PerspectiveCamera, nowMs: number): void {
  const d = st.dir;

  // ── 1. Check for a new alert (always highest priority) ───────────────────
  // Guard: only start the fly when we can resolve a real conflict midpoint.
  // If the alert's aircraft haven't been spawned into acMap yet, alertMidpoint
  // returns orbitTarget as a fallback — flying there produces an invisible focus
  // on empty airspace, so we retry the check every frame until a real position
  // is available.  d.alertId is NOT set here, keeping the retry alive.
  if (st.alertFocusId && st.alertFocusId !== d.alertId && d.phase !== 'hold_alert') {
    const mp        = alertMidpoint(st, st.alertFocusId);
    const horizDist = Math.hypot(mp.x - st.orbitTarget.x, mp.z - st.orbitTarget.z);
    // hasTarget: aircraft are in the scene (> 100 m from origin) AND within the
    // airport's footprint (< DIRECTOR_MAX_ALERT_DIST from centre).  Alerts beyond
    // that radius are distant enroute traffic — skip them and wait for a closer one.
    const hasTarget = horizDist > 100 && horizDist < DIRECTOR_MAX_ALERT_DIST;

    if (hasTarget) {
      const horiz = new THREE.Vector3(camera.position.x - mp.x, 0, camera.position.z - mp.z);
      if (horiz.length() < 1) horiz.set(0, 0, 1);
      horiz.normalize().multiplyScalar(900);

      const camTo = new THREE.Vector3(mp.x + horiz.x, mp.y + 700, mp.z + horiz.z);
      const fwd   = new THREE.Vector3();
      camera.getWorldDirection(fwd);

      d.flyFrom.copy(camera.position);
      d.flyTo.copy(camTo);
      d.lookFrom.copy(camera.position.clone().addScaledVector(fwd, 2000));
      d.lookTo.copy(mp);
      d.flyStartMs = nowMs;
      d.flyMs      = 2_000;
      d.alertId    = st.alertFocusId;
      d.phase      = 'fly_alert';
      d.lookAt.copy(d.lookFrom);
      console.log(`[DIRECTOR] alert interrupt → ${d.alertId}`);
    }
    // else: aircraft not yet in scene — d.alertId stays null, retry next frame
  }

  // ── 2. State machine ─────────────────────────────────────────────────────
  switch (d.phase) {

    case 'orbit': {
      st.angle += ORBIT_SPEED;
      camera.position.set(
        st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle),
        st.orbitElevation,
        st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle),
      );
      camera.lookAt(st.orbitTarget);

      const subject = pickDirectorAircraft(st);
      if (subject) {
        const b = st.acMap.get(subject.id);
        if (b) {
          const lookTarget = b.renderPos.clone();
          lookTarget.y = Math.max(MIN_LOOK_Y, lookTarget.y);
          const camTo  = lookTarget.clone().add(DIRECTOR_CAM_OFFSET);
          const fwd2   = new THREE.Vector3();
          camera.getWorldDirection(fwd2);

          d.flyFrom.copy(camera.position);
          d.flyTo.copy(camTo);
          d.lookFrom.copy(camera.position.clone().addScaledVector(fwd2, 2000));
          d.lookTo.copy(lookTarget);
          d.flyStartMs = nowMs;
          d.flyMs      = 3_000;
          d.acId       = subject.id;
          d.phase      = 'fly_ac';
          d.lookAt.copy(d.lookFrom);
          console.log(`[DIRECTOR] → ${subject.kind} ${d.acId}`);
        }
      }
      break;
    }

    case 'fly_alert': {
      const t  = Math.min((nowMs - d.flyStartMs) / d.flyMs, 1);
      const et = easeInOut(t);
      camera.position.lerpVectors(d.flyFrom, d.flyTo, et);
      const lk = new THREE.Vector3().lerpVectors(d.lookFrom, d.lookTo, et);
      lk.y = Math.max(MIN_LOOK_Y, lk.y);
      camera.lookAt(lk);
      d.lookAt.copy(lk);
      if (t >= 1) {
        d.phase       = 'hold_alert';
        d.holdUntilMs = nowMs + 10_000;
        console.log(`[DIRECTOR] alert ${d.alertId} — hold 10 s`);
      }
      break;
    }

    case 'hold_alert': {
      if (d.alertId) {
        const mp = alertMidpoint(st, d.alertId);
        d.lookAt.lerp(mp, 0.03);
      }
      camera.position.copy(d.flyTo);
      camera.lookAt(d.lookAt);
      if (nowMs >= d.holdUntilMs) {
        console.log(`[DIRECTOR] alert ${d.alertId} done — returning to orbit`);
        d.alertId = null;
        d.phase   = 'orbit';
        const done = st.alertFocusDone;
        st.alertFocusDone = null;
        st.alertFocusId   = null;
        // Glide camera back to orbit position instead of snapping.
        // Switch into the shared 'returning' animation so the director
        // picks up the next alert as soon as the camera re-enters orbit.
        const tx = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
        const tz = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
        const fwdV = new THREE.Vector3();
        camera.getWorldDirection(fwdV);
        st.flyFrom.copy(camera.position);
        st.flyTo.set(tx, st.orbitElevation, tz);
        st.flyLookFrom.copy(camera.position).addScaledVector(fwdV, 2000);
        st.flyLookTo.copy(st.orbitTarget);
        st.flyProgress = 0;
        st.cameraMode  = 'returning';
        done?.();
      }
      break;
    }

    case 'fly_ac': {
      const b = d.acId ? st.acMap.get(d.acId) : null;
      if (!b) { d.acId = null; d.phase = 'orbit'; break; }

      const t  = Math.min((nowMs - d.flyStartMs) / d.flyMs, 1);
      const et = easeInOut(t);

      // Track moving aircraft continuously during the fly.
      const lookTarget = b.renderPos.clone();
      lookTarget.y = Math.max(MIN_LOOK_Y, lookTarget.y);
      d.flyTo.copy(lookTarget.clone().add(DIRECTOR_CAM_OFFSET));
      d.lookTo.copy(lookTarget);

      camera.position.lerpVectors(d.flyFrom, d.flyTo, et);
      const lk = new THREE.Vector3().lerpVectors(d.lookFrom, d.lookTo, et);
      lk.y = Math.max(MIN_LOOK_Y, lk.y);
      camera.lookAt(lk);
      d.lookAt.copy(lk);

      if (t >= 1) {
        d.phase = 'hold_ac';
        d.lookAt.copy(lookTarget);
        console.log(`[DIRECTOR] arrived at ${d.acId}`);
      }
      break;
    }

    case 'hold_ac': {
      const b            = d.acId ? st.acMap.get(d.acId) : null;
      const stillPriority = b && !b.isGroundVehicle &&
        (b.phase === 'approach' || b.phase === 'landing' || b.phase === 'takeoff');

      if (!stillPriority) {
        console.log(`[DIRECTOR] ${d.acId} left priority phase — orbit`);
        d.acId = null; d.phase = 'orbit';
        break;
      }

      const lookTarget = b!.renderPos.clone();
      lookTarget.y = Math.max(MIN_LOOK_Y, lookTarget.y);
      camera.position.lerp(lookTarget.clone().add(DIRECTOR_CAM_OFFSET), 0.04);
      d.lookAt.lerp(lookTarget, 0.06);
      camera.lookAt(d.lookAt);
      break;
    }
  }
}

// ── Helper: begin fly-to animation toward an aircraft ────────────────────────
function startFlyTo(st: SceneState, acId: string): void {
  const ac = st.latestAircraftMap.get(acId);
  const acPos = ac
    ? toV3(ac.position.x, ac.position.y, ac.position.alt)
    : new THREE.Vector3(0, 0, 0);

  // Always look at a point at least MIN_LOOK_Y above the ground so the camera
  // never aims into the tarmac when following ground / low-altitude aircraft.
  const lookPos = acPos.clone();
  lookPos.y = Math.max(MIN_LOOK_Y, lookPos.y);

  const targetCamPos = lookPos.clone().add(INSPECT_OFFSET);

  // Derive current camera lookAt from its forward direction
  const dir = new THREE.Vector3();
  st.camera.getWorldDirection(dir);
  const currentLookAt = st.camera.position.clone().add(dir.multiplyScalar(2000));

  st.cameraMode    = 'inspect';
  st.selectedAcId  = acId;
  st.flyFrom.copy(st.camera.position);
  st.flyTo.copy(targetCamPos);
  st.flyLookFrom.copy(currentLookAt);
  st.flyLookTo.copy(lookPos);
  st.flyProgress   = 0;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface AirspaceView3DProps {
  aircraft:         Aircraft[];
  selectedAcId:     string | null;
  cameraMode:       CameraMode;
  onSelectAircraft: (id: string | null) => void;
  onCameraMode:     (mode: CameraMode) => void;
  /** When true the camera uses a wide cinematic offset and smooth tracking. */
  directorMode?:    boolean;
  /** Live weather — drives approach corridor and wind indicator. */
  weather?:         WorldSnapshot['weather'];
  /** Aircraft IDs → severity for active separation alerts (Phase 6A). */
  alertedIds?:      Map<string, 'advisory' | 'caution' | 'critical'>;
  /** Full active alert list — drives the 3-D threat beam renderer. */
  activeAlerts?:    SWAlert[];
  /** Set of aircraft IDs pinned by the controller — shown with a cyan orbit ring. */
  pinnedAcIds?:     Set<string>;
  /**
   * When set to a CRITICAL alert ID, the camera pivots to look at that
   * conflict's 3D midpoint (2 s in, 5 s hold, 2 s return).
   * Clear to undefined to cancel early (e.g. alert cleared).
   */
  alertFocusId?:     string;
  /** Fired when the full pivot-in → hold → pivot-out sequence completes. */
  onAlertFocusDone?: () => void;
  /** When true: velocity vectors, separation bubbles, wake ribbons, and taxi
   *  rings are rendered in the 3D scene.  Mirrors the App-level [P] toggle. */
  showPaths?: boolean;
  /** DEV-ONLY: on mount the component writes rebuildGroundGeometry() into this
   *  ref so the parent can call it imperatively from a dev toolbar button.
   *  The function removes/disposes existing ground groups, builds new geometry
   *  from the given profile, clears all aircraft, and resets the orbit camera. */
  rebuildGroundRef?: { current: ((profile: AirportProfile) => void) | null };
}

// ── Deferred aircraft spawn ───────────────────────────────────────────────────
// Maximum aircraft spawned per rAF frame when draining the queue.
const SPAWN_PER_FRAME = 4;

/**
 * Create all Three.js objects for one aircraft and register them in st.acMap.
 * Called from the rAF drain loop rather than inline in the data-sync effect,
 * so large batches are spread across frames and never block the main thread.
 */
function spawnAircraft(st: SceneState, ac: Aircraft, nowMs: number): void {
  const { scene, acMap, coneToId } = st;
  const pos   = toV3(ac.position.x, ac.position.y, ac.position.alt);
  const hex   = phaseHex(ac.phase);
  const headY = -(ac.heading * Math.PI) / 180;

  // Cone — shared geometry reused by every aircraft; per-aircraft MeshLambertMaterial
  const coneMat = new THREE.MeshLambertMaterial({
    color: hex, emissive: hex, emissiveIntensity: 0.30,
  });
  const cone = new THREE.Mesh(CONE_GEO, coneMat);
  cone.position.copy(pos);
  cone.rotation.y = headY;
  // renderOrder=1 ensures the opaque cone renders AFTER the transparent trail.
  cone.renderOrder = 1;
  scene.add(cone);
  coneToId.set(cone, ac.id);

  // Halo / pin ring — shared geometry AND shared material; only the Mesh is per-aircraft
  const halo = new THREE.Mesh(HALO_GEO, HALO_MAT);
  halo.rotation.x = Math.PI / 2;
  halo.renderOrder = 3;
  halo.visible = false;
  scene.add(halo);

  const pinRing = new THREE.Mesh(PIN_RING_GEO, PIN_RING_MAT);
  pinRing.rotation.x = Math.PI / 2;
  pinRing.renderOrder = 4;
  pinRing.visible = false;
  scene.add(pinRing);

  // Stem — two endpoint positions vary per aircraft → per-aircraft geometry
  const stemGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(pos.x, 0, pos.z),
    new THREE.Vector3(pos.x, pos.y, pos.z),
  ]);
  const stem = new THREE.Line(stemGeo, STEM_MAT);
  scene.add(stem);

  // Trail — per-aircraft geometry + cloned ShaderMaterial.
  // .clone() reuses the compiled GL program — no per-aircraft GLSL recompile.
  const trailPosArr   = new Float32Array(TRAIL_MAX * 3);
  trailPosArr[0] = pos.x; trailPosArr[1] = pos.y; trailPosArr[2] = pos.z;
  trailPosArr[3] = pos.x; trailPosArr[4] = pos.y; trailPosArr[5] = pos.z;
  const trailAlphaArr = new Float32Array(TRAIL_MAX);
  trailAlphaArr[0] = trailAlphaArr[1] = TRAIL_OPACITY;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
  trailGeo.setAttribute('alpha',    new THREE.BufferAttribute(trailAlphaArr, 1));
  trailGeo.setDrawRange(0, 2);
  const trailMat = TRAIL_MAT_TEMPLATE.clone();
  trailMat.uniforms.color.value = new THREE.Color(hex);
  const trail = new THREE.Line(trailGeo, trailMat);
  scene.add(trail);

  const label = makeAcLabel(ac.callsign, ac.heading, ac.phase);
  label.position.set(pos.x, pos.y + LABEL_LIFT, pos.z);
  // Freshly spawned aircraft always have fresh data — full opacity
  (label.material as THREE.SpriteMaterial).opacity = 1.0;
  scene.add(label);

  // Leader line — thin connector from displaced label to cone
  const leaderGeo = new THREE.BufferGeometry();
  leaderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const leaderLineMat = new THREE.LineBasicMaterial({
    color: 0x64748b, transparent: true, opacity: 0.50, depthWrite: false,
  });
  const leaderLine = new THREE.Line(leaderGeo, leaderLineMat);
  leaderLine.frustumCulled = false;
  leaderLine.visible = false;
  scene.add(leaderLine);

  const trailBuf: { pos: THREE.Vector3; t: number }[] = [
    { pos: pos.clone(), t: nowMs },
    { pos: pos.clone(), t: nowMs },
  ];
  // Age-compensate the initial fix so extrapolation starts from the present
  // position, not a seen_pos-seconds-old raw fix.
  const spawnCanExtrap = (ac.seenPos ?? 0) < STALE_EXTRAP_S && ac.groundSpeed >= GS_EXTRAP_MIN_KT;
  const spawnGsMps  = spawnCanExtrap ? ac.groundSpeed * KT_TO_MPS : 0;
  const spawnVyPerS = ((ac.verticalRate ?? 0) / 60) * ALT_SCALE;
  const spawnPos    = spawnCanExtrap
    ? (() => {
        const ageS = ac.seenPos ?? 0;
        const hRad = ac.heading * Math.PI / 180;
        return new THREE.Vector3(
          pos.x + spawnGsMps * Math.sin(hRad) * ageS,
          Math.max(0, pos.y + spawnVyPerS * ageS),
          pos.z - spawnGsMps * Math.cos(hRad) * ageS,
        );
      })()
    : pos.clone();

  // Velocity vector
  const velVecGeo = new THREE.BufferGeometry();
  velVecGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const velVecMat = new THREE.LineBasicMaterial({
    color: hex, transparent: true, opacity: 0.50, depthWrite: false,
  });
  const velVec = new THREE.Line(velVecGeo, velVecMat);
  velVec.frustumCulled = false;
  velVec.visible = false;
  scene.add(velVec);

  // Separation bubble — shared geometry, per-aircraft material (color mutated per-frame)
  const sepBubbleMat = new THREE.MeshBasicMaterial({
    color:       0x8899bb,
    transparent: true,
    opacity:     0.03,
    depthWrite:  false,
    side:        THREE.BackSide,
  });
  const sepBubble = new THREE.Mesh(SEP_BUBBLE_GEO, sepBubbleMat);
  sepBubble.frustumCulled = false;
  sepBubble.visible = false;
  scene.add(sepBubble);

  // Wake turbulence ribbon — Heavy aircraft only; cloned ShaderMaterials
  const spawnIsHeavy    = wakeCategory(ac.type) === 'H';
  const spawnIsAirborne = isAirborne(ac);
  let wakeL: THREE.Line | null = null;
  let wakeR: THREE.Line | null = null;
  let wakeLMat: THREE.ShaderMaterial | null = null;
  let wakeRMat: THREE.ShaderMaterial | null = null;
  if (spawnIsHeavy) {
    const makeWake = () => {
      const wGeo = new THREE.BufferGeometry();
      wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
      wGeo.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(TRAIL_MAX),     1));
      wGeo.setDrawRange(0, 0);
      const wMat = WAKE_MAT_TEMPLATE.clone(); // reuses compiled GL program
      const wLine = new THREE.Line(wGeo, wMat);
      wLine.frustumCulled = false;
      wLine.visible = false;
      scene.add(wLine);
      return { line: wLine, mat: wMat };
    };
    const wL = makeWake(); const wR = makeWake();
    wakeL = wL.line; wakeLMat = wL.mat;
    wakeR = wR.line; wakeRMat = wR.mat;
  }

  acMap.set(ac.id, {
    cone, stem, trail, label, trailBuf, halo, pinRing,
    leaderLine, leaderLineMat,
    velVec, velVecMat,
    sepBubble, sepBubbleMat,
    wakeL, wakeR, wakeLMat, wakeRMat,
    renderPos:       spawnPos.clone(),
    lastKnownPos:    spawnPos.clone(),
    lastKnownTimeMs: nowMs,
    headingDeg:      ac.heading,
    gsMps:           spawnGsMps,
    vyPerS:          spawnVyPerS,
    seenPos:         ac.seenPos ?? 0,
    corrFromPos:     spawnPos.clone(),
    corrStartMs:     -1,
    callsign:        ac.callsign,
    labelPhase:      ac.phase,
    labelHeadingDeg: ac.heading,
    phase:           ac.phase,
    isGroundVehicle: ac.isGroundVehicle ?? false,
    isHeavy:         spawnIsHeavy,
    isAirborne:      spawnIsAirborne,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirspaceView3D({
  aircraft,
  selectedAcId,
  cameraMode,
  onSelectAircraft,
  onCameraMode,
  directorMode = false,
  weather,
  alertedIds,
  activeAlerts,
  alertFocusId,
  onAlertFocusDone,
  showPaths = false,
  pinnedAcIds,
  rebuildGroundRef,
}: AirspaceView3DProps) {
  const mountRef       = useRef<HTMLDivElement>(null);
  const sceneRef       = useRef<SceneState | null>(null);
  /** Three.js Groups comprising the current airport's ground geometry.
   *  Stored so rebuildGroundGeometry() can remove and dispose them in-place. */
  const groundGrpsRef  = useRef<THREE.Group[]>([]);
  /** Three.js group rebuilt whenever weather changes (approach cone + wind arrow). */
  const weatherGrpRef  = useRef<THREE.Group | null>(null);
  /** Three.js group containing all SID/STAR route ribbons for the current airport. */
  const routeGroupRef      = useRef<THREE.Group | null>(null);
  /** Flat array of RouteLine entries driving per-frame opacity in the rAF loop. */
  const routeLineEntriesRef = useRef<RouteLine[]>([]);

  // Stable callback refs — updated every render so event handlers always call
  // the latest versions without needing to be re-registered.
  const selectRef  = useRef(onSelectAircraft);
  const camModeRef = useRef(onCameraMode);
  useEffect(() => { selectRef.current  = onSelectAircraft; }, [onSelectAircraft]);
  useEffect(() => { camModeRef.current = onCameraMode;     }, [onCameraMode]);

  // Stable refs for alert-focus interrupt props.
  // The scene-setup effect has [] deps so it can't read React state/props
  // directly after mount.  These refs are written on EVERY render (no useEffect),
  // so the scene-setup effect can always read the latest values — needed for
  // remount recovery when alertFocusId was already set in App's state.
  // Airport profile — updated every render so the scene-setup effect ([] deps)
  // can read the latest geometry via profileRef.current.
  const profile    = useAirport();
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const alertFocusIdRef     = useRef<string | null>(alertFocusId ?? null);
  const onAlertFocusDoneRef = useRef<(() => void) | null>(onAlertFocusDone ?? null);
  alertFocusIdRef.current     = alertFocusId ?? null;
  onAlertFocusDoneRef.current = onAlertFocusDone ?? null;

  // Stable ref so the scene-setup effect ([] deps, runs after the directorMode
  // sync effect) can read the CURRENT directorMode without a closure.
  const directorModeRef = useRef(directorMode);
  directorModeRef.current = directorMode;

  // Sync directorMode prop → SceneState; reset director to orbit when activated.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.directorMode = directorMode;
    if (directorMode) {
      st.dir.phase      = 'orbit';
      st.dir.alertId    = null;
      st.dir.acId       = null;
      st.dir.holdUntilMs = 0;
      console.log('[DIRECTOR] activated — starting orbit');
    }
  }, [directorMode]);

  // Sync showPaths prop — controls velocity vectors, sep bubbles, wake ribbons, taxi rings,
  // and SID/STAR route ribbons.
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.showPaths = showPaths;
    if (routeGroupRef.current) routeGroupRef.current.visible = showPaths;
  }, [showPaths]);

  // Sync alertedIds prop so the rAF loop highlights alerted aircraft.
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.alertedIds = alertedIds ?? new Map();
  }, [alertedIds]);

  // Sync activeAlerts prop so the rAF loop can build/update threat beams.
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.activeAlerts = activeAlerts ?? [];
  }, [activeAlerts]);

  // Sync pinnedAcIds prop so the rAF loop can show/hide the pin ring.
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.pinnedAcIds = pinnedAcIds ?? new Set();
  }, [pinnedAcIds]);

  // ── rebuildGroundGeometry — exposed via rebuildGroundRef for imperative callers ──
  // Written once at mount; reads refs at call-time so no stale closure risk.
  useEffect(() => {
    if (!rebuildGroundRef) return;
    rebuildGroundRef.current = (profile: AirportProfile) => {
      const st = sceneRef.current;
      if (!st) return;
      const { scene } = st;

      // 1. Remove and dispose every mesh/line/sprite in the current ground groups.
      //    Only ground geometry is touched — scene, renderer, and rAF loop are untouched.
      for (const grp of groundGrpsRef.current) {
        scene.remove(grp);
        grp.traverse(obj => {
          const node = obj as THREE.Mesh | THREE.Line | THREE.Sprite;
          if ((node as THREE.Mesh).geometry) (node as THREE.Mesh).geometry.dispose();
          const mat = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (mat) {
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat.dispose();
          }
        });
      }
      groundGrpsRef.current = [];

      // 2. Build fresh ground geometry from the new profile and add to same scene.
      const thresholds = computeRunwayThresholds(profile.runways, profile.geometry.runways);
      const geoGrp     = buildGroundGeometry(profile.geometry.runways, profile.geometry.taxiways, profile.geometry.aprons);
      const altGrp     = buildAltRings();
      const annoGrp    = buildAirportAnnotations(thresholds, profile.terminalLabelPos);
      scene.add(geoGrp, altGrp, annoGrp);
      groundGrpsRef.current = [geoGrp, altGrp, annoGrp];
      // Update threshold cache used by the glide-slope rAF pass.
      st.allThresholds = thresholds;

      // 3. Clear all aircraft (they belong to the old airport).
      //    Per-aircraft cloned materials/geometries are disposed; shared module-level
      //    geometry/materials (CONE_GEO, HALO_MAT, etc.) are NOT touched.
      st.acMap.forEach(b => {
        scene.remove(b.cone, b.stem, b.trail, b.label);
        if (b.halo)      scene.remove(b.halo);
        if (b.pinRing)   scene.remove(b.pinRing);
        if (b.velVec)    scene.remove(b.velVec);
        if (b.sepBubble) scene.remove(b.sepBubble);
        if (b.wakeL)     scene.remove(b.wakeL);
        if (b.wakeR)     scene.remove(b.wakeR);
        disposeBundle(b);
      });
      st.acMap.clear();
      st.coneToId.clear();
      // Drain the spawn queue so stale IDs don't get built into the new scene.
      st.spawnQueue.length = 0;
      st.spawnQueueIds.clear();

      // Clear aircraft-linked overlays (indicators reference old aircraft positions).
      st.takeoffMap.forEach(entry => disposeTakeoffIndicator(entry, scene));
      st.takeoffMap.clear();
      st.approachMap.forEach(entry => disposeApproachIndicator(entry, scene));
      st.approachMap.clear();
      st.glideSlopeMap.forEach(entry => disposeGlideSlopeLine(entry, scene));
      st.glideSlopeMap.clear();
      st.taxiRingMap.forEach(entry => disposeTaxiRingEntry(entry, scene));
      st.taxiRingMap.clear();

      // Clear alert beams, pulse rings, and alert labels — they reference old
      // aircraft positions and old alert state, so they must be torn down.
      st.beamMap.forEach(b => disposeBeamEntry(b, scene));
      st.beamMap.clear();
      st.pulseRingMap.forEach(p => disposePulseRingEntry(p, scene));
      st.pulseRingMap.clear();
      st.labelMap.forEach(l => disposeAlertLabel(l, scene));
      st.labelMap.clear();

      // Clear the weather group (approach cone + wind indicator). The weather
      // useEffect only re-fires when wind values change, so if YSSY and YBBN
      // happen to share the same wind reading the old cone would survive.
      if (weatherGrpRef.current) {
        scene.remove(weatherGrpRef.current);
        weatherGrpRef.current.traverse(obj => {
          const node = obj as THREE.Mesh | THREE.Line;
          if ((node as THREE.Mesh).geometry) (node as THREE.Mesh).geometry.dispose();
          const mat = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (mat) {
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat.dispose();
          }
        });
        weatherGrpRef.current = null;
      }

      // Clear route ribbons — they are airport-specific (SID/STAR paths).
      if (routeGroupRef.current) {
        scene.remove(routeGroupRef.current);
        routeGroupRef.current.traverse(obj => {
          const node = obj as THREE.Mesh | THREE.Line;
          if ((node as THREE.Mesh).geometry) (node as THREE.Mesh).geometry.dispose();
          const mat = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (mat) {
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat.dispose();
          }
        });
        routeGroupRef.current       = null;
        routeLineEntriesRef.current = [];
      }

      // Reset alertedIds so no stale highlight bleeds into the new airport.
      st.alertedIds = new Map();
      st.activeAlerts = [];

      // Reset director state so a stale hold_alert from the previous airport
      // cannot block new alerts after the switch, and any expired hold timer
      // doesn't immediately consume the first new alert on resuming orbit.
      st.dir.phase      = 'orbit';
      st.dir.alertId    = null;
      st.dir.acId       = null;
      st.dir.holdUntilMs = 0;

      // 4. Reset orbit camera to frame the new airport's origin.
      st.orbitTarget.set(0, 0, 0);
      st.orbitRadius    = ORBIT_RADIUS;
      st.orbitElevation = ORBIT_HEIGHT;
      st.angle          = ORBIT_INIT_ANGLE;
      st.cameraMode     = 'orbit';
      st.camera.position.set(
        ORBIT_RADIUS * Math.cos(ORBIT_INIT_ANGLE),
        ORBIT_HEIGHT,
        ORBIT_RADIUS * Math.sin(ORBIT_INIT_ANGLE),
      );
      st.camera.lookAt(st.orbitTarget);

      console.log(`[GROUND] rebuild complete — ${profile.icao}`);
    };
    return () => { rebuildGroundRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync alertFocusId prop → sceneRef so the director picks it up ───────────
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.alertFocusId   = alertFocusId ?? null;
    st.alertFocusDone = onAlertFocusDone ?? null;
    if (alertFocusId) console.log(`[DIRECTOR] prop sync: alertFocusId → ${alertFocusId}`);
  }, [alertFocusId, onAlertFocusDone]);

  // ── Sync external cameraMode prop → sceneRef ────────────────────────────────
  // Fired when App changes cameraMode (e.g. "Follow" button in panel).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || st.cameraMode === cameraMode) return;
    // Never interrupt an in-progress smooth return; React already believes
    // cameraMode is 'orbit' from when we started the animation.
    if (st.cameraMode === 'returning') return;
    console.log(`[3D CAM] prop→scene sync: ${st.cameraMode} → ${cameraMode}`);
    if (cameraMode === 'follow' && st.selectedAcId) {
      // Fly-to setup — glides camera to the selected aircraft over ~5 s.
      st.flyFrom.copy(st.camera.position);
      st.flyProgress = 0;
      st.cameraMode  = 'follow';
    } else if (cameraMode === 'inspect' && st.cameraMode === 'follow') {
      // Panel "Stop Following" — hold current position
      st.cameraMode = 'inspect';
      st.flyProgress = 1; // already at target
    } else if (cameraMode === 'orbit') {
      // Any transition to orbit from outside — fly back smoothly.
      const cam = st.camera;
      const tx  = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
      const tz  = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
      st.flyFrom.copy(cam.position);
      st.flyTo.set(tx, st.orbitElevation, tz);
      // Capture the actual look-at point the camera was aimed at so the
      // look-at lerp starts from the right place (aircraft or wherever the
      // camera was pointed) and smoothly glides to the orbit centre.
      // Without this fix flyLookFrom == flyLookTo == orbitTarget, which
      // makes the camera immediately snap its look direction on frame 0.
      const dir3 = new THREE.Vector3();
      cam.getWorldDirection(dir3);
      st.flyLookFrom.copy(cam.position).addScaledVector(dir3, 2000);
      st.flyLookTo.copy(st.orbitTarget);
      st.flyProgress = 0;
      st.cameraMode  = 'returning';
      // Leave camModeRef alone — React already has 'orbit', which is what we
      // will settle into once the animation completes.
    } else {
      st.cameraMode = cameraMode;
    }
  }, [cameraMode]);

  // ── Sync weather prop → rebuild approach cone + wind arrow ───────────────────
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    // Remove previous weather group
    if (weatherGrpRef.current) { st.scene.remove(weatherGrpRef.current); weatherGrpRef.current = null; }
    // Keep st.activeRunwayDirection fresh so the rAF tick can filter thresholds
    st.activeRunwayDirection = weather?.activeRunwayDirection ?? null;
    if (!weather) return;
    const wg   = new THREE.Group();
    const corr = computeApproachCorridors(
      profileRef.current.runways,
      profileRef.current.geometry.runways,
      weather.activeRunwayDirection,
    );
    wg.add(buildWindIndicator(weather.windDir, weather.windSpeed));
    st.scene.add(wg);
    weatherGrpRef.current = wg;
  }, [weather?.activeRunwayDirection, weather?.windDir, weather?.windSpeed]);

  // ── Sync external selectedAcId prop → sceneRef ──────────────────────────────
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.selectedAcId = selectedAcId;
    // Director aircraft switches need no special handling here — the continuous
    // position/look-at lerp in the rAF tick automatically glides to the new
    // target without any position reset or fly-to restart.
  }, [selectedAcId]);

  // ── One-time Three.js scene setup ───────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const W = el.clientWidth  || window.innerWidth;
    const H = el.clientHeight || window.innerHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x07090F, 1);
    el.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090F, 0.000048);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, W / H, 10, 80000);
    camera.position.set(
      ORBIT_RADIUS * Math.cos(ORBIT_INIT_ANGLE),
      ORBIT_HEIGHT,
      ORBIT_RADIUS * Math.sin(ORBIT_INIT_ANGLE),
    );
    camera.lookAt(LOOK_AT);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(3000, 8000, 2000);
    scene.add(sun);

    // Ground
    const grid = new THREE.GridHelper(8000, 40, 0x0D1520, 0x0D1520);
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = 0.90;
    scene.add(grid);

    const discGeo = new THREE.CircleGeometry(4500, 64);
    discGeo.rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x0A0F18 })));

    const prof       = profileRef.current;
    const thresholds = computeRunwayThresholds(prof.runways, prof.geometry.runways);
    const geoGrp  = buildGroundGeometry(prof.geometry.runways, prof.geometry.taxiways, prof.geometry.aprons);
    const altGrp  = buildAltRings();
    const annoGrp = buildAirportAnnotations(thresholds, prof.terminalLabelPos);
    scene.add(geoGrp, altGrp, annoGrp);
    groundGrpsRef.current = [geoGrp, altGrp, annoGrp];

    // Initialise mutable state
    const st: SceneState = {
      renderer, scene, camera,
      animId:  0,
      angle:   ORBIT_INIT_ANGLE,
      acMap:   new Map(),
      coneToId: new Map(),
      cameraMode:  'orbit',
      flyFrom:     new THREE.Vector3(),
      flyTo:       new THREE.Vector3(),
      flyLookFrom: new THREE.Vector3(),
      flyLookTo:   new THREE.Vector3(),
      flyProgress: 1,
      selectedAcId:       null,
      latestAircraftMap:  new Map(),
      mouseDownX:    0,
      mouseDownY:    0,
      lastClickAcId: null,
      lastClickTime:  0,
      lastPollMs:     0,
      pollDurationMs: 8000,   // conservative default; replaced after first two polls
      orbitRadius:      ORBIT_RADIUS,
      orbitElevation:   ORBIT_HEIGHT,
      orbitTarget:      LOOK_AT.clone(),
      rightDragActive:  false,
      rightDragLastX:   0,
      rightDragLastY:   0,
      panResumeTimer:   null,
      leftDragActive:   false,
      leftDragLastX:    0,
      leftDragLastY:    0,
      directorMode:         false,
      dir: {
        phase:       'orbit',
        flyFrom:     new THREE.Vector3(),
        flyTo:       new THREE.Vector3(),
        lookFrom:    new THREE.Vector3(),
        lookTo:      new THREE.Vector3(),
        flyStartMs:  0,
        flyMs:       2_000,
        alertId:     null,
        holdUntilMs: 0,
        acId:        null,
        lookAt:      new THREE.Vector3(),
      },
      alertedIds:           new Map(),
      activeAlerts:         [],
      beamMap:              new Map(),
      pulseRingMap:         new Map(),
      labelMap:             new Map(),
      alertFocusId:         null,
      alertFocusDone:       null,
      takeoffMap:           new Map(),
      approachMap:          new Map(),
      glideSlopeMap:        new Map(),
      allThresholds:        computeRunwayThresholds(prof.runways, prof.geometry.runways),
      activeRunwayDirection: null,
      showPaths:            false,
      taxiRingMap:          new Map(),
      pinnedAcIds:          new Set(),
      spawnQueue:           [],
      spawnQueueIds:        new Set(),
    };
    sceneRef.current = st;

    // ── Remount recovery: directorMode + alertFocusId ───────────────────────
    // The sync effects (useEffect([directorMode]) etc.) fire BEFORE the scene
    // is created (sceneRef is still null when they run on first mount), so they
    // always early-return without writing anything.  Read the stable refs here,
    // immediately after sceneRef.current is set, to bootstrap the correct state
    // on every mount — including hard page refresh and HMR remounts.
    {
      const dm   = directorModeRef.current;
      const fid  = alertFocusIdRef.current;
      const done = onAlertFocusDoneRef.current;
      st.directorMode = dm;
      if (dm) {
        console.log('[DIRECTOR] activated — starting orbit');
      }
      if (fid) {
        console.log(`[DIRECTOR] remount recovery: alertFocusId=${fid}`);
        st.alertFocusId   = fid;
        st.alertFocusDone = done;
      }
    }

    // ── Raycaster (shared across frames) ────────────────────────────────────
    const raycaster = new THREE.Raycaster();

    // ── Animation loop ───────────────────────────────────────────────────────
    const tick = () => {
      st.animId = requestAnimationFrame(tick);
      const nowMs = performance.now();

      // ── Deferred spawn queue — drain ≤ SPAWN_PER_FRAME aircraft per tick ──
      {
        let n = 0;
        while (st.spawnQueue.length > 0 && n < SPAWN_PER_FRAME) {
          const id = st.spawnQueue.shift()!;
          st.spawnQueueIds.delete(id);
          const ac = st.latestAircraftMap.get(id);
          if (!ac || st.acMap.has(id)) continue; // left before spawn, or already present
          spawnAircraft(st, ac, nowMs);
          n++;
        }
      }

      // ── Director state machine — takes over when active and in orbit ────────
      if (st.directorMode && st.cameraMode === 'orbit') {
        runDirector(st, camera, nowMs);
      } else {

      switch (st.cameraMode) {
        case 'orbit': {
          st.angle += ORBIT_SPEED;
          camera.position.set(
            st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle),
            st.orbitElevation,
            st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle),
          );
          camera.lookAt(st.orbitTarget);
          break;
        }
        case 'manual': {
          // Camera is frozen — panned or dragged off auto-orbit. Esc resumes.
          break;
        }
        case 'inspect': {
          if (st.flyProgress < 1) {
            // Fly-to animation
            st.flyProgress = Math.min(st.flyProgress + FLY_SPEED_NORMAL, 1);
            const t  = easeInOut(st.flyProgress);
            camera.position.lerpVectors(st.flyFrom, st.flyTo, t);
            const lk = new THREE.Vector3().lerpVectors(st.flyLookFrom, st.flyLookTo, t);
            lk.y = Math.max(MIN_LOOK_Y, lk.y); // never look into the tarmac mid-fly
            camera.lookAt(lk);
          } else {
            // Arrived — track the aircraft's interpolated display position
            if (st.selectedAcId) {
              const b = st.acMap.get(st.selectedAcId);
              if (b) {
                const lp = b.renderPos.clone();
                lp.y = Math.max(MIN_LOOK_Y, lp.y);
                camera.lookAt(lp);
              }
            }
          }
          break;
        }
        case 'follow': {
          if (st.selectedAcId) {
            const b = st.acMap.get(st.selectedAcId);
            if (b) {
              const liveTarget = b.renderPos.clone().add(FOLLOW_OFFSET);
              if (st.flyProgress < 1) {
                st.flyProgress = Math.min(st.flyProgress + FLY_SPEED_NORMAL, 1);
                const t = easeInOut(st.flyProgress);
                camera.position.lerpVectors(st.flyFrom, liveTarget, t);
              } else {
                camera.position.copy(liveTarget);
              }
              const nlp = b.renderPos.clone();
              nlp.y = Math.max(MIN_LOOK_Y, nlp.y);
              camera.lookAt(nlp);
            }
          }
          break;
        }
        case 'returning': {
          // Smooth fly-back to the default orbit position.
          // On completion, hands off to 'orbit' with angle re-synced so
          // the auto-orbit continues seamlessly from the arrived position.
          st.flyProgress = Math.min(st.flyProgress + FLY_SPEED_NORMAL, 1); // same 5 s as fly-to
          const t  = easeInOut(st.flyProgress);
          camera.position.lerpVectors(st.flyFrom, st.flyTo, t);
          const lk = new THREE.Vector3().lerpVectors(st.flyLookFrom, st.flyLookTo, t);
          lk.y = Math.max(MIN_LOOK_Y, lk.y); // prevent looking underground during fly-back
          camera.lookAt(lk);
          if (st.flyProgress >= 1) {
            st.angle = Math.atan2(
              camera.position.z - st.orbitTarget.z,
              camera.position.x - st.orbitTarget.x,
            );
            st.cameraMode = 'orbit';
          }
          break;
        }
      }

      } // end director else-branch

      // ── Velocity extrapolation tick ───────────────────────────────────────
      //
      // Each frame we advance an aircraft's renderPos by dead-reckoning from its
      // last known real position along its current heading at its ground speed.
      // When a new poll arrives (in the data sync effect below) the extrapolation
      // error is corrected with a 1 s smooth blend so there is no snap.
      //
      // Guards enforced here every frame:
      //   • Stale aircraft (seenPos ≥ STALE_EXTRAP_S) hold position — no motion.
      //   • Ground-stopped aircraft (gsMps == 0) hold position — no motion.
      //   • Extrapolation is capped at MAX_EXTRAP_S seconds ahead.
      //   • renderPos.y is always clamped ≥ 0 (never underground).

      for (const [, b] of st.acMap) {
        // HMR guard: stale bundles from a hot-reload may lack the new fields
        if (!b.renderPos || !b.lastKnownPos) continue;

        // Can we extrapolate this aircraft?  Both the freshness and speed guards
        // must pass — extrapolating a silent transponder invents fake motion.
        const canExtrap = b.seenPos < STALE_EXTRAP_S && b.gsMps > 0;

        if (canExtrap) {
          // Time since last known position, capped so we never fly indefinitely
          const dtS    = Math.min((nowMs - b.lastKnownTimeMs) / 1000, MAX_EXTRAP_S);
          const hRad   = b.headingDeg * Math.PI / 180;
          // Forward extrapolation: heading 0=north → -Z, 90=east → +X
          const extrapX = b.lastKnownPos.x + b.gsMps * Math.sin(hRad) * dtS;
          const extrapZ = b.lastKnownPos.z - b.gsMps * Math.cos(hRad) * dtS;
          const extrapY = b.lastKnownPos.y + b.vyPerS * dtS; // altitude

          if (b.corrStartMs >= 0) {
            // ── Correction blend ─────────────────────────────────────────────
            // Smoothly merge from corrFromPos toward the extrapolated truth over
            // CORR_DURATION_MS.  As corrT → 1 the blend converges to the pure
            // extrapolation track with no discontinuity.
            const rawCorrT = Math.min((nowMs - b.corrStartMs) / CORR_DURATION_MS, 1);
            const corrT    = rawCorrT * rawCorrT * (3 - 2 * rawCorrT); // smoothstep
            b.renderPos.set(
              b.corrFromPos.x + (extrapX - b.corrFromPos.x) * corrT,
              b.corrFromPos.y + (extrapY - b.corrFromPos.y) * corrT,
              b.corrFromPos.z + (extrapZ - b.corrFromPos.z) * corrT,
            );
            if (rawCorrT >= 1) b.corrStartMs = -1; // correction complete
          } else {
            // ── Pure extrapolation ────────────────────────────────────────────
            b.renderPos.set(extrapX, extrapY, extrapZ);
          }
        } else {
          // Stale or ground-stopped: hold at last known position.
          // If a correction was in progress (e.g. fresh→stale transition) let it
          // finish blending toward lastKnownPos so there is no snap.
          if (b.corrStartMs >= 0) {
            const rawCorrT = Math.min((nowMs - b.corrStartMs) / CORR_DURATION_MS, 1);
            const corrT    = rawCorrT * rawCorrT * (3 - 2 * rawCorrT);
            b.renderPos.lerpVectors(b.corrFromPos, b.lastKnownPos, corrT);
            if (rawCorrT >= 1) b.corrStartMs = -1;
          } else {
            b.renderPos.copy(b.lastKnownPos);
          }
        }

        // Underground clamp — never let a cone sink below the ground plane
        b.renderPos.y = Math.max(0, b.renderPos.y);

        // Apply renderPos to all visuals
        b.cone.position.copy(b.renderPos);
        b.label.position.set(b.renderPos.x, b.renderPos.y + LABEL_LIFT, b.renderPos.z);

        // Halo: track aircraft + slow Z-rotation pulse
        if (b.halo && b.halo.visible) {
          b.halo.position.set(b.renderPos.x, b.renderPos.y - 40, b.renderPos.z);
          b.halo.rotation.z += 0.008; // slow spin in the horizontal plane
        }

        // Pin ring: cyan orbit ring — counter-rotates at a slightly faster rate
        if (b.pinRing) {
          const acId     = st.coneToId.get(b.cone) ?? '';
          const isPinned = acId !== '' && st.pinnedAcIds.has(acId);
          b.pinRing.visible = isPinned;
          if (isPinned) {
            b.pinRing.position.set(b.renderPos.x, b.renderPos.y - 20, b.renderPos.z);
            b.pinRing.rotation.z -= 0.012; // counter-clockwise spin
          }
        }

        b.stem.geometry.setFromPoints([
          new THREE.Vector3(b.renderPos.x, 0,             b.renderPos.z),
          new THREE.Vector3(b.renderPos.x, b.renderPos.y, b.renderPos.z),
        ]);
        b.stem.geometry.computeBoundingSphere();

        // ── Per-frame trail fade ─────────────────────────────────────────────
        // Every frame: drop points older than TRAIL_FADE_S, then write
        // positions + per-vertex alpha to the GPU so the trail fades from
        // full opacity at the aircraft to transparent at the 20-second mark.
        if (b.trailBuf && b.trailBuf.length > 0) {
          // Expire tail — keep at least 2 so the Line geometry stays valid.
          while (b.trailBuf.length > 2 && nowMs - b.trailBuf[0].t > TRAIL_FADE_MS) {
            b.trailBuf.shift();
          }

          const n        = b.trailBuf.length;
          const posAttr  = b.trail.geometry.attributes.position as THREE.BufferAttribute;
          const alpAttr  = b.trail.geometry.attributes.alpha    as THREE.BufferAttribute;
          // HMR guard: old bundles may not have the alpha attribute yet.
          if (posAttr && alpAttr) {
            const posArr = posAttr.array as Float32Array;
            const alpArr = alpAttr.array as Float32Array;

            for (let i = 0; i < n; i++) {
              const tp = b.trailBuf[i];
              posArr[i * 3]     = tp.pos.x;
              posArr[i * 3 + 1] = tp.pos.y;
              posArr[i * 3 + 2] = tp.pos.z;
              // alpha: TRAIL_OPACITY at newest point → 0 at TRAIL_FADE_S
              const ageFrac = Math.min((nowMs - tp.t) / TRAIL_FADE_MS, 1);
              alpArr[i]     = (1 - ageFrac) * TRAIL_OPACITY;
            }

            // Override the head with the live extrapolated position so the
            // trail follows the aircraft continuously between 8-second polls.
            posArr[(n - 1) * 3]     = b.renderPos.x;
            posArr[(n - 1) * 3 + 1] = b.renderPos.y;
            posArr[(n - 1) * 3 + 2] = b.renderPos.z;
            alpArr[n - 1]            = TRAIL_OPACITY; // head is always full opacity

            posAttr.needsUpdate = true;
            alpAttr.needsUpdate = true;
            b.trail.geometry.setDrawRange(0, n);
            b.trail.geometry.computeBoundingSphere();
          }
        }

        // Label opacity is set per-poll (in the data sync effect) based on seenPos —
        // no per-frame override needed here.

        // ── Velocity vector (Task 33) ──────────────────────────────────────
        // Thin look-ahead line: 90 s of travel at current ground speed.
        // Hidden for at-gate and ground vehicles.
        if (b.velVec) {
          const showVV = st.showPaths && b.phase !== 'at-gate' && !b.isGroundVehicle;
          b.velVec.visible = showVV;
          if (showVV) {
            const hRad = b.headingDeg * Math.PI / 180;
            const dist = b.gsMps * VEL_VEC_LOOKAHEAD_S;
            const vvAttr = b.velVec.geometry.attributes.position as THREE.BufferAttribute;
            const vvArr  = vvAttr.array as Float32Array;
            vvArr[0] = b.renderPos.x;                            vvArr[1] = b.renderPos.y; vvArr[2] = b.renderPos.z;
            vvArr[3] = b.renderPos.x + Math.sin(hRad) * dist;   vvArr[4] = b.renderPos.y; vvArr[5] = b.renderPos.z - Math.cos(hRad) * dist;
            vvAttr.needsUpdate = true;
            b.velVec.geometry.computeBoundingSphere();
          }
        }

        // ── Separation bubble (Task 33) ────────────────────────────────────
        // Very faint sphere (~5 NM radius) centred on airborne aircraft.
        // Overlap detection (colour shift) happens after this loop.
        if (b.sepBubble) {
          const showBbl = st.showPaths && b.isAirborne;
          b.sepBubble.visible = showBbl;
          if (showBbl) b.sepBubble.position.copy(b.renderPos);
        }

        // ── Wake turbulence ribbon (Task 33, Heavy aircraft only) ──────────
        // Amber pair of lines offset perpendicular to heading, using trailBuf
        // positions with a 90-second opacity decay.
        if (b.wakeL && b.wakeR && b.wakeLMat && b.wakeRMat) {
          const showWake = st.showPaths && b.isHeavy;
          b.wakeL.visible = showWake;
          b.wakeR.visible = showWake;
          if (showWake && b.trailBuf.length >= 2) {
            const n = b.trailBuf.length;
            const hRad = b.headingDeg * Math.PI / 180;
            const perpX = Math.cos(hRad) * WAKE_HALF_WIDTH;
            const perpZ = Math.sin(hRad) * WAKE_HALF_WIDTH;

            const posLAttr = b.wakeL.geometry.attributes.position as THREE.BufferAttribute;
            const alpLAttr = b.wakeL.geometry.attributes.alpha    as THREE.BufferAttribute;
            const posRAttr = b.wakeR.geometry.attributes.position as THREE.BufferAttribute;
            const alpRAttr = b.wakeR.geometry.attributes.alpha    as THREE.BufferAttribute;
            const posL = posLAttr.array as Float32Array;
            const alpL = alpLAttr.array as Float32Array;
            const posR = posRAttr.array as Float32Array;
            const alpR = alpRAttr.array as Float32Array;

            for (let i = 0; i < n; i++) {
              const tp = b.trailBuf[i];
              posL[i*3]   = tp.pos.x - perpX; posL[i*3+1] = tp.pos.y; posL[i*3+2] = tp.pos.z - perpZ;
              posR[i*3]   = tp.pos.x + perpX; posR[i*3+1] = tp.pos.y; posR[i*3+2] = tp.pos.z + perpZ;
              const ageFrac = Math.min((nowMs - tp.t) / WAKE_FADE_MS, 1);
              alpL[i] = alpR[i] = (1 - ageFrac) * WAKE_PEAK_OPACITY;
            }
            // Head point tracks live renderPos
            posL[(n-1)*3]   = b.renderPos.x - perpX; posL[(n-1)*3+1] = b.renderPos.y; posL[(n-1)*3+2] = b.renderPos.z - perpZ;
            posR[(n-1)*3]   = b.renderPos.x + perpX; posR[(n-1)*3+1] = b.renderPos.y; posR[(n-1)*3+2] = b.renderPos.z + perpZ;
            alpL[n-1] = alpR[n-1] = WAKE_PEAK_OPACITY;

            posLAttr.needsUpdate = true; alpLAttr.needsUpdate = true;
            posRAttr.needsUpdate = true; alpRAttr.needsUpdate = true;
            b.wakeL.geometry.setDrawRange(0, n); b.wakeL.geometry.computeBoundingSphere();
            b.wakeR.geometry.setDrawRange(0, n); b.wakeR.geometry.computeBoundingSphere();
          }
        }
      }

      // ── Separation bubble overlap detection (Task 33) ────────────────────
      // Check all airborne pairs and tint overlapping bubbles red.
      // O(N²) but N is small — typically 10–30 aircraft.
      if (st.showPaths) {
        for (const [idA, bA] of st.acMap) {
          if (!bA.sepBubble?.visible || !bA.sepBubbleMat) continue;
          let overlaps = false;
          for (const [idB, bB] of st.acMap) {
            if (idB === idA || !bB.isAirborne) continue;
            const dx = bA.renderPos.x - bB.renderPos.x;
            const dy = bA.renderPos.y - bB.renderPos.y;
            const dz = bA.renderPos.z - bB.renderPos.z;
            // Overlap when distance < 2R  →  distance² < 4R²
            if (dx*dx + dy*dy + dz*dz < 4 * SEP_BUBBLE_R_SQ) { overlaps = true; break; }
          }
          bA.sepBubbleMat.color.setHex(overlaps ? 0xff2222 : 0x8899bb);
          bA.sepBubbleMat.opacity = overlaps ? 0.07 : 0.03;
        }
      }

      // ── SID/STAR route ribbon highlighting (Task 34) ─────────────────────
      // Each frame: reset all route lines to their base opacity, then check
      // every airborne aircraft against each segment.  When an aircraft is
      // within ROUTE_PROX_M and its heading aligns with the segment bearing
      // to within ROUTE_HDG_TOL degrees, raise that route's opacity so the
      // active corridor glows noticeably brighter.
      {
        const routeLines = routeLineEntriesRef.current;
        if (routeLines.length > 0 && routeGroupRef.current?.visible) {
          const ROUTE_PROX_M   = 1_500; // metres horizontal threshold
          const ROUTE_HDG_TOL  = 25;    // degrees heading tolerance

          // Reset to base opacity
          for (const rl of routeLines) {
            rl.mat.opacity = rl.baseOpacity;
          }

          // Raise opacity when any airborne aircraft tracks along the route
          for (const [, b] of st.acMap) {
            if (!b.isAirborne) continue;
            const px = b.renderPos.x;
            const pz = b.renderPos.z;

            for (const rl of routeLines) {
              if (rl.mat.opacity > rl.baseOpacity) continue; // already lit
              for (const seg of rl.segments) {
                const dist = distToSegment2D(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
                if (dist > ROUTE_PROX_M) continue;
                const diff = Math.abs(b.headingDeg - seg.bearingDeg);
                const hdgDiff = Math.min(diff, 360 - diff);
                if (hdgDiff <= ROUTE_HDG_TOL) {
                  rl.mat.opacity = 0.50;
                  break;
                }
              }
            }
          }
        }
      }

      // ── Label deconfliction + leader lines ───────────────────────────────
      // Project labels to NDC, run a bounded push-apart, unproject back to
      // world, and draw a leader line when the label was actually displaced.
      //
      // Design decisions:
      //  • Smaller min gap (50 px) — 120 px was pushing labels far off-screen
      //    when many aircraft cluster at the terminal.
      //  • Hard clamp (MAX_DISP_NDC ≈ 80 px) — labels may never move more than
      //    this from their default anchor, so they always stay near their aircraft.
      //    Dense clusters may still overlap but labels won't drift off-screen.
      {
        const canvasH = renderer.domElement.clientHeight || 1;
        const MIN_SEP_NDC  = (50 / canvasH) * 2;   // min gap between label centres
        const MAX_DISP_NDC = (80 / canvasH) * 2;   // max displacement from anchor

        // Collect all bundles + their default-position NDC
        const items: { b: AcBundle; ndc: THREE.Vector3; defY: number }[] = [];
        const _tmp = new THREE.Vector3();
        for (const b of st.acMap.values()) {
          _tmp.set(b.renderPos.x, b.renderPos.y + LABEL_LIFT, b.renderPos.z);
          _tmp.project(camera);
          items.push({ b, ndc: _tmp.clone(), defY: _tmp.y });
        }

        // Sort top → bottom in screen space (NDC Y descending = visually higher)
        items.sort((a, b) => b.ndc.y - a.ndc.y);

        // Iterative push-apart — each pass is followed by a hard clamp so no
        // label can ever drift more than MAX_DISP_NDC from its anchor.
        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i + 1 < items.length; i++) {
            const a = items[i], b = items[i + 1];
            const gap = a.ndc.y - b.ndc.y;
            if (gap < MIN_SEP_NDC) {
              const push = (MIN_SEP_NDC - gap) / 2;
              a.ndc.y += push;
              b.ndc.y -= push;
            }
          }
          // Clamp each label to within MAX_DISP_NDC of its default anchor
          for (const item of items) {
            const delta = item.ndc.y - item.defY;
            if (Math.abs(delta) > MAX_DISP_NDC) {
              item.ndc.y = item.defY + Math.sign(delta) * MAX_DISP_NDC;
            }
          }
        }

        // Apply deconflicted positions; draw leader lines for displaced labels
        const DISPLACE_THRESH = (6 / canvasH) * 2; // treat <6 px as "not moved"
        for (const { b, ndc, defY } of items) {
          const worldPos = ndc.clone().unproject(camera);
          b.label.position.copy(worldPos);

          const displaced = Math.abs(ndc.y - defY) > DISPLACE_THRESH;
          if (b.leaderLine) {
            if (displaced) {
              const posAttr = b.leaderLine.geometry.attributes.position as THREE.BufferAttribute;
              const arr = posAttr.array as Float32Array;
              // from label centre → top of aircraft cone
              arr[0] = worldPos.x; arr[1] = worldPos.y; arr[2] = worldPos.z;
              arr[3] = b.renderPos.x; arr[4] = b.renderPos.y + 60; arr[5] = b.renderPos.z;
              posAttr.needsUpdate = true;
              b.leaderLine.geometry.computeBoundingSphere();
            }
            b.leaderLine.visible = displaced;
          }
        }
      }

      // ── Threat beam update (Phase 6A) ─────────────────────────────────────
      // Each frame: sync beamMap to st.activeAlerts, update line endpoints from
      // live renderPos, and tick the shader time uniform.
      {
        const tSec = nowMs / 1000;

        // Remove beams whose alerts are no longer active
        for (const [alertId, entry] of st.beamMap) {
          if (!st.activeAlerts.find(a => a.id === alertId)) {
            disposeBeamEntry(entry, scene);
            st.beamMap.delete(alertId);
          }
        }

        // Create / update beams for each active separation alert
        for (const alert of st.activeAlerts) {
          if (alert.kind !== 'separation' || alert.aircraftIds.length < 2) continue;
          const [idA, idB] = alert.aircraftIds;
          const bA = st.acMap.get(idA);
          const bB = st.acMap.get(idB);
          if (!bA || !bB) continue;

          const posA = bA.renderPos;
          const posB = bB.renderPos;

          // Create entry on first sight of this alert
          let entry = st.beamMap.get(alert.id);
          if (!entry) {
            entry = createBeamEntry(alert.severity, scene);
            st.beamMap.set(alert.id, entry);
          }

          // Update line geometry endpoints
          const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
          const arr     = posAttr.array as Float32Array;
          arr[0] = posA.x; arr[1] = posA.y; arr[2] = posA.z;
          arr[3] = posB.x; arr[4] = posB.y; arr[5] = posB.z;
          posAttr.needsUpdate = true;
          entry.line.geometry.computeBoundingSphere();

          // Update midpoint sphere position
          entry.midSphere.position.set(
            (posA.x + posB.x) * 0.5,
            (posA.y + posB.y) * 0.5,
            (posA.z + posB.z) * 0.5,
          );

          // Tick shader time uniform
          entry.mat.uniforms.time.value = tSec;

          // Pulse sphere opacity in sync with beam
          const p = BEAM_PARAMS[alert.severity];
          entry.sphereMat.opacity = (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(tSec * p.pulseSpeed)));
        }
      }

      // ── 3D alert label sprites (Task #15) ────────────────────────────────
      // Floating canvas sprites at the 3D midpoint of each active caution/
      // critical alert.  Position updates every frame; texture only when
      // the alert message text changes (~every 8 s with a new ADS-B poll).
      {
        // Remove labels for cleared / dismissed alerts
        for (const [alertId, entry] of st.labelMap) {
          if (!st.activeAlerts.find(a => a.id === alertId)) {
            disposeAlertLabel(entry, scene);
            st.labelMap.delete(alertId);
          }
        }

        for (const alert of st.activeAlerts) {
          if (alert.aircraftIds.length === 0) continue;

          // Anchor label to the beam midpoint sphere so they stay in lockstep.
          // Fall back to averaging renderPos when the beam entry isn't ready yet.
          const beamEntry = st.beamMap.get(alert.id);
          let midX: number, midY: number, midZ: number;
          if (beamEntry) {
            midX = beamEntry.midSphere.position.x;
            midY = beamEntry.midSphere.position.y;
            midZ = beamEntry.midSphere.position.z;
          } else {
            let cnt = 0;
            midX = 0; midY = 0; midZ = 0;
            for (const id of alert.aircraftIds.slice(0, 2)) {
              const b = st.acMap.get(id);
              if (!b) continue;
              midX += b.renderPos.x;
              midY += b.renderPos.y;
              midZ += b.renderPos.z;
              cnt++;
            }
            if (cnt === 0) continue;
            midX /= cnt; midY /= cnt; midZ /= cnt;
          }
          // Float the label just above the sphere (sphere radius = 55 m; 160 m gives
          // ~105 m clearance so it reads cleanly without obscuring the aircraft).
          midY += 160;

          let entry = st.labelMap.get(alert.id);
          if (!entry) {
            const tex    = makeAlertLabelTexture(alert.severity, alert.aircraft.join(' & '), alert.message);
            const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(800, 240, 1);
            sprite.frustumCulled = false;
            sprite.renderOrder   = 999; // always draw on top of ground geometry
            scene.add(sprite);
            entry = { sprite, mat, lastMessage: alert.message };
            st.labelMap.set(alert.id, entry);
          }

          // Update position every frame (cheap — just sets a Vector3)
          entry.sprite.position.set(midX, midY, midZ);

          // Regenerate canvas texture only when message text changes
          if (alert.message !== entry.lastMessage) {
            entry.lastMessage = alert.message;
            const newTex = makeAlertLabelTexture(
              alert.severity, alert.aircraft.join(' & '), alert.message,
            );
            entry.mat.map?.dispose();
            entry.mat.map = newTex;
            entry.mat.needsUpdate = true;
          }
        }
      }

      // ── Pulse ring update (Task #6) ────────────────────────────────────────
      // Expanding concentric rings on the ground plane (y=1) pulsing outward
      // from the ground projection of each active conflict midpoint.
      {
        // Remove ring clusters for cleared alerts
        for (const [alertId, entry] of st.pulseRingMap) {
          if (!st.activeAlerts.find(a => a.id === alertId)) {
            disposePulseRingEntry(entry, scene);
            st.pulseRingMap.delete(alertId);
          }
        }

        for (const alert of st.activeAlerts) {
          if (alert.kind !== 'separation' || alert.aircraftIds.length < 2) continue;
          const [idA, idB] = alert.aircraftIds;
          const bA = st.acMap.get(idA);
          const bB = st.acMap.get(idB);
          if (!bA || !bB) continue;

          // Ground projection: horizontal midpoint of the two aircraft, y=1
          const gx = (bA.renderPos.x + bB.renderPos.x) * 0.5;
          const gz = (bA.renderPos.z + bB.renderPos.z) * 0.5;

          let entry = st.pulseRingMap.get(alert.id);
          if (!entry) {
            entry = { rings: [], lastSpawnMs: -Infinity, severity: alert.severity };
            st.pulseRingMap.set(alert.id, entry);
          }

          const rp = PULSE_RING_PARAMS[alert.severity];

          // Spawn a new ring when the interval has elapsed
          if (nowMs - entry.lastSpawnMs >= rp.spawnIntervalMs) {
            const mat = new THREE.LineBasicMaterial({
              color:       rp.color,
              transparent: true,
              opacity:     rp.peakOpacity,
              depthWrite:  false,
              blending:    THREE.AdditiveBlending,
            });
            const mesh = new THREE.LineLoop(PULSE_RING_GEO, mat);
            mesh.frustumCulled = false;
            mesh.position.set(gx, 1, gz);
            mesh.scale.setScalar(rp.minRadius);
            scene.add(mesh);
            entry.rings.push({ mesh, mat, startMs: nowMs });
            entry.lastSpawnMs = nowMs;
          }

          // Advance all rings: expand + fade; collect expired ones
          const expired: ActiveRing[] = [];
          for (const ring of entry.rings) {
            const age = (nowMs - ring.startMs) / rp.maxAgeMs;
            if (age >= 1) { expired.push(ring); continue; }
            ring.mesh.position.set(gx, 1, gz);
            ring.mesh.scale.setScalar(rp.minRadius + (rp.maxRadius - rp.minRadius) * age);
            ring.mat.opacity = (1 - age) * rp.peakOpacity;
          }

          // Dispose expired rings
          for (const ring of expired) {
            scene.remove(ring.mesh);
            ring.mat.dispose();
            entry.rings.splice(entry.rings.indexOf(ring), 1);
          }
        }
      }

      // ── Takeoff indicator update ──────────────────────────────────────────
      // Runs every frame; simply repositions the line endpoints and the sign
      // to follow the aircraft's interpolated renderPos.
      {
        for (const [acId, entry] of st.takeoffMap) {
          const b = st.acMap.get(acId);
          if (!b) continue;
          const rx = b.renderPos.x, ry = b.renderPos.y, rz = b.renderPos.z;
          const top = ry + TAKEOFF_LINE_HEIGHT;
          const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          arr[0] = rx; arr[1] = ry; arr[2] = rz;
          arr[3] = rx; arr[4] = top; arr[5] = rz;
          posAttr.needsUpdate = true;
          entry.line.geometry.computeBoundingSphere();
          // Position the "TAKING OFF" sign sprite just above the line top
          entry.sign.position.set(rx, top + 80, rz);
          // Queue number label — sits just above the callsign label box
          if (entry.queueLabel.visible) {
            entry.queueLabel.position.set(rx, ry + LABEL_LIFT + 120, rz);
          }
        }
      }

      // ── Approach / landing indicator update ───────────────────────────────
      // Diagonal line forward-and-down along the aircraft's heading, evoking
      // a glide slope descent.
      {
        for (const [acId, entry] of st.approachMap) {
          const b = st.acMap.get(acId);
          if (!b) continue;
          const rx = b.renderPos.x, ry = b.renderPos.y, rz = b.renderPos.z;
          // Forward direction in scene space (heading 0=north=-Z, 90=east=+X)
          const hRad = b.headingDeg * Math.PI / 180;
          const endX = rx + Math.sin(hRad) * APPROACH_LINE_FORWARD;
          const endY = Math.max(0, ry - APPROACH_LINE_DROP);
          const endZ = rz - Math.cos(hRad) * APPROACH_LINE_FORWARD;
          const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          arr[0] = rx;  arr[1] = ry;  arr[2] = rz;
          arr[3] = endX; arr[4] = endY; arr[5] = endZ;
          posAttr.needsUpdate = true;
          entry.line.geometry.computeBoundingSphere();
        }
      }

      // ── Glide slope projected path line (Task #26) ───────────────────────
      // Approach-only: thin line from aircraft renderPos to nearest runway
      // threshold.  Opacity fades from GLIDE_PEAK_OPACITY (far) → 0 (on threshold).
      {
        for (const [acId, entry] of st.glideSlopeMap) {
          const b = st.acMap.get(acId);
          if (!b) continue;

          // Find the nearest threshold to this aircraft's current renderPos,
          // restricted to the active landing direction so the beam targets the
          // correct end (e.g. "19R"/"19L") rather than the opposite threshold.
          let nearestX = 0, nearestZ = 0, nearestDist = Infinity;
          const activeDir = st.activeRunwayDirection;
          const thresholdsForGlide = activeDir
            ? st.allThresholds.filter(([des]) => des.replace(/[LRC]$/, '') === activeDir)
            : st.allThresholds;
          for (const [, tx, tz] of thresholdsForGlide) {
            const dx = tx - b.renderPos.x;
            const dz = tz - b.renderPos.z;
            const d  = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) { nearestDist = d; nearestX = tx; nearestZ = tz; }
          }

          // Opacity: peaks at GLIDE_PEAK_OPACITY when ≥ GLIDE_MAX_DIST away,
          // fades to 0 linearly as the aircraft reaches the threshold.
          const distFrac = Math.min(nearestDist / GLIDE_MAX_DIST, 1);
          entry.lineMat.opacity = distFrac * GLIDE_PEAK_OPACITY;

          // Update line: aircraft renderPos → ground-level threshold position
          const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          arr[0] = b.renderPos.x; arr[1] = b.renderPos.y; arr[2] = b.renderPos.z;
          arr[3] = nearestX;      arr[4] = 0;              arr[5] = nearestZ;
          posAttr.needsUpdate = true;
          entry.line.geometry.computeBoundingSphere();

          // Label — anchored close to the threshold (12% of the way from
          // threshold toward the aircraft) so it appears in the airport context.
          // A small upward offset lifts it just above the glide slope line.
          const T = 0.12; // 0 = threshold, 1 = aircraft
          const labelX = nearestX + (b.renderPos.x - nearestX) * T;
          const labelY = b.renderPos.y * T + 220; // slight lift above line
          const labelZ = nearestZ + (b.renderPos.z - nearestZ) * T;
          entry.label.position.set(labelX, labelY, labelZ);
          entry.label.material.opacity = distFrac * GLIDE_PEAK_OPACITY;

          // Glide angle: atan(alt_metres / horiz_metres)
          const altMetres = (b.renderPos.y / ALT_SCALE) * 0.3048;
          const angleDeg  = nearestDist > 10
            ? Math.atan2(altMetres, nearestDist) * (180 / Math.PI)
            : 0;

          // ETA to threshold — gsMps is horizontal ground speed in m/s
          const etaSec = b.gsMps > 1 ? nearestDist / b.gsMps : 0;
          // Key on callsign + angle (1 dp) + ETA rounded to nearest 1 s so the
          // canvas texture repaints each second, giving a smooth countdown.
          const etaBucket = Math.round(etaSec);
          const labelKey  = `${b.callsign}|${angleDeg.toFixed(1)}|${etaBucket}`;
          if (entry.labelKey !== labelKey) {
            entry.labelKey = labelKey;
            refreshGlideSlopeLabel(entry, b.callsign, angleDeg, etaSec);
          }
        }
      }

      // ── Taxi time ring update (Task 33) ──────────────────────────────────
      // Expanding ground-plane rings for taxiing aircraft; colour based on
      // how long the aircraft has been in taxi phase.
      {
        for (const [acId, entry] of st.taxiRingMap) {
          const b = st.acMap.get(acId);
          if (!b) continue;
          const gx = b.renderPos.x, gz = b.renderPos.z;

          // Colour transitions with taxi dwell time
          const taxiDurMin = (nowMs - entry.taxiStartMs) / 60_000;
          const ringColor  = taxiDurMin < 2 ? 0xffffff
                           : taxiDurMin < 5 ? 0xf59e0b
                           : 0xef4444;

          // Spawn a new ring when interval has elapsed (only when paths visible)
          if (st.showPaths && nowMs - entry.lastSpawnMs >= TAXI_RING_SPAWN_MS) {
            const mat = new THREE.LineBasicMaterial({
              color:       ringColor,
              transparent: true,
              opacity:     0.55,
              depthWrite:  false,
            });
            const mesh = new THREE.LineLoop(PULSE_RING_GEO, mat);
            mesh.frustumCulled = false;
            mesh.position.set(gx, 1, gz);
            mesh.scale.setScalar(TAXI_RING_MIN_R);
            scene.add(mesh);
            entry.rings.push({ mesh, mat, spawnMs: nowMs });
            entry.lastSpawnMs = nowMs;
          }

          // Advance all rings: expand + fade; collect expired ones
          const expired: typeof entry.rings = [];
          for (const ring of entry.rings) {
            const age = (nowMs - ring.spawnMs) / TAXI_RING_MAX_AGE;
            if (age >= 1) { expired.push(ring); continue; }
            ring.mesh.visible = st.showPaths;
            if (st.showPaths) {
              ring.mesh.position.set(gx, 1, gz);
              ring.mesh.scale.setScalar(TAXI_RING_MIN_R + (TAXI_RING_MAX_R - TAXI_RING_MIN_R) * age);
              ring.mat.opacity = (1 - age) * 0.55;
              ring.mat.color.setHex(ringColor);
            }
          }
          // Dispose expired rings
          for (const ring of expired) {
            scene.remove(ring.mesh);
            ring.mat.dispose();
            entry.rings.splice(entry.rings.indexOf(ring), 1);
          }
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    // ── Resize observer ──────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    // ── Pointer events ───────────────────────────────────────────────────────
    const canvas = renderer.domElement;

    // ── Scroll wheel — zoom camera in/out ───────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.92 : 1.09; // up = zoom in
      const MIN_R = 500, MAX_R = 20000;
      st.orbitRadius = Math.min(Math.max(st.orbitRadius * factor, MIN_R), MAX_R);
      // Recompute camera from orbit params (works in orbit and manual modes)
      if (st.cameraMode === 'orbit' || st.cameraMode === 'manual') {
        camera.position.set(
          st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle),
          st.orbitElevation,
          st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle),
        );
        camera.lookAt(st.orbitTarget);

        // Scrolling while in manual counts as user activity — reset idle timer
        // so the camera doesn't snap back to orbit mid-zoom.
        if (st.cameraMode === 'manual') {
          if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
          st.panResumeTimer = setTimeout(() => {
            if (st.cameraMode !== 'manual') { st.panResumeTimer = null; return; }
            st.panResumeTimer = null;
            st.angle = Math.atan2(
              camera.position.z - st.orbitTarget.z,
              camera.position.x - st.orbitTarget.x,
            );
            const tx = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
            const tz = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
            st.flyFrom.copy(camera.position);
            st.flyTo.set(tx, st.orbitElevation, tz);
            st.flyLookFrom.copy(st.orbitTarget);
            st.flyLookTo.copy(st.orbitTarget);
            st.flyProgress = 0;
            st.cameraMode  = 'returning';
            camModeRef.current('orbit');
            console.log('[3D CAM] scroll idle 10 s → returning (smooth fly-back to orbit)');
          }, 10_000);
        }
      } else {
        // inspect / follow — dolly along view axis
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, (e.deltaY < 0 ? 1 : -1) * st.orbitRadius * 0.08);
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ── Context menu — suppress right-click browser menu ────────────────────
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);

    // ── Pointer events ───────────────────────────────────────────────────────
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right button — start pan drag
        st.rightDragActive = true;
        st.rightDragLastX  = e.clientX;
        st.rightDragLastY  = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) {
        // Left button — start arc-rotate + record origin for click detection
        st.leftDragActive = true;
        st.leftDragLastX  = e.clientX;
        st.leftDragLastY  = e.clientY;
        st.mouseDownX     = e.clientX;
        st.mouseDownY     = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      }
    };

    // ── Left-drag: arc-rotate around orbit target  ───────────────────────────
    // ── Right-drag: pan orbit target + camera laterally ─────────────────────
    const onPointerMove = (e: PointerEvent) => {
      if (st.leftDragActive) {
        const dx = e.clientX - st.leftDragLastX;
        const dy = e.clientY - st.leftDragLastY;
        st.leftDragLastX = e.clientX;
        st.leftDragLastY = e.clientY;

        // Horizontal mouse → rotate azimuth; vertical → tilt elevation
        st.angle         -= dx * 0.005;                                    // rad/px
        st.orbitElevation = Math.min(Math.max(st.orbitElevation + dy * 3, 200), 8000);

        camera.position.set(
          st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle),
          st.orbitElevation,
          st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle),
        );
        camera.lookAt(st.orbitTarget);

        // Pause auto-orbit while user is rotating manually
        if (st.cameraMode === 'orbit') {
          st.cameraMode = 'manual';
          camModeRef.current('manual');
          console.log('[3D CAM] left-drag → manual (resumes after 10 s idle)');
        }

        // Reset idle-return timer on EVERY drag frame, not just the first mode
        // switch.  Without this the timer fires 30 s after the INITIAL drag that
        // switched to manual, even if the user has been rotating continuously.
        if (st.cameraMode === 'manual') {
          if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
          st.panResumeTimer = setTimeout(() => {
            if (st.cameraMode !== 'manual') { st.panResumeTimer = null; return; }
            st.panResumeTimer = null;
            st.angle = Math.atan2(
              camera.position.z - st.orbitTarget.z,
              camera.position.x - st.orbitTarget.x,
            );
            const tx = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
            const tz = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
            st.flyFrom.copy(camera.position);
            st.flyTo.set(tx, st.orbitElevation, tz);
            st.flyLookFrom.copy(st.orbitTarget);
            st.flyLookTo.copy(st.orbitTarget);
            st.flyProgress = 0;
            st.cameraMode  = 'returning';
            camModeRef.current('orbit');
            console.log('[3D CAM] left-drag idle 10 s → returning (smooth fly-back to orbit)');
          }, 10_000);
        }
        return;
      }

      if (!st.rightDragActive) return;

      // ── Right-drag pan ──────────────────────────────────────────────────────
      const dx = e.clientX - st.rightDragLastX;
      const dy = e.clientY - st.rightDragLastY;
      st.rightDragLastX = e.clientX;
      st.rightDragLastY = e.clientY;

      const dir    = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const right  = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up     = new THREE.Vector3().crossVectors(right, dir).normalize();
      const panScale = st.orbitRadius * 0.001;

      const panVec = right.clone().multiplyScalar(-dx * panScale)
                          .addScaledVector(up, dy * panScale);
      camera.position.add(panVec);
      st.orbitTarget.add(panVec);

      // Pause auto-orbit during pan
      if (st.cameraMode === 'orbit') {
        st.cameraMode = 'manual';
        camModeRef.current('manual');
        console.log('[3D CAM] right-drag pan → manual (resumes after 10 s idle)');
      }

      // Reset 10 s idle timer — on expiry, re-sync angle and resume orbit
      if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
      st.panResumeTimer = setTimeout(() => {
        if (st.cameraMode !== 'manual') { st.panResumeTimer = null; return; }
        st.panResumeTimer = null;
        // Re-sync angle from current position, then fly smoothly back.
        st.angle = Math.atan2(
          camera.position.z - st.orbitTarget.z,
          camera.position.x - st.orbitTarget.x,
        );
        const tx = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
        const tz = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
        st.flyFrom.copy(camera.position);
        st.flyTo.set(tx, st.orbitElevation, tz);
        st.flyLookFrom.copy(st.orbitTarget);
        st.flyLookTo.copy(st.orbitTarget);
        st.flyProgress = 0;
        st.cameraMode  = 'returning';
        camModeRef.current('orbit');
        console.log('[3D CAM] pan idle 10 s → returning (smooth fly-back to orbit)');
      }, 10_000);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        st.rightDragActive = false;
        return;
      }
      if (e.button !== 0) return;

      st.leftDragActive = false;

      const dx   = e.clientX - st.mouseDownX;
      const dy   = e.clientY - st.mouseDownY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // If the pointer moved more than 6 px it was a rotate drag — don't raycast
      if (dist > 6) return;

      // Short tap — raycast against aircraft cones
      const rect = canvas.getBoundingClientRect();
      const mx   = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const my   = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
      const hits = raycaster.intersectObjects([...st.coneToId.keys()]);

      if (!hits.length) return; // tapped empty space

      const hitMesh = hits[0].object as THREE.Mesh;
      const acId    = st.coneToId.get(hitMesh);
      if (!acId) return;

      const now = Date.now();
      if (acId === st.lastClickAcId && now - st.lastClickTime < 400) {
        // Double-click — follow mode
        st.cameraMode = 'follow';
        camModeRef.current('follow');
        console.log(`[3D CAM] dblclick ${acId} → follow`);
      } else {
        // Single click — fly to aircraft, open panel
        startFlyTo(st, acId);
        selectRef.current(acId);
        camModeRef.current('inspect');
        console.log(`[3D CAM] click ${acId} → inspect (fly-to progress=0)`);
      }
      st.lastClickAcId = acId;
      st.lastClickTime = now;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup',   onPointerUp);

    // ── Keyboard handler: O = snap to orbit, Esc = back-out chain ───────────
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // O — direct jump to auto-orbit from any state, clears selection
      if (e.key.toUpperCase() === 'O') {
        const prev = st.cameraMode;
        st.cameraMode   = 'orbit';
        st.selectedAcId = null;
        st.flyProgress  = 1;
        selectRef.current(null);
        camModeRef.current('orbit');
        console.log(`[3D CAM] O: ${prev} → orbit  [snap; selection cleared]`);
        return;
      }

      if (e.key !== 'Escape') return;

      const prev = st.cameraMode;

      // Director: Esc during aircraft-hold drops back to orbit.
      if (st.directorMode && (st.dir.phase === 'hold_ac' || st.dir.phase === 'fly_ac')) {
        st.dir.phase = 'orbit';
        st.dir.acId  = null;
        console.log('[3D CAM] Esc: director → orbit');
        return;
      }

      if (prev === 'follow') {
        st.cameraMode = 'inspect';
        st.flyProgress = 1; // already at target; stay put
        camModeRef.current('inspect');
        console.log(`[3D CAM] Esc: follow → inspect  [panel stays, camera holds]`);

      } else if (prev === 'inspect') {
        // Close panel and smoothly fly back to the default overview.
        st.selectedAcId = null;
        selectRef.current(null);
        const cam = st.camera;
        const tx  = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
        const tz  = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
        st.flyFrom.copy(cam.position);
        st.flyTo.set(tx, st.orbitElevation, tz);
        st.flyLookFrom.copy(st.orbitTarget);
        st.flyLookTo.copy(st.orbitTarget);
        st.flyProgress = 0;
        st.cameraMode  = 'returning';
        camModeRef.current('orbit');
        console.log(`[3D CAM] Esc: inspect → returning (smooth fly-back, panel closed)`);

      } else if (prev === 'manual') {
        // Smooth fly-back instead of a position snap.
        const cam = st.camera;
        const tx  = st.orbitTarget.x + st.orbitRadius * Math.cos(st.angle);
        const tz  = st.orbitTarget.z + st.orbitRadius * Math.sin(st.angle);
        st.flyFrom.copy(cam.position);
        st.flyTo.set(tx, st.orbitElevation, tz);
        st.flyLookFrom.copy(st.orbitTarget);
        st.flyLookTo.copy(st.orbitTarget);
        st.flyProgress = 0;
        st.cameraMode  = 'returning';
        camModeRef.current('orbit');
        console.log(`[3D CAM] Esc: manual → returning (smooth fly-back to orbit)`);

      } else {
        // Already in orbit — nothing to unwind
        console.log(`[3D CAM] Esc: orbit → orbit  [no-op]`);
      }
    };
    window.addEventListener('keydown', onKey);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      ro.disconnect();
      cancelAnimationFrame(st.animId);
      // Fire the alert-done callback on unmount so App clears alertFocusId.
      if (st.alertFocusId) {
        const done = st.alertFocusDone;
        st.alertFocusDone = null;
        st.alertFocusId   = null;
        done?.();
      }
      if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
      canvas.removeEventListener('wheel',        onWheel);
      canvas.removeEventListener('contextmenu',  onContextMenu);
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      window.removeEventListener('keydown', onKey);
      st.acMap.forEach(b => {
        scene.remove(b.cone, b.stem, b.trail, b.label);
        if (b.halo)      scene.remove(b.halo);
        if (b.pinRing)   scene.remove(b.pinRing);
        if (b.velVec)    scene.remove(b.velVec);
        if (b.sepBubble) scene.remove(b.sepBubble);
        if (b.wakeL)     scene.remove(b.wakeL);
        if (b.wakeR)     scene.remove(b.wakeR);
        disposeBundle(b);
      });
      st.acMap.clear();
      st.coneToId.clear();
      st.beamMap.forEach(entry => disposeBeamEntry(entry, scene));
      st.beamMap.clear();
      st.pulseRingMap.forEach(entry => disposePulseRingEntry(entry, scene));
      st.pulseRingMap.clear();
      st.labelMap.forEach(entry => disposeAlertLabel(entry, scene));
      st.labelMap.clear();
      st.takeoffMap.forEach(entry => disposeTakeoffIndicator(entry, scene));
      st.takeoffMap.clear();
      st.approachMap.forEach(entry => disposeApproachIndicator(entry, scene));
      st.approachMap.clear();
      st.glideSlopeMap.forEach(entry => disposeGlideSlopeLine(entry, scene));
      st.glideSlopeMap.clear();
      st.taxiRingMap.forEach(entry => disposeTaxiRingEntry(entry, scene));
      st.taxiRingMap.clear();
      // Dispose SID/STAR route ribbons
      if (routeGroupRef.current) {
        for (const rl of routeLineEntriesRef.current) {
          rl.line.geometry.dispose();
          rl.mat.dispose();
        }
        routeLineEntriesRef.current = [];
        scene.remove(routeGroupRef.current);
        routeGroupRef.current = null;
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync airport profile → rebuild SID/STAR route ribbons ────────────────────
  // Runs on mount (after scene setup, which has [] deps and runs first) and
  // whenever the active airport ICAO changes (e.g. YBBN ↔ YSSY switch).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    // Dispose the previous airport's route group
    if (routeGroupRef.current) {
      for (const rl of routeLineEntriesRef.current) {
        rl.line.geometry.dispose();
        rl.mat.dispose();
      }
      routeLineEntriesRef.current = [];
      st.scene.remove(routeGroupRef.current);
      routeGroupRef.current = null;
    }

    // Build ribbons for the new airport
    const { group, lines } = buildRouteGroup(ROUTES, profile.icao);
    group.visible = false; // hidden by default; [P] key shows them via showPaths
    st.scene.add(group);
    routeGroupRef.current      = group;
    routeLineEntriesRef.current = lines;
  }, [profile.icao]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aircraft data sync — runs on every snapshot tick (10 Hz) ────────────────
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const { scene, acMap, coneToId } = st;

    // Measure the actual wall-clock interval between this poll and the previous one.
    // This is the duration each aircraft will use to span its interpolation segment.
    const nowMs = performance.now();
    if (st.lastPollMs > 0) {
      st.pollDurationMs = nowMs - st.lastPollMs;
    }
    st.lastPollMs = nowMs;

    // Keep latestAircraftMap current for camera tracking
    st.latestAircraftMap.clear();
    for (const ac of aircraft) st.latestAircraftMap.set(ac.id, ac);

    const seen = new Set<string>();

    for (const ac of aircraft) {
      seen.add(ac.id);
      const pos        = toV3(ac.position.x, ac.position.y, ac.position.alt);
      const hex        = phaseHex(ac.phase);
      const headY      = -(ac.heading * Math.PI) / 180;
      const isSelected = ac.id === st.selectedAcId;

      if (!acMap.has(ac.id) && !st.spawnQueueIds.has(ac.id)) {
        // ── Queue deferred spawn ────────────────────────────────────────────
        // Three.js object creation runs in the rAF drain (≤ SPAWN_PER_FRAME/frame)
        // so a large first-load batch never synchronously blocks the main thread.
        st.spawnQueue.push(ac.id);
        st.spawnQueueIds.add(ac.id);
      } else if (acMap.has(ac.id)) {
        // ── Update ────────────────────────────────────────────────────────

        const b  = acMap.get(ac.id)!;
        const cm = b.cone.material as THREE.MeshLambertMaterial;

        // ── Velocity state update ─────────────────────────────────────────
        //
        // Determine whether this aircraft can be extrapolated after this poll.
        const nowCanExtrap    = (ac.seenPos ?? 0) < STALE_EXTRAP_S && ac.groundSpeed >= GS_EXTRAP_MIN_KT;
        const wasExtrapolating = b.gsMps > 0;

        // Start a correction blend on every poll for extrapolatable aircraft.
        // Fix 1 (age-compensation below) means this correction is near-zero for
        // straight-and-level flight; it absorbs heading/speed changes cleanly.
        if (nowCanExtrap) {
          b.corrFromPos.copy(b.renderPos);
          b.corrStartMs = nowMs;
        } else if (wasExtrapolating && !nowCanExtrap) {
          // Aircraft went stale or stopped: blend back to raw lastKnownPos.
          b.corrFromPos.copy(b.renderPos);
          b.corrStartMs = nowMs;
        }

        // Update velocity fields first — vyPerS is needed for age-compensation.
        b.headingDeg = ac.heading;
        b.gsMps      = nowCanExtrap ? ac.groundSpeed * KT_TO_MPS : 0;
        b.vyPerS     = ((ac.verticalRate ?? 0) / 60) * ALT_SCALE;
        b.seenPos    = ac.seenPos ?? 0;

        // ── Fix 1: age-compensate the incoming position ───────────────────
        // The transponder fix is seen_pos seconds old.  Project it forward
        // along heading/speed so lastKnownPos represents NOW, not the past.
        // This eliminates the backwards snap: extrap restarts from the present
        // position (dt≈0) rather than from a stale fix seen_pos seconds behind.
        // Stale/stopped aircraft use the raw position — they are held + greyed
        // and we must not invent motion for silent transponders.
        if (nowCanExtrap) {
          const ageS = ac.seenPos ?? 0;
          const hRad = ac.heading * Math.PI / 180;
          b.lastKnownPos.set(
            pos.x + b.gsMps * Math.sin(hRad) * ageS,
            Math.max(0, pos.y + b.vyPerS * ageS),
            pos.z - b.gsMps * Math.cos(hRad) * ageS,
          );
        } else {
          b.lastKnownPos.copy(pos);
        }
        b.lastKnownTimeMs = nowMs; // correct: compensated pos IS the now-position

        // Heading snaps immediately (no perceptible jerk at these speeds)
        b.cone.rotation.y = headY;

        // ── Refresh combined label when phase or heading drifts > 5° ─────────
        {
          const hdgDrift = Math.abs(((ac.heading - b.labelHeadingDeg) + 180 + 360) % 360 - 180);
          if (ac.phase !== b.labelPhase || hdgDrift > 5) {
            refreshAcLabel(b, b.callsign, ac.heading, ac.phase);
          }
        }

        // ── Task 33: Update cached aircraft properties ─────────────────────
        b.phase           = ac.phase;
        b.isGroundVehicle = ac.isGroundVehicle ?? false;
        b.isHeavy         = wakeCategory(ac.type) === 'H';
        b.isAirborne      = isAirborne(ac);
        // Sync velVec colour when phase changes
        if (b.velVecMat) b.velVecMat.color.setHex(phaseHex(ac.phase));

        // ── FIX B: visual stale-track indicator ───────────────────────────
        // SAFETY SIGNAL: aircraft with seen_pos > STALE_DISPLAY_S are shown
        // dimmed so the controller can distinguish a live track from one whose
        // position may be significantly behind the aircraft's true location.
        const isStale = (ac.seenPos ?? 0) > STALE_DISPLAY_S;

        // ── Cone colour — never yellow; selection shown via halo ring ─────────
        if (isStale) {
          cm.color.setHex(0x64748B);
          cm.emissive.setHex(0x334155);
          cm.emissiveIntensity = 0.05;
          (b.label.material as THREE.SpriteMaterial).opacity = 0.35;
        } else {
          cm.color.setHex(hex);
          cm.emissive.setHex(hex);
          cm.emissiveIntensity = isSelected ? 0.55 : 0.30;
          (b.label.material as THREE.SpriteMaterial).opacity = 1.0;
        }

        // ── Purple halo ring — visible only when director-selected ────────────
        if (b.halo) b.halo.visible = isSelected;

        // ── Alert colour override — overrides phase colour for alerted aircraft ─
        // Applied AFTER the stale/phase logic so alerts are always visible.
        const alertSev = st.alertedIds.get(ac.id);
        if (alertSev && !isStale) {
          const alertHex = alertSev === 'critical' ? 0xef4444
                         : alertSev === 'caution'  ? 0xf59e0b : 0xfbbf24;
          cm.color.setHex(alertHex);
          cm.emissive.setHex(alertHex);
          cm.emissiveIntensity = 0.80;
        }

        // ── FIX A: trail sanity cap ────────────────────────────────────────
        // Drop a trail point that is physically further from the last point
        // than the aircraft could have travelled in one poll interval.
        // This kills starburst from seen_pos oscillation (fresh/stale position
        // alternation) without hiding genuine motion of fast-moving aircraft.
        //
        // Extension — stopped-aircraft trail wipe:
        // If the aircraft is stopped (b.gsMps === 0, set above from nowCanExtrap)
        // and the new position exceeds the cap, the jump is due to GPS scatter or
        // a moving→stopped phase transition (e.g. landing → taxi → at-gate).
        // In that case clear the entire buffer instead of just skipping the point.
        // Without this, old taxi/runway trail points live for up to TRAIL_FADE_S
        // seconds after the aircraft parks and render as a long diagonal green line
        // from the runway exit area to the gate — the screenshot bug.
        const gsMps        = ac.groundSpeed * KT_TO_MPS;
        const maxTrailJump = gsMps * (st.pollDurationMs / 1000) * TRAIL_SLACK + TRAIL_GPS_M;
        const lastTp       = b.trailBuf[b.trailBuf.length - 1].pos;
        if (pos.distanceTo(lastTp) <= maxTrailJump) {
          b.trailBuf.push({ pos: pos.clone(), t: nowMs });
          if (b.trailBuf.length > TRAIL_MAX) b.trailBuf.shift();
        } else if (b.gsMps === 0) {
          // Stopped aircraft: position jumped beyond cap (GPS scatter, or
          // transition from a moving phase).  Wipe old trail, restart fresh.
          b.trailBuf.length = 0;
          b.trailBuf.push(
            { pos: pos.clone(), t: nowMs },
            { pos: pos.clone(), t: nowMs },
          );
        }

        // GPU trail writes (positions + alphas) happen every frame in the rAF
        // loop so the fade is continuous.  Here we only update the colour.
        // HMR guard: old bundles still have LineBasicMaterial without .uniforms.
        const trailMat = b.trail.material as THREE.ShaderMaterial;
        if (trailMat.uniforms) {
          trailMat.uniforms.color.value.setHex(isStale ? 0x64748B : hex);
        }
      }
    }

    // ── Sync takeoff indicators ───────────────────────────────────────────────
    // Show for: explicit 'takeoff' phase (airborne climb), runway roll (high gs
    // on ground), or holding at a runway threshold (slow/stopped near threshold).
    const TAKEOFF_ROLL_GS_KT     = 28;  // knots — runway roll vs normal taxi
    const TAKEOFF_THRESHOLD_M2   = 220 * 220; // 220 m proximity to any threshold
    for (const ac of aircraft) {
      const onGround = (ac.position.alt ?? 0) < 50;
      const notVehicle = !ac.isGroundVehicle;
      const isRolling = onGround && notVehicle && ac.groundSpeed >= TAKEOFF_ROLL_GS_KT;
      const isHoldingThreshold = onGround && notVehicle && !isRolling &&
        st.allThresholds.some(([, tx, tz]) => {
          const dx = ac.position.x - tx;
          const dz = ac.position.y - tz; // adapter y → Three.js Z axis
          return dx * dx + dz * dz <= TAKEOFF_THRESHOLD_M2;
        });

      if (ac.phase === 'takeoff' || isRolling || isHoldingThreshold) {
        if (!st.takeoffMap.has(ac.id)) {
          st.takeoffMap.set(ac.id, createTakeoffIndicator(scene));
        }
      } else {
        const entry = st.takeoffMap.get(ac.id);
        if (entry) {
          disposeTakeoffIndicator(entry, scene);
          st.takeoffMap.delete(ac.id);
        }
      }
    }

    // ── Assign takeoff queue order ────────────────────────────────────────────
    // Holding aircraft (slow/stopped at threshold) get a "#N" label above their
    // callsign box.  Sort by distance to nearest threshold — closest = #1.
    // Rolling and airborne aircraft have their queue label hidden.
    {
      const holding: Array<{ id: string; dist: number }> = [];
      for (const ac of aircraft) {
        if (!st.takeoffMap.has(ac.id)) continue;
        const onGround   = (ac.position.alt ?? 0) < 50;
        const notVehicle = !ac.isGroundVehicle;
        const isRolling  = onGround && notVehicle && ac.groundSpeed >= TAKEOFF_ROLL_GS_KT;
        if (isRolling || !onGround || !notVehicle) continue; // only holding aircraft
        let minDist = Infinity;
        for (const [, tx, tz] of st.allThresholds) {
          const dx = ac.position.x - tx;
          const dz = ac.position.y - tz;
          const d  = Math.sqrt(dx * dx + dz * dz);
          if (d < minDist) minDist = d;
        }
        holding.push({ id: ac.id, dist: minDist });
      }
      holding.sort((a, b) => a.dist - b.dist);

      // Update queue positions — repaint label canvas only when position changes.
      const holdingSet = new Set(holding.map(h => h.id));
      for (let i = 0; i < holding.length; i++) {
        const entry = st.takeoffMap.get(holding[i].id)!;
        const newPos = i + 1;
        if (entry.queuePos !== newPos) repaintQueueLabel(entry, newPos);
        entry.queueLabel.visible = true;
      }
      for (const [id, entry] of st.takeoffMap) {
        if (!holdingSet.has(id) && entry.queueLabel.visible) {
          entry.queueLabel.visible = false;
          entry.queuePos = 0;
        }
      }
    }

    // ── Sync approach / landing indicators ────────────────────────────────────
    // Create an indicator when phase enters 'approach' or 'landing'; dispose
    // and recreate when phase transitions between the two (sign text/colour
    // differs); dispose the moment the phase leaves both inbound phases.
    for (const ac of aircraft) {
      if (ac.phase === 'approach' || ac.phase === 'landing') {
        const existing = st.approachMap.get(ac.id);
        if (existing && existing.phase !== ac.phase) {
          // Phase flipped between approach ↔ landing — recreate for correct sign.
          disposeApproachIndicator(existing, scene);
          st.approachMap.delete(ac.id);
        }
        if (!st.approachMap.has(ac.id)) {
          st.approachMap.set(ac.id, createApproachIndicator(scene, ac.phase));
        }
      } else {
        const entry = st.approachMap.get(ac.id);
        if (entry) {
          disposeApproachIndicator(entry, scene);
          st.approachMap.delete(ac.id);
        }
      }
    }

    // ── Sync glide slope projected path lines ────────────────────────────────
    // Only the SINGLE approach-phase aircraft nearest to any runway threshold
    // gets a line.  This prevents a fan of crossing lines when multiple aircraft
    // are on long finals simultaneously.  The line switches automatically to the
    // next closest inbound once the current aircraft transitions to 'landing'.
    {
      // Find the closest approach aircraft to any active-direction threshold.
      // Pre-filter to the active landing direction so an aircraft on long final
      // to runway 19 is not erroneously matched to the nearer 01 threshold.
      const activeDirSync = weather?.activeRunwayDirection ?? null;
      const thresholdsForSync = activeDirSync
        ? st.allThresholds.filter(([des]) => des.replace(/[LRC]$/, '') === activeDirSync)
        : st.allThresholds;

      let closestId: string | null = null;
      let closestDist = Infinity;
      for (const ac of aircraft) {
        if (ac.phase !== 'approach') continue;
        const b = acMap.get(ac.id);
        if (!b) continue;
        for (const [, tx, tz] of thresholdsForSync) {
          const dx = tx - b.renderPos.x;
          const dz = tz - b.renderPos.z;
          const d  = Math.sqrt(dx * dx + dz * dz);
          if (d < closestDist) { closestDist = d; closestId = ac.id; }
        }
      }

      // Create line for winner, dispose lines for everyone else
      for (const ac of aircraft) {
        if (ac.id === closestId) {
          if (!st.glideSlopeMap.has(ac.id)) {
            st.glideSlopeMap.set(ac.id, createGlideSlopeLine(scene));
          }
        } else {
          const entry = st.glideSlopeMap.get(ac.id);
          if (entry) {
            disposeGlideSlopeLine(entry, scene);
            st.glideSlopeMap.delete(ac.id);
          }
        }
      }
    }

    // ── Sync taxi time rings (Task 33) ───────────────────────────────────────
    for (const ac of aircraft) {
      const isTaxiing = (ac.phase === 'taxi-in' || ac.phase === 'taxi-out') && !ac.isGroundVehicle;
      if (isTaxiing) {
        if (!st.taxiRingMap.has(ac.id)) {
          st.taxiRingMap.set(ac.id, {
            rings: [], lastSpawnMs: -Infinity, taxiStartMs: nowMs,
          });
        }
      } else {
        const entry = st.taxiRingMap.get(ac.id);
        if (entry) { disposeTaxiRingEntry(entry, scene); st.taxiRingMap.delete(ac.id); }
      }
    }

    // Remove aircraft that left the snapshot
    for (const [id, b] of acMap) {
      if (!seen.has(id)) {
        scene.remove(b.cone, b.stem, b.trail, b.label, b.halo);
        if (b.pinRing)   scene.remove(b.pinRing);
        if (b.velVec)    scene.remove(b.velVec);
        if (b.sepBubble) scene.remove(b.sepBubble);
        if (b.wakeL)     scene.remove(b.wakeL);
        if (b.wakeR)     scene.remove(b.wakeR);
        coneToId.delete(b.cone);
        disposeBundle(b);
        acMap.delete(id);
        // Clean up any takeoff indicator for the despawned aircraft
        const ti = st.takeoffMap.get(id);
        if (ti) { disposeTakeoffIndicator(ti, scene); st.takeoffMap.delete(id); }
        // Clean up any approach/landing indicator for the despawned aircraft
        const ai = st.approachMap.get(id);
        if (ai) { disposeApproachIndicator(ai, scene); st.approachMap.delete(id); }
        // Clean up any glide slope line for the despawned aircraft
        const gs = st.glideSlopeMap.get(id);
        if (gs) { disposeGlideSlopeLine(gs, scene); st.glideSlopeMap.delete(id); }
        // Clean up any taxi ring for the despawned aircraft (Task 33)
        const tr = st.taxiRingMap.get(id);
        if (tr) { disposeTaxiRingEntry(tr, scene); st.taxiRingMap.delete(id); }
      }
    }
  }, [aircraft]);

  // ── Render ────────────────────────────────────────────────────────────────
  const airborneCount = aircraft.filter(isAirborne).length;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07090F]">

      {/* Three.js canvas mount */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* ── HUD top-left ── */}
      <div className="absolute top-4 left-4 flex flex-col gap-0.5 pointer-events-none select-none">
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-600">3D · AIRSPACE</span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-700">
          {airborneCount} AIRBORNE &nbsp;·&nbsp; {aircraft.length - airborneCount} GROUND
        </span>
        <span className="font-mono text-[10px] tracking-[0.25em] text-slate-800 mt-1">
          {cameraMode.toUpperCase()}
        </span>
      </div>

      {/* ── FL altitude labels — top-right ── */}
      <div className="absolute top-4 right-4 flex flex-col gap-1 pointer-events-none select-none text-right">
        {[150, 100, 50].map(fl => (
          <span key={fl} className="font-mono text-[10px] tracking-wider text-slate-700">
            FL{fl.toString().padStart(3, '0')}
          </span>
        ))}
        <span className="font-mono text-[10px] tracking-wider text-slate-800 mt-1">GND</span>
      </div>

      {/* ── Phase legend — bottom-center horizontal ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-row items-center gap-4 pointer-events-none select-none">
        {([
          ['#38BDF8', 'APPROACH / ARRIVAL'],
          ['#F59E0B', 'TAXI IN'],
          ['#4ADE80', 'AT GATE'],
          ['#FB923C', 'TAXI OUT'],
          ['#818CF8', 'TAKEOFF'],
          ['#C084FC', 'DEPARTURE'],
        ] as const).map(([col, lbl]) => (
          <div key={lbl} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col }} />
            <span className="font-mono text-[9px] tracking-wider text-slate-700">{lbl}</span>
          </div>
        ))}
      </div>

      {/* ── Key hints — bottom-right ── */}
      <div className="absolute bottom-4 right-4 pointer-events-none select-none flex flex-col items-end gap-0.5">
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[CLICK] INSPECT</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[DBLCLICK] FOLLOW</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[ESC] BACK</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[O] ORBIT</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[SCROLL] ZOOM</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[RMB] PAN</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[V] 2D VIEW</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[P] PRED. PATHS</span>
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[L] SNAP LIVE</span>
      </div>

    </div>
  );
}
