---
name: SilentWing terrain mesh
description: How the coarse elevation terrain mesh is fetched, cached, built, and integrated.
---

## Pattern
- Open-Meteo Elevation API: `GET /v1/elevation?latitude=csv&longitude=csv` — no key, 100 pts/batch.
- Fetch is a **build-time Node script** (not live). Results saved to `src/data/terrain_YBBN.json`.
- Thin TS wrapper `src/data/terrain_ybbn.ts` re-exports with `TerrainGrid` type annotation.
- `TerrainGrid` defined in `airports/types.ts`; `AirportProfile.terrain?: TerrainGrid`.
- Airport profile imports and includes `terrain: TERRAIN_YBBN`; airports without it render flat.

## Mesh build (buildTerrainMesh)
- `TERRAIN_VSCALE = 1.5` — vertical exaggeration constant, easy to nudge.
- Centre-cell elevation subtracted from all vertices → airport ground = y=0.
- `mesh.position.y = -1` — 1 m global offset keeps terrain below runway/disc plane, eliminating z-fighting.
- Single `BufferGeometry` with `Uint32Array` index + `computeVertexNormals()`. One draw call.
- Material: `MeshLambertMaterial({ color: 0x0D1B28 })` — needs scene lights (AmbientLight + DirectionalLight already present).
- Uses same equirectangular projection / y-sign as runways: `sceneX=(lon−originLon)*LON_M`, `sceneZ=-(lat−originLat)*LAT_M`.

## Lifecycle
- Added to `groundGrpsRef` (cast as `THREE.Group`) so auto-disposed on airport switch with runways/buildings.
- `terrainMeshRef` tracks for visibility toggle (parallel to `bldGrpRef`).
- Both build sites patched: `rebuildGroundGeometry` callback + initial-mount useEffect.

## Why y=-1 offset, not renderOrder
- renderOrder alone doesn't prevent z-fighting when objects share the same Y plane.
- 1 m global offset is simpler and correct: disc at y=0 depth-occludes terrain at y=-1 inside the 4500 m disc radius; terrain relief visible beyond the disc edge.

## API rate limit
- Open-Meteo free tier: 100 requests/minute. 9 batches of 100 hit the limit at batch 7 on first attempt.
- Fix: 8 s inter-batch delay + 15 s retry backoff. Re-run is safe; JSON is checked in.
