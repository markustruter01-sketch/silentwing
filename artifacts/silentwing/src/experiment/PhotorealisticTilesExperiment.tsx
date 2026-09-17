import { useState } from "react";
import {
  getTileSessionCount,
  MAX_TILE_SESSIONS,
  requestTileSession,
} from "../tiles/tileSession";
import "./photorealisticTilesExperiment.css";

const AIRPORTS = [
  {
    id: "YBBN",
    label: "Brisbane",
    latitude: -27.3842,
    longitude: 153.1175,
  },
  {
    id: "YSSY",
    label: "Sydney",
    latitude: -33.9461,
    longitude: 151.1772,
  },
  {
    id: "YMML",
    label: "Melbourne",
    latitude: -37.669,
    longitude: 144.841,
  },
  {
    id: "YPPH",
    label: "Perth",
    latitude: -31.9403,
    longitude: 115.9669,
  },
  {
    id: "YPAD",
    label: "Adelaide",
    latitude: -34.945,
    longitude: 138.531,
  },
] as const;

type AirportId = (typeof AIRPORTS)[number]["id"];

export default function PhotorealisticTilesExperiment() {
  const [selectedAirportId, setSelectedAirportId] =
    useState<AirportId>("YBBN");
  const [photorealGroundEnabled, setPhotorealGroundEnabled] = useState(false);
  const [tileSessionCount, setTileSessionCount] = useState(
    getTileSessionCount(),
  );
  const [statusMessage, setStatusMessage] = useState(
    "Photoreal ground is off. No tile request can start.",
  );
  const [status, setStatus] = useState<"ready" | "limit">("ready");

  const selectedAirport =
    AIRPORTS.find((airport) => airport.id === selectedAirportId) ?? AIRPORTS[0];

  const handleToggle = (enabled: boolean) => {
    setPhotorealGroundEnabled(enabled);
    setStatus("ready");
    setStatusMessage(
      enabled
        ? "Photoreal ground is on. Loading is still explicit and guarded."
        : "Photoreal ground is off. No tile request can start.",
    );
  };

  const handleLoad = () => {
    if (!photorealGroundEnabled) return;

    const result = requestTileSession();
    setTileSessionCount(result.count);

    if (!result.ok) {
      setStatus("limit");
      setStatusMessage(result.reason);
      return;
    }

    setStatus("ready");
    setStatusMessage(
      `Tile request ${result.count} reserved for ${selectedAirport.id}. Tile rendering is intentionally disabled in Stage 0.`,
    );
  };

  return (
    <main className="tiles-experiment">
      <div className="tiles-experiment__stage" aria-hidden="true" />
      <section className="tiles-experiment__panel" aria-labelledby="tiles-title">
        <div className="tiles-experiment__eyebrow">P-27 / request guard</div>
        <h1 id="tiles-title">Photoreal ground cost controls</h1>
        <p className="tiles-experiment__lede">
          Stage 0 keeps the tile renderer out of the app. Turn the control on,
          then explicitly reserve a guarded request slot.
        </p>

        <div className="tiles-experiment__field">
          <label htmlFor="airport-target">Pending airport target</label>
          <select
            id="airport-target"
            value={selectedAirportId}
            onChange={(event) =>
              setSelectedAirportId(event.target.value as AirportId)
            }
          >
            {AIRPORTS.map((airport) => (
              <option key={airport.id} value={airport.id}>
                {airport.id} — {airport.label}
              </option>
            ))}
          </select>
        </div>
        <p className="tiles-experiment__pending-note">
          Pending reference: {selectedAirport.latitude},{" "}
          {selectedAirport.longitude}. Selection does not request tiles.
        </p>

        <label className="tiles-experiment__toggle">
          <input
            type="checkbox"
            checked={photorealGroundEnabled}
            onChange={(event) => handleToggle(event.target.checked)}
          />
          <span>Photoreal ground</span>
        </label>

        {photorealGroundEnabled && (
          <div className="tiles-experiment__counter" role="status">
            tiles: {tileSessionCount} / {MAX_TILE_SESSIONS}
          </div>
        )}

        <button
          className="tiles-experiment__button"
          type="button"
          onClick={handleLoad}
          disabled={!photorealGroundEnabled}
        >
          Load photoreal ground
        </button>

        <div
          className="tiles-experiment__status"
          role="status"
          aria-live="polite"
        >
          <span
            className={`tiles-experiment__dot tiles-experiment__dot--${status}`}
          />
          <span>{statusMessage}</span>
        </div>

        <p className="tiles-experiment__note">
          Off is the default on every fresh page. This stage performs no Google
          request and does not render tiles.
        </p>
      </section>
    </main>
  );
}