---
name: SilentWing WebGL preview limit
description: Verification constraint for the browser preview when checking Three.js and photoreal tile behavior
---

The Replit headless browser preview currently cannot create a WebGL context for SilentWing. The app renders its existing “3D VIEW UNAVAILABLE” fallback, and the photoreal load control reports that the 3D scene is not ready before requesting tile configuration.

**Why:** This is an environment limitation, not an application failure; UI state, conditional backing, and guarded no-request behavior can still be verified in the preview, but actual photoreal imagery and canvas labels require a WebGL-capable browser.

**How to apply:** When verifying photoreal changes in this preview, capture the on/off UI states and record the WebGL limitation explicitly. Do not treat zero tile requests as evidence that tile code itself is broken.