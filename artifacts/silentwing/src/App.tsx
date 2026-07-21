import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar     from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D, { type CameraMode } from '@/components/views/AirspaceView3D';
import AircraftDetailPanel from '@/components/panels/AircraftDetailPanel';
import { getSimAdapter } from '@/sim/engine';
import type { DataFeedAdapter, WorldSnapshot } from '@/types';
import { isAirborne } from '@/types';

type View = 'airspace' | 'airfield';

// Derive a rough sector-load from aircraft count (≤ 99 %)
// NOTE: placeholder — will be replaced with a real demand metric in Phase 7.
function sectorLoad(count: number) {
  return Math.min(99, count * 11);
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

  // ── Selection & camera state ─────────────────────────────────────────────
  const [selectedAcId, setSelectedAcId] = useState<string | null>(null);
  const [cameraMode, setCameraMode]     = useState<CameraMode>('orbit');

  // Derive the selected aircraft object from the current snapshot
  const selectedAc = snapshot.aircraft.find(a => a.id === selectedAcId) ?? null;

  // If the selected aircraft leaves the snapshot (despawned), clear selection
  useEffect(() => {
    if (selectedAcId && !snapshot.aircraft.find(a => a.id === selectedAcId)) {
      console.log(`[APP] selected aircraft ${selectedAcId} despawned — clearing selection`);
      setSelectedAcId(null);
      setCameraMode(prev => (prev === 'orbit' ? 'orbit' : 'manual'));
    }
  }, [snapshot.aircraft, selectedAcId]);

  // Close panel helper — used by × button and by 2D Esc
  const handleClosePanel = useCallback(() => {
    console.log('[APP] panel closed via UI');
    setSelectedAcId(null);
    setCameraMode(prev => (prev === 'orbit' ? 'orbit' : 'manual'));
  }, []);

  // Follow toggle from panel button
  const handleToggleFollow = useCallback(() => {
    setCameraMode(prev => {
      const next = prev === 'follow' ? 'inspect' : 'follow';
      console.log(`[APP] follow toggle: ${prev} → ${next}`);
      return next;
    });
  }, []);

  // ── Global keyboard handler ──────────────────────────────────────────────
  // The 3D view handles its own Esc chain internally; we handle 2D Esc here.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key.toUpperCase() === 'V') {
      setView(v => v === 'airspace' ? 'airfield' : 'airspace');
      return;
    }

    if (e.key === 'Escape' && viewRef.current === 'airfield') {
      // 2D view Esc — deselect aircraft
      if (selectedAcId) {
        console.log('[APP] Esc in 2D view: deselect');
        setSelectedAcId(null);
      }
    }
    // 3D view Esc is handled entirely within AirspaceView3D's keydown listener.
  }, [selectedAcId]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const feedHealth   = adapter.getFeedHealth();
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
        groundCount={snapshot.aircraft.filter(ac => !isAirborne(ac)).length}
        sectorLoad={sectorLoad(snapshot.aircraft.length)}
      />

      {/* ── Main view area ── */}
      <main className="flex-1 relative overflow-hidden">
        {view === 'airfield' ? (
          <AirfieldView2D
            aircraft={snapshot.aircraft}
            selectedAircraftId={selectedAcId}
            onAircraftClick={(id) => {
              console.log(`[APP] 2D aircraft click: ${id}`);
              setSelectedAcId(id);
            }}
          />
        ) : (
          <AirspaceView3D
            aircraft={snapshot.aircraft}
            selectedAcId={selectedAcId}
            cameraMode={cameraMode}
            onSelectAircraft={(id) => {
              console.log(`[APP] 3D select: ${id ?? 'null'}`);
              setSelectedAcId(id);
            }}
            onCameraMode={(mode) => {
              console.log(`[APP] camera mode: ${mode}`);
              setCameraMode(mode);
            }}
          />
        )}

        {/* ── Aircraft detail panel — shared overlay for both views ── */}
        {selectedAc && (
          <AircraftDetailPanel
            ac={selectedAc}
            followMode={cameraMode === 'follow'}
            onClose={handleClosePanel}
            onToggleFollow={handleToggleFollow}
          />
        )}
      </main>
    </div>
  );
}
