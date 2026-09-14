import React from 'react';

interface StatusStripProps {
  aircraftCount: number;
  alertCount: number;
  groundCount: number;
  sectorLoad: number; // 0–100 %
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-600 font-mono text-[10px] tracking-widest uppercase">
        {label}
      </span>
      <span className={`font-mono text-xs font-semibold ${accent ?? 'text-slate-300'}`}>
        {value}
      </span>
    </div>
  );
}

const StatusStrip: React.FC<StatusStripProps> = ({
  aircraftCount,
  alertCount,
  groundCount,
  sectorLoad,
}) => {
  const loadColor =
    sectorLoad >= 80 ? 'text-red-400' :
    sectorLoad >= 60 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className="flex items-center gap-6 px-4 h-8 border-b border-slate-800/60 bg-slate-950/80 shrink-0 overflow-hidden">
      <Stat label="Aircraft" value={aircraftCount} />
      <div className="w-px h-3 bg-slate-800" />
      <Stat
        label="Alerts"
        value={alertCount}
        accent={alertCount > 0 ? 'text-amber-400' : 'text-slate-500'}
      />
      <div className="w-px h-3 bg-slate-800" />
      <Stat label="Ground" value={groundCount} />
      <div className="w-px h-3 bg-slate-800" />
      {/* Estimate, not feed data: aircraft count over a fixed sectorCapacity. */}
      <Stat label="Sector Load (est.)" value={`${sectorLoad}%`} accent={loadColor} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Hotkey hints */}
      <div className="flex items-center gap-3 text-slate-700">
        {[
          ['V', 'Switch view'],
          ['P', 'Pred. paths'],
          ['L', 'Snap live'],
        ].map(([key, hint]) => (
          <span key={key} className="flex items-center gap-1 font-mono text-[10px]">
            <kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-[9px] text-slate-500">
              {key}
            </kbd>
            <span className="text-slate-700">{hint}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export default StatusStrip;
