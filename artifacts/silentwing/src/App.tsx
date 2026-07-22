import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar     from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D, { type CameraMode } from '@/components/views/AirspaceView3D';
import AircraftDetailPanel from '@/components/panels/AircraftDetailPanel';
import ControlsHUD from '@/components/ui/ControlsHUD';
import { getSimAdapter } from '@/sim/engine';
import { AdsbAdapter } from '@/feed/adsbAdapter';
import type { DataFeedAdapter, WorldSnapshot, FlightPhase, Aircraft } from '@/types';
import { isAirborne } from '@/types';

type View = 'airspace' | 'airfield';
export type DataSource = 'sim' | 'live';

// Derive a rough sector-load from aircraft count (≤ 99 %)
// NOTE: placeholder — will be replaced with a real demand metric in Phase 7.
function sectorLoad(count: number) {
  return Math.min(99, count * 11);
}

// ── Director Mode ─────────────────────────────────────────────────────────────

const DIRECTOR_DWELL_MS = 10_000; // ms to watch each aircraft before switching

/** Priority score for each flight phase — higher = more cinematically interesting. */
const DIRECTOR_PHASE_SCORE: Record<FlightPhase, number> = {
  'landing':           100,
  'takeoff':            95,
  'approach':           80,
  'departure':          70,
  'enroute-departure':  55,
  'enroute-arrival':    50,
  'taxi-out':           35,
  'taxi-in':            20,
  'at-gate':             5,
};

/** Large bonus when an aircraft just changed phase — prioritises transitions. */
const DIRECTOR_TRANSITION_BONUS = 160;

function directorScore(ac: Aircraft, prevPhase: FlightPhase | undefined): number {
  const base       = DIRECTOR_PHASE_SCORE[ac.phase] ?? 0;
  const transition = prevPhase !== undefined && prevPhase !== ac.phase
    ? DIRECTOR_TRANSITION_BONUS : 0;
  return base + transition;
}

