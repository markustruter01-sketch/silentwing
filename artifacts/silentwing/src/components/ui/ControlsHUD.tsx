// ControlsHUD — bottom-right controls legend shown on both 2D and 3D views.
// Collapsible: renders as a [?] pill by default; click to expand the full legend.
// Collapsed state persists in localStorage.

import { useState } from 'react';
import { Key, MouseSVG, Row, MouseRow } from './ControlAtoms';

type View = 'airfield' | 'airspace';

interface Props {
  activeView: View;
  /** Use the light glass surface while photoreal ground is enabled. */
  photorealGroundEnabled?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ControlsHUD({
  activeView,
  photorealGroundEnabled = false,
}: Props) {
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
         className={[
           'absolute bottom-4 right-4 z-30 flex items-center justify-center px-3 py-1.5',
           'rounded-full border font-mono text-[11px] text-slate-400',
           'hover:text-slate-200 hover:border-slate-500/80 transition-colors cursor-pointer select-none',
           photorealGroundEnabled
             ? 'sw-glass-panel'
             : 'border-slate-700/60 bg-slate-900/75 backdrop-blur-sm',
         ].join(' ')}
      >
        [?]
      </button>
    );
  }

  // ── Expanded state: full legend ───────────────────────────────────────────
  return (
    <div
      className={[
        'absolute bottom-4 right-4 z-30 flex flex-col gap-0 rounded-xl border',
        'pointer-events-auto select-none overflow-hidden',
        photorealGroundEnabled
          ? 'sw-glass-panel'
          : 'border-slate-700/60 bg-slate-900/75 backdrop-blur-sm',
      ].join(' ')}
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
