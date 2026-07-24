// ─── METAR + TAF proxy route ───────────────────────────────────────────────────
//
// GET /api/metar?icao=YBBN
//   Fetches the latest METAR AND TAF for the given ICAO from aviationweather.gov
//   (free, no API key required) in parallel, returning both.
//
// Response: { metar: MetarRecord | null, taf: TafRecord | null }
//   or      { error } on total failure.
//
// Cache-Control: 5 min — METAR updates ~30 min, SPECI can fire any time,
// TAF is re-issued every 6 h.  5 min balances freshness vs. request rate.

import { Router, type IRouter } from "express";

const router: IRouter = Router();

const BASE = "https://aviationweather.gov/api/data";

async function upstream(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal:  AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

router.get("/metar", async (req, res) => {
  const icao = ((req.query["icao"] as string) || "YBBN").toUpperCase();

  const [metarResult, tafResult] = await Promise.allSettled([
    upstream(`${BASE}/metar?ids=${icao}&format=json`),
    upstream(`${BASE}/taf?ids=${icao}&format=json`),
  ]);

  // Extract first array element from each; null on any failure or empty array.
  const metar = metarResult.status === "fulfilled" && Array.isArray(metarResult.value) && metarResult.value.length > 0
    ? metarResult.value[0]
    : null;

  const taf = tafResult.status === "fulfilled" && Array.isArray(tafResult.value) && tafResult.value.length > 0
    ? tafResult.value[0]
    : null;

  if (!metar && !taf) {
    res.status(502).json({ error: "Both METAR and TAF fetches failed" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ metar, taf });
});

export default router;
