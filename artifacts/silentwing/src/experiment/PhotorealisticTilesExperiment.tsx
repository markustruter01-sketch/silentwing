import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
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
    if (status === "requesting-key" || status === "loading") return;

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
        <div className="tiles-experiment__eyebrow">P-23 / isolated experiment</div>
        <h1 id="tiles-title">Brisbane Airport photorealistic tiles</h1>
        <p className="tiles-experiment__lede">
          The scene stays empty until you explicitly start the Google 3D Tiles
          request.
        </p>

        <button
          className="tiles-experiment__button"
          type="button"
          onClick={loadTiles}
          disabled={busy}
        >
          {busy ? "Loading tiles…" : "Load Brisbane Airport tiles"}
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