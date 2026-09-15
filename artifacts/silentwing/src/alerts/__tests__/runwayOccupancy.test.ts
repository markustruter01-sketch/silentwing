import { describe, expect, it } from 'vitest';
import type { Polyline } from '../../data/ybbn_real';
import type { Aircraft } from '../../types';
import { detectRunwayOccupancy } from '../detectors/runwayOccupancy';

const RUNWAY: Polyline = {
  ref: 'TEST-EW',
  coords: [
    [-1500, 0],
    [1500, 0],
  ],
};

const PROFILE = {
  terminalRadiusNm: 30,
  geometry: { runways: [RUNWAY] },
};

type AircraftOverrides = Omit<Partial<Aircraft>, 'position'> & {
  position?: Partial<Aircraft['position']>;
};

const DEFAULT_AIRCRAFT: Aircraft = {
  id: 'A',
  callsign: 'AAA001',
  type: 'A320',
  phase: 'taxi-out',
  position: { x: 0, y: 0, alt: 100 },
  heading: 90,
  groundSpeed: 0,
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

function findingsFor(
  aircraft: Aircraft[],
  profile = PROFILE,
) {
  return detectRunwayOccupancy(aircraft, profile);
}

describe('detectRunwayOccupancy synthetic runway geometry', () => {
  it('detects two aircraft when one is plainly on the runway centreline', () => {
    const findings = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 0 },
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.runwayRef).toBe('TEST-EW');
  });

  it('returns no finding for one aircraft alone in the corridor', () => {
    expect(findingsFor([makeAircraft()])).toHaveLength(0);
  });

  it('returns a finding for two aircraft in the corridor', () => {
    const findings = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 50 },
      }),
    ]);

    expect(findings).toHaveLength(1);
  });

  it('flips north-positive runway geometry to match south-positive aircraft positions', () => {
    const offsetProfile = {
      terminalRadiusNm: 30,
      geometry: {
        runways: [
          {
            ref: 'OFFSET-EW',
            coords: [
              [-1500, 100],
              [1500, 100],
            ],
          },
        ],
      },
    };
    const findings = findingsFor(
      [
        makeAircraft({ position: { x: -500, y: -100 } }),
        makeAircraft({
          id: 'B',
          callsign: 'BBB002',
          position: { x: 500, y: -100 },
        }),
      ],
      offsetProfile,
    );

    expect(findings[0]?.runwayRef).toBe('OFFSET-EW');
  });

  it('includes an aircraft 59 metres off the centreline but excludes one at 61 metres', () => {
    const insideFindings = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 59 },
      }),
    ]);
    const outsideFindings = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 61 },
      }),
    ]);

    expect(insideFindings).toHaveLength(1);
    expect(outsideFindings).toHaveLength(0);
  });

  it('includes an aircraft within the 500-metre end extension but excludes one beyond it', () => {
    const insideFindings = findingsFor([
      makeAircraft({ position: { x: 0, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 1900, y: 0 },
      }),
    ]);
    const outsideFindings = findingsFor([
      makeAircraft({ position: { x: 0, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 2101, y: 0 },
      }),
    ]);

    expect(insideFindings).toHaveLength(1);
    expect(outsideFindings).toHaveLength(0);
  });

  it('includes altitude 499 feet but excludes altitude 500 feet', () => {
    const belowCutoff = findingsFor([
      makeAircraft({ position: { x: -500, y: 0, alt: 100 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 0, alt: 499 },
      }),
    ]);
    const atCutoff = findingsFor([
      makeAircraft({ position: { x: -500, y: 0, alt: 100 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 0, alt: 500 },
      }),
    ]);

    expect(belowCutoff).toHaveLength(1);
    expect(atCutoff).toHaveLength(0);
  });

  it('includes seenPos 60 seconds but excludes seenPos 61 seconds', () => {
    const freshEnough = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 }, seenPos: 60 }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 0 },
      }),
    ]);
    const tooStale = findingsFor([
      makeAircraft({ position: { x: -500, y: 0 }, seenPos: 61 }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        position: { x: 500, y: 0 },
      }),
    ]);

    expect(freshEnough).toHaveLength(1);
    expect(tooStale).toHaveLength(0);
  });
});

describe('detectRunwayOccupancy severity', () => {
  it('returns critical when both occupants are moving above 5 knots', () => {
    const findings = findingsFor([
      makeAircraft({ groundSpeed: 6, position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        groundSpeed: 6,
        position: { x: 500, y: 0 },
      }),
    ]);

    expect(findings[0]?.severity).toBe('critical');
  });

  it('returns caution when only one occupant is moving above 5 knots', () => {
    const findings = findingsFor([
      makeAircraft({ groundSpeed: 6, position: { x: -500, y: 0 } }),
      makeAircraft({
        id: 'B',
        callsign: 'BBB002',
        groundSpeed: 5,
        position: { x: 500, y: 0 },
      }),
    ]);

    expect(findings[0]?.severity).toBe('caution');
  });
});