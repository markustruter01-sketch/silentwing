// ControlsHUD — bottom-right controls legend shown on both 2D and 3D views.
// Collapsible: renders as a [?] pill by default; click to expand the full legend.
// Collapsed state persists in localStorage.

import { useState } from 'react';

type View = 'airfield' | 'airspace';

interface Props { activeView: View; }

// ── Mouse SVG ────────────────────────────────────────────────────────────────
function MouseSVG() {
  return (
    <svg
      viewBox="0 0 44 66"
      width={36}
      height={54}
      aria-hidden
      className="flex-shrink-0"
    >
      {/* Body outline */}
      <rect
        x={2} y={14} width={40} height={50}
        rx={20} ry={20}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={2}
      />
      {/* Left button */}
      <path
        d="M2 33 Q2 14 22 14 L22 33 Z"
        fill="#1e2a3a"
        stroke="#94a3b8"
        strokeWidth={1.5}
      />
      {/* Right button */}
      <path
        d="M42 33 Q42 14 22 14 L22 33 Z"
        fill="#1e2a3a"
        stroke="#94a3b8"
        strokeWidth={1.5}
      />
      {/* Centre divider line between buttons */}
      <line x1={22} y1={14} x2={22} y2={33} stroke="#94a3b8" strokeWidth={1.5} />
      {/* Scroll wheel */}
      <rect
        x={18} y={18} width={8} height={14}
        rx={4}
        fill="#475569"
        stroke="#64748b"
        strokeWidth={1}
      />
      {/* Scroll wheel highlight tick */}
      <line x1={22} y1={21} x2={22} y2={29} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 2" />
    </svg>
  );
}

// ── Label atoms ───────────────────────────────────────────────────────────────
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1
                    rounded border border-slate-600 bg-slate-800
                    text-[10px] font-mono text-slate-300 leading-none select-none">
      {children}
    </kbd>
  );
}

function Row({ label, hint }: { label: React.ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-slate-400 text-[10px] leading-tight">{hint}</span>
      {label}
    </div>
  );
}

function MouseRow({ side, hint }: { side: 'L' | 'R' | 'Scroll'; hint: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center justify-center w-[34px] h-[16px]
                   rounded border border-slate-600 bg-slate-800
                   text-[9px] font-mono text-slate-300 leading-none select-none flex-shrink-0"
      >
        {side === 'Scroll' ? '↕' : side}
      </span>
      <span className="text-slate-400 text-[10px] leading-tight">{hint}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ControlsHUD({ activeView }: Props) {
  const is3D = activeView === 'airspace';

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('hud-collapsed') === 'true'; }
    catch { return true; }
  });

  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('hud-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // ── Collapsed state: just the [?] pill ────────────────────────────────────
  if (collapsed) {
    return (
      <button
        onClick={toggle}
        aria-label="Show controls reference"
        title="Show keyboard & mouse controls"
        className="absolute bottom-4 right-4 z-30
                   flex items-center justify-center px-3 py-1.5
                   rounded-full border border-slate-700/60
                   bg-slate-900/75 backdrop-blur-sm
                   font-mono text-[11px] text-slate-400
                   hover:text-slate-200 hover:border-slate-500/80
                   transition-colors cursor-pointer select-none"
      >
        [?]
      </button>
    );
  }

  // ── Expanded state: full legend ───────────────────────────────────────────
  return (
    <div
      className="absolute bottom-4 right-4 z-30
                 flex flex-col gap-0
                 rounded-xl border border-slate-700/60
                 bg-slate-900/75 backdrop-blur-sm
                 pointer-events-auto select-none overflow-hidden"
      aria-label="Controls reference"
    >
      {/* Collapse button */}
      <div className="flex justify-end px-2 pt-1.5">
        <button
          onClick={toggle}
          aria-label="Hide controls reference"
          title="Hide controls"
          className="font-mono text-[9px] text-slate-600 hover:text-slate-400 transition-colors cursor-pointer px-1"
        >
          [×]
        </button>
      </div>

      {/* Legend content */}
      <div className="flex items-end gap-4 px-4 pb-2.5">
        {/* ── Keyboard legend ── */}
        <div className="flex flex-col gap-1 items-end">
          <div className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase mb-0.5">
            Keyboard
          </div>
          <Row hint="toggle view" label={<Key>V</Key>} />
          <Row hint="live feed"   label={<Key>L</Key>} />
          <Row hint="paths & routes" label={<Key>P</Key>} />
          {is3D
            ? <Row hint="exit mode" label={<Key>Esc</Key>} />
            : <Row hint="deselect"  label={<Key>Esc</Key>} />
          }
        </div>

        {/* ── Divider ── */}
        <div className="w-px self-stretch bg-slate-700/60" />

        {/* ── Mouse SVG ── */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase mb-0.5">
            Mouse
          </div>
          <MouseSVG />
        </div>

        {/* ── Divider ── */}
        <div className="w-px self-stretch bg-slate-700/60" />

        {/* ── Mouse-button legend ── */}
        <div className="flex flex-col gap-1 items-start">
          <div className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase mb-0.5">
            &nbsp;
          </div>
          {is3D ? (
            <>
              <MouseRow side="L"      hint="orbit / drag" />
              <MouseRow side="R"      hint="pan"          />
              <MouseRow side="Scroll" hint="zoom"         />
              <MouseRow side="L"      hint="click · select → inspect" />
            </>
          ) : (
            <>
              <MouseRow side="L"      hint="drag to pan"  />
              <MouseRow side="Scroll" hint="zoom"         />
              <MouseRow side="L"      hint="click · select aircraft" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
