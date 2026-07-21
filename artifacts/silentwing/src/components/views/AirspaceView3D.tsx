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
import type { Aircraft } from '@/types';
import { isAirborne } from '@/types';
import { REAL_RUNWAYS, REAL_TAXIWAYS, REAL_APRONS } from '@/data/ybbn_real';

// ── Camera mode — exported so App can type-check ──────────────────────────────
export type CameraMode = 'orbit' | 'manual' | 'inspect' | 'follow';

// ── Scene constants ────────────────────────────────────────────────────────────
const ALT_SCALE    = 0.15;
const ORBIT_RADIUS = 5200;        // default orbit radius (was 4200 — widened for airspace margin)
const ORBIT_HEIGHT = 1600;        // was 2600 — lower angle, more runway visible
const ORBIT_SPEED  = 0.00035;     // rad/frame ≈ 4.4 min/revolution at 60 fps
const LOOK_AT      = new THREE.Vector3(0, 0, 0); // airfield centre (was y=700)
const KT_TO_MPS    = 0.514444;    // knots → metres per second for dead-reckoning
const LABEL_LIFT      = 210;      // Three.js Y-units above cone
const TRAIL_MAX       = 600;      // 10 Hz × 60 s
// Label opacity fades between these camera-to-label distances (Three.js units).
// At orbit distance (~7 600) all labels are invisible; at inspect distance
// (~1 500) they are fully opaque. Selected aircraft label is always full opacity.
const LABEL_FULL_DIST = 2800;     // below this → opacity 1.0
const LABEL_HIDE_DIST = 4500;     // above this → opacity 0.0

// Camera offset from aircraft for inspect / follow modes
// (south and above: Z=south in Three.js coordinate space)
const INSPECT_OFFSET = new THREE.Vector3(0, 700, 1400);
const FOLLOW_OFFSET  = new THREE.Vector3(0, 700, 1400);

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

// ── Altitude reference rings (FL050 / FL100 / FL150) ──────────────────────────
function buildAltRings(): THREE.Group {
  const g   = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x162030, transparent: true, opacity: 0.55 });
  const N   = 128;
  for (const fl of [50, 100, 150]) {
    const y   = fl * 100 * ALT_SCALE;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 4200, y, Math.sin(a) * 4200));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
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

// ── Per-aircraft Three.js bundle ──────────────────────────────────────────────
interface AcBundle {
  cone:     THREE.Mesh;
  stem:     THREE.Line;
  trail:    THREE.Line;
  label:    THREE.Sprite;
  trailBuf: THREE.Vector3[];
  /** Pure dead-reckoned display position — advanced every rAF frame along
   *  last-known heading × groundspeed. Never pulled toward a stale fixed point. */
  drPos:      THREE.Vector3;
  /** Pending correction offset accumulated on each poll arrival.
   *  Decays to zero over ~1.5 s so corrections appear as small nudges,
   *  never freezes or snaps. */
  corrOffset: THREE.Vector3;
}

