import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";

export interface TileLayerOrigin {
  lat: number;
  lon: number;
}

export interface TileSurfaceAlignment {
  /** Measured tile surface height at the airport reference point, in app metres. */
  measuredHeightM: number;
  /** Vertical translation applied to the tile world to place that surface at Y=0. */
  appliedOffsetM: number;
}

export interface TileLayer {
  readonly tiles: TilesRenderer;
  update(): number;
  alignSurfaceToAppZero(): TileSurfaceAlignment | null;
  dispose(): void;
}

interface SessionConfig {
  apiToken?: string;
}

const TILE_CONFIG_PATH = "/api/google-tiles/config";

function createLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create an anchor marker label.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "700 30px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = "rgba(2, 8, 23, 0.95)";
  context.lineWidth = 10;
  context.strokeText(text, canvas.width / 2, canvas.height / 2);
  context.fillStyle = color;
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const label = new THREE.Sprite(material);
  label.scale.set(320, 64, 1);
  label.renderOrder = 100;
  return label;
}

function createAnchorMarkers(): THREE.Group {
  const markers = new THREE.Group();
  markers.name = "P-28 temporary coordinate markers";

  const anchors = [
    { position: new THREE.Vector3(0, 0, 0), label: "(0, 0) · airport origin", color: "#fef08a" },
    { position: new THREE.Vector3(1000, 0, 0), label: "(1000, 0) · 1 km east", color: "#fb7185" },
    { position: new THREE.Vector3(0, 0, 1000), label: "(0, 1000) · 1 km south", color: "#67e8f9" },
  ];

  for (const anchor of anchors) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(28, 16, 12),
      new THREE.MeshBasicMaterial({
        color: anchor.color,
        depthTest: false,
        depthWrite: false,
      }),
    );
    marker.position.copy(anchor.position);
    marker.renderOrder = 100;

    const label = createLabel(anchor.label, anchor.color);
    label.position.copy(anchor.position);
    label.position.y += 80;

    markers.add(marker, label);
  }

  return markers;
}

/**
 * Builds a Google Photorealistic 3D Tiles layer in the app's local frame.
 *
 * The library's ellipsoid is Earth-centered, Earth-fixed. Its ENU frame gives
 * east/north/up at the airport origin. SilentWing uses Three.js x=east,
 * y=up, z=south, so the local-to-ECEF basis is east/up/-north. The inverse
 * of that frame is assigned to TilesRenderer.group, converting tile ECEF
 * coordinates into the existing app coordinate frame.
 */
