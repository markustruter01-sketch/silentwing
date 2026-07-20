// ─── YBBN Airport Geometry ────────────────────────────────────────────────────
//
// All coordinates in METERS using SVG convention:
//   origin = airport reference center (approx midpoint between runways)
//   +X = east, +Y = south (standard SVG; so −Y = north, i.e. up on screen)
//
// Runway heading 010° (true/magnetic are close for YBBN)
// sin(10°) ≈ 0.17365, cos(10°) ≈ 0.98481

const H = (10 * Math.PI) / 180;
const SH = Math.sin(H); // 0.17365
const CH = Math.cos(H); // 0.98481

// Perpendicular (east side of runway) in SVG coords
const PERP_X = CH;  //  0.98481
const PERP_Y = SH;  //  0.17365

function poly(
  cx: number,
  cy: number,
  len: number,
  wid: number
): [number, number][] {
  const hl = len / 2;
  const hw = wid / 2;
  // north-end direction in SVG: (SH, -CH)
  // perp east direction in SVG:  (CH, SH)
  return [
    [cx + hl * SH + hw * CH,  cy - hl * CH + hw * SH], // NE
    [cx + hl * SH - hw * CH,  cy - hl * CH - hw * SH], // NW
    [cx - hl * SH - hw * CH,  cy + hl * CH - hw * SH], // SW
    [cx - hl * SH + hw * CH,  cy + hl * CH + hw * SH], // SE
  ];
}

function endpoint(cx: number, cy: number, halfLen: number, northward: boolean): [number, number] {
  const s = northward ? 1 : -1;
  return [cx + s * halfLen * SH, cy - s * halfLen * CH];
}

// ─── Runways ─────────────────────────────────────────────────────────────────

export interface Runway {
  id: string;
  designator01: string;
  designator19: string;
  length: number;
  width: number;
  cx: number;
  cy: number;
  corners: [number, number][];
  threshold01: [number, number]; // north end
  threshold19: [number, number]; // south end
  centerline: [number, number][]; // north, south
}

const RW_WIDTH = 45;

export const RUNWAYS: Runway[] = [
  {
    id: '01L_19R',
    designator01: '01L',
    designator19: '19R',
    length: 3560,
    width: RW_WIDTH,
    cx: -1020,
    cy: 0,
    corners: poly(-1020, 0, 3560, RW_WIDTH),
    threshold01: endpoint(-1020, 0, 1780, true),
    threshold19: endpoint(-1020, 0, 1780, false),
    centerline: [endpoint(-1020, 0, 1780, true), endpoint(-1020, 0, 1780, false)],
  },
  {
    id: '01R_19L',
    designator01: '01R',
    designator19: '19L',
    length: 3300,
    width: RW_WIDTH,
    cx: 980,
    cy: 0,
    corners: poly(980, 0, 3300, RW_WIDTH),
    threshold01: endpoint(980, 0, 1650, true),
    threshold19: endpoint(980, 0, 1650, false),
    centerline: [endpoint(980, 0, 1650, true), endpoint(980, 0, 1650, false)],
  },
];

// ─── Taxiways ────────────────────────────────────────────────────────────────

export interface Taxiway {
  id: string;
  label: string;
  points: [number, number][];
  width: number;
}

// Alpha: parallel to 01L/19R, offset 165m east (perpendicular direction)
const ALPHA_CX = -1020 + 165 * PERP_X; // ≈ -1020 + 162 = -858
const ALPHA_CY =     0 + 165 * PERP_Y; // ≈ 0 + 29 = 29

// Bravo: parallel to 01R/19L, offset 160m west
const BRAVO_CX = 980 - 160 * PERP_X; // ≈ 980 - 157 = 823
const BRAVO_CY =   0 - 160 * PERP_Y; // ≈ 0 - 28 = -28

