// ─── NOTAM proxy route ─────────────────────────────────────────────────────────
//
// GET /api/notam?icao=YBBN
//   Fetches NOTAMs from aviationweather.gov (free, no key required) and
//   returns the raw JSON array.  The browser cannot call this directly due to
//   CORS, so we proxy it here server-side.
//
// Response: raw NOTAM array from aviationweather.gov, or { error } on failure.

import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/notam", async (req, res) => {
  const icao = ((req.query["icao"] as string) || "YBBN").toUpperCase();
  const url  = `https://aviationweather.gov/api/data/notam?ids=${icao}&format=json`;

  try {
    const upstream = await fetch(url, {
      signal:  AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      // aviationweather.gov covers US/ICAO airports via FAA.  Non-US airports
      // (e.g. YBBN) return 404; the API was also decommissioned in mid-2026.
      res.status(upstream.status).json({
        error:  upstream.status === 404
          ? "NOTAM data unavailable — no free public API covers this airport"
          : "NOTAM upstream error",
        status: upstream.status,
      });
      return;
    }

    const json = await upstream.json();
    // Allow the browser to cache for 10 minutes — NOTAMs rarely change faster.
    res.setHeader("Cache-Control", "public, max-age=600");
    res.status(200).json(json);
  } catch (err) {
    res.status(502).json({
      error:  "NOTAM fetch failed",
      detail: String(err),
    });
  }
});

export default router;
