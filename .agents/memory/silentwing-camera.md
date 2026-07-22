---
name: Director camera state machine
description: Architecture of the SilentWing 3D director camera — three-priority state machine replacing the old scoring/interval approach
---

## Architecture (current)

The director camera is a self-contained state machine inside `runDirector()` in `AirspaceView3D.tsx`. It runs **every rAF frame** when `st.directorMode === true && st.cameraMode === 'orbit'`. App.tsx no longer has any director interval or scoring logic.

### Three priority levels (highest first)

1. **Alert** — when `st.alertFocusId` changes to a new non-null value, immediately transition to `fly_alert` (2 s), then `hold_alert` (10 s), then fire `alertFocusDone` callback and return to `orbit`.
2. **Approach / takeoff** — `pickDirectorAircraft()` scans acMap for approach/landing aircraft (lowest renderPos.y first), then takeoff. On finding one: `fly_ac` (3 s) → `hold_ac` (track while priority phase continues) → `orbit`.
3. **Orbit** — slow 360° rotation around airport.

### DirState interface (fields on SceneState.dir)
- `phase: 'orbit' | 'fly_alert' | 'hold_alert' | 'fly_ac' | 'hold_ac'`
- `flyFrom/flyTo/lookFrom/lookTo: THREE.Vector3` — shared fly-animation vectors
- `flyStartMs, flyMs` — ms timestamps for easing
- `alertId: string | null` — alert being shown
- `holdUntilMs: number` — when hold_alert ends
- `acId: string | null` — aircraft being followed
- `lookAt: THREE.Vector3` — smoothly lerped look-at

### Key constants
- `DIRECTOR_CAM_OFFSET = (0, 1200, 2400)` — offset from aircraft for fly_ac/hold_ac
- Alert camera: 900 units horizontally from midpoint (current azimuth) + 700 above

### CameraMode type
`'orbit' | 'manual' | 'inspect' | 'follow' | 'returning'`

The director only runs when `st.cameraMode === 'orbit'`. User drag → `manual`, click → `inspect`, double-click → `follow`. Esc during `hold_ac` or `fly_ac` drops director back to `orbit` phase.

### App.tsx responsibilities
- Detects new alerts → sets `alertFocusId` state
- Passes `alertFocusId` and `onAlertFocusDone` as props to AirspaceView3D
- `handleAlertFocusDone` just clears `alertFocusId`
- No director scoring, interval, or ref state

**Why:** The old 1 s interval + scoring approach caused camera thrash between aircraft, couldn't track moving conflicts smoothly, and required complex ref plumbing to avoid stale closures. The rAF state machine runs 60×/s with full access to live renderPos, eliminating all of those issues.
