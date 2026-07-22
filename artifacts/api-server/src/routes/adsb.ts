// ─── ADS-B Exchange proxy route ───────────────────────────────────────────────
//
// GET /api/adsb[?lat=&lon=&dist=]
//   Reads ADSBX_API_KEY from process.env (set as a Replit Secret).
//   Fetches the requested lat/lon/radius from ADS-B Exchange.
//   Falls back to YBBN coordinates if query params are absent (backwards compat).
//   Returns the raw JSON to the client unchanged.
//   On upstream error, returns { error, status } with the real status code.
//
// The key is NEVER sent to the client. All RapidAPI calls happen here,
// server-side. The client only ever calls /api/adsb.

import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ── YBBN fallback values ───────────────────────────────────────────────────────
const YBBN_LAT = -27.384;
const YBBN_LON = 153.117;
const YBBN_DIST_NM = 50;

router.get("/adsb", async (req, res) => {
  // Accept optional ?lat=&lon=&dist= query params so multi-airport support
  // can request any airport from the same proxy endpoint.  Fall back to YBBN.
  const lat  = parseFloat(req.query["lat"]  as string) || YBBN_LAT;
  const lon  = parseFloat(req.query["lon"]  as string) || YBBN_LON;
  const dist = parseFloat(req.query["dist"] as string) || YBBN_DIST_NM;

  const upstreamUrl =
    `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/${dist}/`;

  // Read the key at request time — avoids caching issues if the secret is set
  // after the process starts (common in Replit dev sessions).
  const apiKey = process.env["ADSBX_API_KEY"];

  if (!apiKey) {
    res.status(500).json({
      error: "ADSBX_API_KEY secret is not configured on the server.",
    });
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "x-rapidapi-host": "adsbexchange-com1.p.rapidapi.com",
        "x-rapidapi-key":  apiKey,   // stays server-side
      },
    });

    // Pass the upstream status through for rate-limit (429) / auth (403) cases
    // so the client's feed-health logic can classify the failure correctly.
    if (!upstream.ok) {
      const body = await upstream.text();
      res.status(upstream.status).json({
        error:  "Upstream ADS-B Exchange error",
        status: upstream.status,
        body,
      });
      return;
    }

    const json = await upstream.json();
    res.status(200).json(json);
  } catch (err) {
    res.status(502).json({
      error:  "Network error reaching ADS-B Exchange",
      detail: String(err),
    });
  }
});

export default router;
