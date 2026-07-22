// ─── Airport context ──────────────────────────────────────────────────────────
//
// Provides the active AirportProfile to any React component in the tree without
// prop-drilling.  View components (AirspaceView3D, AirfieldView2D) call
// useAirport() to get geometry, viewbox dimensions, and annotation positions.
//
// There is currently only one airport (YBBN).  When a second airport is added,
// swap the value prop on AirportProvider — no component internals need to change.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { YBBN } from './ybbn';
import type { AirportProfile } from './types';

const AirportContext = createContext<AirportProfile>(YBBN);

/**
 * Read the active airport profile from context.
 * Must be called inside a component tree wrapped by <AirportProvider>.
 * Falls back to YBBN if no provider is present (safe default for tests).
 */
export function useAirport(): AirportProfile {
  return useContext(AirportContext);
}

/**
 * Provides the active airport profile to all descendant components.
 * Wrap the view section of the component tree (or the full App) with this.
 */
export function AirportProvider({
  profile = YBBN,
  children,
}: {
  profile?: AirportProfile;
  children: ReactNode;
}) {
  return (
    <AirportContext.Provider value={profile}>
      {children}
    </AirportContext.Provider>
  );
}
