import { describe, expect, it } from 'vitest';
import type { AirportProfile } from '../../airports/types';
import type { GatePos } from '../../data/ybbn_real';
import {
  angularDiff as adsbAngularDiff,
  activeRunwayHeadingDegrees,
  derivePhase as adsbDerivePhase,
} from '../adsbAdapter';
import {
  angularDiff as openSkyAngularDiff,
  activeRunwayHeadingDeg,
  derivePhase as openSkyDerivePhase,
} from '../openSkyAdapter';

const angularCases = [
  { name: 'identical headings', a: 90, b: 90, expected: 0 },
  { name: '10 versus 350', a: 10, b: 350, expected: 20 },
  { name: 'exactly 180 apart', a: 0, b: 180, expected: 180 },
  { name: '181 apart', a: 0, b: 181, expected: 179 },
  { name: '720 versus 0', a: 720, b: 0, expected: 0 },
  { name: 'one negative input', a: -10, b: 0, expected: 10 },
] as const;

for (const [adapterName, angularDiff] of [
  ['ADS-B', adsbAngularDiff],
  ['OpenSky', openSkyAngularDiff],
] as const) {
  describe(`${adapterName} angularDiff`, () => {
    for (const testCase of angularCases) {
      it(testCase.name, () => {
        expect(angularDiff(testCase.a, testCase.b)).toBe(testCase.expected);
      });
    }
  });
}

type RunwayProfile = Pick<AirportProfile, 'runways'>;

const suffixRunwayProfile: RunwayProfile = {
  runways: [
    {
      ref: '18C/36C',
      lowDesignator: '18C',
      highDesignator: '36C',
      headingDeg: 180,
    },
    {
      ref: '27R/09L',
      lowDesignator: '27R',
      highDesignator: '09L',
      headingDeg: 270,
    },
  ],
};

const sharedStemRunwayProfile: RunwayProfile = {
  runways: [
    {
      ref: '18C/36C',
      lowDesignator: '18C',
      highDesignator: '36C',
      headingDeg: 180,
    },
    {
      ref: '18/36',
      lowDesignator: '18',
      highDesignator: '36',
      headingDeg: 181,
    },
  ],
};

const activeHeadingCases = [
  {
    name: 'low designator stem',
    profile: suffixRunwayProfile,
    stem: '18',
    expected: 180,
  },
  {
    name: 'high designator stem',
    profile: suffixRunwayProfile,
    stem: '36',
    expected: 0,
  },
  {
    name: 'trailing R omitted from low designator',
    profile: suffixRunwayProfile,
    stem: '27',
    expected: 270,
  },
  {
    name: 'trailing L omitted from high designator',
    profile: suffixRunwayProfile,
    stem: '09',
    expected: 90,
  },
  {
    name: 'unmatched stem',
    profile: suffixRunwayProfile,
    stem: '99',
    expected: undefined,
  },
  {
    name: 'two runways sharing a stem use the first match',
    profile: sharedStemRunwayProfile,
    stem: '18',
    expected: 180,
  },
] as const;

for (const [adapterName, activeRunwayHeading] of [
  ['ADS-B', activeRunwayHeadingDegrees],
  ['OpenSky', activeRunwayHeadingDeg],
] as const) {
  describe(`${adapterName} active runway heading`, () => {
    for (const testCase of activeHeadingCases) {
      it(testCase.name, () => {
        expect(activeRunwayHeading(testCase.profile, testCase.stem)).toBe(testCase.expected);
      });
    }
  });
}

const gateAtOrigin: GatePos[] = [{ ref: 'G1', pos: [0, 0] }];

type DerivePhaseArgs = Parameters<typeof adsbDerivePhase>;
type PhaseCase = {
  name: string;
  args: DerivePhaseArgs;
  expected: ReturnType<typeof adsbDerivePhase>;
};

export const derivePhaseCases: PhaseCase[] = [
  {
    name: 'ground below 50 ft, slow and inside the gate radius',
    args: [49, 1, 0, 0, 0, gateAtOrigin, 0, undefined],
    expected: 'at-gate',
  },
  {
    name: 'ground speed exactly 2 is taxiing',
    args: [49, 2, 0, 0, 0, gateAtOrigin, 0, undefined],
    expected: 'taxi-in',
  },
  {
    name: 'ground below 50 ft far from every gate',
    args: [49, 1, 0, 1000, 1000, gateAtOrigin, 0, undefined],
    expected: 'taxi-in',
  },
  {
    name: 'ground below 50 ft with no gates',
    args: [49, 1, 0, 0, 0, [], 0, undefined],
    expected: 'taxi-in',
  },
  {
    name: 'positive gate y matches negative aircraft y after the axis flip',
    args: [49, 1, 0, 0, -60, [{ ref: 'G2', pos: [0, 60] }], 0, undefined],
    expected: 'at-gate',
  },
  {
    name: 'gate distance exactly 60 metres',
    args: [49, 1, 0, 60, 0, gateAtOrigin, 0, undefined],
    expected: 'at-gate',
  },
  {
    name: 'gate distance 61 metres',
    args: [49, 1, 0, 61, 0, gateAtOrigin, 0, undefined],
    expected: 'taxi-in',
  },
  {
    name: 'altitude 49 feet',
    args: [49, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'taxi-in',
  },
  {
    name: 'altitude 50 feet',
    args: [50, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'takeoff',
  },
  {
    name: 'altitude 499 feet',
    args: [499, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'takeoff',
  },
  {
    name: 'altitude 500 feet',
    args: [500, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'departure',
  },
  {
    name: 'altitude 2999 feet',
    args: [2999, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'departure',
  },
  {
    name: 'altitude 3000 feet',
    args: [3000, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'enroute-departure',
  },
  {
    name: 'vertical rate exactly 200 ft per minute',
    args: [600, 100, 200, 1000, 1000, [], 0, undefined],
    expected: 'approach',
  },
  {
    name: 'vertical rate 201 ft per minute',
    args: [600, 100, 201, 1000, 1000, [], 0, undefined],
    expected: 'departure',
  },
  {
    name: 'negative vertical rate',
    args: [600, 100, -1, 1000, 1000, [], 0, undefined],
    expected: 'approach',
  },
  {
    // Known current bug: a departure tracking along the active runway returns "landing".
    name: 'no vertical rate, speed 80, track aligned with active runway',
    args: [100, 80, undefined, 1000, 1000, [], 90, 90],
    expected: 'landing',
  },
  {
    name: 'no vertical rate, speed 80, track opposed to active runway',
    args: [100, 80, undefined, 1000, 1000, [], 270, 90],
    expected: 'takeoff',
  },
  {
    name: 'no vertical rate and no active runway heading',
    args: [100, 80, undefined, 1000, 1000, [], 90, undefined],
    expected: 'landing',
  },
];

for (const [adapterName, derivePhase] of [
  ['ADS-B', adsbDerivePhase],
  ['OpenSky', openSkyDerivePhase],
] as const) {
  describe(`${adapterName} derivePhase characterization`, () => {
    for (const testCase of derivePhaseCases) {
      it(testCase.name, () => {
        expect(derivePhase(...testCase.args)).toBe(testCase.expected);
      });
    }
  });
}