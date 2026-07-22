---
name: Trail fade + velocity extrapolation
description: How 3D trails are faded per-vertex and how position extrapolation avoids backwards snapping
---

## Trail fade (AirspaceView3D)

`trailBuf` is `{ pos: THREE.Vector3; t: number }[]` — each point timestamped at `performance.now()` when pushed.

Trail material is a `THREE.ShaderMaterial` (not `LineBasicMaterial`) with:
- `uniform vec3 color` — updated at poll time via `uniforms.color.value.setHex()`
- `attribute float alpha` — per-vertex, written every rAF frame
- `transparent: true, depthWrite: false`

Every rAF frame (inside the existing aircraft loop):
1. Drop entries from the front (`trailBuf[0]`) older than `TRAIL_FADE_MS = 20 000 ms`, keeping at least 2.
2. Rewrite position and alpha GPU arrays: `alpha[i] = (1 - ageFrac) * TRAIL_OPACITY` where `ageFrac = clamp(age / TRAIL_FADE_MS, 0, 1)`. Newest point (tail of array, nearest plane) → `TRAIL_OPACITY = 0.70`; oldest visible point → 0.
3. `posAttr.needsUpdate = true; alpAttr.needsUpdate = true` then `setDrawRange(0, n)`.

Poll update no longer writes GPU buffers for trails — only pushes `{ pos, t }`.

HMR guard: check `posAttr && alpAttr` before writing; check `trailMat.uniforms` before calling `.setHex()`.

## Velocity extrapolation / backwards-snap fix

**Root cause:** `lastKnownPos` was stored as the raw transponder position (seen_pos seconds old) but timestamped as `nowMs`. This caused extrapolation to restart from a past position each poll.

**Fix 1 — age-compensate lastKnownPos:**
```
if (nowCanExtrap):
  lastKnownPos = rawPos + velocity * seen_pos   // project to NOW
else:
  lastKnownPos = rawPos                          // stale aircraft: raw, held + greyed
lastKnownTimeMs = nowMs
```
Applied at both spawn and per-poll update. `vyPerS` computed before the compensation so it's available.

**Fix 2 — always start correction for canExtrap aircraft:**
Removed `posActuallyMoved` guard. Correction fires every poll; for straight-and-level flight it's a near-zero blend.

**Fix 3 — `MAX_EXTRAP_S = 9`** (down from 12): just above the 8 s poll gap, shrinks worst-case correction distance.

**Why:** With age-compensation, `lastKnownPos` ≈ `renderPos` at poll arrival → correction delta ≈ 0 → no backwards motion for straight-and-level. Turns produce a small visible curve correction over 1 s (`CORR_DURATION_MS = 1000`).
