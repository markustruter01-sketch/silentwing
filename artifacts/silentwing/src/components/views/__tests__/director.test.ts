import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { alertMidpoint, easeInOut, pickDirectorAircraft } from '../director';

describe('Director helper exports', () => {
  it('imports all three helpers as functions', () => {
    expect(easeInOut).toEqual(expect.any(Function));
    expect(pickDirectorAircraft).toEqual(expect.any(Function));
    expect(alertMidpoint).toEqual(expect.any(Function));
  });
});

describe('easeInOut', () => {
  it('returns the expected endpoints and midpoint', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
  });

  it('is symmetric around the midpoint', () => {
    expect(easeInOut(0.25)).toBe(0.125);
    expect(easeInOut(0.75)).toBe(0.875);
  });
});

type DirectorScene = Parameters<typeof pickDirectorAircraft>[0];

function makeAircraft(
  phase: string,
  x: number,
  y: number,
  z: number,
  isGroundVehicle = false,
) {
  return {
    phase,
    renderPos: new THREE.Vector3(x, y, z),
    isGroundVehicle,
  };
}

function makeScene(
  aircraft: Array<[string, ReturnType<typeof makeAircraft>]>,
  orbitTarget = new THREE.Vector3(0, 0, 0),
): DirectorScene {
  return {
    acMap: new Map(aircraft),
    orbitTarget,
  } as DirectorScene;
}

describe('pickDirectorAircraft', () => {
  it('returns null for an empty aircraft map', () => {
    expect(pickDirectorAircraft(makeScene([]))).toBeNull();
  });

  it('ignores ground vehicles', () => {
    const scene = makeScene([
      ['vehicle-1', makeAircraft('takeoff', 0, 10, 0, true)],
    ]);

    expect(pickDirectorAircraft(scene)).toBeNull();
  });

  it('prefers an in-range approach aircraft over takeoff aircraft', () => {
    const scene = makeScene([
      ['takeoff-1', makeAircraft('takeoff', 100, 10, 100)],
      ['approach-1', makeAircraft('approach', 100, 100, 100)],
    ]);

    expect(pickDirectorAircraft(scene)).toEqual({
      id: 'approach-1',
      kind: 'approach',
    });
  });

  it('keeps the first approach aircraft when the lowest altitudes tie', () => {
    const scene = makeScene([
      ['approach-first', makeAircraft('approach', 100, 100, 100)],
      ['approach-second', makeAircraft('landing', -100, 100, -100)],
    ]);

    expect(pickDirectorAircraft(scene)).toEqual({
      id: 'approach-first',
      kind: 'approach',
    });
  });
});

describe('alertMidpoint', () => {
  it('averages the first two referenced aircraft and clamps look height', () => {
    const scene = {
      activeAlerts: [{
        id: 'alert-1',
        aircraftIds: ['ac-1', 'ac-2'],
      }],
      acMap: new Map([
        ['ac-1', { renderPos: new THREE.Vector3(10, 30, 30) }],
        ['ac-2', { renderPos: new THREE.Vector3(30, 70, 50) }],
      ]),
      orbitTarget: new THREE.Vector3(0, 0, 0),
    } as DirectorScene;

    const midpoint = alertMidpoint(scene, 'alert-1');

    expect([midpoint.x, midpoint.y, midpoint.z]).toEqual([20, 50, 40]);
  });

  it('falls back to the airport centre when referenced aircraft are absent', () => {
    const orbitTarget = new THREE.Vector3(125, 0, -240);
    const scene = {
      activeAlerts: [{
        id: 'alert-1',
        aircraftIds: ['missing-1', 'missing-2'],
      }],
      acMap: new Map(),
      orbitTarget,
    } as DirectorScene;

    const midpoint = alertMidpoint(scene, 'alert-1');

    expect(midpoint).not.toBe(orbitTarget);
    expect([midpoint.x, midpoint.y, midpoint.z]).toEqual([125, 0, -240]);
  });
});