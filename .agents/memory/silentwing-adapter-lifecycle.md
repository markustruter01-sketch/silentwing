---
name: Feed adapter lifecycle
description: Why data-feed adapters must be effect-owned, never constructed with side effects in useMemo/render
---

# Rule
Never start timers/network polling from a constructor invoked in `useMemo` or during render. React may run memo factories in discarded renders; those orphan instances never receive an effect cleanup, so their timers poll forever.

**Why:** The live ADS-B feed showed paired `/api/adsb` requests (~1.2s apart every 8s cycle) — two live pollers, one an orphan from a discarded render. Only the committed adapter logged `poll ok`; the orphan polled into the void.

**How to apply:** `AdsbAdapter` construction is side-effect free; polling begins only via idempotent `start()`. The adapter is React state created + started inside a `useEffect` keyed on `[dataSource, activeProfile]`, whose cleanup calls `destroy()` on the exact captured instance. `destroyed` flag guards `_poll()` entry AND post-await snapshot delivery (in-flight fetch completing after destroy must not notify subscribers). Sim adapter is a singleton — never destroy it.

Also: WebGL renderer creation in the 3D view is wrapped in try/catch with a text fallback — a failed WebGL context must not crash the React tree (that used to tear down the whole feed). Headless test browsers here have no WebGL.

**Visibility gating at startup:** Never gate `_start()`'s initial `_poll()` + `_startTimer()` on `document.visibilityState === 'visible'`. The Replit preview pane is a cross-origin iframe whose document starts as `"hidden"` even while the user is actively viewing it — the iframe hasn't received a visibility transition yet. This caused permanent STALLED (lastPoll=0 forever). The fix: always start unconditionally; keep the `visibilitychange` handler only for genuine background/foreground transitions after startup.
