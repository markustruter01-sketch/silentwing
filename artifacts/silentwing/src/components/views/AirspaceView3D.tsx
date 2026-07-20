import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import type { Aircraft } from '@/types';
import { RUNWAYS } from '@/data/ybbn';

// ─── Scene constants ──────────────────────────────────────────────────────────

/** Vertical compression: 1 ft MSL → this many Three.js Y-units */
const ALT_SCALE = 0.15;

/** Camera orbit — slow pan around the airport (~4.4 min / revolution at 60 fps) */
const ORBIT_RADIUS = 7200;
const ORBIT_HEIGHT = 2600;
const ORBIT_SPEED  = 0.00035; // rad/frame
const LOOK_AT      = new THREE.Vector3(0, 700, 0);

/** Callsign labels float this many Y-units above the cone */
const LABEL_LIFT = 210;

/** Rolling trail history: 10 Hz × 60 s */
const TRAIL_MAX = 600;

// ─── Phase colour map (mirrors 2D layer exactly) ──────────────────────────────

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

function phaseHex(phase: string): number {
  return PHASE_HEX[phase] ?? HEX_DEFAULT;
}

// ─── Coordinate conversion ────────────────────────────────────────────────────
// sim  :  x = east (m),  y = south (m, SVG),  alt = feet MSL
// THREE:  X = east (m),  Z = south (m),        Y = alt * ALT_SCALE

function toV3(x: number, y: number, alt: number): THREE.Vector3 {
  return new THREE.Vector3(x, alt * ALT_SCALE, y);
}

// ─── Callsign label sprite ────────────────────────────────────────────────────

function makeLabel(callsign: string, hex: number): THREE.Sprite {
  const W = 320, H = 80;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.font = 'bold 30px "JetBrains Mono","Courier New",monospace';
  ctx.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(callsign, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(480, 120, 1);
  return sprite;
}

// ─── Altitude reference rings (FL050, FL100, FL150) ──────────────────────────

function buildAltRings(): THREE.Group {
  const g = new THREE.Group();
  const ringMat = new THREE.LineBasicMaterial({ color: 0x162030, transparent: true, opacity: 0.55 });
  const N = 128;
  for (const fl of [50, 100, 150]) {
    const y = fl * 100 * ALT_SCALE;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 4200, y, Math.sin(a) * 4200));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }
  return g;
}

// ─── Runway outlines on the ground plane ─────────────────────────────────────

