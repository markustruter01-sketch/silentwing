---
name: SilentWing Phase 6A alert architecture
description: AlertEngine, SWAlert type, separation detector, AlertShell panel — what was built and key rules
---

## File layout
- `src/alerts/types.ts` — SWAlert interface, SWAlertSeverity, SWAlertKind, severityRank()
- `src/alerts/detectors/separation.ts` — detectSeparation(); pairwise airborne+fresh aircraft
- `src/alerts/engine.ts` — AlertEngine class; process(snapshot, extra?) / dismiss(id) / getAllAlerts()
- `src/components/panels/AlertShell.tsx` — 5-tab left-edge fixed panel

## Key rules enforced
- One active alert per pair per kind — dedup key = `kind:idA:idB` (IDs sorted)
- Dismissed alert stays dismissed UNLESS severity ESCALATES → new alert raised
- Advisory: NO auto-expand, NO chime (enforced in AlertShell useEffect)
- Cleared alerts (condition resolved) set `clearedAt` but stay in log forever
- Engine reads only WorldSnapshot + optional extra[] — works in sim and live mode

## App.tsx wiring
- alertEngineRef = useRef(new AlertEngine())
- swAlerts state updated on every snapshot via useEffect([snapshot, injectConflict])
- activeAlerts = filter(!acknowledged && !clearedAt)
- alertedIds = Map<id, severity> from activeAlerts — passed to AirspaceView3D
- injectConflict flag → TEST_CONFLICT_AIRCRAFT (1.08nm/500ft → CRITICAL); auto-clears after 30s
- Dev button: `import.meta.env.DEV` gate, bottom-left, clearly labelled "[DEV] Inject conflict"
- _legacyAlerts = adapter.getActiveAlerts() renamed to avoid collision with new activeAlerts

## 3D cone override
In AirspaceView3D aircraft update loop, AFTER stale/phase color logic:
  critical → 0xef4444, caution → 0xf59e0b, advisory → 0xfbbf24, emissiveIntensity=0.80
  alertedIds synced via dedicated useEffect; initial SceneState value = new Map()

## CSS
alert-glow-advisory / alert-glow-caution / alert-glow-critical utility classes in index.css
Uses @keyframes sw-pulse-amber and sw-pulse-red

**Why separate SWAlert from legacy Alert:** avoids breaking existing adapter/DataFeedAdapter interfaces which already have their own Alert type in src/types/index.ts.
