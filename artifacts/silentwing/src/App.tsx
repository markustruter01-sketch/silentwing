import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from '@/components/layout/Header';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D, { type CameraMode } from '@/components/views/AirspaceView3D';
import DirectorFocusPanel  from '@/components/panels/DirectorFocusPanel';
import AlertShell          from '@/components/panels/AlertShell';
import SequenceLadder, { ARRIVAL_PHASES, DEPARTURE_PHASES } from '@/components/panels/SequenceLadder';
import ControlsHUD         from '@/components/ui/ControlsHUD';
import CommandBar          from '@/components/ui/CommandBar';
import RewindScrubber      from '@/components/ui/RewindScrubber';
import WelcomeModal        from '@/components/ui/WelcomeModal';
import OurAirportsPanel    from '@/components/dev/OurAirportsPanel';
import WeatherWidget  from '@/components/panels/WeatherWidget';
import MetarWidget    from '@/components/panels/MetarWidget';
import { deriveActiveRunwayDirection } from '@/airports/helpers';
import { getSimAdapter } from '@/sim/engine';
import { AdsbAdapter, HEALTH_LAGGING_MS, HEALTH_STALLED_MS } from '@/feed/adsbAdapter';
import { OpenSkyAdapter } from '@/feed/openSkyAdapter';
import { AlertEngine }  from '@/alerts/engine';
import { YBBN }         from '@/airports/ybbn';
import { YSSY }         from '@/airports/yssy';
import type { AirportProfile } from '@/airports/types';
import { AirportProvider } from '@/airports/context';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';
import { severityRank } from '@/alerts/types';
import type { DataFeedAdapter, WorldSnapshot, FlightPhase, Aircraft } from '@/types';
import { isAirborne } from '@/types';

type View = 'airspace' | 'airfield';
export type DataSource = 'sim' | 'live' | 'opensky';

// Derive a rough sector-load from aircraft count (≤ 99 %)
// NOTE: placeholder — will be replaced with a real demand metric in Phase 7.
function sectorLoad(count: number, capacity: number) {
  return Math.min(99, Math.round(count / capacity * 100));
}

