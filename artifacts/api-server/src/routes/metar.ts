// ─── METAR proxy route ─────────────────────────────────────────────────────────
//
// GET /api/metar?icao=YBBN
//   Fetches the latest METAR from aviationweather.gov (free, no key required)
//   and returns the raw JSON object from the upstream API.
//
// Response: METAR object or { error } on failure.

import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/metar", async (req, res) => {
  const icao = ((req.query["icao"] as string) || "YBBN").toUpperCase();
  const url  = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`;

  try {
    const upstream = await fetch(url, {
      signal:  AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `METAR upstream ${upstream.status}` });
      return;
    }

    const json = await upstream.json();
    // METAR updates every 30 min; SPECI can fire anytime — cache for 5 min.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(json);
  } catch (err) {
    res.status(502).json({ error: "METAR fetch failed", detail: String(err) });
  }
});

export default router;
