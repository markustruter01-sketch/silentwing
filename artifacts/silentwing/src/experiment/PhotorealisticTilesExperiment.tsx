import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  Vector3,
} from "three";
import {
  GlobeControls,
  TilesRenderer,
} from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";
import "./photorealisticTilesExperiment.css";

const BRISBANE_AIRPORT = {
  latitude: -27.3842,
  longitude: 153.1175,
};

// These are the same origin and equirectangular projection constants used by
// the YBBN ADS-B adapter. The app's flat frame is +x east, +y south, then
// AirspaceView3D maps that y value to Three.js z.
const APP_ORIGIN = {
  latitude: -27.384,
  longitude: 153.117,
};
const LAT_METRES = 110_540;
const LON_METRES =
  111_320 * Math.cos((APP_ORIGIN.latitude * Math.PI) / 180);

type FlatPosition = {
  x: number;
  y: number;
};

type MarkerDefinition = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  source: string;
  flatPosition?: FlatPosition;
  color: string;
};

type MarkerReadout = MarkerDefinition & {
  scenePosition: { x: number; y: number; z: number };
};

function projectToAppFlat(latitude: number, longitude: number): FlatPosition {
  return {
    x: (longitude - APP_ORIGIN.longitude) * LON_METRES,
    y: -(latitude - APP_ORIGIN.latitude) * LAT_METRES,
  };
}

function appFlatToLatLon({ x, y }: FlatPosition) {
  return {
    latitude: APP_ORIGIN.latitude - y / LAT_METRES,
    longitude: APP_ORIGIN.longitude + x / LON_METRES,
  };
}

function createMarkerDefinitions(): MarkerDefinition[] {
  const referenceFlat = projectToAppFlat(
    BRISBANE_AIRPORT.latitude,
    BRISBANE_AIRPORT.longitude,
  );
  const eastFlat = {
    x: referenceFlat.x + 1_000,
    y: referenceFlat.y,
  };
  const northFlat = {
    x: referenceFlat.x,
    y: referenceFlat.y - 1_000,
  };
  const east = appFlatToLatLon(eastFlat);
  const north = appFlatToLatLon(northFlat);

  return [
    {
      id: "airport-reference",
      label: "Airport reference point",
      latitude: BRISBANE_AIRPORT.latitude,
      longitude: BRISBANE_AIRPORT.longitude,
      source: "Given WGS84 position",
      color: "#ffffff",
    },
    {
      id: "runway-01l",
      label: "Runway 01L threshold",
      latitude: -27.3975,
      longitude: 153.11722,
      source: "Public aeronautical data; approximate ± tens of metres",
      color: "#ffcd56",
    },
    {
      id: "runway-19r",
      label: "Runway 19R threshold",
      latitude: -27.37,
      longitude: 153.12361,
      source: "Public aeronautical data; approximate ± tens of metres",
      color: "#ffcd56",
    },
    {
      id: "offset-east",
      label: "App offset: 1,000 m east",
      latitude: east.latitude,
      longitude: east.longitude,
      source: "Derived from YBBN flat-metres projection",
      flatPosition: eastFlat,
      color: "#43d9ff",
    },
    {
      id: "offset-north",
      label: "App offset: 1,000 m north",
      latitude: north.latitude,
      longitude: north.longitude,
      source: "Derived from YBBN flat-metres projection",
      flatPosition: northFlat,
      color: "#43d9ff",
    },
  ];
}

function addMarkerPole(
  scene: Scene,
  marker: MarkerDefinition,
  position: Vector3,
) {
  const markerGroup = new Group();
  markerGroup.position.copy(position);
  markerGroup.quaternion.setFromUnitVectors(
    new Vector3(0, 1, 0),
    position.clone().normalize(),
  );

  const poleMaterial = new MeshBasicMaterial({
    color: marker.color,
    depthTest: false,
    depthWrite: false,
  });
  const pole = new Mesh(new CylinderGeometry(12, 18, 240, 12), poleMaterial);
  pole.position.y = 120;
  pole.renderOrder = 10;
  markerGroup.add(pole);

  const beaconMaterial = new MeshBasicMaterial({
    color: marker.color,
    depthTest: false,
    depthWrite: false,
  });
  const beacon = new Mesh(new SphereGeometry(42, 16, 10), beaconMaterial);
  beacon.position.y = 240;
  beacon.renderOrder = 11;
  markerGroup.add(beacon);

  markerGroup.name = marker.id;
  scene.add(markerGroup);
}

type ExperimentStatus =
  | "ready"
  | "requesting-key"
  | "loading"
  | "loaded"
  | "error";

