#!/usr/bin/env node
/**
 * fetch-terrain.mjs
 *
 * Fetches a coarse elevation grid from the Open-Meteo Elevation API and writes
 * it as a JSON cache file consumable by SilentWing's terrain mesh builder.
 *
 * Usage (YBBN defaults):
 *   node scripts/fetch-terrain.mjs
 *
 * Full usage:
 *   node scripts/fetch-terrain.mjs \
 *     --icao YBBN \
 *     --lat -27.384 --lon 153.117 \
 *     --rows 30 --cols 30 \
 *     --span-lat 0.15 --span-lon 0.15
 *
 * The script builds a flat row-major grid of (lat, lon) pairs, splits them
 * into batches of ≤100 points (API limit), fires sequential requests, and
 * writes `src/data/terrain_<ICAO>.json` only if ALL batches succeed.
 * On any error it logs the failure and exits with code 1.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── CLI argument parsing ──────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
  };
  return {
    icao:    (get('--icao',     'YBBN')).toUpperCase(),
    lat:     parseFloat(get('--lat',      '-27.384')),
    lon:     parseFloat(get('--lon',      '153.117')),
    rows:    parseInt  (get('--rows',     '30'), 10),
    cols:    parseInt  (get('--cols',     '30'), 10),
    spanLat: parseFloat(get('--span-lat', '0.15')),
    spanLon: parseFloat(get('--span-lon', '0.15')),
  };
}

// ── Grid assembly ─────────────────────────────────────────────────────────────
/**
 * Build a row-major list of (lat, lon) pairs for a rectangular elevation grid.
 * Row 0 is the southern edge; row (rows-1) is the northern edge.
 * Col 0 is the western edge; col (cols-1) is the eastern edge.
 */
function buildGrid({ lat, lon, rows, cols, spanLat, spanLon }) {
  const originLat = lat - spanLat;   // southern edge
  const originLon = lon - spanLon;   // western edge
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pLat = originLat + (2 * spanLat / (rows - 1)) * r;
      const pLon = originLon + (2 * spanLon / (cols - 1)) * c;
      points.push({ lat: pLat, lon: pLon });
    }
  }
  return points;
}

// ── Batched fetch ─────────────────────────────────────────────────────────────
const BATCH_SIZE = 100;
const API_URL = 'https://api.open-meteo.com/v1/elevation';

async function fetchBatch(batch, batchIndex) {
  const lats = batch.map(p => p.lat.toFixed(6)).join(',');
  const lons = batch.map(p => p.lon.toFixed(6)).join(',');
  const url  = `${API_URL}?latitude=${lats}&longitude=${lons}`;

  console.log(`  Batch ${batchIndex}: fetching ${batch.length} points…`);
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`HTTP ${res.status} from Open-Meteo: ${text}`);
  }

  const json = await res.json();
  if (!Array.isArray(json.elevation)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(json)}`);
  }
  if (json.elevation.length !== batch.length) {
    throw new Error(
      `Expected ${batch.length} elevations, got ${json.elevation.length}`,
    );
  }

  console.log(
    `  Batch ${batchIndex}: OK — ` +
    `min=${Math.min(...json.elevation)} m, max=${Math.max(...json.elevation)} m`,
  );
  return json.elevation;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = parseArgs();
  console.log(`\nfetch-terrain.mjs — ${cfg.icao}`);
  console.log(
    `  Grid: ${cfg.rows}×${cfg.cols} = ${cfg.rows * cfg.cols} points, ` +
    `centre (${cfg.lat}, ${cfg.lon}), ±${cfg.spanLat}°lat ±${cfg.spanLon}°lon`,
  );

  const points = buildGrid(cfg);
  const totalBatches = Math.ceil(points.length / BATCH_SIZE);
  console.log(`  Batches: ${totalBatches} (≤${BATCH_SIZE} pts each)\n`);

  const elevations = [];

  const INTER_BATCH_DELAY_MS = 8_000; // 8 s between batches — stays well under Open-Meteo's minutely limit

  for (let b = 0; b < totalBatches; b++) {
    if (b > 0) {
      process.stdout.write(`  Waiting ${INTER_BATCH_DELAY_MS / 1000} s before next batch…\r`);
      await new Promise(r => setTimeout(r, INTER_BATCH_DELAY_MS));
    }
    const batch = points.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    let result;
    try {
      result = await fetchBatch(batch, b + 1);
    } catch (err) {
      console.error(`\n✗ Batch ${b + 1} failed: ${err.message}`);
      console.error('  Aborting — no output file written.');
      process.exit(1);
    }
    elevations.push(...result);
  }

  // ── Spot-check ───────────────────────────────────────────────────────────
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const zeros = elevations.filter(e => e === 0).length;

  console.log(`\n  Min elevation : ${min} m`);
  console.log(`  Max elevation : ${max} m`);
  console.log(`  Zero count    : ${zeros} / ${elevations.length}`);

  // Spot-check: point near western ranges (lat -27.45, lon 152.75)
  // Approximate grid indices for that point:
  const originLat = cfg.lat - cfg.spanLat;
  const originLon = cfg.lon - cfg.spanLon;
  const targetLat = -27.45;
  const targetLon = 152.75;
  const rApprox = Math.round((targetLat - originLat) / (2 * cfg.spanLat / (cfg.rows - 1)));
  const cApprox = Math.round((targetLon - originLon) / (2 * cfg.spanLon / (cfg.cols - 1)));
  if (rApprox >= 0 && rApprox < cfg.rows && cApprox >= 0 && cApprox < cfg.cols) {
    const spotElev = elevations[rApprox * cfg.cols + cApprox];
    console.log(
      `  Spot-check (≈lat ${targetLat}, lon ${targetLon}) → ${spotElev} m` +
      (spotElev >= 100 ? ' ✓' : ' ⚠ (expected ≥100 m for western ranges)'),
    );
  }

  // ── Write output ─────────────────────────────────────────────────────────
  const output = {
    rows:       cfg.rows,
    cols:       cfg.cols,
    originLat:  cfg.lat,
    originLon:  cfg.lon,
    spanLat:    cfg.spanLat,
    spanLon:    cfg.spanLon,
    elevations,
  };

  const outPath = resolve(
    __dirname,
    `../artifacts/silentwing/src/data/terrain_${cfg.icao}.json`,
  );
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`\n✓ Written: ${outPath}`);
  console.log(`  Size: ${JSON.stringify(output).length} bytes\n`);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
