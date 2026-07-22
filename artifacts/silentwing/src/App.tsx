import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar     from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';
import AirspaceView3D, { type CameraMode } from '@/components/views/AirspaceView3D';
import DirectorFocusPanel  from '@/components/panels/DirectorFocusPanel';
import AlertShell          from '@/components/panels/AlertShell';
import ControlsHUD    from '@/components/ui/ControlsHUD';
import WeatherWidget  from '@/components/panels/WeatherWidget';
import { getSimAdapter } from '@/sim/engine';
import { AdsbAdapter, HEALTH_LAGGING_MS, HEALTH_STALLED_MS } from '@/feed/adsbAdapter';
import { AlertEngine }  from '@/alerts/engine';
import { YBBN }         from '@/airports/ybbn';
import { AIRPORTS }     from '@/airports/index';
import { AirportProvider } from '@/airports/context';
import type { AirportProfile } from '@/airports/types';
import type { SWAlert, SWAlertSeverity } from '@/alerts/types';
import { severityRank } from '@/alerts/types';
import type { DataFeedAdapter, WorldSnapshot, FlightPhase, Aircraft } from '@/types';
import { isAirborne } from '@/types';
import { deriveActiveRunwayDirection } from '@/airports/helpers';

type View = 'airspace' | 'airfield';
export type DataSource = 'sim' | 'live';

// Derive a rough sector-load from aircraft count (≤ 99 %)
// NOTE: placeholder — will be replaced with a real demand metric in Phase 7.
function sectorLoad(count: number, capacity: number) {
  return Math.min(99, Math.round(count / capacity * 100));
}

