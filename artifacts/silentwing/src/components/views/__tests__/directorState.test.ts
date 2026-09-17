import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Aircraft } from '@/types';
import {
  runDirector,
  startFlyTo,
} from '../AirspaceView3D';

type DirectorScene = Parameters<typeof runDirector>[0];

const CAMERA_START = new THREE.Vector3(1000, 400, 1000);

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 10, 80_000);
  camera.position.copy(CAMERA_START);
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  return camera;
}

function makeScene(): DirectorScene {
  return {
    renderer: undefined as unknown as DirectorScene['renderer'],
    scene: new THREE.Scene(),
    camera: makeCamera(),
    animId: 0,
    angle: 0,
    acMap: new Map(),
    coneToId: new Map(),
    cameraMode: 'orbit',
    flyFrom: new THREE.Vector3(),
    flyTo: new THREE.Vector3(),
    flyLookFrom: new THREE.Vector3(),
    flyLookTo: new THREE.Vector3(),
    flyProgress: 1,
    selectedAcId: null,
    latestAircraftMap: new Map(),
    mouseDownX: 0,
    mouseDownY: 0,
    lastClickAcId: null,
    lastClickTime: 0,
    lastPollMs: 0,
    pollDurationMs: 8000,
    orbitRadius: 1000,
    orbitElevation: 400,
    orbitTarget: new THREE.Vector3(0, 0, 0),
    rightDragActive: false,
    rightDragLastX: 0,
    rightDragLastY: 0,
    panResumeTimer: null,
    leftDragActive: false,
    leftDragLastX: 0,
    leftDragLastY: 0,
    directorMode: true,
    alertedIds: new Map(),
    pinnedAcIds: new Set(),
    activeAlerts: [],
    beamMap: new Map(),
    pulseRingMap: new Map(),
    labelMap: new Map(),
    takeoffMap: new Map(),
    approachMap: new Map(),
    glideSlopeMap: new Map(),
    allThresholds: [],
    activeRunwayDirection: null,
    showPaths: false,
    taxiRingMap: new Map(),
    alertFocusId: null,
    alertFocusDone: null,
    dir: {
      phase: 'orbit',
      flyFrom: new THREE.Vector3(),
      flyTo: new THREE.Vector3(),
      lookFrom: new THREE.Vector3(),
      lookTo: new THREE.Vector3(),
      flyStartMs: 0,
      flyMs: 2000,
      alertId: null,
      holdUntilMs: 0,
      acId: null,
      lookAt: new THREE.Vector3(),
    },
    spawnQueue: [],
    spawnQueueIds: new Set(),
  } as DirectorScene;
}

function addBundle(
  scene: DirectorScene,
  id: string,
  phase: string,
  position: THREE.Vector3,
  isGroundVehicle = false,
): void {
  scene.acMap.set(id, {
    phase,
    renderPos: position,
    isGroundVehicle,
  } as never);
}

function addAlert(
  scene: DirectorScene,
  id: string,
  aircraftIds: string[],
  severity: 'advisory' | 'caution' | 'critical' = 'critical',
): void {
  scene.activeAlerts.push({
    id,
    kind: 'separation',
    severity,
    aircraft: aircraftIds,
    aircraftIds,
    message: 'test alert',
    raisedAt: 0,
    acknowledged: false,
  });
}

describe('startFlyTo', () => {
  it('sets the inspect transition, targets, and progress without changing DirState', () => {
    const scene = makeScene();
    const aircraft: Aircraft = {
      id: 'ac-1',
      callsign: 'TEST1',
      type: 'A320',
      phase: 'approach',
      position: { x: 100, y: 200, alt: 1000 },
      heading: 90,
      groundSpeed: 140,
      confidence: 1,
    };
    scene.latestAircraftMap.set(aircraft.id, aircraft);
    scene.dir.phase = 'hold_ac';
    scene.dir.flyMs = 777;
    scene.dir.acId = 'unchanged';
    const initialCameraPosition = scene.camera.position.clone();
    const direction = new THREE.Vector3();
    scene.camera.getWorldDirection(direction);
    const expectedLookFrom = initialCameraPosition.clone().addScaledVector(direction, 2000);

    startFlyTo(scene, aircraft.id);

    expect(scene.cameraMode).toBe('inspect');
    expect(scene.selectedAcId).toBe('ac-1');
    expect(scene.flyProgress).toBe(0);
    expect([scene.flyFrom.x, scene.flyFrom.y, scene.flyFrom.z])
      .toEqual([1000, 400, 1000]);
    expect([scene.flyTo.x, scene.flyTo.y, scene.flyTo.z])
      .toEqual([100, 850, 1600]);
    expect([scene.flyLookFrom.x, scene.flyLookFrom.y, scene.flyLookFrom.z])
      .toEqual([expectedLookFrom.x, expectedLookFrom.y, expectedLookFrom.z]);
    expect([scene.flyLookTo.x, scene.flyLookTo.y, scene.flyLookTo.z])
      .toEqual([100, 150, 200]);

    expect(scene.dir.phase).toBe('hold_ac');
    expect(scene.dir.flyMs).toBe(777);
    expect(scene.dir.acId).toBe('unchanged');
  });
});

