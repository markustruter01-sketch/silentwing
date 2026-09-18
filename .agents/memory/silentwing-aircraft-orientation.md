---
name: SilentWing aircraft GLB transform carrier
description: Durable orientation constraint for the shipped aircraft GLB and its heading composition
---

The shipped aircraft GLB has an identity `FBX_Root` parent whose `PLANE` child carries the baked conversion matrix/quaternion. Normalize the actual carrier with quaternion inverse multiplication before wrapping the model, then apply heading yaw only on the aircraft root; do not stack an extra Euler correction.

**Why:** The measured baked quaternion was previously attributed to `FBX_Root`, but inspecting the GLB JSON showed the matrix on `PLANE` instead. Targeting the named parent would be a no-op and preserve the constant world-heading offset.

**How to apply:** Anchor the lookup at `FBX_Root`; use its non-identity quaternion if present, otherwise normalize its `PLANE` child. Keep any wrapper correction identity unless a new asset measurement proves another correction is required. Headless preview may not provide WebGL, so validate transform math directly from the real GLB when runtime model mounting is unavailable.