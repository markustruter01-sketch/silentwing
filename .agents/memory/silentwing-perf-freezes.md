---
name: SilentWing freeze/perf lessons
description: Root causes of page freezes in the live 3D viewer and the rules that prevent them
---

# Freeze root causes found (July 2026 deep dive)

1. **Never call `geometry.computeBoundingSphere()` per frame.** All dynamic lines
   (trails ~600 verts, beams, takeoff/glide lines) are `frustumCulled = false`,
   which makes bounding spheres unnecessary. Recomputing them per aircraft per
   frame was a major rAF cost at high traffic.
2. **Reuse canvas + CanvasTexture for frequently-updated sprite labels.**
   Glide-slope ETA labels change ~1/s per approach aircraft; allocating a new
   canvas + GPU texture each time caused steady upload/GC churn. Redraw into
   the same canvas and set `texture.needsUpdate = true`.
3. **Alert log must be bounded.** AlertEngine log was append-only; busy airports
   (YSSY) generate O(N²) pairwise separation advisories that churn, so long
   sessions grew React state/DOM unboundedly → progressive freezing.
   Rules: cap (LOG_CAP=300), prune oldest cleared-and-non-resident alerts only;
   NEVER prune alerts whose condition is still active (would break "dismissed
   stays dismissed" and ID stability). Cleared entries leave activeMap after a
   60s reopen-grace window.
4. **Per-frame `.find()` over activeAlerts inside map-cleanup loops** = O(alerts²);
   build a Set of ids once per frame.
5. **Prune per-aircraft caches (e.g. phase history map) against live snapshot IDs**
   — live feeds see many unique hex IDs per hour.

**How to apply:** any new per-frame or per-alert visual in AirspaceView3D must
follow rules 1–4; any App-level map keyed by aircraft ID needs rule 5.

# Still-open (known, unfixed)
- Airport switch does NOT rebuild the 3D scene (setup effect deps=[], no key on
  AirspaceView3D) — old airport ground geometry persists after switch. Correctness
  bug, not a freeze.
- perfProbe instrumentation (src/lib/perfProbe.ts + marks in App/AirspaceView3D)
  is still live and must be stripped once freezes are confirmed fixed.