describe('runDirector', () => {
  it('stays in orbit and advances the camera angle without targets', () => {
    const scene = makeScene();

    runDirector(scene, scene.camera, 1000);

    expect(scene.dir.phase).toBe('orbit');
    expect(scene.angle).toBe(0.00025);
    expect(scene.camera.position.x).toBeCloseTo(1000);
    expect(scene.camera.position.y).toBe(400);
    expect(scene.camera.position.z).toBeCloseTo(0.25);
  });

  it('starts an alert fly when an in-range alert has live aircraft positions', () => {
    const scene = makeScene();
    scene.alertFocusId = 'alert-1';
    addBundle(scene, 'ac-1', 'approach', new THREE.Vector3(200, 200, 200));
    addBundle(scene, 'ac-2', 'approach', new THREE.Vector3(300, 300, 300));
    addAlert(scene, 'alert-1', ['ac-1', 'ac-2']);

    runDirector(scene, scene.camera, 1000);

    expect(scene.dir.phase).toBe('fly_alert');
    expect(scene.dir.alertId).toBe('alert-1');
    expect(scene.dir.flyStartMs).toBe(1000);
    expect(scene.dir.flyMs).toBe(2000);
    expect([scene.dir.lookTo.x, scene.dir.lookTo.y, scene.dir.lookTo.z])
      .toEqual([250, 250, 250]);
  });

  it('moves an elapsed alert flight into the alert hold', () => {
    const scene = makeScene();
    scene.dir.phase = 'fly_alert';
    scene.dir.alertId = 'alert-1';
    scene.dir.flyStartMs = 1000;
    scene.dir.flyMs = 2000;
    scene.dir.flyFrom.set(0, 400, 0);
    scene.dir.flyTo.set(100, 500, 100);
    scene.dir.lookFrom.set(0, 400, 0);
    scene.dir.lookTo.set(100, 200, 100);

    runDirector(scene, scene.camera, 3000);

    expect(scene.dir.phase).toBe('hold_alert');
    expect(scene.dir.holdUntilMs).toBe(13000);
    expect([scene.camera.position.x, scene.camera.position.y, scene.camera.position.z])
      .toEqual([100, 500, 100]);
  });

  it('returns from an elapsed alert hold into the shared returning camera mode', () => {
    const scene = makeScene();
    let callbackCount = 0;
    scene.dir.phase = 'hold_alert';
    scene.dir.alertId = 'alert-1';
    scene.dir.holdUntilMs = 1000;
    scene.alertFocusId = 'alert-1';
    scene.alertFocusDone = () => { callbackCount++; };

    runDirector(scene, scene.camera, 1000);

    expect(scene.dir.phase).toBe('orbit');
    expect(scene.dir.alertId).toBeNull();
    expect(scene.alertFocusId).toBeNull();
    expect(scene.alertFocusDone).toBeNull();
    expect(scene.cameraMode).toBe('returning');
    expect(scene.flyProgress).toBe(0);
    expect(callbackCount).toBe(1);
  });

  it('starts an aircraft fly when orbit has a priority aircraft and no alert', () => {
    const scene = makeScene();
    addBundle(scene, 'ac-1', 'approach', new THREE.Vector3(100, 200, 100));

    runDirector(scene, scene.camera, 1000);

    expect(scene.dir.phase).toBe('fly_ac');
    expect(scene.dir.acId).toBe('ac-1');
    expect(scene.dir.flyStartMs).toBe(1000);
    expect(scene.dir.flyMs).toBe(3000);
    expect([scene.dir.lookTo.x, scene.dir.lookTo.y, scene.dir.lookTo.z])
      .toEqual([100, 200, 100]);
  });

  it('moves a completed aircraft flight into the aircraft hold', () => {
    const scene = makeScene();
    addBundle(scene, 'ac-1', 'takeoff', new THREE.Vector3(100, 200, 100));
    scene.dir.phase = 'fly_ac';
    scene.dir.acId = 'ac-1';
    scene.dir.flyStartMs = 1000;
    scene.dir.flyMs = 3000;
    scene.dir.flyFrom.set(0, 400, 0);
    scene.dir.lookFrom.set(0, 400, 0);

    runDirector(scene, scene.camera, 4000);

    expect(scene.dir.phase).toBe('hold_ac');
    expect(scene.dir.acId).toBe('ac-1');
    expect([scene.dir.lookAt.x, scene.dir.lookAt.y, scene.dir.lookAt.z])
      .toEqual([100, 200, 100]);
  });

  it('resolves the suppression sentinel on the next orbit frame', () => {
    const scene = makeScene();
    scene.dir.suppressUntilMs = -1;

    runDirector(scene, scene.camera, 5000);

    expect(scene.dir.suppressUntilMs).toBe(35000);
    expect(scene.dir.phase).toBe('orbit');
  });

  it('keeps the current alert hold when a more severe alert appears', () => {
    const scene = makeScene();
    scene.dir.phase = 'hold_alert';
    scene.dir.alertId = 'old-alert';
    scene.dir.holdUntilMs = 10000;
    scene.alertFocusId = 'new-alert';
    addAlert(scene, 'new-alert', ['missing-1', 'missing-2'], 'critical');

    runDirector(scene, scene.camera, 5000);

    expect(scene.dir.phase).toBe('hold_alert');
    expect(scene.dir.alertId).toBe('old-alert');
    expect(scene.alertFocusId).toBe('new-alert');
  });
});