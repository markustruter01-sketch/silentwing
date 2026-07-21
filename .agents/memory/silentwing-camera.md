---
name: Three.js camera state machine
description: CameraMode type, Esc chain design, and the prop-sync pattern for keeping React props in sync with the rAF loop without teardown
---

## CameraMode states
`'orbit' | 'manual' | 'inspect' | 'follow'`
- Exported from `AirspaceView3D.tsx`, imported by `App.tsx`
- Canonical state lives in `App.tsx` as React state; synced into `sceneRef` via a `useEffect`

## Esc chain (in AirspaceView3D onKey, window keydown)
```
follow  → inspect  (panel stays, camera holds, flyProgress=1)
inspect → manual   (selectedAcId=null, onSelectAircraft(null), panel closes)
manual  → orbit    (auto-orbit resumes)
orbit   → orbit    (no-op)
```
Each transition emits `console.log('[3D CAM] Esc: X → Y ...')` for raw verification.

## Prop-sync pattern
Callbacks (`onSelectAircraft`, `onCameraMode`) are stored in stable refs (`selectRef`, `camModeRef`) updated on every render. Event handlers inside the setup `useEffect([])` call these refs, never the closure-captured prop, so they always call the latest version without re-registering.

External prop changes (e.g. panel "Follow" button) flow in via a `useEffect([cameraMode])` that writes to `st.cameraMode` directly — no rAF teardown.

## Fly-to animation
- Progress: `+= 0.022` per frame ≈ 45 frames ≈ 0.75 s at 60 fps
- Easing: `t < 0.5 ? 2t² : -1+(4-2t)t` (ease-in-out quadratic)
- Start lookAt: derived from `camera.getWorldDirection() * 2000`
- Target: `acPos + (0, 700, 1400)` in Three.js space (south-and-above the aircraft)

## Raycasting
Cones are registered in `coneToId: Map<THREE.Mesh, string>` at spawn; removed at despawn. `raycaster.intersectObjects([...coneToId.keys()])` on every click (pointerup with dist < 6 px).

**Why:** The rAF loop must not call setState; all camera state is mutable in sceneRef. Only callbacks to App are allowed, and they go through stable refs to avoid stale closures.
