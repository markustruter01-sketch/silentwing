// ─── OpenSky Network proxy route ──────────────────────────────────────────────
//
// GET /api/opensky[?lat=&lon=&dist=]
//   Fetches live state vectors from the OpenSky Network anonymous REST API.
//   No API key required for anonymous access.
//   Rate limits (anonymous): ~10-second state-vector resolution; requests
//   are throttled server-side via the adapter's POLL_INTERVAL_MS constant.
//
// LICENSING NOTE: The OpenSky Network data is provided for non-commercial
// research and personal use only.  Commercial deployment requires a separate
// data-use agreement with The OpenSky Network gGmbH.
// See https://opensky-network.org/about/terms-of-use
//
// The upstream URL is constructed server-side from lat/lon/dist params so
// the client never constructs or sees the raw OpenSky endpoint.
//
// On upstream error, returns { error, status } with the real HTTP status so
// the client's feed-health logic can classify the failure correctly.

import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ── Fallback (YBBN) ───────────────────────────────────────────────────────────
const YBBN_LAT     = -27.384;
const YBBN_LON     = 153.117;
const YBBN_DIST_NM = 50;

/**
 * Convert a centre-point + NM radius to a WGS-84 bounding box.
 * 1 NM = 1 852 m; longitude degrees per NM adjusted for latitude.
 */
function nmToBbox(lat: number, lon: number, distNm: number) {
  const M_PER_NM      = 1_852;
  const M_PER_DEG_LAT = 111_120;
  const M_PER_DEG_LON = 111_320 * Math.cos(lat * (Math.PI / 180));
  const dLat = (distNm * M_PER_NM) / M_PER_DEG_LAT;
  const dLon = (distNm * M_PER_NM) / M_PER_DEG_LON;
  return {
    lamin: lat - dLat,
    lamax: lat + dLat,
    lomin: lon - dLon,
    lomax: lon + dLon,
  };
}

router.get("/opensky", async (req, res) => {
  const clientId     = process.env["OPENSKY_CLIENT_ID"];
  const clientSecret = process.env["OPENSKY_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    res.status(500).json({
      error: "OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET secrets are not configured.",
    });
    return;
  }

  const lat  = parseFloat(req.query["lat"]  as string) || YBBN_LAT;
  const lon  = parseFloat(req.query["lon"]  as string) || YBBN_LON;
  const dist = parseFloat(req.query["dist"] as string) || YBBN_DIST_NM;

  const { lamin, lamax, lomin, lomax } = nmToBbox(lat, lon, dist);

  const upstreamUrl =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin.toFixed(6)}&lomin=${lomin.toFixed(6)}` +
    `&lamax=${lamax.toFixed(6)}&lomax=${lomax.toFixed(6)}`;

  // Authenticated access: Basic Auth with client credentials.
  // Benefits over anonymous: 4000 req/day (vs 400), 5 s resolution (vs 10 s).
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept:        "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      res.status(upstream.status).json({
        error:  "Upstream OpenSky Network error",
        status: upstream.status,
        body,
      });
      return;
    }

    const json = await upstream.json();
    res.status(200).json(json);
  } catch (err) {
    res.status(502).json({
      error:  "Network error reaching OpenSky Network",
      detail: String(err),
    });
  }
});

export default router;
