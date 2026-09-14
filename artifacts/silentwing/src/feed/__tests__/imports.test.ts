import { expect, it } from 'vitest';
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

it('imports all phase and runway helpers', () => {
  expect(typeof adsbAngularDiff).toBe('function');
  expect(typeof activeRunwayHeadingDegrees).toBe('function');
  expect(typeof adsbDerivePhase).toBe('function');
  expect(typeof openSkyAngularDiff).toBe('function');
  expect(typeof activeRunwayHeadingDeg).toBe('function');
  expect(typeof openSkyDerivePhase).toBe('function');
});