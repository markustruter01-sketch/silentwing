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
import { RUNWAYS } from '@/data/ybbn';

// ── Camera mode — exported so App can type-check ──────────────────────────────
export type CameraMode = 'orbit' | 'manual' | 'inspect' | 'follow';

// ── Scene constants ────────────────────────────────────────────────────────────
const ALT_SCALE    = 0.15;
const ORBIT_RADIUS = 4200;        // was 7200 — tightened to frame YBBN runways
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

// ── Runway outlines on the ground plane ───────────────────────────────────────
function buildRunwayFootprints(): THREE.LineSegments {
  const positions: number[] = [];
  for (const rw of RUNWAYS) {
    const c = rw.corners, n = c.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % n];
      positions.push(ax, 0, ay, bx, 0, by);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xC8CDD4, transparent: true, opacity: 0.40 }),
  );
}

// ── Per-aircraft Three.js bundle ──────────────────────────────────────────────
interface AcBundle {
  cone:     THREE.Mesh;
  stem:     THREE.Line;
  trail:    THREE.Line;
  label:    THREE.Sprite;
  trailBuf: THREE.Vector3[];
  /** Smoothly-interpolated display position — advanced each rAF frame. */
  drPos:    THREE.Vector3;
  /** Latest ground-truth position from poll — drPos lerps toward this. */
  drTarget: THREE.Vector3;
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

    scene.add(buildRunwayFootprints());
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
            ORBIT_RADIUS * Math.cos(st.angle),
            ORBIT_HEIGHT,
            ORBIT_RADIUS * Math.sin(st.angle),
          );
          camera.lookAt(LOOK_AT);
          break;
        }
        case 'manual': {
          // Camera is frozen — user dragged it off auto-orbit. Esc resumes.
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
      const nowTick = performance.now();
      const dtMs    = Math.min(nowTick - st.lastTickTime, 100); // clamp: tab wake-up
      st.lastTickTime = nowTick;
      const dtS       = dtMs / 1000;
      const lerpAlpha = 1 - Math.exp(-dtMs / 800); // ~800 ms correction time-constant

      for (const [id, b] of st.acMap) {
        // Guard: bundles spawned before this code version (HMR mid-session)
        // may lack drPos/drTarget. Skip — they'll be replaced next data tick.
        if (!b.drPos || !b.drTarget) continue;

        // ── Dead-reckon: advance drPos along heading × gs ──────────────
        const acLive = st.latestAircraftMap.get(id);
        if (acLive) {
          const gsMps = acLive.groundSpeed * KT_TO_MPS;
          if (gsMps > 1.03) { // > ~2 kt — skip stationary ground traffic
            const headRad = acLive.heading * (Math.PI / 180);
            // heading 0 = north = −Z in scene (sim Y is south → Three.js Z)
            b.drPos.x += gsMps * Math.sin(headRad) * dtS;
            b.drPos.z -= gsMps * Math.cos(headRad) * dtS;
          }
          // Correct toward ground-truth; also pulls altitude into drPos.y
          b.drPos.lerp(b.drTarget, lerpAlpha);
        }

        // ── Apply drPos to all visuals ─────────────────────────────────
        b.cone.position.copy(b.drPos);
        b.label.position.set(b.drPos.x, b.drPos.y + LABEL_LIFT, b.drPos.z);
        b.stem.geometry.setFromPoints([
          new THREE.Vector3(b.drPos.x, 0,         b.drPos.z),
          new THREE.Vector3(b.drPos.x, b.drPos.y, b.drPos.z),
        ]);
        b.stem.geometry.computeBoundingSphere();

        // ── Label opacity: distance-based declutter ────────────────────
        const lm = b.label.material as THREE.SpriteMaterial;
        const d  = camera.position.distanceTo(b.label.position);
        if (id === st.selectedAcId) {
          lm.opacity = 1.0; // selected label always full opacity
        } else if (d <= LABEL_FULL_DIST) {
          lm.opacity = 1.0;
        } else if (d >= LABEL_HIDE_DIST) {
          lm.opacity = 0.0;
        } else {
          lm.opacity = 1.0 - (d - LABEL_FULL_DIST) / (LABEL_HIDE_DIST - LABEL_FULL_DIST);
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

    const onPointerDown = (e: PointerEvent) => {
      st.mouseDownX = e.clientX;
      st.mouseDownY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx   = e.clientX - st.mouseDownX;
      const dy   = e.clientY - st.mouseDownY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 6) {
        // Drag — freeze camera (stop auto-orbit)
        if (st.cameraMode === 'orbit') {
          st.cameraMode = 'manual';
          camModeRef.current('manual');
          console.log('[3D CAM] drag → manual (auto-orbit paused; Esc to resume)');
        }
        return;
      }

      // Click — raycast against aircraft cones
      const rect = canvas.getBoundingClientRect();
      const mx   = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
      const my   = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
      const hits = raycaster.intersectObjects([...st.coneToId.keys()]);

      if (!hits.length) return; // clicked empty space

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
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup',   onPointerUp);
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

        const coneGeo = new THREE.ConeGeometry(55, 170, 4, 1);
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
        // drPos and drTarget start at the spawn position — no lerp on first frame
        acMap.set(ac.id, { cone, stem, trail, label, trailBuf,
          drPos: pos.clone(), drTarget: pos.clone() });

      } else {
        // ── Update ────────────────────────────────────────────────────────

        const b  = acMap.get(ac.id)!;
        const cm = b.cone.material as THREE.MeshLambertMaterial;

        // Ground-truth has arrived — update the dead-reckoning target.
        // The tick loop lerps drPos toward drTarget; cone/label/stem positions
        // are written from drPos each rAF frame — no hard-snap here.
        b.drTarget.copy(pos);

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
        <span className="font-mono text-[9px] tracking-wider text-slate-800">[V] 2D VIEW</span>
      </div>

    </div>
  );
}
