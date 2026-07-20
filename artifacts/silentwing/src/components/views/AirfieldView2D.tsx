import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  RUNWAYS,
  TAXIWAYS,
  APRONS,
  TERMINALS,
  GATES,
  GEO_POLYGONS,
  VIEWBOX_STR,
  VIEWBOX,
} from '@/data/ybbn';
import type { Aircraft } from '@/types';

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  land:         '#0D1117',
  water:        '#0A1628',
  apron:        '#141C27',
  apronStroke:  '#1E293B',
  terminal:     '#1E293B',
  terminalLine: '#2D3F52',
  taxiway:      '#2D3B4E',
  taxiCL:       '#92400E',   // amber — taxiway centreline
  runway:       '#C8CDD4',
  runwayEdge:   '#9CA3AF',
  runwayCL:     '#FFFFFF',
  thresholdBar: '#FFFFFF',
  gateStroke:   '#334155',
  label:        '#94A3B8',
  labelBright:  '#CBD5E1',
  designator:   '#E2E8F0',
  northArrow:   '#64748B',
};

// ─── SVG helpers ──────────────────────────────────────────────────────────────
function pts(arr: [number, number][]): string {
  return arr.map(([x, y]) => `${x},${y}`).join(' ');
}
function d(arr: [number, number][]): string {
  if (!arr.length) return '';
  const [first, ...rest] = arr;
  return `M${first[0]},${first[1]} ` + rest.map(([x, y]) => `L${x},${y}`).join(' ') + ' Z';
}
function polyline(arr: [number, number][]): string {
  return arr.map(([x, y]) => `${x},${y}`).join(' ');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const GeographyLayer: React.FC = () => (
  <g id="geography">
    {/* Background land fill */}
    <rect
      x={VIEWBOX.minX} y={VIEWBOX.minY}
      width={VIEWBOX.width} height={VIEWBOX.height}
      fill={C.land}
    />
    {GEO_POLYGONS.map(p => (
      <polygon
        key={p.id}
        points={pts(p.points)}
        fill={C.water}
        opacity={0.9}
      />
    ))}
  </g>
);

const ApronsLayer: React.FC = () => (
  <g id="aprons">
    {APRONS.map(a => (
      <polygon
        key={a.id}
        points={pts(a.corners)}
        fill={C.apron}
        stroke={C.apronStroke}
        strokeWidth={8}
      />
    ))}
  </g>
);

const TerminalsLayer: React.FC = () => (
  <g id="terminals">
    {TERMINALS.map(t => (
      <g key={t.id}>
        <polygon
          points={pts(t.corners)}
          fill={C.terminal}
          stroke={C.terminalLine}
          strokeWidth={10}
        />
      </g>
    ))}
    {/* Terminal labels */}
    <text
      x={-220} y={-460}
      fill={C.label} fontSize={52} fontFamily="Inter, system-ui, sans-serif"
      fontWeight={400} letterSpacing={4} textAnchor="middle"
    >
      DOMESTIC
    </text>
    <text
      x={-960} y={820}
      fill={C.label} fontSize={48} fontFamily="Inter, system-ui, sans-serif"
      fontWeight={400} letterSpacing={4} textAnchor="middle"
    >
      INTERNATIONAL
    </text>
  </g>
);

const GatesLayer: React.FC = () => (
  <g id="gates">
    {GATES.map(g => (
      <g key={g.id}>
        <circle cx={g.x} cy={g.y} r={22} fill={C.apron} stroke={C.gateStroke} strokeWidth={5} />
        <text
          x={g.x} y={g.y + 8}
          fill={C.label} fontSize={20} fontFamily="Inter, system-ui, sans-serif"
          fontWeight={500} textAnchor="middle"
        >
          {g.id}
        </text>
      </g>
    ))}
  </g>
);

const TaxiwaysLayer: React.FC = () => (
  <g id="taxiways">
    {TAXIWAYS.map(t => (
      <g key={t.id}>
        {/* Taxiway surface */}
        <polyline
          points={polyline(t.points)}
          fill="none"
          stroke={C.taxiway}
          strokeWidth={t.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Taxiway centreline */}
        <polyline
          points={polyline(t.points)}
          fill="none"
          stroke={C.taxiCL}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="40 30"
        />
      </g>
    ))}
  </g>
);

// Threshold bar rendering
function ThresholdBars({ rw }: { rw: typeof RUNWAYS[0] }) {
  const H = (rw.id === '01L_19R' ? 10 : 10) * Math.PI / 180;
  const sinH = Math.sin(H);
  const cosH = Math.cos(H);
  const perpX = cosH;  // east
  const perpY = sinH;

  function bar(cx: number, cy: number, inside: boolean) {
    const DIR = inside ? 1 : -1; // inward
    const barW = rw.width * 0.7;
    const barH = 12;
    const segments = 8;
    const spacing = barW / (segments - 1);
    return Array.from({ length: segments }, (_, i) => {
      const offset = -barW / 2 + i * spacing;
      const bx = cx + offset * perpX + DIR * barH * sinH;
      const by = cy + offset * perpY - DIR * barH * cosH;
      return (
        <line
          key={i}
          x1={bx - sinH * 30} y1={by + cosH * 30}
          x2={bx + sinH * 30} y2={by - cosH * 30}
          stroke={C.thresholdBar}
          strokeWidth={4}
          opacity={0.9}
        />
      );
    });
  }

  const [n01x, n01y] = rw.threshold01;
  const [n19x, n19y] = rw.threshold19;

  return (
    <g>
      {bar(n01x, n01y, true)}
      {bar(n19x, n19y, true)}
    </g>
  );
}

const RunwaysLayer: React.FC = () => (
  <g id="runways">
    {RUNWAYS.map(rw => (
      <g key={rw.id}>
        {/* Runway surface */}
        <polygon
          points={pts(rw.corners)}
          fill={C.runway}
          stroke={C.runwayEdge}
          strokeWidth={2}
        />
        {/* Centreline */}
        <line
          x1={rw.centerline[0][0]} y1={rw.centerline[0][1]}
          x2={rw.centerline[1][0]} y2={rw.centerline[1][1]}
          stroke={C.runwayCL}
          strokeWidth={3}
          strokeDasharray="80 50"
          opacity={0.5}
        />
        {/* Threshold bars */}
        <ThresholdBars rw={rw} />
        {/* Designator text — 01 end (north) */}
        <text
          x={rw.threshold01[0] + 50 * Math.sin((10 * Math.PI) / 180)}
          y={rw.threshold01[1] - 50 * Math.cos((10 * Math.PI) / 180) + 280}
          fill={C.designator}
          fontSize={90}
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={700}
          textAnchor="middle"
          transform={`rotate(10, ${rw.threshold01[0]}, ${rw.threshold01[1] + 200})`}
          opacity={0.8}
        >
          {rw.designator01}
        </text>
        {/* Designator text — 19 end (south) */}
        <text
          x={rw.threshold19[0] + 50 * Math.sin((10 * Math.PI) / 180)}
          y={rw.threshold19[1] + 50 * Math.cos((10 * Math.PI) / 180) - 280}
          fill={C.designator}
          fontSize={90}
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight={700}
          textAnchor="middle"
          transform={`rotate(190, ${rw.threshold19[0]}, ${rw.threshold19[1] - 200})`}
          opacity={0.8}
        >
          {rw.designator19}
        </text>
      </g>
    ))}
  </g>
);

const OverlayLayer: React.FC = () => {
  // North arrow & scale bar (in SVG coordinate space, placed at top-left of viewbox)
  const NAX = VIEWBOX.minX + 160;
  const NAY = VIEWBOX.minY + 250;

  return (
    <g id="overlay">
      {/* ICAO ident */}
      <text
        x={VIEWBOX.minX + 120} y={VIEWBOX.minY + 120}
        fill={C.labelBright} fontSize={72} fontFamily="Inter, system-ui, sans-serif"
        fontWeight={700} letterSpacing={6}
        opacity={0.5}
      >
        YBBN
      </text>
      <text
        x={VIEWBOX.minX + 120} y={VIEWBOX.minY + 190}
        fill={C.label} fontSize={40} fontFamily="Inter, system-ui, sans-serif"
        fontWeight={400} letterSpacing={3}
        opacity={0.4}
      >
        BRISBANE INTL
      </text>

      {/* North arrow */}
      <g transform={`translate(${NAX}, ${NAY})`}>
        <line x1={0} y1={80} x2={0} y2={-80} stroke={C.northArrow} strokeWidth={3} />
        <polygon points="0,-80 -16,-40 0,-60 16,-40" fill={C.northArrow} />
        <text
          x={0} y={-100}
          fill={C.northArrow} fontSize={44} fontFamily="Inter, system-ui, sans-serif"
          fontWeight={700} textAnchor="middle"
        >
          N
        </text>
      </g>

      {/* Scale bar: 1000m */}
      <g transform={`translate(${VIEWBOX.minX + 120}, ${VIEWBOX.minY + 500})`}>
        <line x1={0} y1={0} x2={1000} y2={0} stroke={C.northArrow} strokeWidth={4} />
        <line x1={0} y1={-20} x2={0} y2={20} stroke={C.northArrow} strokeWidth={4} />
        <line x1={1000} y1={-20} x2={1000} y2={20} stroke={C.northArrow} strokeWidth={4} />
        <text
          x={500} y={60}
          fill={C.northArrow} fontSize={38} fontFamily="Inter, system-ui, sans-serif"
          fontWeight={400} textAnchor="middle"
        >
          1 km
        </text>
      </g>
    </g>
  );
};

// ─── Aircraft layer (placeholder for Phase 2) ─────────────────────────────────
const AircraftLayer: React.FC<{ aircraft: Aircraft[] }> = ({ aircraft }) => {
  if (!aircraft.length) return null;
  return (
    <g id="aircraft">
      {aircraft.map(ac => (
        <g key={ac.id} transform={`translate(${ac.position.x}, ${ac.position.y})`}>
          <circle r={24} fill="white" opacity={0.9} />
          <text x={0} y={-32} fontSize={36} textAnchor="middle" fill="#E2E8F0"
            fontFamily="Inter, system-ui, sans-serif" fontWeight={600}>
            {ac.callsign}
          </text>
        </g>
      ))}
    </g>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface AirfieldView2DProps {
  aircraft?: Aircraft[];
  onAircraftClick?: (id: string) => void;
  selectedAircraftId?: string | null;
}

const AirfieldView2D: React.FC<AirfieldView2DProps> = ({
  aircraft = [],
  onAircraftClick,
  selectedAircraftId,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);

  // Pan & zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform(prev => ({
      ...prev,
      scale: Math.min(Math.max(prev.scale * delta, 0.3), 8),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
    };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setTransform(prev => ({
      ...prev,
      x: dragRef.current!.startTx + (e.clientX - dragRef.current!.startX),
      y: dragRef.current!.startTy + (e.clientY - dragRef.current!.startY),
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: C.land, cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={VIEWBOX_STR}
        preserveAspectRatio="xMidYMid meet"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '50% 50%',
          transition: dragRef.current ? 'none' : 'transform 0.05s ease-out',
        }}
      >
        <GeographyLayer />
        <ApronsLayer />
        <TaxiwaysLayer />
        <TerminalsLayer />
        <GatesLayer />
        <RunwaysLayer />
        <AircraftLayer aircraft={aircraft} />
        <OverlayLayer />
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-1">
        <button
          className="w-8 h-8 flex items-center justify-center text-slate-300 bg-slate-800/80 border border-slate-700 rounded text-sm font-mono hover:bg-slate-700 transition-colors"
          onClick={() => setTransform(p => ({ ...p, scale: Math.min(p.scale * 1.25, 8) }))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center text-slate-300 bg-slate-800/80 border border-slate-700 rounded text-sm font-mono hover:bg-slate-700 transition-colors"
          onClick={() => setTransform(p => ({ ...p, scale: Math.max(p.scale * 0.8, 0.3) }))}
          title="Zoom out"
        >
          −
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center text-slate-400 bg-slate-800/80 border border-slate-700 rounded text-xs hover:bg-slate-700 transition-colors"
          onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
          title="Reset view"
        >
          ⊙
        </button>
      </div>

      {/* View mode badge */}
      <div className="absolute top-3 left-3 px-2 py-0.5 rounded text-xs font-mono tracking-widest text-slate-400 bg-slate-900/60 border border-slate-800">
        2D · AIRFIELD
      </div>
    </div>
  );
};

export default AirfieldView2D;
