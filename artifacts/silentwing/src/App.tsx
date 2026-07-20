import { useCallback, useEffect, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import StatusStrip from '@/components/layout/StatusStrip';
import AirfieldView2D from '@/components/views/AirfieldView2D';

type View = 'airspace' | 'airfield';

// Phase 3+ placeholder for the 3D airspace view
function AirspaceView3D() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0A0E14]">
      <div className="w-12 h-12 border border-slate-800 rounded flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5">
          <path d="M12 22V12M12 12L4 7M12 12l8-5M4 17l8 5 8-5M4 7l8-5 8 5" />
        </svg>
      </div>
      <p className="text-slate-700 font-mono text-xs tracking-widest">3D AIRSPACE — PHASE 3</p>
      <p className="text-slate-800 text-xs">Press V to switch to 2D Airfield view</p>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('airfield');

  // Global hotkey handler
  const handleKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.key.toUpperCase()) {
      case 'V':
        setView(v => v === 'airspace' ? 'airfield' : 'airspace');
        break;
      case 'ESCAPE':
        // Phase 4: back-out chain will be wired here
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#0A0E14] text-slate-100">
      <TopBar
        activeView={view}
        onViewChange={setView}
        feedStatus="live"
      />
      <StatusStrip
        aircraftCount={0}
        alertCount={0}
        groundCount={0}
        sectorLoad={12}
      />
      <main className="flex-1 relative overflow-hidden">
        {view === 'airfield' ? (
          <AirfieldView2D aircraft={[]} />
        ) : (
          <AirspaceView3D />
        )}
      </main>
    </div>
  );
}