export async function createTileLayer(
  scene: THREE.Scene,
  origin: TileLayerOrigin,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
): Promise<TileLayer> {
  const response = await fetch(TILE_CONFIG_PATH, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Server returned ${response.status} for tile configuration.`);
  }

  const { apiToken } = (await response.json()) as SessionConfig;
  if (!apiToken) {
    throw new Error("The server did not return a Google Maps token.");
  }

  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new GoogleCloudAuthPlugin({
      apiToken,
      autoRefreshToken: true,
    }),
  );
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  const latitude = (origin.lat * Math.PI) / 180;
  const longitude = (origin.lon * Math.PI) / 180;
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  const originEcef = new THREE.Vector3();
  tiles.ellipsoid.getEastNorthUpAxes(
    latitude,
    longitude,
    east,
    north,
    up,
    originEcef,
  );

  const appToEcef = new THREE.Matrix4()
    .makeBasis(east, up, north.clone().negate())
    .setPosition(originEcef);
  const appFromEcef = appToEcef.clone().invert();
  const tileWorldMatrix = new THREE.Matrix4();
  // Runtime-measured at the airport reference point with a vertical raycast
  // against the loaded tile surface; each airport gets its own value.
  let tileVerticalOffsetM = 0;
  const applyTileWorldTransform = () => {
    tileWorldMatrix
      .makeTranslation(0, tileVerticalOffsetM, 0)
      .multiply(appFromEcef);
    tiles.group.matrix.copy(tileWorldMatrix);
    tiles.group.updateMatrixWorld(true);
  };

  tiles.group.matrixAutoUpdate = false;
  applyTileWorldTransform();
  tiles.group.renderOrder = -10;
  scene.add(tiles.group);

  const markers = createAnchorMarkers();
  scene.add(markers);
  scene.updateMatrixWorld(true);

  let disposed = false;
  let firstVisibleTileLogged = false;
  let surfaceAlignment: TileSurfaceAlignment | null = null;
  let p42ProbeTimer: ReturnType<typeof setTimeout> | null = null;
  const startedAt = performance.now();

  const sampleSurfaceHeightM = (requireCompleteLoad = true): number | null => {
    // Wait for the renderer's current refinement/download queue to settle.
    // An early coarse tile can cover the origin with a non-ground model extent.
    if (requireCompleteLoad && tiles.loadProgress < 1) return null;

    scene.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 10_000, 0),
      new THREE.Vector3(0, -1, 0),
      0,
      20_000,
    );
    const hits = raycaster.intersectObject(tiles.group, true);
    return hits.length ? hits[0].point.y : null;
  };

  const onTileVisibilityChange = () => {
    if (!firstVisibleTileLogged && tiles.visibleTiles.size > 0) {
      firstVisibleTileLogged = true;
      console.info(
        `[TILES] first visible tile after ${Math.round(performance.now() - startedAt)} ms`,
      );
    }
  };
  tiles.addEventListener("tile-visibility-change", onTileVisibilityChange);

  return {
    tiles,
    update() {
      if (disposed) return 0;
      tiles.update();
      return tiles.visibleTiles.size;
    },
    alignSurfaceToAppZero() {
      if (disposed || surfaceAlignment) return surfaceAlignment;

      const measuredHeightM = sampleSurfaceHeightM();
      if (measuredHeightM === null) return null;

      // If the renderer already agrees with the app frame, preserve zero and
      // report it rather than inventing an offset. Otherwise move only the
      // tile world through the same transform built above.
      const appliedOffsetM = Math.abs(measuredHeightM) < 0.5 ? 0 : -measuredHeightM;
      if (appliedOffsetM !== 0) {
        tileVerticalOffsetM = appliedOffsetM;
        applyTileWorldTransform();
      }

      surfaceAlignment = { measuredHeightM, appliedOffsetM };
      const alignmentLoadProgress = tiles.loadProgress;
      const alignmentErrorTarget = tiles.errorTarget;
      const samplePoint = `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`;
      console.info(
        `[P-42] alignment cached origin=${samplePoint} ` +
        `height=${measuredHeightM.toFixed(3)} m ` +
        `loadProgress=${alignmentLoadProgress.toFixed(3)} ` +
        `errorTarget=${alignmentErrorTarget}`,
      );

      p42ProbeTimer = setTimeout(() => {
        p42ProbeTimer = null;
        if (disposed) return;

        const refinedHeightM = sampleSurfaceHeightM(false);
        const refinedLoadProgress = tiles.loadProgress;
        const refinedErrorTarget = tiles.errorTarget;
        const deltaM = refinedHeightM === null
          ? null
          : refinedHeightM - measuredHeightM;
        console.info(
          `[P-42] delayed probe origin=${samplePoint} ` +
          `height=${refinedHeightM === null ? "null" : `${refinedHeightM.toFixed(3)} m`} ` +
          `delta=${deltaM === null ? "null" : `${deltaM.toFixed(3)} m`} ` +
          `loadProgress=${refinedLoadProgress.toFixed(3)} ` +
          `errorTarget=${refinedErrorTarget}`,
        );
      }, 2500);

      return surfaceAlignment;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (p42ProbeTimer !== null) {
        clearTimeout(p42ProbeTimer);
        p42ProbeTimer = null;
      }
      tiles.removeEventListener("tile-visibility-change", onTileVisibilityChange);
      scene.remove(tiles.group, markers);
      markers.traverse((object) => {
        const mesh = object as THREE.Mesh | THREE.Sprite;
        if ("geometry" in mesh && mesh.geometry) {
          mesh.geometry.dispose();
        }
        if ("material" in mesh && mesh.material) {
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const material of materials) {
            if (material instanceof THREE.SpriteMaterial) {
              material.map?.dispose();
            }
            material.dispose();
          }
        }
      });
      tiles.dispose();
    },
  };
}