---
name: SilentWing director camera bugs
description: Root causes and fixes for the "director never focuses on alerts" regression
---

## Root cause 1 — handleClosePanel silently kills director mode
`handleClosePanel` in App.tsx called `setDirectorMode(false)`.  Every time the user dismissed
the inspector panel (Esc, × button) director mode turned off permanently.  React Fast Refresh
preserved the `false` state across all code saves, so the director appeared broken for the
entire session after the first panel-close.

**Fix:** `handleClosePanel` now calls `setAlertFocusId(null)` instead of `setDirectorMode(false)`.
This prevents the director from immediately re-selecting the same conflict without killing it entirely.

## Root cause 2 — alertMidpoint returned orbitTarget when aircraft not yet in acMap
Aircraft spawn into `st.acMap` through a throttled queue (≤4 per rAF frame).  On the first few
frames after mount, or just after a new poll, the alert's aircraft might not yet be in `acMap`.
`alertMidpoint` fell back to `st.orbitTarget` (0,0,0).  The director then "flew" to the airport
centre, held 10 s, called `done()`, which synchronously cleared `st.alertFocusId` — overwriting
any new alert that arrived during the hold.  This cycle repeated silently.

**Fix:** The alert interrupt now checks `mp.distanceTo(st.orbitTarget) > 100` before starting
`fly_alert`.  If the aircraft aren't in the scene yet, `d.alertId` is left null and the check
retries every frame.

## Root cause 3 — jarring snap to orbit after hold
When `hold_alert` completed, `d.phase = 'orbit'` caused an instant camera jump from ~900 m
to the 3400 m orbit position on the very next frame.

**Fix:** On hold completion the director now sets up `st.flyFrom/flyTo/flyLookFrom/flyLookTo/flyProgress`
and transitions `st.cameraMode = 'returning'`, re-using the existing 5 s smooth-return animation.
Director resumes when returning completes and `st.cameraMode` goes back to `'orbit'`.

## Root cause 4 — stale hold_alert state across airport switch
If the director was in `hold_alert` when the user switched airports, `rebuildGroundGeometry`
didn't reset the director state.  On orbit resumption the expired hold timer fired immediately,
clearing `st.alertFocusId` and consuming the first new alert from the new airport.

**Fix:** `rebuildGroundGeometry` now resets `d.phase = 'orbit'`, `d.alertId = null`,
`d.acId = null`, `d.holdUntilMs = 0`.

## Debugging note
`[DIRECTOR] activated — starting orbit` only fires when `directorMode` prop transitions to `true`.
Absence of this log after an HMR remount means `directorMode` is `false` in App state.
The `[DIRECTOR] prop sync: alertFocusId → X` log fires regardless of `directorMode`, so it
cannot be used to confirm the director is actually running.
