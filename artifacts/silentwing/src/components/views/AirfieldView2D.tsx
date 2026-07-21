import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  REAL_RUNWAYS,
  REAL_TAXIWAYS,
  REAL_APRONS,
  REAL_GATES,
} from '@/data/ybbn_real';
import {
  GEO_POLYGONS,
  VIEWBOX_STR,
  VIEWBOX,
} from '@/data/ybbn';
import type { Aircraft } from '@/types';

// ── Y-flip: ybbn_real uses +y=north; this SVG uses +y=south ──────────────────
// ADS-B adapter also uses +y=south, so this keeps geometry and aircraft aligned.
function fy(coords: [number, number][]): [number, number][] {
  return coords.map(([x, y]) => [x, -y] as [number, number]);
}

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

// ── Real airport geometry layers — all Y-flipped via fy() ────────────────────

const ApronsLayer: React.FC = () => (
  <g id="aprons">
    {REAL_APRONS.map((apron, i) => (
      <polygon
        key={i}
        points={pts(fy(apron))}
        fill={C.apron}
        stroke={C.apronStroke}
        strokeWidth={6}
      />
    ))}
  </g>
);

const GatesLayer: React.FC = () => (
  <g id="gates">
    {REAL_GATES.map((g, i) => {
      const [gx, gy] = [g.pos[0], -g.pos[1]]; // Y-flip
      return (
        <g key={i}>
          <circle cx={gx} cy={gy} r={16} fill={C.apron} stroke={C.gateStroke} strokeWidth={3} />
          {g.ref ? (
            <text
              x={gx} y={gy + 5}
              fill={C.label} fontSize={13} fontFamily="Inter, system-ui, sans-serif"
              fontWeight={500} textAnchor="middle"
            >
              {g.ref}
            </text>
          ) : null}
        </g>
      );
    })}
  </g>
);

const TaxiwaysLayer: React.FC = () => (
  <g id="taxiways">
    {REAL_TAXIWAYS.map((t, i) => {
      const ptsStr = polyline(fy(t.coords));
      return (
        <g key={i}>
          {/* Taxiway surface */}
          <polyline
            points={ptsStr}
            fill="none"
            stroke={C.taxiway}
            strokeWidth={22}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Centreline */}
          <polyline
            points={ptsStr}
            fill="none"
            stroke={C.taxiCL}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="30 20"
          />
        </g>
      );
    })}
  </g>
);