function formatElapsed(milliseconds: number | null) {
  return milliseconds === null ? "—" : `${Math.round(milliseconds)} ms`;
}

export default function PhotorealisticTilesExperiment() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<{
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    tiles: TilesRenderer;
    controls: GlobeControls;
    animationFrame: number;
    removeResizeListener: () => void;
  } | null>(null);
  const [status, setStatus] = useState<ExperimentStatus>("ready");
  const [statusMessage, setStatusMessage] = useState(
    "No Google request has been made.",
  );
  const [keyRequestMs, setKeyRequestMs] = useState<number | null>(null);
  const [firstFrameMs, setFirstFrameMs] = useState<number | null>(null);
  const [loadedTileCount, setLoadedTileCount] = useState(0);
  const [attribution, setAttribution] = useState("Google Maps Platform");
  const [markerReadouts, setMarkerReadouts] = useState<MarkerReadout[] | null>(
    null,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    };

    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      runtimeRef.current?.tiles.dispose();
      runtimeRef.current?.controls.dispose();
      runtimeRef.current?.renderer.dispose();
      runtimeRef.current?.removeResizeListener();
      if (runtimeRef.current) {
        cancelAnimationFrame(runtimeRef.current.animationFrame);
      }
      runtimeRef.current = null;
    };
  }, []);

  const loadTiles = async () => {
    if (status !== "ready" && status !== "error") return;

    setStatus("requesting-key");
    setStatusMessage("Requesting a session configuration from the server…");
    const requestStarted = performance.now();

    try {
      const response = await fetch("/api/google-tiles/config", {
        headers: { Accept: "application/json" },
      });
      const keyElapsed = performance.now() - requestStarted;
      setKeyRequestMs(keyElapsed);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}.`);
      }

      const { apiToken } = (await response.json()) as { apiToken?: string };
      if (!apiToken) {
        throw new Error("The server did not return a Google Maps token.");
      }

      const canvas = canvasRef.current;
      if (!canvas) throw new Error("The experiment canvas is unavailable.");

      const renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(new Color("#09131f"));

      const scene = new Scene();
      scene.background = new Color("#09131f");
      scene.add(new AmbientLight("#b8d5ff", 1.4));

      const sun = new DirectionalLight("#fff1d0", 2.2);
      sun.position.set(-2, 4, 3);
      scene.add(sun);

      const camera = new PerspectiveCamera(45, 1, 1, 100000000);
      const tiles = new TilesRenderer();
      const auth = new GoogleCloudAuthPlugin({
        apiToken,
        autoRefreshToken: true,
      });
      tiles.registerPlugin(auth);
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.group.matrixAutoUpdate = false;
      scene.add(tiles.group);

      const markerDefinitions = createMarkerDefinitions();
      const markerReadoutValues: MarkerReadout[] = [];
      for (const marker of markerDefinitions) {
        const scenePosition = new Vector3();
        tiles.ellipsoid.getCartographicToPosition(
          (marker.latitude * Math.PI) / 180,
          (marker.longitude * Math.PI) / 180,
          0,
          scenePosition,
        );
        addMarkerPole(scene, marker, scenePosition);
        markerReadoutValues.push({
          ...marker,
          scenePosition: {
            x: scenePosition.x,
            y: scenePosition.y,
            z: scenePosition.z,
          },
        });
      }
      setMarkerReadouts(markerReadoutValues);

      const controls = new GlobeControls(scene, camera, canvas);
      controls.enableDamping = true;
      controls.minDistance = 50;
      controls.maxDistance = 100000;
      controls.setEllipsoid(tiles.ellipsoid, tiles.group);

      const target = new Vector3();
      tiles.ellipsoid.getCartographicToPosition(
        (BRISBANE_AIRPORT.latitude * Math.PI) / 180,
        (BRISBANE_AIRPORT.longitude * Math.PI) / 180,
        0,
        target,
      );
      camera.position.copy(target).multiplyScalar(1.00008);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      const resize = () => {
        const width =
          canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
        const height =
          canvas.clientHeight || canvas.parentElement?.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();

      setStatus("loading");
      setStatusMessage("Google Photorealistic 3D Tiles are loading…");
      const tileStarted = performance.now();
      let firstVisibleFrame = false;
      let previousAttribution = "";

      const onTileVisibilityChange = () => {
        setLoadedTileCount(tiles.visibleTiles.size);
        if (!firstVisibleFrame && tiles.visibleTiles.size > 0) {
          firstVisibleFrame = true;
          setFirstFrameMs(performance.now() - tileStarted);
          setStatus("loaded");
          setStatusMessage("Brisbane Airport tiles are visible.");
        }
      };
      tiles.addEventListener("tile-visibility-change", onTileVisibilityChange);
      window.addEventListener("resize", resize);

      const render = () => {
        controls.update();
        camera.updateMatrixWorld();
        tiles.update();
        const currentAttributions = tiles.getAttributions([]);
        const nextAttribution = currentAttributions
          .map(({ value }) => String(value))
          .filter(Boolean)
          .join(" · ");
        if (nextAttribution && nextAttribution !== previousAttribution) {
          previousAttribution = nextAttribution;
          setAttribution(nextAttribution);
        }
        renderer.render(scene, camera);
        const animationFrame = requestAnimationFrame(render);
          runtimeRef.current = {
          renderer,
          scene,
          camera,
          tiles,
          controls,
          animationFrame,
          removeResizeListener: () => window.removeEventListener("resize", resize),
        };
      };
      render();
    } catch (error) {
      setStatus("error");
      setStatusMessage(
        error instanceof Error ? error.message : "The tiles request failed.",
      );
    }
  };

  const busy = status === "requesting-key" || status === "loading";

  return (
    <main className="tiles-experiment">
      <canvas ref={canvasRef} className="tiles-experiment__canvas" />
      <section className="tiles-experiment__panel" aria-labelledby="tiles-title">
        <div className="tiles-experiment__eyebrow">P-24 / coordinate proof</div>
        <h1 id="tiles-title">Brisbane Airport marker conversion</h1>
        <p className="tiles-experiment__lede">
          Five known positions will be placed on the photorealistic tiles. The
          scene stays empty until you explicitly start the Google request.
        </p>

        <button
          className="tiles-experiment__button"
          type="button"
          onClick={loadTiles}
          disabled={busy}
        >
          {busy
            ? "Loading tiles…"
            : status === "loaded"
              ? "Markers loaded"
              : "Load Brisbane Airport tiles"}
        </button>

        <div className="tiles-experiment__status" role="status" aria-live="polite">
          <span
            className={`tiles-experiment__dot tiles-experiment__dot--${status}`}
          />
          <span>{statusMessage}</span>
        </div>

        <dl className="tiles-experiment__metrics">
          <div>
            <dt>Latitude</dt>
            <dd>{BRISBANE_AIRPORT.latitude}</dd>
          </div>
          <div>
            <dt>Longitude</dt>
            <dd>{BRISBANE_AIRPORT.longitude}</dd>
          </div>
          <div>
            <dt>Server key request</dt>
            <dd>{formatElapsed(keyRequestMs)}</dd>
          </div>
          <div>
            <dt>First visible tile</dt>
            <dd>{formatElapsed(firstFrameMs)}</dd>
          </div>
          <div>
            <dt>Visible tiles</dt>
            <dd>{loadedTileCount}</dd>
          </div>
        </dl>

        <section
          className="tiles-experiment__marker-readout"
          aria-labelledby="marker-readout-title"
        >
          <h2 id="marker-readout-title">Marker readout</h2>
          {!markerReadouts ? (
            <p className="tiles-experiment__readout-empty">
              Scene x/y/z values appear after the tiles load.
            </p>
          ) : (
            <div className="tiles-experiment__marker-list">
              {markerReadouts.map((marker) => (
                <article
                  className="tiles-experiment__marker"
                  key={marker.id}
                >
                  <div className="tiles-experiment__marker-heading">
                    <span
                      className="tiles-experiment__marker-swatch"
                      style={{ backgroundColor: marker.color }}
                    />
                    <strong>{marker.label}</strong>
                  </div>
                  <div className="tiles-experiment__marker-coords">
                    input lat/lon&nbsp; {marker.latitude.toFixed(6)},{" "}
                    {marker.longitude.toFixed(6)}
                  </div>
                  <div className="tiles-experiment__marker-coords">
                    scene x/y/z&nbsp;{" "}
                    {[
                      marker.scenePosition.x,
                      marker.scenePosition.y,
                      marker.scenePosition.z,
                    ]
                      .map((value) => value.toFixed(3))
                      .join(", ")}
                  </div>
                  <div className="tiles-experiment__marker-source">
                    {marker.source}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="tiles-experiment__conversion-note">
            WGS84 lat/lon → ECEF uses the renderer library’s
            <code>Ellipsoid.getCartographicToPosition</code>. The cyan markers
            first use the existing app projection: +x east, +y south, then
            Three.js z = app y.
          </p>
        </section>

        <p className="tiles-experiment__attribution" aria-label="Map data attribution">
          {attribution}
        </p>
        <p className="tiles-experiment__note">
          The API key is read by the server and requested only after this button
          is pressed.
        </p>
      </section>
    </main>
  );
}