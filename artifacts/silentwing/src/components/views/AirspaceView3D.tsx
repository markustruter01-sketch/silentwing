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
import { REAL_RUNWAYS, REAL_TAXIWAYS, REAL_APRONS } from '@/data/ybbn_real';

// ── Camera mode — exported so App can type-check ──────────────────────────────
export type CameraMode = 'orbit' | 'manual' | 'inspect' | 'follow' | 'returning';

// ── Scene constants ────────────────────────────────────────────────────────────
const ALT_SCALE    = 0.15;
const ORBIT_RADIUS     = 3750;    // 50% closer than the original wide overview
const ORBIT_HEIGHT     = 2500;    // proportionally lower for a tighter perspective
const ORBIT_INIT_ANGLE = Math.PI * 0.6; // starting angle (south of airport, runway visible)
const ORBIT_SPEED      = 0.00025; // rad/frame ≈ 7 min/revolution at 60 fps
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

// Camera offset from aircraft for inspect / follow modes
// (south and above: Z=south in Three.js coordinate space)
const INSPECT_OFFSET = new THREE.Vector3(0, 700, 1400);
const FOLLOW_OFFSET  = new THREE.Vector3(0, 700, 1400);

// Director Mode uses a wide, cinematic overview shot — ~10× the normal follow
// distance so the whole flight path context is visible, not just the aircraft.
const DIRECTOR_FOLLOW_OFFSET = new THREE.Vector3(0, 4_500, 9_000);

// Transition speed for manual inspect fly-to (flyProgress increment per frame at 60 fps)
const FLY_SPEED_NORMAL = 0.022; // ~45 frames ≈ 0.75 s

// Director continuous-lerp rates — no discrete fly-to; both position and look-at
// drift toward their targets every frame so aircraft switches are seamless glides.
// At 60 fps, lerp(t, 0.006) reaches 95% of target in ~8 s.
const DIRECTOR_POS_LERP       = 0.006;  // camera position drift speed (ongoing switches)
const DIRECTOR_LOOK_LERP      = 0.009;  // look-at settles slightly faster so aircraft stays centred
// Intro lerp: on first page-load the camera glides slowly from orbit into director
// position over 15 s.  lerp(t, 0.003) → 95% in ~15 s at 60 fps.
const DIRECTOR_POS_LERP_INTRO = 0.003;

// ── Helpers ────────────────────────────────────────────────────────────────────
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
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