// ── Dev-only test-conflict aircraft ──────────────────────────────────────────
// Two aircraft 1.08 nm apart / 500 ft vertical → CRITICAL separation alert.
// Used exclusively by the "DEV: INJECT CONFLICT" button.  Never shown in prod.
const TEST_CONFLICT_AIRCRAFT: Aircraft[] = [
  { id: '__dev_tc1__', callsign: 'TEST01', type: 'B738', phase: 'approach',
    position: { x: 0, y: -5000, alt: 3000 }, heading: 180, groundSpeed: 150, confidence: 1 },
  { id: '__dev_tc2__', callsign: 'TEST02', type: 'A320', phase: 'approach',
    position: { x: 2000, y: -5000, alt: 3500 }, heading: 0, groundSpeed: 150, confidence: 1 },
];

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

  // ── Active airport profile ────────────────────────────────────────────────
  const [activeProfile, setActiveProfile] = useState<AirportProfile>(YBBN);
  const [photorealGroundEnabled, setPhotorealGroundEnabled] = useState(false);
  /** Stable ref — lets switch callbacks read the current profile without stale closures. */
  const activeProfileRef = useRef<AirportProfile>(YBBN);
  activeProfileRef.current = activeProfile;

  // Adapter is (re-)created whenever dataSource or activeProfile changes.
  // YSSY is live-only; guard against accidental sim start on an airport with no sim config.
  const adapter = useMemo<DataFeedAdapter>(() => {
    if (dataSource === 'opensky') return new OpenSkyAdapter(activeProfile);
    if (dataSource === 'live' || !activeProfile.sim) return new AdsbAdapter(activeProfile);
    return getSimAdapter(activeProfile);
  }, [dataSource, activeProfile]);

  // Destroy live adapter instances when replaced (dataSource change or unmount).
  // The sim adapter is a singleton and must NOT be destroyed.
  // Both AdsbAdapter and OpenSkyAdapter implement destroy().
  useEffect(() => {
    return () => {
      if (adapter instanceof AdsbAdapter || adapter instanceof OpenSkyAdapter) {
        adapter.destroy();
      }
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

  // ── METAR wind override — must be declared before effectiveWeather useMemo ─
  // When MetarWidget receives authoritative METAR data it calls setMetarWind.
  // We overlay it on the adapter's weather so active-runway selection uses
  // real tower data instead of Open-Meteo-derived wind.
  const [metarWind, setMetarWind] = useState<{ dir: number; speed: number } | null>(null);
  // Reset on airport switch so stale METAR never influences the new airport.
  useEffect(() => { setMetarWind(null); }, [activeProfile]);

  // ── METAR-overridden weather ─────────────────────────────────────────────
  // When real METAR wind is available, overlay it on the adapter's weather so
  // active-runway selection uses authoritative tower data instead of Open-Meteo.
  const effectiveWeather = useMemo(() => {
    if (!metarWind) return snapshot.weather;
    const activeRunwayDirection = deriveActiveRunwayDirection(
      activeProfile, metarWind.dir, metarWind.speed,
    );
    return {
      ...snapshot.weather,
      windDir:              metarWind.dir,
      windSpeed:            metarWind.speed,
      activeRunwayDirection,
    };
  }, [snapshot.weather, metarWind, activeProfile]);

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
    // Also prune pinned IDs that are no longer in the snapshot
    const liveIds = new Set(snapshot.aircraft.map(a => a.id));
    setPinnedAcIds(prev => {
      let changed = false;
      for (const id of prev) {
        if (!liveIds.has(id)) { changed = true; break; }
      }
      if (!changed) return prev;
      const next = new Set<string>();
      for (const id of prev) { if (liveIds.has(id)) next.add(id); }
      return next;
    });
  }, [snapshot.aircraft, selectedAcId]);

  // Also clear selection when the data source changes (IDs are not shared
  // between sim and live feeds).
  useEffect(() => {
    setSelectedAcId(null);
    setCameraMode('orbit');
  }, [dataSource]);

  // Close panel helper — used by × button and by 2D Esc.
  // Clears the current alert focus so the director doesn't immediately
  // jump to the same conflict, but leaves director mode ON so it can
  // resume picking up new alerts on the next poll cycle.
  const handleClosePanel = useCallback(() => {
    console.log('[APP] panel closed via UI');
    setSelectedAcId(null);
    setAlertFocusId(null);  // prevent immediate re-selection
    setCameraMode('orbit'); // triggers smooth return-to-orbit in the 3D view
  }, []);

  // ── Predicted paths toggle ───────────────────────────────────────────────
  const [showPredictedPaths, setShowPredictedPaths] = useState(false);

  // ── Pinned aircraft ──────────────────────────────────────────────────────
  const [pinnedAcIds, setPinnedAcIds] = useState<Set<string>>(new Set());
  /** Stable ref so the director tick can read pinned IDs without a closure. */
  const pinnedAcIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { pinnedAcIdsRef.current = pinnedAcIds; }, [pinnedAcIds]);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedAcIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        console.log(`[APP] unpin ${id}`);
      } else {
        next.add(id);
        console.log(`[APP] pin ${id}`);
      }
      return next;
    });
  }, []);

  // ── Director Mode state ──────────────────────────────────────────────────
  const [directorMode, setDirectorMode] = useState(true); // starts ON
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [metarOpen, setMetarOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  // ── Alert engine (Phase 6A) ──────────────────────────────────────────────
  const alertEngineRef  = useRef(new AlertEngine(YBBN));
  const [swAlerts,       setSWAlerts]       = useState<SWAlert[]>([]);
  const [injectConflict, setInjectConflict] = useState(false);

  // ── Feed-health state (polled every 1 s for live countdown) ──────────────
  const [feedHealth, setFeedHealth] = useState<{
    status: 'live' | 'lagging' | 'stalled';
    lastUpdate: number;
  }>(() => adapter.getFeedHealth());

  // Dev-only: simulate a feed loss so the failsafe can be demonstrated
  const [simulateFeedLoss,  setSimulateFeedLoss] = useState(false);
  const simulateFeedLossRef  = useRef(false);      // stable ref read inside interval
  const feedLossStartRef     = useRef<number>(0);  // when the simulated loss began
  /** Receives the rebuildGroundGeometry function from AirspaceView3D on mount. */
  const rebuildGroundRef     = useRef<((profile: typeof YBBN) => void) | null>(null);

  useEffect(() => {
    const tick = () => {
      if (simulateFeedLossRef.current) {
        // Compute age from simulated loss start, then derive status from thresholds.
        const age = Date.now() - feedLossStartRef.current;
        const status: 'live' | 'lagging' | 'stalled' =
          age > HEALTH_STALLED_MS ? 'stalled' :
          age > HEALTH_LAGGING_MS ? 'lagging' : 'live';
        setFeedHealth({ status, lastUpdate: feedLossStartRef.current });
      } else {
        setFeedHealth(adapter.getFeedHealth());
      }
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [adapter]);

  // Process alerts on every snapshot (and whenever the inject flag changes)
  useEffect(() => {
    const extra = injectConflict ? TEST_CONFLICT_AIRCRAFT : [];
    setSWAlerts(alertEngineRef.current.process(snapshot, extra));
  }, [snapshot, injectConflict]);

  // Auto-clear injected test conflict after 30 s
  useEffect(() => {
    if (!injectConflict) return;
    const t = setTimeout(() => setInjectConflict(false), 30_000);
    return () => clearTimeout(t);
  }, [injectConflict]);

  const handleDismissAlert = useCallback((id: string) => {
    alertEngineRef.current.dismiss(id);
    setSWAlerts(alertEngineRef.current.getAllAlerts());
  }, []);

  /** Active = not acknowledged AND not cleared */
  const activeAlerts = useMemo(
    () => swAlerts.filter(a => !a.acknowledged && !a.clearedAt),
    [swAlerts],
  );

  /** Map from aircraft ID → highest active alert severity (for 3-D highlight) */
  const alertedIds = useMemo(() => {
    const map = new Map<string, SWAlertSeverity>();
    for (const alert of activeAlerts) {
      for (const aid of alert.aircraftIds) {
        const prev = map.get(aid);
        if (!prev || severityRank(alert.severity) > severityRank(prev)) {
          map.set(aid, alert.severity);
        }
      }
    }
    return map;
  }, [activeAlerts]);

  // ── Critical alert camera interrupt (Task #16) ────────────────────────────
  /** CRITICAL alert IDs seen on the previous activeAlerts tick — for diff. */
  const prevCriticalIdsRef     = useRef<Set<string>>(new Set());
  /** Alert ID the 3D camera is currently pivoting toward; null = no interrupt. */
  const [alertFocusId, setAlertFocusId] = useState<string | null>(null);

  // Detect newly-fired alerts (all severities) and kick off the 3D camera interrupt.
  useEffect(() => {
    const currentAlertIds = new Set(activeAlerts.map(a => a.id));
    // Among alerts newly seen this tick, focus the highest-severity one.
    // Set iteration order is arrival order, not severity order, so taking
    // the first new ID could point the director at an advisory while a
    // critical alert fired in the same snapshot.
    let newAlert: SWAlert | null = null;
    for (const alert of activeAlerts) {
      if (prevCriticalIdsRef.current.has(alert.id)) continue;
      if (!newAlert || severityRank(alert.severity) > severityRank(newAlert.severity)) {
        newAlert = alert;
      }
    }
    prevCriticalIdsRef.current = currentAlertIds;
    if (newAlert) {
      console.log(`[APP] new ${newAlert.severity} alert ${newAlert.id} — director interrupt`);
      setAlertFocusId(newAlert.id);
    }
  }, [activeAlerts]);

  /** Called by AirspaceView3D when the director alert hold completes. */
  const handleAlertFocusDone = useCallback(() => {
    console.log('[APP] director alert hold complete');
    setAlertFocusId(null);
  }, []);

  /** Manual alert focus — director flies to the selected alert. */
  const handleManualAlertFocus = useCallback((alertId: string) => {
    console.log(`[APP] manual alert focus → ${alertId}`);
    setAlertFocusId(alertId);
  }, []);

  // ── Director intro hint ─────────────────────────────────────────────────
  // Shown for 5 seconds on load, fades out over the last second.
  const [showDirectorHint,    setShowDirectorHint]    = useState(true);
  const [directorHintVisible, setDirectorHintVisible] = useState(true);
  useEffect(() => {
    const t1 = setTimeout(() => setDirectorHintVisible(false), 4_000); // start fade
    const t2 = setTimeout(() => setShowDirectorHint(false),    5_000); // remove from DOM
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // ── Airport switch handler ────────────────────────────────────────────────
  /**
   * Swap the active airport IN PLACE — no scene remount.
   *   1. Force live if the new airport has no sim config.
   *   2. Rebuild ground geometry inside the existing Three.js scene.
   *   3. Reset the alert engine with the new airport boundaries.
   *   4. Set activeProfile → triggers new AdsbAdapter(newProfile) via useMemo.
   */
  const handleSwitchAirport = useCallback((newProfile: AirportProfile) => {
    if (newProfile.icao === activeProfileRef.current.icao) return;
    console.log(`[APP] airport switch ${activeProfileRef.current.icao} → ${newProfile.icao}`);
    // YSSY (and any live-only airport) cannot run the sim
    if (!newProfile.sim && dataSource === 'sim') setDataSource('live');
    // Swap geometry inside the existing scene — spawn queue fills aircraft over frames
    rebuildGroundRef.current?.(newProfile);
    // Fresh alert engine scoped to the new airport; clear stale alerts immediately
    alertEngineRef.current = new AlertEngine(newProfile);
    setSWAlerts([]);
    // Clear selection / camera state that belonged to the old airport
    setSelectedAcId(null);
    setCameraMode('orbit');
    setAlertFocusId(null);
    setActiveProfile(newProfile);
  }, [dataSource]);


  // ── Display filters (hide from rendering; data is always fully ingested) ──
  /** Hide category-C2 ground vehicles and TWR stations (default ON). */
  const [hideGroundVehicles, setHideGroundVehicles] = useState(true);
  /** Hide contacts whose callsign is just their hex code — no real flight ID. */
  const [hideAnonymous, setHideAnonymous] = useState(false);
  /** Show extruded building footprints in the 3D view (default ON). */
  const [showBuildings, setShowBuildings] = useState(true);
  /** Show coarse terrain elevation mesh in the 3D view (default ON). */
  const [showTerrain, setShowTerrain] = useState(true);

  // Welcome modal — shown on every load / refresh, no persistence
  const [showWelcome, setShowWelcome] = useState(true);

  /** Aircraft that pass the current display filters — passed to both views. */
  const visibleAircraft = useMemo(() =>
    snapshot.aircraft.filter(ac => {
      if (hideGroundVehicles && ac.isGroundVehicle) return false;
      if (hideAnonymous && ac.callsign === ac.id)   return false;
      return true;
    }),
    [snapshot.aircraft, hideGroundVehicles, hideAnonymous],
  );

  // ── Sequence ladder queues ────────────────────────────────────────────────
  /** Next 3 arrivals sorted by ascending altitude (lower = closer to threshold).
   *  Pinned aircraft always float to the top of the column. */
  const arrivalsQueue = useMemo(() => {
    const all = visibleAircraft
      .filter(ac => ARRIVAL_PHASES.has(ac.phase) && !ac.isGroundVehicle)
      .sort((a, b) => {
        const ap = pinnedAcIds.has(a.id) ? 0 : 1;
        const bp = pinnedAcIds.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.position.alt - b.position.alt;
      });
    return all.slice(0, 3);
  }, [visibleAircraft, pinnedAcIds]);

  /** Next 3 departures sorted by phase then ground speed.
   *  Pinned aircraft always float to the top of the column. */
  const departuresQueue = useMemo(() => {
    const all = visibleAircraft
      .filter(ac => DEPARTURE_PHASES.has(ac.phase) && !ac.isGroundVehicle)
      .sort((a, b) => {
        const ap = pinnedAcIds.has(a.id) ? 0 : 1;
        const bp = pinnedAcIds.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        // taxi-out first (no altitude), then takeoff/departure by descending GS
        const phaseOrder: Record<string, number> = { 'taxi-out': 0, 'takeoff': 1, 'departure': 2 };
        const ao = phaseOrder[a.phase] ?? 3;
        const bo = phaseOrder[b.phase] ?? 3;
        if (ao !== bo) return ao - bo;
        return b.groundSpeed - a.groundSpeed;
      });
    return all.slice(0, 3);
  }, [visibleAircraft, pinnedAcIds]);


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

  // Legacy adapter alerts (not used in 6A UI — kept for StatusStrip count fallback)
  const _legacyAlerts = adapter.getActiveAlerts();

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0A0E14] text-slate-100">
      <Header
        activeView={view}
        onViewChange={setView}
        feedStatus={feedHealth.status}
        feedLastUpdate={feedHealth.lastUpdate}
        dataSource={dataSource}
        onDataSourceChange={setDataSource}
        simDisabled={!activeProfile.sim}
        airports={[YBBN, YSSY]}
        activeProfile={activeProfile}
        onSwitchAirport={handleSwitchAirport}
        aircraftCount={visibleAircraft.length}
        alertCount={activeAlerts.length || _legacyAlerts.length}
        groundCount={visibleAircraft.filter(ac => !isAirborne(ac)).length}
        sectorLoad={sectorLoad(visibleAircraft.length, activeProfile.sectorCapacity)}
        hideGroundVehicles={hideGroundVehicles}
        onHideGroundVehicles={setHideGroundVehicles}
        hideAnonymous={hideAnonymous}
        onHideAnonymous={setHideAnonymous}
        hiddenCount={snapshot.aircraft.length - visibleAircraft.length}
        showBuildings={showBuildings}
        onShowBuildings={setShowBuildings}
        showTerrain={showTerrain}
        onShowTerrain={setShowTerrain}
        directorMode={directorMode}
        onDirectorMode={setDirectorMode}
        devSlot={import.meta.env.DEV ? (
          <>
            <span className="ml-2 w-px h-5 bg-slate-800/80 shrink-0" aria-hidden />
            <button
              onClick={() => rebuildGroundRef.current?.(activeProfile)}
              title="DEV: Rebuild current airport geometry in-place"
              className="flex items-center gap-1 px-2 py-[2px] text-[7px] font-mono tracking-widest uppercase rounded border border-slate-700/40 text-slate-700 hover:text-slate-500 transition-colors select-none cursor-pointer shrink-0"
            >↺ geo</button>
            <button
              onClick={() => setInjectConflict(v => !v)}
              title="DEV: Inject converging aircraft to trigger CRITICAL separation alert"
              className={[
                'flex items-center gap-1 px-2 py-[2px] text-[7px] font-mono tracking-widest uppercase rounded border',
                'transition-colors select-none cursor-pointer shrink-0',
                injectConflict
                  ? 'border-red-600/80 text-red-300 bg-red-950/50'
                  : 'border-slate-700/40 text-slate-700 hover:text-slate-500',
              ].join(' ')}
            >{injectConflict ? '■' : '▶'} conflict</button>
            <button
              onClick={() => setSimulateFeedLoss(v => {
                const next = !v;
                simulateFeedLossRef.current = next;
                if (next) feedLossStartRef.current = Date.now();
                return next;
              })}
              title="DEV: Simulate feed loss to exercise lagging/stalled failsafe"
              className={[
                'flex items-center gap-1 px-2 py-[2px] text-[7px] font-mono tracking-widest uppercase rounded border',
                'transition-colors select-none cursor-pointer shrink-0',
                simulateFeedLoss
                  ? 'border-amber-500/80 text-amber-300 bg-amber-950/50'
                  : 'border-slate-700/40 text-slate-700 hover:text-slate-500',
              ].join(' ')}
            >{simulateFeedLoss ? '■' : '▶'} feed loss</button>
            <OurAirportsPanel />
          </>
        ) : undefined}
      />

      {/* ── Main view area ── */}
      <main className="flex-1 relative overflow-hidden">

        {/* ── FEED-STALLED SAFETY OVERLAY ─────────────────────────────────────
            Visible ONLY when the data feed has stalled (> STALL_S since last
            good update).  Must be impossible to miss: red viewport border +
            prominent banner + aircraft-dimming layer.                        */}
        {feedHealth.status === 'stalled' && (
          <>
            {/* Inset red border around the entire viewport */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none z-[500]"
              style={{ boxShadow: 'inset 0 0 0 4px rgba(220,38,38,0.9)' }}
            />
            {/* Subtle red tint over everything — marks all tracks as unreliable */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none z-[15] bg-red-950/20"
            />
            {/* Prominent stale-data banner — impossible to miss */}
            <div
              role="alert"
              className="absolute inset-x-0 top-0 z-[510] flex items-center justify-center
                         gap-3 py-2.5 px-4 select-none pointer-events-none
                         bg-red-900/95 backdrop-blur-sm border-b-2 border-red-500/80"
            >
              <span className="text-red-200 text-lg leading-none" aria-hidden>⚠</span>
              <span className="font-mono text-sm font-bold tracking-widest text-red-100 uppercase">
                DATA STALE — DO NOT USE FOR SEPARATION
              </span>
              <span className="text-red-200 text-lg leading-none" aria-hidden>⚠</span>
            </div>
          </>
        )}
        {/* ── Phase 6A alert shell — left edge ── */}
        <AlertShell
          activeAlerts={activeAlerts}
          onAlertFocus={handleManualAlertFocus}
          onDismiss={handleDismissAlert}
          alertFocusId={alertFocusId}
          open={alertsOpen}
          photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
        />
        {/* ── Airport title — 3D airspace only ── */}
        {view === 'airspace' && (
          <div className="sw-airport-title-band absolute inset-x-0 top-0 z-10 flex flex-col items-center py-2 pointer-events-none select-none">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-mono tracking-[0.25em] text-cyan-300 uppercase">{activeProfile.icao}</span>
              <h1 className="text-2xl font-bold tracking-[0.18em] text-white uppercase"
                  style={{ fontFamily: '"Courier New", monospace', textShadow: '0 0 24px rgba(14,165,233,0.45)' }}>
                {activeProfile.name}
              </h1>
              <span className="text-[10px] font-mono tracking-[0.25em] text-white/45 uppercase">ICAO</span>
            </div>
          </div>
        )}
        <AirportProvider profile={activeProfile}>
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
            weather={effectiveWeather}
            alertedIds={alertedIds}
            activeAlerts={activeAlerts}
            alertFocusId={alertFocusId ?? undefined}
            photorealGroundEnabled={photorealGroundEnabled}
            onAlertFocusDone={handleAlertFocusDone}
            showPaths={showPredictedPaths}
            showBuildings={showBuildings}
            showTerrain={showTerrain}
            onPhotorealGroundChange={setPhotorealGroundEnabled}
            pinnedAcIds={pinnedAcIds}
            rebuildGroundRef={rebuildGroundRef}
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
        </AirportProvider>

        {/* ── Director focus panel — shown in follow AND inspect modes so
             manual selection while director is on still surfaces the panel ── */}
        {directorMode && (cameraMode === 'follow' || cameraMode === 'inspect') && selectedAc && (
          <DirectorFocusPanel
            ac={selectedAc}
            onClose={handleClosePanel}
            photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
          />
        )}

        {/* ── On-demand sequence ladder — centered above the command bar ── */}
        {sequenceOpen && (
          <SequenceLadder
            arrivalsQueue={arrivalsQueue}
            departuresQueue={departuresQueue}
            pinnedAcIds={pinnedAcIds}
            onTogglePin={handleTogglePin}
            onSelectAc={(id) => {
              console.log(`[APP] sequence ladder select: ${id}`);
              setSelectedAcId(id);
              if (directorMode) setCameraMode('follow');
            }}
            photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
            bottomOffset={80}
            dockCenter
          />
        )}

        {/* ── Condensed weather / on-demand full METAR ── */}
        <div className="fixed bottom-20 right-4 z-[150] w-[340px] pointer-events-auto">
          <MetarWidget
            profile={activeProfile}
            photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
            onWind={(dir, speed) => setMetarWind({ dir, speed })}
            compact={!metarOpen}
            onExpand={() => setMetarOpen(true)}
            onClose={() => setMetarOpen(false)}
          />
        </div>

        {/* ── Forecast strip is on-demand from LAYERS ── */}
        {forecastOpen && (
          <div className="fixed bottom-20 right-[370px] z-[145] w-[340px] max-h-[calc(100vh-180px)] overflow-auto pointer-events-auto">
            <WeatherWidget
              profile={activeProfile}
              photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
            />
          </div>
        )}

        {controlsOpen && (
          <ControlsHUD
            activeView={view}
            photorealGroundEnabled={view === 'airspace' && photorealGroundEnabled}
          />
        )}

        <CommandBar
          activeView={view}
          directorMode={directorMode}
          groundEnabled={view === 'airspace' && photorealGroundEnabled}
          alertCount={activeAlerts.length || _legacyAlerts.length}
          onView={() => setView(v => v === 'airspace' ? 'airfield' : 'airspace')}
          onRewind={() => undefined}
          onLayers={() => {
            setSequenceOpen(v => !v);
            setForecastOpen(v => !v);
            setMetarOpen(v => !v);
          }}
          onDirector={() => setDirectorMode(v => !v)}
          onAlerts={() => setAlertsOpen(v => !v)}
          onGround={() => {
            if (view === 'airspace') setPhotorealGroundEnabled(v => !v);
          }}
          onMore={() => setControlsOpen(v => !v)}
        />
        <RewindScrubber />

        {/* ── Director intro hint ──────────────────────────────────────────── */}
        {showDirectorHint && (
          <div
            className={[
              'fixed right-4 z-[200] pointer-events-none select-none',
              'transition-opacity duration-1000',
              directorHintVisible ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            style={{ top: '68px' }}
          >
            <div className="flex items-center gap-2 bg-slate-900/95 border border-amber-500/60
              rounded-lg px-3 py-2 shadow-xl shadow-black/60">
              <span className="text-[11px] text-amber-300 font-mono tracking-wide whitespace-nowrap">
                Toggle Camera Director Mode Off Here
              </span>
              <span className="text-amber-400 text-base leading-none">↓</span>
            </div>
            <div className="flex justify-end pr-6">
              <div className="w-px h-2 bg-amber-500/40" />
            </div>
          </div>
        )}

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

      {/* ── Welcome modal — shown on every page load / refresh ─────────── */}
      {showWelcome && <WelcomeModal onDismiss={() => setShowWelcome(false)} />}
    </div>
  );
}