function disposeBundle(b: AcBundle): void {
  b.cone.geometry.dispose(); (b.cone.material as THREE.Material).dispose();
  b.stem.geometry.dispose();
  b.trail.geometry.dispose(); (b.trail.material as THREE.Material).dispose();
  const sm = b.label.material as THREE.SpriteMaterial;
  sm.map?.dispose(); sm.dispose();
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
  // dead-reckoning: timestamp of last rAF tick (ms) for dt calculation
  lastTickTime:  number;
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
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirspaceView3D({
  aircraft,
  selectedAcId,
  cameraMode,
  onSelectAircraft,
  onCameraMode,
}: AirspaceView3DProps) {
  const mountRef  = useRef<HTMLDivElement>(null);
  const sceneRef  = useRef<SceneState | null>(null);

  // Stable callback refs — updated every render so event handlers always call
  // the latest versions without needing to be re-registered.
  const selectRef  = useRef(onSelectAircraft);
  const camModeRef = useRef(onCameraMode);
  useEffect(() => { selectRef.current  = onSelectAircraft; }, [onSelectAircraft]);
  useEffect(() => { camModeRef.current = onCameraMode;     }, [onCameraMode]);

  // ── Sync external cameraMode prop → sceneRef ────────────────────────────────
  // Fired when App changes cameraMode (e.g. "Follow" button in panel).
  useEffect(() => {
    const st = sceneRef.current;
    if (!st || st.cameraMode === cameraMode) return;
    console.log(`[3D CAM] prop→scene sync: ${st.cameraMode} → ${cameraMode}`);
    if (cameraMode === 'follow' && st.selectedAcId && st.cameraMode === 'inspect') {
      // Panel "Follow" button pressed — enter follow immediately
      st.cameraMode = 'follow';
    } else if (cameraMode === 'inspect' && st.cameraMode === 'follow') {
      // Panel "Stop Following" — hold current position
      st.cameraMode = 'inspect';
      st.flyProgress = 1; // already at target
    } else {
      st.cameraMode = cameraMode;
    }
  }, [cameraMode]);

  // ── Sync external selectedAcId prop → sceneRef ──────────────────────────────
  useEffect(() => {
    const st = sceneRef.current;
    if (st) st.selectedAcId = selectedAcId;
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
    const camera = new THREE.PerspectiveCamera(42, W / H, 10, 80000);
    camera.position.set(ORBIT_RADIUS, ORBIT_HEIGHT, 0);
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

    // Initialise mutable state
    const st: SceneState = {
      renderer, scene, camera,
      animId:  0,
      angle:   0,
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
      lastClickTime: 0,
      lastTickTime:  performance.now(),
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
            // Arrived — track the aircraft's dead-reckoned display position
            if (st.selectedAcId) {
              const b = st.acMap.get(st.selectedAcId);
              if (b) camera.lookAt(b.drPos);
            }
          }
          break;
        }
        case 'follow': {
          if (st.selectedAcId) {
            const b = st.acMap.get(st.selectedAcId);
            if (b) {
              // Follow the interpolated drPos so the camera never jerks on poll
              camera.position.copy(b.drPos.clone().add(FOLLOW_OFFSET));
              camera.lookAt(b.drPos);
            }
          }
          break;
        }
      }

      // ── Dead-reckoning + position correction + label declutter ──────────
      // All three combined so visual positions are settled before the
      // label distance test runs in the same frame.
      const nowTick  = performance.now();
      const dtMs     = Math.min(nowTick - st.lastTickTime, 100); // clamp: tab wake-up
      st.lastTickTime = nowTick;
      const dtS      = dtMs / 1000;
      // Fraction of the pending correction offset to drain this frame.
      // Time constant ~1 500 ms → correction fully absorbed in ~3–4 s; imperceptible nudge.
      const corrAlpha = 1 - Math.exp(-dtMs / 1500);

      for (const [id, b] of st.acMap) {
        // Guard: bundles spawned before this code version (HMR mid-session)
        // may lack drPos/corrOffset. Skip — they'll be replaced next data tick.
        if (!b.drPos || !b.corrOffset) continue;

        // ── Step 1: Pure dead-reckoning — advance drPos every frame ────
        // drPos is the authoritative display position; it advances continuously
        // along last-known heading × groundspeed with NO pull toward a fixed point.
        const acLive = st.latestAircraftMap.get(id);
        if (acLive) {
          const gsMps = acLive.groundSpeed * KT_TO_MPS;
          if (gsMps > 1.03) { // > ~2 kt — skip stationary ground traffic
            const headRad = acLive.heading * (Math.PI / 180);
            // heading 0 = north = −Z in scene (sim Y is south → Three.js Z)
            b.drPos.x += gsMps * Math.sin(headRad) * dtS;
            b.drPos.z -= gsMps * Math.cos(headRad) * dtS;
          }

          // ── Step 2: Drain correction offset (poll nudge) ────────────
          // corrOffset was accumulated on poll arrival as (groundTruth − drPos).
          // Each frame we apply a small fraction into drPos and shrink the offset,
          // so the correction is spread over ~1.5 s as an additive nudge.
          // This never opposes the forward advance — both are additive.
          if (!b.corrOffset.equals(new THREE.Vector3())) {
            b.drPos.addScaledVector(b.corrOffset, corrAlpha);
            b.corrOffset.multiplyScalar(1 - corrAlpha);
            // Zero out negligible residual to avoid drift accumulation
            if (b.corrOffset.lengthSq() < 0.01) b.corrOffset.set(0, 0, 0);
          }
        }

        // ── Apply drPos to all visuals ─────────────────────────────────
        b.cone.position.copy(b.drPos);
        b.label.position.set(b.drPos.x, b.drPos.y + LABEL_LIFT, b.drPos.z);
        b.stem.geometry.setFromPoints([
          new THREE.Vector3(b.drPos.x, 0,         b.drPos.z),
          new THREE.Vector3(b.drPos.x, b.drPos.y, b.drPos.z),
        ]);
        b.stem.geometry.computeBoundingSphere();

        // ── Label opacity: all identifiers always visible ──────────────
        const lm = b.label.material as THREE.SpriteMaterial;
        lm.opacity = 1.0;
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
        st.angle = Math.atan2(
          camera.position.z - st.orbitTarget.z,
          camera.position.x - st.orbitTarget.x,
        );
        st.cameraMode = 'orbit';
        camModeRef.current('orbit');
        console.log('[3D CAM] pan idle 30 s → orbit resumed');
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
        st.cameraMode    = 'manual';
        st.selectedAcId  = null;
        selectRef.current(null);
        camModeRef.current('manual');
        console.log(`[3D CAM] Esc: inspect → manual  [panel closed, camera holds]`);

      } else if (prev === 'manual') {
        st.cameraMode = 'orbit';
        camModeRef.current('orbit');
        console.log(`[3D CAM] Esc: manual → orbit  [auto-orbit resumed]`);

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
        scene.add(cone);
        coneToId.set(cone, ac.id); // register for raycasting

        const stemGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pos.x, 0, pos.z),
          new THREE.Vector3(pos.x, pos.y, pos.z),
        ]);
        const stem = new THREE.Line(stemGeo, STEM_MAT);
        scene.add(stem);

        // Pre-allocated trail buffer (no per-tick realloc)
        const trailArr  = new Float32Array(TRAIL_MAX * 3);
        trailArr[0] = pos.x; trailArr[1] = pos.y; trailArr[2] = pos.z;
        trailArr[3] = pos.x; trailArr[4] = pos.y; trailArr[5] = pos.z;
        const trailAttr = new THREE.BufferAttribute(trailArr, 3);
        const trailGeo  = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', trailAttr);
        trailGeo.setDrawRange(0, 2);
        const trailMat  = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.55 });
        const trail     = new THREE.Line(trailGeo, trailMat);
        scene.add(trail);

        const label = makeLabel(ac.callsign, hex);
        label.position.set(pos.x, pos.y + LABEL_LIFT, pos.z);
        scene.add(label);

        const trailBuf: THREE.Vector3[] = [pos.clone(), pos.clone()];
        // drPos starts at spawn position; corrOffset starts at zero (no snap on first frame)
        acMap.set(ac.id, { cone, stem, trail, label, trailBuf,
          drPos: pos.clone(), corrOffset: new THREE.Vector3() });

      } else {
        // ── Update ────────────────────────────────────────────────────────

        const b  = acMap.get(ac.id)!;
        const cm = b.cone.material as THREE.MeshLambertMaterial;

        // Ground-truth has arrived — compute positional error and accumulate it
        // as a correction offset. The tick loop will drain corrOffset into drPos
        // over ~1.5 s (small nudge) while pure DR continues advancing each frame.
        b.corrOffset.add(pos.clone().sub(b.drPos));

        // Heading and colour snap immediately (no perceptible jerk)
        b.cone.rotation.y = headY;
        // Selected aircraft: gold highlight
        cm.color.setHex(isSelected ? 0xFACC15 : hex);
        cm.emissive.setHex(isSelected ? 0xFACC15 : hex);
        cm.emissiveIntensity = isSelected ? 0.70 : 0.30;

        // Trail records ground-truth positions (not interpolated drPos)
        // Trail — write into pre-allocated buffer
        b.trailBuf.push(pos.clone());
        if (b.trailBuf.length > TRAIL_MAX) b.trailBuf.shift();
        const ta  = b.trail.geometry.attributes.position as THREE.BufferAttribute;
        const arr = ta.array as Float32Array;
        for (let i = 0; i < b.trailBuf.length; i++) {
          arr[i * 3]     = b.trailBuf[i].x;
          arr[i * 3 + 1] = b.trailBuf[i].y;
          arr[i * 3 + 2] = b.trailBuf[i].z;
        }
        ta.needsUpdate = true;
        b.trail.geometry.setDrawRange(0, b.trailBuf.length);
        b.trail.geometry.computeBoundingSphere();
        (b.trail.material as THREE.LineBasicMaterial).color.setHex(
          isSelected ? 0xFACC15 : hex,
        );
      }
    }

    // Remove aircraft that left the snapshot
    for (const [id, b] of acMap) {
      if (!seen.has(id)) {
        scene.remove(b.cone, b.stem, b.trail, b.label);
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