/** Human-readable phase label shown in the NOW WATCHING strip. */
const PHASE_LABEL: Record<FlightPhase, string> = {
  'enroute-arrival':   'En Route',
  'approach':          'Approach',
  'landing':           'Landing',
  'taxi-in':           'Taxi In',
  'at-gate':           'At Gate',
  'taxi-out':          'Taxi Out',
  'takeoff':           'Takeoff',
  'departure':         'Departure',
  'enroute-departure': 'Departing',
};

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

  // Close panel helper — used by × button and by 2D Esc.
  // Also turns Director off: if the user explicitly dismisses the panel they
  // don't want the director to immediately re-select something.
  const handleClosePanel = useCallback(() => {
    console.log('[APP] panel closed via UI');
    setDirectorMode(false);
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

  // ── Director Mode state ──────────────────────────────────────────────────
  const [directorMode, setDirectorMode] = useState(false);
  /** Stores the last known phase per aircraft ID for transition detection. */
  const phaseHistRef       = useRef<Map<string, FlightPhase>>(new Map());
  /** Timestamp of the last director camera switch (ms). */
  const lastSwitchRef      = useRef<number>(0);
  /** Stable ref to the current selectedAcId — avoids stale closures in the interval. */
  const selectedAcIdRef    = useRef<string | null>(null);
  /** Stable ref to the latest visible aircraft list — avoids re-starting interval on every poll. */
  const visibleAircraftRef = useRef<Aircraft[]>([]);

  // Keep the stable refs in sync with state/memo values
  useEffect(() => { selectedAcIdRef.current = selectedAcId; }, [selectedAcId]);

  // Track phase transitions on every snapshot so the scoring function can
  // detect when an aircraft just changed phase.
  useEffect(() => {
    const ph = phaseHistRef.current;
    for (const ac of snapshot.aircraft) ph.set(ac.id, ac.phase);
  }, [snapshot.aircraft]);

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

  // Keep the visibleAircraft ref in sync without restarting the director interval
  useEffect(() => { visibleAircraftRef.current = visibleAircraft; }, [visibleAircraft]);

  // ── Director tick ────────────────────────────────────────────────────────
  // Runs a 1 s interval only while directorMode is ON.
  // Reads visibleAircraftRef / selectedAcIdRef / phaseHistRef to avoid stale
  // closures — the interval is only recreated when directorMode changes.
  useEffect(() => {
    if (!directorMode) return;

    const tick = () => {
      const now = Date.now();
      if (now - lastSwitchRef.current < DIRECTOR_DWELL_MS) return;

      const ph     = phaseHistRef.current;
      const list   = visibleAircraftRef.current;
      // 10 km radius: short final (~3 nm), runway, taxiways, and immediate
      // departure corridor.  Anything further out is not "at the airfield".
      // Squared comparison avoids a sqrt per aircraft per tick.
      const DIRECTOR_RADIUS_M2 = 10_000 ** 2;

      const scored = list
        .filter(ac =>
          ac.phase !== 'at-gate' &&                                   // boring when stationary
          ac.position.alt < 3_000 &&                                  // ignore deep-flight above FL030
          ac.position.x ** 2 + ac.position.y ** 2 < DIRECTOR_RADIUS_M2, // within 80 km of airport
        )
        .map(ac => ({ ac, score: directorScore(ac, ph.get(ac.id)) }))
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) return;

      // Prefer switching to a different aircraft; stay if nothing better exists
      const current = selectedAcIdRef.current;
      let pick = scored[0].ac;
      if (pick.id === current && scored.length > 1 && scored[1].score >= 30) {
        pick = scored[1].ac;
      }

      if (pick.id !== current) {
        setSelectedAcId(pick.id);
        setCameraMode(isAirborne(pick) ? 'follow' : 'inspect');
        lastSwitchRef.current = now;
        console.log(
          `[DIRECTOR] → ${pick.callsign} (${pick.phase})` +
          ` score=${scored.find(s => s.ac.id === pick.id)?.score ?? '?'}`,
        );
      }
    };

    // Fire immediately so the user doesn't stare at an empty screen
    lastSwitchRef.current = 0;
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [directorMode]); // stable — reads all live values through refs

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

        {/* Director toggle — sits at the right edge of the filter bar */}
        <button
          onClick={() => {
            setDirectorMode(v => {
              const next = !v;
              console.log(`[APP] Director mode ${next ? 'ON' : 'OFF'}`);
              if (next) lastSwitchRef.current = 0; // fire immediately on enable
              return next;
            });
          }}
          title="Director Mode — auto-switches camera to the most interesting event"
          className={[
            'ml-2 flex items-center gap-1.5 px-3 py-[2px]',
            'text-[8px] tracking-widest uppercase rounded border',
            'transition-colors select-none cursor-pointer',
            directorMode
              ? 'border-amber-500/70 text-amber-300 bg-amber-900/25'
              : 'border-slate-600/50 text-slate-400 hover:text-slate-300 hover:border-slate-500',
          ].join(' ')}
        >
          {/* Pulsing dot while active */}
          <span className={directorMode ? 'relative flex h-2 w-2' : 'text-slate-600'}>
            {directorMode ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
              </>
            ) : '▶'}
          </span>
          Director
        </button>
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
            directorMode={directorMode}
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

        {/* ── Director NOW WATCHING strip ─────────────────────────────────── */}
        {directorMode && selectedAc && (
          <div
            key={selectedAc.id} // re-mount animates on each aircraft switch
            className={[
              'absolute bottom-14 left-1/2 -translate-x-1/2',
              'pointer-events-none select-none',
              'flex items-center gap-3 px-4 py-2 rounded',
              'bg-black/70 border border-amber-600/30 backdrop-blur-sm',
              'animate-fade-in',
            ].join(' ')}
            style={{ animation: 'directorFade 0.4s ease-out' }}
          >
            {/* Animated signal dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
            <span className="text-[8px] text-amber-400 tracking-[0.25em] uppercase font-mono">
              Auto
            </span>
            <span className="w-px h-4 bg-amber-800/50 shrink-0" />
            <span className="text-sm font-mono text-white tracking-wider">
              {selectedAc.callsign}
            </span>
            <span className="text-[10px] text-slate-400 tracking-wider uppercase">
              {PHASE_LABEL[selectedAc.phase]}
            </span>
            {selectedAc.position.alt > 50 && (
              <span className="text-[10px] text-slate-500 tabular-nums">
                {(Math.round(selectedAc.position.alt / 100) * 100).toLocaleString()} ft
              </span>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