export const TAXIWAYS: Taxiway[] = [
  // Alpha — east parallel of 01L/19R
  {
    id: 'alpha',
    label: 'A',
    width: 23,
    points: [
      endpoint(ALPHA_CX, ALPHA_CY, 1650, true),  // N terminus
      endpoint(ALPHA_CX, ALPHA_CY, 1650, false), // S terminus
    ],
  },
  // Bravo — west parallel of 01R/19L
  {
    id: 'bravo',
    label: 'B',
    width: 23,
    points: [
      endpoint(BRAVO_CX, BRAVO_CY, 1550, true),
      endpoint(BRAVO_CX, BRAVO_CY, 1550, false),
    ],
  },
  // Charlie — cross-field taxiway (links Alpha to Bravo at mid-field)
  {
    id: 'charlie',
    label: 'C',
    width: 23,
    points: [
      [ALPHA_CX + 40, ALPHA_CY - 40],
      [0, -300],
      [BRAVO_CX - 40, BRAVO_CY - 40],
    ],
  },
  // Western connector taxiways (link 01L/19R ↔ Alpha)
  {
    id: 'w1',
    label: 'W1',
    width: 18,
    points: [
      [-1020 + 800 * SH - RW_WIDTH / 2 * CH,  0 - 800 * CH - RW_WIDTH / 2 * SH],
      [ALPHA_CX + 800 * SH, ALPHA_CY - 800 * CH],
    ],
  },
  {
    id: 'w2',
    label: 'W2',
    width: 18,
    points: [
      [-1020 + 0 * SH - RW_WIDTH / 2 * CH, 0 + 0],
      [ALPHA_CX, ALPHA_CY],
    ],
  },
  {
    id: 'w3',
    label: 'W3',
    width: 18,
    points: [
      [-1020 - 700 * SH - RW_WIDTH / 2 * CH, 700 * CH],
      [ALPHA_CX - 700 * SH, ALPHA_CY + 700 * CH],
    ],
  },
  // Eastern connector taxiways (link Bravo ↔ 01R/19L)
  {
    id: 'e1',
    label: 'E1',
    width: 18,
    points: [
      [BRAVO_CX + 700 * SH, BRAVO_CY - 700 * CH],
      [980 + 700 * SH + RW_WIDTH / 2 * CH, -700 * CH + RW_WIDTH / 2 * SH],
    ],
  },
  {
    id: 'e2',
    label: 'E2',
    width: 18,
    points: [
      [BRAVO_CX, BRAVO_CY],
      [980 + RW_WIDTH / 2 * CH, RW_WIDTH / 2 * SH],
    ],
  },
  {
    id: 'e3',
    label: 'E3',
    width: 18,
    points: [
      [BRAVO_CX - 600 * SH, BRAVO_CY + 600 * CH],
      [980 - 600 * SH + RW_WIDTH / 2 * CH, 600 * CH + RW_WIDTH / 2 * SH],
    ],
  },
];

// ─── Aprons ──────────────────────────────────────────────────────────────────

export interface Apron {
  id: string;
  label: string;
  corners: [number, number][];
}

export const APRONS: Apron[] = [
  // Domestic apron (between runways, northern)
  {
    id: 'dom-apron',
    label: 'Domestic Apron',
    corners: [
      [-780, -900],
      [ 300, -900],
      [ 300,  -50],
      [-780,  -50],
    ],
  },
  // International apron (between runways, south of domestic)
  {
    id: 'intl-apron',
    label: 'International Apron',
    corners: [
      [-600,  50],
      [ 300,  50],
      [ 300, 900],
      [-600, 900],
    ],
  },
];

// ─── Terminal buildings ───────────────────────────────────────────────────────

export interface Terminal {
  id: string;
  label: string;
  corners: [number, number][];
}

export const TERMINALS: Terminal[] = [
  {
    id: 'domestic',
    label: 'Domestic Terminal',
    corners: [
      [-620, -780],
      [ 180, -780],
      [ 180, -200],
      [-620, -200],
    ],
  },
  {
    id: 'international',
    label: 'International Terminal',
    corners: [
      [-450, 200],
      [ 200, 200],
      [ 200, 700],
      [-450, 700],
    ],
  },
];

// ─── Gates ───────────────────────────────────────────────────────────────────

export interface Gate {
  id: string;
  terminal: string;
  x: number;
  y: number;
}

function domGates(): Gate[] {
  const gates: Gate[] = [];
  // Domestic: 12 gates along the terminal face
  for (let i = 0; i < 12; i++) {
    gates.push({
      id: `D${i + 1}`,
      terminal: 'domestic',
      x: -580 + i * 68,
      y: -185,
    });
  }
  return gates;
}

function intlGates(): Gate[] {
  const gates: Gate[] = [];
  // International: 8 gates along northern face of terminal (y=215)
  for (let i = 0; i < 8; i++) {
    gates.push({
      id: `I${i + 1}`,
      terminal: 'international',
      x: -410 + i * 75,
      y: 215,
    });
  }
  return gates;
}

export const GATES: Gate[] = [...domGates(), ...intlGates()];

// ─── Airspace boundary ────────────────────────────────────────────────────────
// 30 nm radius ≈ 55,560 m — stored as radius for the 3D view
export const AIRSPACE_RADIUS_M = 55_560;

// ─── Geography polygons (simplified, for visual context) ─────────────────────

export interface GeoPolygon {
  id: string;
  type: 'water' | 'land';
  points: [number, number][];
}

// Moreton Bay — to the NE, approximate coastline polygon
export const GEO_POLYGONS: GeoPolygon[] = [
  {
    id: 'moreton-bay',
    type: 'water',
    points: [
      [2000, -4000],
      [8000, -8000],
      [8000,  4000],
      [2000,  2000],
    ],
  },
  {
    id: 'brisbane-river',
    type: 'water',
    points: [
      [-8000, 2200],
      [ 1200, 1900],
      [ 1200, 2400],
      [-8000, 2700],
    ],
  },
];

// ─── SVG ViewBox ──────────────────────────────────────────────────────────────
// Encompasses all airport features + comfortable margin
export const VIEWBOX = {
  minX: -1800,
  minY: -2100,
  width: 3600,
  height: 4400,
} as const;

export const VIEWBOX_STR = `${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`;
