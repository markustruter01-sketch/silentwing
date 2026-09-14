// Fetch YSSY runway centrelines from OpenStreetMap and project them into the
// same scene-metre frame the ADS-B adapter uses. Read-only: prints, writes nothing.
const ORIGIN = { lat: -33.9461, lon: 151.1772 };
const XS = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
const YS = 110540;

const proj = (lat, lon) => [
  Math.round((lon - ORIGIN.lon) * XS),
  Math.round((lat - ORIGIN.lat) * YS),
];

const QUERY = `[out:json][timeout:30];
way["aeroway"="runway"](-33.97,151.15,-33.92,151.20);
out geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: 'data=' + encodeURIComponent(QUERY),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
if (!res.ok) { console.error('Overpass HTTP ' + res.status); process.exit(1); }
const data = await res.json();

console.log('=== RAW WAYS RETURNED: ' + data.elements.length + ' ===\n');

const lines = [];
for (const w of data.elements) {
  if (!w.geometry) continue;
  const pts = w.geometry.map(g => proj(g.lat, g.lon));
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++)
    len += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
  const a = pts[0], b = pts[pts.length - 1];
  const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  lines.push({ ref: w.tags?.ref ?? '(no ref)', pts, len, brg, nodes: pts.length });
  console.log('ref        : ' + (w.tags?.ref ?? '(no ref)'));
  console.log('osm way id : ' + w.id);
  console.log('nodes      : ' + pts.length);
  console.log('length     : ' + len.toFixed(1) + ' m');
  console.log('bearing    : ' + brg.toFixed(1) + ' deg true (first point -> last point)');
  console.log('coords     : ' + JSON.stringify(pts));
  console.log('');
}

console.log('=== PARALLEL SPACING CHECK ===');
for (let i = 0; i < lines.length; i++) {
  for (let j = i + 1; j < lines.length; j++) {
    const d = Math.abs(lines[i].brg - lines[j].brg) % 360;
    const diff = d > 180 ? 360 - d : d;
    if (diff > 10 && diff < 170) continue;
    const A = lines[i], B = lines[j];
    const ux = (A.pts[A.pts.length-1][0] - A.pts[0][0]) / A.len;
    const uy = (A.pts[A.pts.length-1][1] - A.pts[0][1]) / A.len;
    const vx = B.pts[0][0] - A.pts[0][0];
    const vy = B.pts[0][1] - A.pts[0][1];
    console.log(A.ref + ' <-> ' + B.ref + ' : ' +
      Math.abs(ux * vy - uy * vx).toFixed(1) + ' m apart');
  }
}

console.log('\n=== COMPARE AGAINST PUBLISHED FIGURES ===');
console.log('16R/34L should be 3962 m');
console.log('16L/34R should be 2438 m');
console.log('07/25   should be 2530 m');
console.log('parallel spacing should be about 1037 m');