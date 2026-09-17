import { Router, type IRouter } from "express";

const router: IRouter = Router();

// This endpoint is intentionally called only by the opt-in experiment page.
// The Google key is read at request time and is never committed to source.
router.get("/google-tiles/config", (_req, res) => {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];

  if (!apiKey) {
    res.status(500).json({
      error: "GOOGLE_MAPS_API_KEY secret is not configured on the server.",
    });
    return;
  }

  res.status(200).json({ apiToken: apiKey });
});

export default router;