/** Empty snapshot used before the effect-owned adapter delivers its first one. */
function emptySnapshot(profile: AirportProfile): WorldSnapshot {
  const windDir   = profile.sim?.defaultWindDir   ?? 190;
  const windSpeed = profile.sim?.defaultWindSpeed ?? 12;
  return {
    t: Date.now(),
    aircraft: [],
    alerts:   [],
    weather:  {
      windDir,
      windSpeed,
      activeRunwayDirection: deriveActiveRunwayDirection(profile, windDir, windSpeed),
      precipitationCells:    [],
    },
  };
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

// ── Director Mode ─────────────────────────────────────────────────────────────

const DIRECTOR_DWELL_MS = 10_000; // ms to watch each subject before switching


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

  // ── Active airport ───────────────────────────────────────────────────────
  const [activeProfile, setActiveProfile] = useState<AirportProfile>(YBBN);

  // ── Data source toggle ───────────────────────────────────────────────────
  const [dataSource, setDataSource] = useState<DataSource>('live');

  // ── Airport switch handler ───────────────────────────────────────────────
  // Switches profile, forces live if the new airport has no sim, clears state.
  const handleAirportSwitch = useCallback((profile: AirportProfile) => {
    if (profile.icao === activeProfile.icao) return;
    console.log(`[APP] airport switch → ${profile.icao}`);
    setActiveProfile(profile);
    if (!profile.sim) setDataSource('live');
    setSelectedAcId(null);
    setCameraMode('orbit');
    setSWAlerts([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.icao]);

  // ── Adapter lifecycle ────────────────────────────────────────────────────
  // The adapter is constructed AND started inside a useEffect — never in
  // useMemo or during render. React may run memo factories in discarded
  // renders, which previously created orphan AdsbAdapters whose poll timers
  // never got destroyed (observed as paired /api/adsb requests every cycle).
  // With effect-owned lifecycle, the same effect that creates+starts an
  // adapter is guaranteed a matching cleanup that destroys it — exactly one
  // live poller at all times.
  const [adapter, setAdapter] = useState<DataFeedAdapter | null>(null);

  useEffect(() => {
    const a: DataFeedAdapter =
      dataSource === 'sim' && activeProfile.sim
        ? getSimAdapter(activeProfile)   // singleton — managed by the sim engine
        : new AdsbAdapter(activeProfile);
    if (a instanceof AdsbAdapter) a.start();
    setAdapter(a);
    return () => {
      // Sim adapter is a singleton and must NOT be destroyed here.
      if (a instanceof AdsbAdapter) a.destroy();
    };
  }, [dataSource, activeProfile]);

  // ── World snapshot ───────────────────────────────────────────────────────
  // Resets immediately when adapter changes so stale aircraft don't linger.
  const [snapshot, setSnapshot] = useState<WorldSnapshot>(() =>
    emptySnapshot(activeProfile),
  );

  useEffect(() => {
    if (!adapter) return;
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

  // ── Predicted paths toggle ───────────────────────────────────────────────
  const [showPredictedPaths, setShowPredictedPaths] = useState(false);

  // ── Director Mode state ──────────────────────────────────────────────────
  const [directorMode, setDirectorMode] = useState(true); // starts ON
  /** Stores the last known phase per aircraft ID for transition detection. */
  const phaseHistRef       = useRef<Map<string, FlightPhase>>(new Map());
  /** Timestamp of the last director camera switch (ms). */
  const lastSwitchRef      = useRef<number>(0);
  /** Alternates 'aircraft' → 'airport' → 'aircraft' … so every other cut is the airport overview. */
  const directorPhaseRef   = useRef<'aircraft' | 'airport'>('aircraft');
  /** Stable ref to the current selectedAcId — avoids stale closures in the interval. */
  const selectedAcIdRef    = useRef<string | null>(null);
  /** Cooldown map: aircraft id → ms timestamp of last director selection.
   *  Aircraft visited within DIRECTOR_COOLDOWN_MS receive a heavy score penalty
   *  so the director cycles through different subjects instead of looping. */
  const directorCooldownRef = useRef<Map<string, number>>(new Map());
  /** Stable ref to the latest visible aircraft list — avoids re-starting interval on every poll. */
  const visibleAircraftRef = useRef<Aircraft[]>([]);

  // ── Alert engine (Phase 6A) ──────────────────────────────────────────────
  const alertEngineRef  = useRef(new AlertEngine(activeProfile));

  // Reinitialise the alert engine whenever the active airport changes so stale
  // Brisbane alerts don't carry over into Sydney (or vice versa).
  useEffect(() => {
    alertEngineRef.current = new AlertEngine(activeProfile);
    setSWAlerts([]);
  }, [activeProfile]);
  const [swAlerts,       setSWAlerts]       = useState<SWAlert[]>([]);
  const [injectConflict, setInjectConflict] = useState(false);

  // ── Feed-health state (polled every 1 s for live countdown) ──────────────
  const [feedHealth, setFeedHealth] = useState<{
    status: 'live' | 'lagging' | 'stalled';
    lastUpdate: number;
  }>({ status: 'stalled', lastUpdate: 0 });

  // Dev-only: simulate a feed loss so the failsafe can be demonstrated
  const [simulateFeedLoss,  setSimulateFeedLoss] = useState(false);
  const simulateFeedLossRef = useRef(false);      // stable ref read inside interval
  const feedLossStartRef    = useRef<number>(0);  // when the simulated loss began

  useEffect(() => {
    const tick = () => {
      if (simulateFeedLossRef.current) {
        // Compute age from simulated loss start, then derive status from thresholds.
        const age = Date.now() - feedLossStartRef.current;
        const status: 'live' | 'lagging' | 'stalled' =
          age > HEALTH_STALLED_MS ? 'stalled' :
          age > HEALTH_LAGGING_MS ? 'lagging' : 'live';
        setFeedHealth({ status, lastUpdate: feedLossStartRef.current });
      } else if (adapter) {
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
  /** Blocks the director dwell-timer tick while the camera interrupt is active. */
  const alertInterruptActiveRef = useRef(false);

  // Detect newly-fired CRITICAL alerts and kick off the 3D camera interrupt.
  useEffect(() => {
    const currentCriticalIds = new Set(
      activeAlerts.filter(a => a.severity === 'critical').map(a => a.id),
    );
    let newId: string | null = null;
    for (const id of currentCriticalIds) {
      if (!prevCriticalIdsRef.current.has(id)) { newId = id; break; }
    }
    prevCriticalIdsRef.current = currentCriticalIds;
    if (newId) {
      console.log(`[APP] new CRITICAL alert ${newId} — camera interrupt`);
      alertInterruptActiveRef.current = true;
      setAlertFocusId(newId);
    }
  }, [activeAlerts]);

  /** Called by AirspaceView3D when the pivot-in/hold/pivot-out completes. */
  const handleAlertFocusDone = useCallback(() => {
    console.log('[APP] camera interrupt complete — resuming director');
    alertInterruptActiveRef.current = false;
    setAlertFocusId(null);
    // Reset dwell so the director holds for a full 10 s before switching subjects.
    lastSwitchRef.current = Date.now();
  }, []);

  /** Manual focus — called when the controller clicks an alert in the list panel. */
  const handleManualAlertFocus = useCallback((alertId: string) => {
    console.log(`[APP] manual alert focus → ${alertId}`);
    alertInterruptActiveRef.current = true;
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
      // Pause dwell timer during critical-alert camera interrupt so the director
      // doesn't switch subjects while the camera is mid-pivot.
      if (alertInterruptActiveRef.current) return;
      if (now - lastSwitchRef.current < DIRECTOR_DWELL_MS) return;
      lastSwitchRef.current = now;

      // ── Airport overview cut (every other switch) ─────────────────────────
      if (directorPhaseRef.current === 'airport') {
        directorPhaseRef.current = 'aircraft';
        setCameraMode('orbit');
        console.log('[DIRECTOR] → airport overview');
        return;
      }

      // ── Aircraft cut ──────────────────────────────────────────────────────
      directorPhaseRef.current = 'airport'; // next cut will be the airport

      const ph     = phaseHistRef.current;
      const list   = visibleAircraftRef.current;
      const DIRECTOR_RADIUS_M2 = 10_000 ** 2;

      const DIRECTOR_COOLDOWN_MS = 90_000; // 90 s before an aircraft can be picked again
      const DIRECTOR_COOLDOWN_PENALTY = 200; // large enough to beat most phase bonuses
      const cooldown = directorCooldownRef.current;

      // Prune expired cooldown entries
      for (const [id, ts] of cooldown) {
        if (now - ts > DIRECTOR_COOLDOWN_MS) cooldown.delete(id);
      }

      const scored = list
        .filter(ac =>
          ac.phase !== 'at-gate' &&
          ac.position.alt < 3_000 &&
          ac.position.x ** 2 + ac.position.y ** 2 < DIRECTOR_RADIUS_M2,
        )
        .map(ac => {
          const base    = directorScore(ac, ph.get(ac.id));
          // Penalise recently-seen aircraft so the director cycles through the fleet
          const penalty = cooldown.has(ac.id) ? DIRECTOR_COOLDOWN_PENALTY : 0;
          return { ac, score: base - penalty };
        })
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) return;

      // Always pick the top scorer after cooldown penalties.
      // (The old "skip current if #2 is good enough" check is now redundant
      // because the current aircraft carries a full cooldown penalty.)
      const pick = scored[0].ac;

      // Record this pick in the cooldown map
      cooldown.set(pick.id, now);

      setSelectedAcId(pick.id);
      setCameraMode('follow');
      console.log(
        `[DIRECTOR] → ${pick.callsign} (${pick.phase})` +
        ` score=${scored.find(s => s.ac.id === pick.id)?.score ?? '?'}`,
      );
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

  // Legacy adapter alerts (not used in 6A UI — kept for StatusStrip count fallback)
  const _legacyAlerts = adapter?.getActiveAlerts() ?? [];

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0A0E14] text-slate-100">
      <TopBar
        activeView={view}
        onViewChange={setView}
        feedStatus={feedHealth.status}
        feedLastUpdate={feedHealth.lastUpdate}
        dataSource={dataSource}
        onDataSourceChange={(src) => {
          if (src === 'sim' && !activeProfile.sim) return;
          setDataSource(src);
        }}
        simAvailable={!!activeProfile.sim}
      />
      <StatusStrip
        aircraftCount={visibleAircraft.length}
        alertCount={activeAlerts.length || _legacyAlerts.length}
        groundCount={visibleAircraft.filter(ac => !isAirborne(ac)).length}
        sectorLoad={sectorLoad(visibleAircraft.length, activeProfile.sectorCapacity)}
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

        {/* ── DEV-ONLY scaffold buttons — kept in the filter bar so they don't
            overlap any canvas overlays (color key, ControlsHUD, key hints).
            Hidden in production builds via import.meta.env.DEV. ── */}
        {import.meta.env.DEV && (
          <>
            <span className="ml-3 w-px self-stretch bg-slate-800/80" aria-hidden />
            <button
              onClick={() => setInjectConflict(v => !v)}
              title="DEV: Inject two converging aircraft to trigger a CRITICAL separation alert"
              className={[
                'flex items-center gap-1 px-2 py-[2px] text-[7px] font-mono tracking-widest uppercase rounded border',
                'transition-colors select-none cursor-pointer',
                injectConflict
                  ? 'border-red-600/80 text-red-300 bg-red-950/50'
                  : 'border-slate-700/40 text-slate-700 hover:text-slate-500',
              ].join(' ')}
            >
              {injectConflict ? '■' : '▶'} conflict
            </button>
            <button
              onClick={() => {
                setSimulateFeedLoss(v => {
                  const next = !v;
                  simulateFeedLossRef.current = next;
                  if (next) feedLossStartRef.current = Date.now();
                  return next;
                });
              }}
              title="DEV: Simulate feed loss to exercise the lagging / stalled failsafe"
              className={[
                'flex items-center gap-1 px-2 py-[2px] text-[7px] font-mono tracking-widest uppercase rounded border',
                'transition-colors select-none cursor-pointer',
                simulateFeedLoss
                  ? 'border-amber-500/80 text-amber-300 bg-amber-950/50'
                  : 'border-slate-700/40 text-slate-700 hover:text-slate-500',
              ].join(' ')}
            >
              {simulateFeedLoss ? '■' : '▶'} feed loss
            </button>
          </>
        )}
      </div>

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
        />
        {/* ── Airport title + switcher — 3D airspace only ── */}
        {view === 'airspace' && (
          <div className="absolute inset-x-0 top-3 flex flex-col items-center z-[520] pointer-events-none select-none">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-mono tracking-[0.25em] text-sky-600/70 uppercase">{activeProfile.icao}</span>
              <h1 className="text-2xl font-bold tracking-[0.12em] text-sky-100/90 uppercase"
                  style={{ fontFamily: '"Courier New", monospace', textShadow: '0 0 24px rgba(14,165,233,0.45)' }}>
                {activeProfile.name}
              </h1>
              <span className="text-[10px] font-mono tracking-[0.25em] text-sky-600/70 uppercase">ICAO</span>
            </div>
            <div className="mt-0.5 h-px w-64 bg-gradient-to-r from-transparent via-sky-700/50 to-transparent" />
            {/* Airport switcher — pointer-events re-enabled */}
            <div className="flex items-center gap-1 mt-2 pointer-events-auto">
              {Object.values(AIRPORTS).map(ap => (
                <button
                  key={ap.icao}
                  onClick={() => handleAirportSwitch(ap)}
                  className={[
                    'font-mono text-[9px] tracking-wider px-2.5 py-0.5 rounded border transition-colors select-none cursor-pointer',
                    activeProfile.icao === ap.icao
                      ? 'border-sky-500/60 text-sky-400 bg-sky-900/30'
                      : 'border-slate-700/60 text-slate-500 hover:text-slate-300 hover:border-slate-500',
                  ].join(' ')}
                >
                  {ap.icao}
                </button>
              ))}
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
            weather={snapshot.weather}
            alertedIds={alertedIds}
            activeAlerts={activeAlerts}
            alertFocusId={alertFocusId ?? undefined}
            onAlertFocusDone={handleAlertFocusDone}
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

        {/* ── Director focus panel — single merged popup, director-follow only ── */}
        {directorMode && cameraMode === 'follow' && selectedAc && (
          <DirectorFocusPanel
            ac={selectedAc}
            onClose={handleClosePanel}
          />
        )}

        {/* ── Weather widget — always visible, bottom-left ── */}
        <WeatherWidget profile={activeProfile} />

        {/* ── Controls HUD — bottom-centre on both views ── */}
        <ControlsHUD activeView={view} />

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
              {/* Arrow pointing down toward the Director button in the filter bar */}
              <span className="text-amber-400 text-base leading-none">↓</span>
            </div>
            {/* Connector line to the button */}
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
    </div>
  );
}
