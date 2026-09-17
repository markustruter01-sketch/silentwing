import * as THREE from 'three';
import {
  MIN_LOOK_Y,
  ORBIT_RADIUS,
  ORBIT_SPEED,
  toV3,
} from './AirspaceView3D';
import type { SceneState } from './AirspaceView3D';

// ── Director-only constants ────────────────────────────────────────────────────
/** Maximum horizontal distance from the airport centre at which the director
 *  will focus on an alert.  Set to 50% of ORBIT_RADIUS so the camera stays
 *  within the airport's visual footprint and ignores distant enroute traffic. */
const DIRECTOR_MAX_ALERT_DIST = ORBIT_RADIUS * 0.5; // 1 700 m

// Camera offset from aircraft for inspect / follow modes
// (south and above: Z=south in Three.js coordinate space)
const INSPECT_OFFSET = new THREE.Vector3(0, 700, 1400);

// Director camera offset from aircraft — wider than the normal inspect shot so
// the full approach/departure path context is visible.
const DIRECTOR_CAM_OFFSET = new THREE.Vector3(0, 1_200, 2_400);

// Maximum horizontal distance (world units ≈ metres) from the airport centre
// at which the director will pick up an aircraft.  Keeps the camera focused on
// the immediate airspace rather than following traffic 100 NM away.
// 5 000 m ≈ 2.7 NM — roughly the outer edge of the circuit / final approach.
const DIRECTOR_FOCUS_RADIUS = 5_000;

// How long the director stays out of the way after the operator presses
// Escape. Alerts are exempt — only routine subject-picking is paused.
const DIRECTOR_ESC_COOLDOWN_MS = 30_000;

// ── Helpers ────────────────────────────────────────────────────────────────────
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Pick the highest-priority aircraft for the director.
 *  Approach/landing (closest to threshold first) > takeoff > null. */
export function pickDirectorAircraft(st: SceneState): { id: string; kind: 'approach' | 'takeoff' } | null {
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
export function alertMidpoint(st: SceneState, alertId: string): THREE.Vector3 {
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
export function runDirector(st: SceneState, camera: THREE.PerspectiveCamera, nowMs: number): void {
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

      // Resolve the deferred cooldown set by the Escape handler.
      if (d.suppressUntilMs === -1) d.suppressUntilMs = nowMs + DIRECTOR_ESC_COOLDOWN_MS;
      // Orbit re-picks a subject on the very next frame, so without this the
      // aircraft the operator just dismissed is re-acquired instantly and
      // Escape looks broken. Alerts are unaffected — that check runs above
      // this switch and still interrupts normally.
      if (nowMs < (d.suppressUntilMs ?? 0)) break;

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
export function startFlyTo(st: SceneState, acId: string): void {
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