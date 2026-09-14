import { expect, it } from 'vitest';
import {
  angularDiff as adsbAngularDiff,
  activeRunwayHeadingDegrees,
  derivePhase as adsbDerivePhase,
} from '../phaseUtils';
import {
  angularDiff as openSkyAngularDiff,
  activeRunwayHeadingDegrees as activeRunwayHeadingDeg,
  derivePhase as openSkyDerivePhase,
} from '../phaseUtils';

it('imports all phase and runway helpers', () => {
  expect(typeof adsbAngularDiff).toBe('function');
  expect(typeof activeRunwayHeadingDegrees).toBe('function');
  expect(typeof adsbDerivePhase).toBe('function');
  expect(typeof openSkyAngularDiff).toBe('function');
  expect(typeof activeRunwayHeadingDeg).toBe('function');
  expect(typeof openSkyDerivePhase).toBe('function');
});