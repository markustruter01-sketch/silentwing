import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../../types';
import { detectSeparation } from '../detectors/separation';

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
  return [
    makeAircraft({
      id: 'A',
      callsign: 'AAA001',
      ...firstOverrides,
    }),
    makeAircraft({
      id: 'B',
      callsign: 'BBB002',
      position: { x: 1000, y: 0 },
      ...secondOverrides,
    }),
  ];
}

function findingsFor(aircraft: Aircraft[]) {
  return detectSeparation(aircraft, PROFILE);
}

describe('detectSeparation exclusion filters', () => {
  it('excludes an aircraft marked onGround', () => {
    expect(findingsFor(makePair({ onGround: true }))).toHaveLength(0);
  });

  it('excludes altitude exactly 50 feet but accepts 51 feet', () => {
    const at50 = makePair(
      { position: { alt: 50 } },
      { position: { x: 1000, y: 0, alt: 100 } },
    );
    const at51 = makePair(
      { position: { alt: 51 } },
      { position: { x: 1000, y: 0, alt: 100 } },
    );

    expect(findingsFor(at50)).toHaveLength(0);
    expect(findingsFor(at51)).toHaveLength(1);
  });

  it('excludes ground speed exactly 39 knots but accepts 40 knots', () => {
    expect(findingsFor(makePair({ groundSpeed: 39 }))).toHaveLength(0);
    expect(findingsFor(makePair({ groundSpeed: 40 }))).toHaveLength(1);
  });

  it('excludes altitude exactly at the ceiling but accepts one foot below', () => {
    const atCeiling = makePair(
      { position: { alt: PROFILE.terminalAltCeilFt } },
      { position: { x: 1000, y: 0, alt: 9500 } },
    );
    const belowCeiling = makePair(
      { position: { alt: PROFILE.terminalAltCeilFt - 1 } },
      { position: { x: 1000, y: 0, alt: 9500 } },
    );

    expect(findingsFor(atCeiling)).toHaveLength(0);
    expect(findingsFor(belowCeiling)).toHaveLength(1);
  });

  it('excludes a pair when one aircraft is just outside the terminal radius', () => {
    const justOutside = makePair(
      { position: { x: TERMINAL_RADIUS_M - 1, y: 0 } },
      { position: { x: TERMINAL_RADIUS_M + 1, y: 0 } },
    );
    const justInside = makePair(
      { position: { x: TERMINAL_RADIUS_M - 1000, y: 0 } },
      { position: { x: TERMINAL_RADIUS_M - 1, y: 0 } },
    );

    expect(findingsFor(justOutside)).toHaveLength(0);
    expect(findingsFor(justInside)).toHaveLength(1);
  });

  it('treats seenPos exactly 30 seconds as fresh but excludes 31 seconds', () => {
    expect(findingsFor(makePair({ seenPos: 30 }))).toHaveLength(1);
    expect(findingsFor(makePair({ seenPos: 31 }))).toHaveLength(0);
  });

  it('treats an undefined seenPos as fresh', () => {
    expect(findingsFor(makePair())).toHaveLength(1);
  });
});

describe('detectSeparation severity bands', () => {
  it('returns critical for 1.0 nm and 500 feet', () => {
    const findings = findingsFor(
      makePair({}, { position: { x: 1.0 * NM, y: 0, alt: 5500 } }),
    );

    expect(findings[0]?.severity).toBe('critical');
  });

  it('returns caution for 2.0 nm and 800 feet', () => {
    const findings = findingsFor(
      makePair({}, { position: { x: 2.0 * NM, y: 0, alt: 5800 } }),
    );

    expect(findings[0]?.severity).toBe('caution');
  });

  it('returns advisory for 4.0 nm and 1200 feet', () => {
    const findings = findingsFor(
      makePair({}, { position: { x: 4.0 * NM, y: 0, alt: 6200 } }),
    );

    expect(findings[0]?.severity).toBe('advisory');
  });

  it('returns no finding for 6.0 nm and 100 feet', () => {
    expect(
      findingsFor(makePair({}, { position: { x: 6.0 * NM, y: 0, alt: 5100 } })),
    ).toHaveLength(0);
  });

  it('returns no finding for 1.0 nm and 1600 feet', () => {
    expect(
      findingsFor(makePair({}, { position: { x: 1.0 * NM, y: 0, alt: 6600 } })),
    ).toHaveLength(0);
  });

  it('returns caution at exactly 1.5 nm when vertical separation is 500 feet', () => {
    const findings = findingsFor(
      makePair({}, { position: { x: 1.5 * NM, y: 0, alt: 5500 } }),
    );

    expect(findings[0]?.severity).toBe('caution');
  });

  it('returns caution at exactly 700 feet when horizontal separation is 1.0 nm', () => {
    const findings = findingsFor(
      makePair({}, { position: { x: 1.0 * NM, y: 0, alt: 5700 } }),
    );

    expect(findings[0]?.severity).toBe('caution');
  });
});

describe('detectSeparation pair identity', () => {
  it('uses the same stable key regardless of input order', () => {
    const forward = makePair();
    const reverse = [...forward].reverse();

    expect(findingsFor(forward)[0]?.key).toBe('separation:A:B');
    expect(findingsFor(reverse)[0]?.key).toBe('separation:A:B');
  });

  it('returns one finding for each breached pair among three aircraft', () => {
    const aircraft = [
      makeAircraft({ id: 'A', callsign: 'AAA001', position: { x: 0, y: 0 } }),
      makeAircraft({ id: 'B', callsign: 'BBB002', position: { x: 1000, y: 0 } }),
      makeAircraft({ id: 'C', callsign: 'CCC003', position: { x: 2000, y: 0 } }),
    ];

    expect(findingsFor(aircraft)).toHaveLength(3);
    expect(findingsFor(aircraft).map(finding => finding.key)).toEqual([
      'separation:A:B',
      'separation:A:C',
      'separation:B:C',
    ]);
  });
});