const RunwaysLayer: React.FC = () => (
  <g id="runways">
    {REAL_RUNWAYS.map((rw, i) => {
      const coords  = fy(rw.coords);
      const ptsStr  = polyline(coords);
      const firstPt = coords[0];
      const lastPt  = coords[coords.length - 1];
      // Lower y_scene = further north (SVG +y is south)
      const firstIsNorth = firstPt[1] < lastPt[1];
      const northPt = firstIsNorth ? firstPt : lastPt; // 19x threshold
      const southPt = firstIsNorth ? lastPt : firstPt; // 01x threshold
      const [des01, des19] = rw.ref.split('/');
      return (
        <g key={i}>
          {/* Runway surface — thick polyline (52 m ≈ real width + visibility margin) */}
          <polyline
            points={ptsStr}
            fill="none"
            stroke={C.runway}
            strokeWidth={66}
            strokeLinecap="butt"
            strokeLinejoin="round"
          />
          {/* Centreline */}
          <polyline
            points={ptsStr}
            fill="none"
            stroke={C.runwayCL}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray="80 50"
            opacity={0.5}
          />
          {/* 19x designator at north threshold */}
          <text
            x={northPt[0]} y={northPt[1] - 60}
            fill={C.designator} fontSize={80}
            fontFamily="Inter, system-ui, sans-serif" fontWeight={700}
            textAnchor="middle"
            transform={`rotate(190, ${northPt[0]}, ${northPt[1]})`}
            opacity={0.75}
          >{des19}</text>
          {/* 01x designator at south threshold */}
          <text
            x={southPt[0]} y={southPt[1] + 60}
            fill={C.designator} fontSize={80}
            fontFamily="Inter, system-ui, sans-serif" fontWeight={700}
            textAnchor="middle"
            transform={`rotate(10, ${southPt[0]}, ${southPt[1]})`}
            opacity={0.75}
          >{des01}</text>
        </g>
      );
    })}
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

// ─── Aircraft layer ────────────────────────────────────────────────────────────

// Visual style per phase — a quick lookup table keeps the JSX clean
const PHASE_STYLE: Record<string, { fill: string; stroke: string; opacity: number }> = {
  'approach':           { fill: '#38BDF8', stroke: '#0284C7', opacity: 0.95 },
  'landing':            { fill: '#60A5FA', stroke: '#2563EB', opacity: 0.95 },
  'taxi-in':            { fill: '#F59E0B', stroke: '#92400E', opacity: 0.90 },
  'at-gate':            { fill: '#4ADE80', stroke: '#166534', opacity: 0.80 },
  'taxi-out':           { fill: '#FB923C', stroke: '#9A3412', opacity: 0.90 },
  'takeoff':            { fill: '#818CF8', stroke: '#3730A3', opacity: 0.95 },
  'departure':          { fill: '#C084FC', stroke: '#6B21A8', opacity: 0.90 },
  'enroute-departure':  { fill: '#C084FC', stroke: '#6B21A8', opacity: 0.85 },
  'enroute-arrival':    { fill: '#38BDF8', stroke: '#0284C7', opacity: 0.80 },
};
const DEFAULT_STYLE = { fill: '#94A3B8', stroke: '#475569', opacity: 0.80 };

// Symbol size (metres in SVG coordinate space)
const S = 80;

interface AircraftLayerProps {
  aircraft: Aircraft[];
  onAircraftClick?: (id: string) => void;
  selectedId?: string | null;
}

const AircraftLayer: React.FC<AircraftLayerProps> = ({ aircraft, onAircraftClick, selectedId }) => {
  if (!aircraft.length) return null;

  return (
    <g id="aircraft">
      {aircraft.map(ac => {
        const style = PHASE_STYLE[ac.phase] ?? DEFAULT_STYLE;
        const isSelected = ac.id === selectedId;
        const { x, y } = ac.position;

        return (
          <g
            key={ac.id}
            transform={`translate(${x},${y})`}
            style={{ cursor: onAircraftClick ? 'pointer' : 'default' }}
            onClick={() => onAircraftClick?.(ac.id)}
          >
            {/* Selection halo */}
            {isSelected && (
              <circle r={S * 0.85} fill="none" stroke="#FACC15" strokeWidth={6} opacity={0.7} />
            )}

            {/* Directional triangle — rotated to heading */}
            <g transform={`rotate(${ac.heading})`}>
              <polygon
                points={`0,${-S} ${-S * 0.38},${S * 0.52} 0,${S * 0.28} ${S * 0.38},${S * 0.52}`}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={7}
                opacity={style.opacity}
              />
            </g>

            {/* Centre dot */}
            <circle r={12} fill={style.stroke} opacity={0.9} />

            {/* Callsign — always upright, above the symbol */}
            <text
              y={-(S + 22)}
              fontSize={58}
              textAnchor="middle"
              fontFamily="'JetBrains Mono', 'Consolas', 'Courier New', monospace"
              fontWeight={600}
              fill={style.fill}
              opacity={0.92}
              style={{ userSelect: 'none' }}
            >
              {ac.callsign}
            </text>

            {/* Speed + altitude tag — below callsign */}
            <text
              y={-(S + 22) + 52}
              fontSize={42}
              textAnchor="middle"
              fontFamily="'JetBrains Mono', 'Consolas', 'Courier New', monospace"
              fontWeight={400}
              fill={style.fill}
              opacity={0.55}
              style={{ userSelect: 'none' }}
            >
              {ac.groundSpeed > 0 ? `${ac.groundSpeed}kt` : ac.phase === 'at-gate' ? 'GATE' : ''}
              {ac.position.alt > 50 ? ` A${Math.round(ac.position.alt / 100).toString().padStart(3, '0')}` : ''}
            </text>
          </g>
        );
      })}
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
    if (e.button !== 0 && e.button !== 2) return; // left or right drag pans
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
    };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform(prev => ({
      ...prev,
      x: drag.startTx + (e.clientX - drag.startX),
      y: drag.startTy + (e.clientY - drag.startY),
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
      onContextMenu={e => e.preventDefault()}
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
        <GatesLayer />
        <RunwaysLayer />
        <AircraftLayer
          aircraft={aircraft}
          onAircraftClick={onAircraftClick}
          selectedId={selectedAircraftId}
        />
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
