import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../../types';
import { detectPredictedConflict } from '../detectors/predictedConflict';

const PROFILE = {
  terminalRadiusNm: 30,
  terminalAltCeilFt: 10000,
};

const NM = 1852;
const TERMINAL_RADIUS_M = PROFILE.terminalRadiusNm * NM;

type AircraftOverrides = Omit<Partial<Aircraft>, 'position'> & {
  position?: Partial<Aircraft['position']>;
};

const DEFAULT_AIRCRAFT: Aircraft = {
  id: 'default',
  callsign: 'DEF001',
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

function makePair(
  firstOverrides: AircraftOverrides = {},
  secondOverrides: AircraftOverrides = {},
): Aircraft[] {
  const {
    position: firstPosition,
    ...firstAircraftOverrides
  } = firstOverrides;
  const {
    position: secondPosition,
    ...secondAircraftOverrides
  } = secondOverrides;

  return [
    makeAircraft({
      id: 'A',
      callsign: 'AAA001',
      ...firstAircraftOverrides,
      position: {
        x: 0,
        y: 0,
        ...firstPosition,
      },
    }),
    makeAircraft({
      id: 'B',
      callsign: 'BBB002',
      ...secondAircraftOverrides,
      position: {
        x: 7000,
        y: 0,
        ...secondPosition,
      },
    }),
  ];
}

function findingsFor(
  aircraft: Aircraft[],
  activeSeparationKeys: Set<string> = new Set(),
) {
  return detectPredictedConflict(aircraft, activeSeparationKeys, PROFILE);
}

describe('detectPredictedConflict heading and convergence', () => {
  it('projects heading 90 motion toward increasing x', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270 },
      ),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ttcSeconds).toBe(20);
  });

  it('finds two aircraft flying directly at each other', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270 },
      ),
    );

    expect(findings).toHaveLength(1);
  });

  it('ignores two aircraft flying directly apart', () => {
    expect(
      findingsFor(
        makePair(
          { heading: 270 },
          { heading: 90 },
        ),
      ),
    ).toHaveLength(0);
  });

  it('ignores parallel aircraft flying in the same direction without closing', () => {
    expect(
      findingsFor(
        makePair(
          { heading: 90 },
          { heading: 90 },
        ),
      ),
    ).toHaveLength(0);
  });
});

describe('detectPredictedConflict projection window', () => {
  it('does not report a breach beyond the 120-second lookahead window', () => {
    expect(
      findingsFor(
        makePair(
          { heading: 90 },
          { heading: 270, position: { x: 20000 } },
        ),
      ),
    ).toHaveLength(0);
  });

  it('reports a breach inside the lookahead window', () => {
    expect(
      findingsFor(
        makePair(
          { heading: 90 },
          { heading: 270, position: { x: 7000 } },
        ),
      ),
    ).toHaveLength(1);
  });
});

describe('detectPredictedConflict time-to-conflict severity', () => {
  it('returns critical for a breach under 45 seconds', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270, position: { x: 7000 } },
      ),
    );

    expect(findings[0]).toMatchObject({
      severity: 'critical',
      ttcSeconds: 20,
    });
  });

  it('returns caution for a breach from 45 to under 90 seconds', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270, position: { x: 10000 } },
      ),
    );

    expect(findings[0]).toMatchObject({
      severity: 'caution',
      ttcSeconds: 50,
    });
  });

  it('returns advisory for a breach at 90 seconds or later', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270, position: { x: 14000 } },
      ),
    );

    expect(findings[0]).toMatchObject({
      severity: 'advisory',
      ttcSeconds: 90,
    });
  });
});

describe('detectPredictedConflict suppression', () => {
  it('suppresses a predicted conflict when the separation key is active', () => {
    const findings = findingsFor(
      makePair(
        { heading: 90 },
        { heading: 270 },
      ),
      new Set(['separation:A:B']),
    );

    expect(findings).toHaveLength(0);
  });
});

describe('detectPredictedConflict exclusion filters', () => {
  it('excludes an aircraft marked onGround', () => {
    expect(
      findingsFor(
        makePair(
          { onGround: true, heading: 90 },
          { heading: 270 },
        ),
      ),
    ).toHaveLength(0);
  });

  it('excludes an aircraft at the 50-foot altitude floor', () => {
    expect(
      findingsFor(
        makePair(
          { position: { alt: 50 }, heading: 90 },
          { heading: 270 },
        ),
      ),
    ).toHaveLength(0);
  });

  it('excludes an aircraft below the 40-knot minimum ground speed', () => {
    expect(
      findingsFor(
        makePair(
          { groundSpeed: 39, heading: 90 },
          { heading: 270 },
        ),
      ),
    ).toHaveLength(0);
  });

  it('excludes an aircraft at the terminal altitude ceiling', () => {
    expect(
      findingsFor(
        makePair(
          { position: { alt: PROFILE.terminalAltCeilFt }, heading: 90 },
          { heading: 270 },
        ),
      ),
    ).toHaveLength(0);
  });

  it('excludes a pair when one aircraft is outside the terminal radius', () => {
    expect(
      findingsFor(
        makePair(
          {
            heading: 90,
            position: { x: TERMINAL_RADIUS_M - 1000 },
          },
          {
            heading: 270,
            position: { x: TERMINAL_RADIUS_M + 1 },
          },
        ),
      ),
    ).toHaveLength(0);
  });

  it('excludes an aircraft with a stale position fix', () => {
    expect(
      findingsFor(
        makePair(
          { seenPos: 31, heading: 90 },
          { heading: 270 },
        ),
      ),
    ).toHaveLength(0);
  });
});