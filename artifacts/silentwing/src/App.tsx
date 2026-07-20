import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D from '@/components/views/AirspaceView3D';
import { getSimAdapter } from '@/sim/engine';
import type { DataFeedAdapter, WorldSnapshot } from '@/types';

type View = 'airspace' | 'airfield';

// Derive a rough sector-load from aircraft count (≤ 99 %)
function sectorLoad(count: number) {
  return Math.min(99, count * 11);
}

// Count aircraft that are on the ground (taxiing or parked)
function groundCount(snap: WorldSnapshot) {
  return snap.aircraft.filter(ac =>
    ac.phase === 'landing'   ||
    ac.phase === 'taxi-in'   ||
    ac.phase === 'at-gate'   ||
    ac.phase === 'taxi-out',
  ).length;
}

export default function App() {
  const [view, setView] = useState<View>('airfield');

  // Adapter is created once for the lifetime of the page
  const adapter: DataFeedAdapter = useMemo(() => getSimAdapter(), []);

  // World snapshot — updated at the sim tick rate (10 Hz)
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() =>
    adapter.getSnapshotAt(Date.now()),
  );

  useEffect(() => {
    const unsub = adapter.subscribe(setSnapshot);
    return unsub;
  }, [adapter]);

  // Global hotkey handler
  const handleKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (e.key.toUpperCase()) {
      case 'V':
        setView(v => v === 'airspace' ? 'airfield' : 'airspace');
        break;
      case 'ESCAPE':
        // Phase 4: back-out chain wired here
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const feedHealth = adapter.getFeedHealth();
  const activeAlerts = adapter.getActiveAlerts();

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0A0E14] text-slate-100">
      <TopBar
        activeView={view}
        onViewChange={setView}
        feedStatus={feedHealth.status}
      />
      <StatusStrip
        aircraftCount={snapshot.aircraft.length}
        alertCount={activeAlerts.length}
        groundCount={groundCount(snapshot)}
        sectorLoad={sectorLoad(snapshot.aircraft.length)}
      />
      <main className="flex-1 relative overflow-hidden">
        {view === 'airfield' ? (
          <AirfieldView2D aircraft={snapshot.aircraft} />
        ) : (
          <AirspaceView3D aircraft={snapshot.aircraft} />
        )}
      </main>
    </div>
  );
}