function buildRunwayFootprints(): THREE.LineSegments {
  const positions: number[] = [];
  for (const rw of RUNWAYS) {
    const c = rw.corners;
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = c[i];
      const [bx, by] = c[(i + 1) % n];
      // Y=0 plane; sim y → Three Z
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

// ─── Per-aircraft Three.js bundle ────────────────────────────────────────────

interface AcBundle {
  cone:     THREE.Mesh;
  stem:     THREE.Line;
  trail:    THREE.Line;
  label:    THREE.Sprite;
  trailBuf: THREE.Vector3[]; // oldest first, newest last
}

function disposeBundle(b: AcBundle): void {
  b.cone.geometry.dispose();
  (b.cone.material as THREE.Material).dispose();
  b.stem.geometry.dispose();
  // stem uses shared material — do not dispose it here
  b.trail.geometry.dispose();
  (b.trail.material as THREE.Material).dispose();
  const sm = b.label.material as THREE.SpriteMaterial;
  sm.map?.dispose();
  sm.dispose();
}

// ─── Shared stem material (reused across all aircraft) ────────────────────────

const STEM_MAT = new THREE.LineBasicMaterial({
  color: 0x334155,
  transparent: true,
  opacity: 0.50,
});

// ─── Component ───────────────────────────────────────────────────────────────

export interface AirspaceView3DProps {
  aircraft: Aircraft[];
}

export default function AirspaceView3D({ aircraft }: AirspaceView3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Mutable scene state — never triggers re-renders
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene:    THREE.Scene;
    camera:   THREE.PerspectiveCamera;
    animId:   number;
    angle:    number;
    acMap:    Map<string, AcBundle>;
  } | null>(null);

  // ── One-time scene setup ─────────────────────────────────────────────────
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

    // Camera (orbits; projection updated on resize)
    const camera = new THREE.PerspectiveCamera(42, W / H, 10, 80000);
    camera.position.set(ORBIT_RADIUS, ORBIT_HEIGHT, 0);
    camera.lookAt(LOOK_AT);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(3000, 8000, 2000);
    scene.add(sun);

    // Ground grid (200 m spacing, 8000 m total)
    const grid = new THREE.GridHelper(8000, 40, 0x0D1520, 0x0D1520);
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = 0.90;
    scene.add(grid);

    // Ground disc — very subtle fill
    const discGeo = new THREE.CircleGeometry(4500, 64);
    discGeo.rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x0A0F18 })));

    // Runway footprints
    scene.add(buildRunwayFootprints());

    // Altitude reference rings
    scene.add(buildAltRings());

    const state = {
      renderer, scene, camera,
      animId: 0,
      angle: 0,
      acMap: new Map<string, AcBundle>(),
    };
    sceneRef.current = state;

    // Responsive resize
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    // Animation loop — only orbits the camera, no data logic here
    const tick = () => {
      state.animId = requestAnimationFrame(tick);
      state.angle += ORBIT_SPEED;
      camera.position.set(
        ORBIT_RADIUS * Math.cos(state.angle),
        ORBIT_HEIGHT,
        ORBIT_RADIUS * Math.sin(state.angle),
      );
      camera.lookAt(LOOK_AT);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(state.animId);
      state.acMap.forEach(b => { disposeBundle(b); });
      state.acMap.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) {
        el.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aircraft sync — runs on every snapshot tick ──────────────────────────
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    const { scene, acMap } = st;
    const seen = new Set<string>();

    for (const ac of aircraft) {
      seen.add(ac.id);
      const pos  = toV3(ac.position.x, ac.position.y, ac.position.alt);
      const hex  = phaseHex(ac.phase);
      const headY = -(ac.heading * Math.PI) / 180; // heading → Three.js Y-rotation

      if (!acMap.has(ac.id)) {
        // ── Spawn new aircraft ─────────────────────────────────────────

        // Cone — apex points in heading direction
        // After rotateX(-π/2), the apex faces -Z (north); Y-rotation steers it.
        const coneGeo = new THREE.ConeGeometry(55, 170, 4, 1);
        coneGeo.rotateX(-Math.PI / 2); // apex now faces -Z (north at Y=0)
        const coneMat = new THREE.MeshLambertMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.30,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.copy(pos);
        cone.rotation.y = headY;
        scene.add(cone);

        // Altitude stem — ground (y=0) to aircraft position
        const stemGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pos.x, 0, pos.z),
          new THREE.Vector3(pos.x, pos.y, pos.z),
        ]);
        const stem = new THREE.Line(stemGeo, STEM_MAT);
        scene.add(stem);

        // Trail — starts with two identical points so the Line is valid
        const trailBuf: THREE.Vector3[] = [pos.clone(), pos.clone()];
        const trailGeo = new THREE.BufferGeometry().setFromPoints(trailBuf);
        const trailMat = new THREE.LineBasicMaterial({
          color: hex,
          transparent: true,
          opacity: 0.55,
        });
        const trail = new THREE.Line(trailGeo, trailMat);
        scene.add(trail);

        // Callsign label
        const label = makeLabel(ac.callsign, hex);
        label.position.set(pos.x, pos.y + LABEL_LIFT, pos.z);
        scene.add(label);

        acMap.set(ac.id, { cone, stem, trail, label, trailBuf });

      } else {
        // ── Update existing aircraft ───────────────────────────────────
        const b = acMap.get(ac.id)!;

        // Cone: position, heading, color
        b.cone.position.copy(pos);
        b.cone.rotation.y = headY;
        const cm = b.cone.material as THREE.MeshLambertMaterial;
        cm.color.setHex(hex);
        cm.emissive.setHex(hex);

        // Stem: replace both endpoints
        b.stem.geometry.setFromPoints([
          new THREE.Vector3(pos.x, 0, pos.z),
          new THREE.Vector3(pos.x, pos.y, pos.z),
        ]);
        b.stem.geometry.computeBoundingSphere();

        // Label
        b.label.position.set(pos.x, pos.y + LABEL_LIFT, pos.z);

        // Trail: push new point, trim oldest if at cap
        b.trailBuf.push(pos.clone());
        if (b.trailBuf.length > TRAIL_MAX) b.trailBuf.shift();

        // Rebuild trail geometry (always ≥ 2 pts)
        const pts = b.trailBuf.length >= 2 ? b.trailBuf : [b.trailBuf[0], b.trailBuf[0]];
        b.trail.geometry.setFromPoints(pts);
        b.trail.geometry.computeBoundingSphere();
        // Sync trail color in case phase changed
        (b.trail.material as THREE.LineBasicMaterial).color.setHex(hex);
      }
    }

    // ── Remove aircraft no longer in the snapshot ──────────────────────
    for (const [id, b] of acMap) {
      if (!seen.has(id)) {
        scene.remove(b.cone, b.stem, b.trail, b.label);
        disposeBundle(b);
        acMap.delete(id);
      }
    }
  }, [aircraft]);

  // ── Derived counts for the HUD ────────────────────────────────────────────
  const airborne = aircraft.filter(
    a => ['enroute-arrival','approach','landing','takeoff','departure','enroute-departure'].includes(a.phase)
  ).length;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07090F]">

      {/* Three.js canvas mount */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* ── HUD top-left ── */}
      <div className="absolute top-4 left-4 flex flex-col gap-0.5 pointer-events-none select-none">
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-600">3D · AIRSPACE</span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-slate-700">
          {airborne} AIRBORNE &nbsp;·&nbsp; {aircraft.length - airborne} GROUND
        </span>
      </div>

      {/* ── FL altitude reference labels — top-right ── */}
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
        {[
          ['#38BDF8', 'APPROACH / ARRIVAL'],
          ['#F59E0B', 'TAXI IN'],
          ['#4ADE80', 'AT GATE'],
          ['#FB923C', 'TAXI OUT'],
          ['#818CF8', 'TAKEOFF'],
          ['#C084FC', 'DEPARTURE'],
        ].map(([col, lbl]) => (
          <div key={lbl} className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: col }}
            />
            <span className="font-mono text-[9px] tracking-wider text-slate-700">{lbl}</span>
          </div>
        ))}
      </div>

      {/* ── V hint — bottom-right ── */}
      <div className="absolute bottom-4 right-4 pointer-events-none select-none">
        <span className="font-mono text-[9px] tracking-wider text-slate-800">
          [V] 2D AIRFIELD
        </span>
      </div>
    </div>
  );
}
