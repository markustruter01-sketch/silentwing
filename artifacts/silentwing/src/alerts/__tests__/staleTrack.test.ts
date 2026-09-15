import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../../types';
import { detectStaleTracks } from '../detectors/staleTrack';

type AircraftOverrides = Omit<Partial<Aircraft>, 'position'> & {
  position?: Partial<Aircraft['position']>;
};

const DEFAULT_AIRCRAFT: Aircraft = {
  id: 'A',
  callsign: 'AAA001',
  type: 'A320',
  phase: 'enroute-arrival',
  position: { x: 0, y: 0, alt: 5000 },
  heading: 90,
  groundSpeed: 100,
  confidence: 1,
};

function makeAircraft(overrides: AircraftOverrides = {}): Aircraft {
  const { position: positionOverrides, ...aircraftOverrides } = overrides;

  return {
    ...DEFAULT_AIRCRAFT,
    ...aircraftOverrides,
    position: {
      ...DEFAULT_AIRCRAFT.position,
      ...positionOverrides,
    },
  };
}

function findingsFor(aircraft: Aircraft[]) {
  return detectStaleTracks(aircraft);
}

describe('detectStaleTracks thresholds', () => {
  for (const [seenPos, expectedSeverity] of [
    [29, undefined],
    [30, 'advisory'],
    [59, 'advisory'],
    [60, 'caution'],
  ] as const) {
    it(`returns ${expectedSeverity ?? 'no finding'} at seenPos ${seenPos}`, () => {
      const findings = findingsFor([makeAircraft({ seenPos })]);

      expect(findings[0]?.severity).toBe(expectedSeverity);
      expect(findings).toHaveLength(expectedSeverity ? 1 : 0);
    });
  }

  it('treats an undefined seenPos as fresh', () => {
    expect(findingsFor([makeAircraft()])).toHaveLength(0);
  });
});

describe('detectStaleTracks anonymous and ground handling', () => {
  it('suppresses an anonymous aircraft that is on the ground', () => {
    expect(
      findingsFor([
        makeAircraft({
          id: 'ANON1',
          callsign: 'ANON1',
          seenPos: 31,
          onGround: true,
          groundSpeed: 0,
        }),
      ),
    ).toHaveLength(0);
  });

  it('reports the same anonymous aircraft when airborne and moving', () => {
    const findings = findingsFor([
      makeAircraft({
        id: 'ANON1',
        callsign: 'ANON1',
        seenPos: 31,
        onGround: false,
        groundSpeed: 10,
      }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('reports a named stale aircraft on the ground', () => {
    const findings = findingsFor([
      makeAircraft({
        id: 'HEX123',
        callsign: 'QFA123',
        seenPos: 31,
        onGround: true,
        groundSpeed: 0,
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('advisory');
  });
});

describe('detectStaleTracks nearby traffic note', () => {
  it('mentions nearby traffic within 10 nm and omits it when none is nearby', () => {
    const withNearby = findingsFor([
      makeAircraft({
        seenPos: 31,
        position: { x: 0, y: 0 },
      }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        seenPos: 0,
        position: { x: 10000, y: 0 },
      }),
    ]);
    const withoutNearby = findingsFor([
      makeAircraft({
        seenPos: 31,
        position: { x: 0, y: 0 },
      }),
    ]);

    expect(withNearby[0]?.message).toContain('1 aircraft nearby');
    expect(withoutNearby[0]?.message).not.toContain('nearby');
  });
});