// ── Callsign label sprite ──────────────────────────────────────────────────────
function makeLabel(callsign: string, hex: number): THREE.Sprite {
  const W = 320, H = 80;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = 'bold 30px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(callsign, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(480, 120, 1);
  return sprite;
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

function buildGroundGeometry(): THREE.Group {
  const g = new THREE.Group();

  // Runways — 3 parallel lines (centre ± 20 m) so they read ~3× wider than taxiways
  const rwMat = new THREE.LineBasicMaterial({ color: 0xC8CDD4, transparent: true, opacity: 0.60 });
  const RW_HALF_WIDTH = 20; // metres offset each side of centreline
  for (const rw of REAL_RUNWAYS) {
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
  for (const tw of REAL_TAXIWAYS) {
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
  for (const apron of REAL_APRONS) {
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

// Runway threshold positions in Three.js scene coords (after flipRealY applied).
// Derived from REAL_RUNWAYS first/last coords: [label, x, z].
const RUNWAY_THRESHOLDS: [string, number, number][] = [
  ['19R',      490.6,   -3032.4],
  ['01L',     -1007.7,   -102.8],
  ['01R',      120.3,   2079.9 ],
  ['19L',     1710.8,  -1030.6 ],
];

function buildAirportAnnotations(): THREE.Group {
  const g = new THREE.Group();
  const H = 90; // hover height (scene units ≈ 600 ft)

  for (const [text, x, z] of RUNWAY_THRESHOLDS) {
    const sp = makeRunwayLabel(text);
    sp.position.set(x, H, z);
    g.add(sp);
  }

  // Terminal label — gates cluster around (420, -250) in scene coords
  const term = makeRunwayLabel('TERMINAL');
  term.position.set(420, H, -250);
  g.add(term);

  return g;
}

// ── ILS approach corridor ──────────────────────────────────────────────────────
// A translucent wedge descending from approach-fix altitude to runway threshold.
function buildApproachCone(activeDir: '01' | '19'): THREE.Group {
  const g = new THREE.Group();
  const RANGE_M  = 9_000;
  const WIDTH_M  = 1_400;
  // Height at far end of corridor following a 3° glide slope
  const farY = RANGE_M * Math.tan((3 * Math.PI) / 180) * ALT_SCALE; // ≈ 71 units

  // Average the two active-direction thresholds for corridor centre
  let cx: number, cz: number, dz: number;
  if (activeDir === '01') {
    cx = (-1007.7 + 120.3) / 2;            // ≈ -444
    cz = (-102.8  + 2079.9) / 2;           // ≈  989
    dz = 1;                                 // approach from +Z (south)
  } else {
    cx = (490.6 + 1710.8) / 2;             // ≈ 1101
    cz = (-3032.4 + (-1030.6)) / 2;        // ≈ -2032
    dz = -1;                                // approach from -Z (north)
  }
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

// ── Wind direction indicator ───────────────────────────────────────────────────
// Floating arrow NW of airport showing current wind FROM direction + speed.
function buildWindIndicator(windDir: number, windSpeed: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(-2200, 680, -1800); // NW of airport, well above aircraft traffic

  // Wind FROM direction — arrow points in the downwind (TO) direction
  const rad = (windDir * Math.PI) / 180;
  const dir = new THREE.Vector3(-Math.sin(rad), 0, Math.cos(rad)).normalize();
  const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 900, 0x38bdf8, 260, 130);
  (arrow.line.material as THREE.LineBasicMaterial).transparent = true;
  (arrow.line.material as THREE.LineBasicMaterial).opacity     = 0.72;
  (arrow.cone.material as THREE.MeshBasicMaterial).transparent = true;
  (arrow.cone.material as THREE.MeshBasicMaterial).opacity     = 0.72;
  g.add(arrow);

  // Label
  const sp = makeRingLabel(`WIND  ${Math.round(windDir).toString().padStart(3,'0')}° / ${Math.round(windSpeed)} kt`);
  sp.position.set(0, 300, 0);
  g.add(sp);

  return g;
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
}

function disposeBundle(b: AcBundle): void {
  b.cone.geometry.dispose(); (b.cone.material as THREE.Material).dispose();
  b.stem.geometry.dispose();
  b.trail.geometry.dispose(); (b.trail.material as THREE.Material).dispose();
  const sm = b.label.material as THREE.SpriteMaterial;
  sm.map?.dispose(); sm.dispose();
  // HMR guard — bundles created before this field existed won't have halo
  if (b.halo) { b.halo.geometry.dispose(); (b.halo.material as THREE.Material).dispose(); }
}

// Shared stem material — one instance, never disposed here
const STEM_MAT = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.50 });

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
  /** Smoothly-lerped look-at point used exclusively in director mode.
   *  Persists across aircraft switches so the camera pans rather than snaps. */
  directorLookAt:   THREE.Vector3;
  /** True once the very first director follow entry has been triggered (page-load intro). */
  directorIntroStarted: boolean;
  /** performance.now() timestamp when the 15 s intro lerp ends. */
  directorIntroEnd:     number;
}

// ── Helper: begin fly-to animation toward an aircraft ────────────────────────
function startFlyTo(st: SceneState, acId: string): void {
  const ac = st.latestAircraftMap.get(acId);
  const acPos = ac
    ? toV3(ac.position.x, ac.position.y, ac.position.alt)
    : new THREE.Vector3(0, 0, 0);

  const targetCamPos = acPos.clone().add(INSPECT_OFFSET);

  // Derive current camera lookAt from its forward direction
  const dir = new THREE.Vector3();
  st.camera.getWorldDirection(dir);
  const currentLookAt = st.camera.position.clone().add(dir.multiplyScalar(2000));

  st.cameraMode    = 'inspect';
  st.selectedAcId  = acId;
  st.flyFrom.copy(st.camera.position);
  st.flyTo.copy(targetCamPos);
  st.flyLookFrom.copy(currentLookAt);
  st.flyLookTo.copy(acPos);
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
}: AirspaceView3DProps) {
  const mountRef       = useRef<HTMLDivElement>(null);
  const sceneRef       = useRef<SceneState | null>(null);
  /** Three.js group rebuilt whenever weather changes (approach cone + wind arrow). */
  const weatherGrpRef  = useRef<THREE.Group | null>(null);

  // Stable callback refs — updated every render so event handlers always call
  // the latest versions without needing to be re-registered.
  const selectRef  = useRef(onSelectAircraft);
  const camModeRef = useRef(onCameraMode);
  useEffect(() => { selectRef.current  = onSelectAircraft; }, [onSelectAircraft]);
  useEffect(() => { camModeRef.current = onCameraMode;     }, [onCameraMode]);

  // Sync directorMode prop into SceneState so the rAF loop always reads fresh.
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.directorMode = directorMode;
  }, [directorMode]);

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
      if (st.directorMode) {
        // Director: seed the smooth look-at from the camera's current forward
        // direction so the first frame doesn't jump to scene origin.
        const dir = new THREE.Vector3();
        st.camera.getWorldDirection(dir);
        st.directorLookAt.copy(st.camera.position).addScaledVector(dir, 500);
        // First-ever director follow entry → start the 15 s page-load intro glide.
        if (!st.directorIntroStarted) {
          st.directorIntroStarted = true;
          st.directorIntroEnd     = performance.now() + 15_000;
        }
      }
      // Non-director fly-to setup (used when entering follow manually).
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
      st.flyLookFrom.copy(st.orbitTarget);
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
    if (!weather) return;
    const wg = new THREE.Group();
    wg.add(buildApproachCone(weather.activeRunwayDirection));
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

    scene.add(buildGroundGeometry());
    scene.add(buildAltRings());
    scene.add(buildAirportAnnotations());

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
      directorLookAt:       new THREE.Vector3(), // starts at scene origin (airport centre)
      directorIntroStarted: false,
      directorIntroEnd:     0,
    };
    sceneRef.current = st;

    // ── Raycaster (shared across frames) ────────────────────────────────────
    const raycaster = new THREE.Raycaster();

    // ── Animation loop ───────────────────────────────────────────────────────
    const tick = () => {
      st.animId = requestAnimationFrame(tick);

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
            st.flyProgress = Math.min(st.flyProgress + 0.022, 1); // ~45 frames ≈ 0.75 s
            const t  = easeInOut(st.flyProgress);
            camera.position.lerpVectors(st.flyFrom, st.flyTo, t);
            const lk = new THREE.Vector3().lerpVectors(st.flyLookFrom, st.flyLookTo, t);
            camera.lookAt(lk);
          } else {
            // Arrived — track the aircraft's interpolated display position
            if (st.selectedAcId) {
              const b = st.acMap.get(st.selectedAcId);
              if (b) camera.lookAt(b.renderPos);
            }
          }
          break;
        }
        case 'follow': {
          if (st.selectedAcId) {
            const b = st.acMap.get(st.selectedAcId);
            if (b) {
              const offset     = st.directorMode ? DIRECTOR_FOLLOW_OFFSET : FOLLOW_OFFSET;
              const liveTarget = b.renderPos.clone().add(offset);

              if (st.directorMode) {
                // ── Director: one continuous gliding shot ──────────────────
                // On first page-load use the slower intro lerp (15 s), then
                // switch to the normal 8 s rate once the intro window closes.
                const isIntro  = st.directorIntroStarted && performance.now() < st.directorIntroEnd;
                const posLerp  = isIntro ? DIRECTOR_POS_LERP_INTRO : DIRECTOR_POS_LERP;
                camera.position.lerp(liveTarget, posLerp);
                st.directorLookAt.lerp(b.renderPos, DIRECTOR_LOOK_LERP);
                camera.lookAt(st.directorLookAt);
              } else {
                // ── Normal follow ──────────────────────────────────────────
                if (st.flyProgress < 1) {
                  st.flyProgress = Math.min(st.flyProgress + FLY_SPEED_NORMAL, 1);
                  const t = easeInOut(st.flyProgress);
                  camera.position.lerpVectors(st.flyFrom, liveTarget, t);
                } else {
                  camera.position.copy(liveTarget);
                }
                camera.lookAt(b.renderPos);
              }
            }
          }
          break;
        }
        case 'returning': {
          // Smooth fly-back to the default orbit position.
          // On completion, hands off to 'orbit' with angle re-synced so
          // the auto-orbit continues seamlessly from the arrived position.
          st.flyProgress = Math.min(st.flyProgress + 0.018, 1); // ~56 frames ≈ 0.9 s
          const t  = easeInOut(st.flyProgress);
          camera.position.lerpVectors(st.flyFrom, st.flyTo, t);
          const lk = new THREE.Vector3().lerpVectors(st.flyLookFrom, st.flyLookTo, t);
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
      const nowMs = performance.now();

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
        console.log('[3D CAM] right-drag pan → manual (resumes in 30 s idle)');
      }

      // Reset 30 s idle timer — on expiry, re-sync angle and resume orbit
      if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
      st.panResumeTimer = setTimeout(() => {
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
        console.log('[3D CAM] pan idle 30 s → returning (smooth fly-back to orbit)');
      }, 30_000);
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
      if (st.panResumeTimer !== null) clearTimeout(st.panResumeTimer);
      canvas.removeEventListener('wheel',        onWheel);
      canvas.removeEventListener('contextmenu',  onContextMenu);
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      window.removeEventListener('keydown', onKey);
      st.acMap.forEach(b => { scene.remove(b.cone, b.stem, b.trail, b.label); disposeBundle(b); });
      st.acMap.clear();
      st.coneToId.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      if (!acMap.has(ac.id)) {
        // ── Spawn ──────────────────────────────────────────────────────────

        const coneGeo = new THREE.ConeGeometry(27.5, 85, 4, 1);
        coneGeo.rotateX(-Math.PI / 2); // apex faces −Z (north)
        const coneMat = new THREE.MeshLambertMaterial({
          color: hex, emissive: hex, emissiveIntensity: 0.30,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.copy(pos);
        cone.rotation.y = headY;
        // renderOrder=1 ensures the opaque cone renders AFTER the transparent
        // trail (renderOrder=0 default), so the aircraft icon is never obscured
        // by its own trail even when the trail head overlaps the cone position.
        cone.renderOrder = 1;
        scene.add(cone);
        coneToId.set(cone, ac.id); // register for raycasting

        // Purple selection halo — flat torus ring, hidden until director selects
        const haloGeo = new THREE.TorusGeometry(70, 7, 8, 64);
        const haloMat = new THREE.MeshBasicMaterial({
          color: 0xa855f7, transparent: true, opacity: 0.50, depthWrite: false,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.rotation.x = Math.PI / 2; // lay flat (horizontal ring)
        halo.renderOrder = 3;
        halo.visible = false;
        scene.add(halo);

        const stemGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pos.x, 0, pos.z),
          new THREE.Vector3(pos.x, pos.y, pos.z),
        ]);
        const stem = new THREE.Line(stemGeo, STEM_MAT);
        scene.add(stem);

        // Pre-allocated trail buffer (no per-tick realloc).
        // Each vertex has a position (xyz) and a per-vertex alpha float so the
        // rAF loop can fade the trail from opaque (nearest plane) to transparent
        // (TRAIL_FADE_S seconds behind) without a custom geometry rebuild.
        const trailPosArr   = new Float32Array(TRAIL_MAX * 3);
        trailPosArr[0] = pos.x; trailPosArr[1] = pos.y; trailPosArr[2] = pos.z;
        trailPosArr[3] = pos.x; trailPosArr[4] = pos.y; trailPosArr[5] = pos.z;
        const trailAlphaArr = new Float32Array(TRAIL_MAX);
        trailAlphaArr[0] = trailAlphaArr[1] = TRAIL_OPACITY;
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPosArr, 3));
        trailGeo.setAttribute('alpha',    new THREE.BufferAttribute(trailAlphaArr, 1));
        trailGeo.setDrawRange(0, 2);
        // ShaderMaterial: per-vertex alpha encodes fade along the trail length.
        const trailMat = new THREE.ShaderMaterial({
          uniforms: { color: { value: new THREE.Color(hex) } },
          vertexShader: `
            attribute float alpha;
            varying   float vAlpha;
            void main() {
              vAlpha      = alpha;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3  color;
            varying float vAlpha;
            void main() {
              gl_FragColor = vec4(color, vAlpha);
            }
          `,
          transparent: true,
          depthWrite:  false,
        });
        const trail = new THREE.Line(trailGeo, trailMat);
        scene.add(trail);

        const label = makeLabel(ac.callsign, hex);
        label.position.set(pos.x, pos.y + LABEL_LIFT, pos.z);
        // Freshly spawned aircraft always have fresh data — full opacity
        (label.material as THREE.SpriteMaterial).opacity = 1.0;
        scene.add(label);

        const trailBuf: { pos: THREE.Vector3; t: number }[] = [
          { pos: pos.clone(), t: nowMs },
          { pos: pos.clone(), t: nowMs },
        ];
        // Spawn: age-compensate the initial fix so extrapolation starts from
        // the present position, not a seen_pos-seconds-old raw fix.
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
        acMap.set(ac.id, {
          cone, stem, trail, label, trailBuf, halo,
          renderPos:       spawnPos.clone(),
          lastKnownPos:    spawnPos.clone(),
          lastKnownTimeMs: nowMs,
          headingDeg:      ac.heading,
          gsMps:           spawnGsMps,
          vyPerS:          spawnVyPerS,
          seenPos:         ac.seenPos ?? 0,
          corrFromPos:     spawnPos.clone(),
          corrStartMs:     -1,   // no correction on first appearance
        });

      } else {
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

        // ── FIX A: trail sanity cap ────────────────────────────────────────
        // Drop a trail point that is physically further from the last point
        // than the aircraft could have travelled in one poll interval.
        // This kills starburst from seen_pos oscillation (fresh/stale position
        // alternation) without hiding genuine motion of fast-moving aircraft.
        const gsMps        = ac.groundSpeed * KT_TO_MPS;
        const maxTrailJump = gsMps * (st.pollDurationMs / 1000) * TRAIL_SLACK + TRAIL_GPS_M;
        const lastTp       = b.trailBuf[b.trailBuf.length - 1].pos;
        if (pos.distanceTo(lastTp) <= maxTrailJump) {
          b.trailBuf.push({ pos: pos.clone(), t: nowMs });
          if (b.trailBuf.length > TRAIL_MAX) b.trailBuf.shift();
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

    // Remove aircraft that left the snapshot
    for (const [id, b] of acMap) {
      if (!seen.has(id)) {
        scene.remove(b.cone, b.stem, b.trail, b.label, b.halo);
        coneToId.delete(b.cone);
        disposeBundle(b);
        acMap.delete(id);
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

      {/* ── Phase legend — bottom-left ── */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-[3px] pointer-events-none select-none">
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
