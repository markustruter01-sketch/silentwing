import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar     from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D, { type CameraMode } from '@/components/views/AirspaceView3D';
import AircraftDetailPanel from '@/components/panels/AircraftDetailPanel';
import ControlsHUD from '@/components/ui/ControlsHUD';
import { getSimAdapter } from '@/sim/engine';
import { AdsbAdapter } from '@/feed/adsbAdapter';
import type { DataFeedAdapter, WorldSnapshot } from '@/types';
import { isAirborne } from '@/types';

type View = 'airspace' | 'airfield';
export type DataSource = 'sim' | 'live';

// Derive a rough sector-load from aircraft count (≤ 99 %)
// NOTE: placeholder — will be replaced with a real demand metric in Phase 7.
function sectorLoad(count: number) {
  return Math.min(99, count * 11);
}

export default function App() {
  const [view, setView] = useState<View>('airspace');

  // ── Data source toggle ───────────────────────────────────────────────────
  const [dataSource, setDataSource] = useState<DataSource>('live');

  // Adapter is (re-)created whenever dataSource changes.
  // useMemo keeps the same instance as long as dataSource is stable.
  const adapter = useMemo<DataFeedAdapter>(() => {
    return dataSource === 'live' ? new AdsbAdapter() : getSimAdapter();
  }, [dataSource]);

  // Destroy the ADS-B adapter instance when it's replaced (dataSource change
  // or component unmount). The sim adapter is a singleton and must NOT be
  // destroyed — only the ADS-B adapter has a destroy() method.
  useEffect(() => {
    return () => {
      if (adapter instanceof AdsbAdapter) adapter.destroy();
    };
  }, [adapter]);

  // ── World snapshot ───────────────────────────────────────────────────────
  // Resets immediately when adapter changes so stale aircraft don't linger.
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() =>
    adapter.getSnapshotAt(Date.now()),
  );

  useEffect(() => {
    setSnapshot(adapter.getSnapshotAt(Date.now()));
    const unsub = adapter.subscribe(setSnapshot);
    return unsub;
  }, [adapter]);

  // ── Selection & camera state ─────────────────────────────────────────────
  const [selectedAcId, setSelectedAcId] = useState<string | null>(null);
  const [cameraMode, setCameraMode]     = useState<CameraMode>('orbit');

  // Derive the selected aircraft object from the current snapshot
  const selectedAc = snapshot.aircraft.find(a => a.id === selectedAcId) ?? null;

  // If the selected aircraft leaves the snapshot (despawned / source switched),
  // clear selection.
  useEffect(() => {
    if (selectedAcId && !snapshot.aircraft.find(a => a.id === selectedAcId)) {
      console.log(`[APP] selected aircraft ${selectedAcId} left snapshot — clearing selection`);
      setSelectedAcId(null);
      setCameraMode(prev => (prev === 'orbit' ? 'orbit' : 'manual'));
    }
  }, [snapshot.aircraft, selectedAcId]);

  // Also clear selection when the data source changes (IDs are not shared
  // between sim and live feeds).
  useEffect(() => {
    setSelectedAcId(null);
    setCameraMode('orbit');
  }, [dataSource]);

  // Close panel helper — used by × button and by 2D Esc
  const handleClosePanel = useCallback(() => {
    console.log('[APP] panel closed via UI');
    setSelectedAcId(null);
    setCameraMode('orbit'); // triggers smooth return-to-orbit in the 3D view
  }, []);

  // Follow toggle from panel button
  const handleToggleFollow = useCallback(() => {
    setCameraMode(prev => {
      const next = prev === 'follow' ? 'inspect' : 'follow';
      console.log(`[APP] follow toggle: ${prev} → ${next}`);
      return next;
    });
  }, []);

  // ── Predicted paths toggle ───────────────────────────────────────────────
  const [showPredictedPaths, setShowPredictedPaths] = useState(false);

  // ── Display filters (hide from rendering; data is always fully ingested) ──
  /** Hide category-C2 ground vehicles and TWR stations (default ON). */
  const [hideGroundVehicles, setHideGroundVehicles] = useState(true);
  /** Hide contacts whose callsign is just their hex code — no real flight ID. */
  const [hideAnonymous, setHideAnonymous] = useState(false);

  /** Aircraft that pass the current display filters — passed to both views. */
  const visibleAircraft = useMemo(() =>
    snapshot.aircraft.filter(ac => {
      if (hideGroundVehicles && ac.isGroundVehicle) return false;
      if (hideAnonymous && ac.callsign === ac.id)   return false;
      return true;
    }),
    [snapshot.aircraft, hideGroundVehicles, hideAnonymous],
  );

  // ── Global keyboard handler ──────────────────────────────────────────────
  // The 3D view handles its own Esc chain internally; we handle 2D Esc here.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const key = e.key.toUpperCase();

    if (key === 'V') {
      setView(v => v === 'airspace' ? 'airfield' : 'airspace');
      return;
    }

    // P — toggle predicted paths overlay (rendering deferred to Phase 5)
    if (key === 'P') {
      setShowPredictedPaths(prev => {
        const next = !prev;
        console.log(`[APP] P: predicted paths ${next ? 'ON' : 'OFF'}`);
        return next;
      });
      return;
    }

    // L — snap data source to LIVE
    if (key === 'L') {
      console.log('[APP] L: snap to LIVE feed');
      setDataSource('live');
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
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
      />
      <StatusStrip
        aircraftCount={visibleAircraft.length}
        alertCount={activeAlerts.length}
        groundCount={visibleAircraft.filter(ac => !isAirborne(ac)).length}
        sectorLoad={sectorLoad(visibleAircraft.length)}
      />

      {/* ── Display filters ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-[3px] bg-[#060A0F] border-b border-slate-800/30 shrink-0">
        <span className="text-[8px] tracking-[0.2em] text-slate-600 uppercase select-none">Filters</span>
        {([
          ['Hide vehicles',  hideGroundVehicles, setHideGroundVehicles],
          ['Hide anonymous', hideAnonymous,       setHideAnonymous],
        ] as [string, boolean, React.Dispatch<React.SetStateAction<boolean>>][]).map(([label, on, set]) => (
          <button
            key={label}
            onClick={() => set(v => !v)}
            className={[
              'flex items-center gap-1 px-2 py-[2px] text-[8px] tracking-widest uppercase rounded',
              'border transition-colors select-none cursor-pointer',
              on
                ? 'border-cyan-700/60 text-cyan-400 bg-cyan-900/15'
                : 'border-slate-700/50 text-slate-500 hover:text-slate-400',
            ].join(' ')}
          >
            <span className={on ? 'text-cyan-500' : 'text-slate-600'}>{on ? '●' : '○'}</span>
            {label}
          </button>
        ))}
        <span className="ml-auto text-[8px] text-slate-700 tabular-nums select-none">
          {snapshot.aircraft.length - visibleAircraft.length > 0
            ? `${snapshot.aircraft.length - visibleAircraft.length} hidden`
            : ''}
        </span>
      </div>

      {/* ── Main view area ── */}
      <main className="flex-1 relative overflow-hidden">
        {view === 'airfield' ? (
          <AirfieldView2D
            aircraft={visibleAircraft}
            selectedAircraftId={selectedAcId}
            onAircraftClick={(id) => {
              console.log(`[APP] 2D aircraft click: ${id}`);
              setSelectedAcId(id);
            }}
          />
        ) : (
          <AirspaceView3D
            aircraft={visibleAircraft}
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

        {/* ── Controls HUD — bottom-centre on both views ── */}
        <ControlsHUD activeView={view} />
      </main>
    </div>
  );
}
