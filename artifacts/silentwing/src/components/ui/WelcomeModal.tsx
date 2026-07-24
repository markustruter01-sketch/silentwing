// ── WelcomeModal ──────────────────────────────────────────────────────────────
//
// Shown on every page load / refresh.  Dismissed by the CTA button or Escape.
// No localStorage — intentionally reappears each session so new controllers
// always see the briefing on cold start.

import { useEffect } from 'react';
import { Key, MouseSVG, Row, MouseRow } from './ControlAtoms';

interface Props { onDismiss: () => void }

const FEATURES = [
  'Live 3D airport visualisation with real taxiway geometry',
  'Separation, runway incursion & stale-track alert engine',
  'Automated director camera — cuts to active conflicts',
  'Arrival & departure sequence ladder',
  'Weather (METAR) and NOTAM widgets',
  '2D airfield plan view',
];

const AIRPORTS = [
  {
    icao: 'YBBN',
    name: 'Brisbane Airport',
    desc: 'Parallel runway complex — 01L/19R, 01R/19L',
  },
  {
    icao: 'YSSY',
    name: 'Sydney Airport',
    desc: 'Mixed-use complex — 16L/34R, 16R/34L, 07/25',
  },
];

export default function WelcomeModal({ onDismiss }: Props) {
  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onDismiss}
    >
      {/* Panel — stop clicks propagating to backdrop */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-[#0D1117] border border-slate-700/60 rounded-lg shadow-2xl
                   max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 sticky top-0 bg-[#0D1117] z-10">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
            SilentWing · System Briefing
          </span>
        </div>

        <div className="px-5 py-5 flex-1">
          {/* ── Two-column grid for top sections ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">

            {/* § 1 — Overview */}
            <section>
              <div className="font-mono text-[9px] tracking-widest text-sky-500/80 uppercase mb-1.5">
                Overview
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Real-time ATC situational awareness display. Visualises live airport
                traffic in 3D, detects conflicts, and focuses controller attention
                automatically.
              </p>
            </section>

            {/* § 2 — Data sources */}
            <section>
              <div className="font-mono text-[9px] tracking-widest text-sky-500/80 uppercase mb-2">
                Data Sources — 2 live streams
              </div>
              <ul className="space-y-1.5">
                {[
                  ['ADS-B Exchange', 'transponder feed — positions, altitude, speed, heading'],
                  ['Aviation Weather Center', 'METAR observations — wind, visibility, QNH'],
                ].map(([src, desc]) => (
                  <li key={src} className="flex gap-2 text-sm">
                    <span className="shrink-0 text-emerald-400 text-[10px] leading-none mt-[2px]">✓</span>
                    <span>
                      <span className="text-slate-200 font-medium">{src}</span>
                      <span className="text-slate-500"> — {desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* § 3 — Features */}
            <section>
              <div className="font-mono text-[9px] tracking-widest text-sky-500/80 uppercase mb-2">
                Features
              </div>
              <ul className="space-y-1.5">
                {FEATURES.map(f => (
                  <li key={f} className="flex gap-2 text-sm text-slate-300">
                    <span className="mt-[3px] w-1 h-1 shrink-0 rounded-full bg-sky-500/70" />
                    {f}
                  </li>
                ))}
              </ul>
            </section>

            {/* § 4 — Airports */}
            <section>
              <div className="font-mono text-[9px] tracking-widest text-sky-500/80 uppercase mb-2">
                Airports
              </div>
              <div className="flex flex-col gap-2">
                {AIRPORTS.map(ap => (
                  <div
                    key={ap.icao}
                    className="flex items-start gap-3 rounded-md border border-slate-700/50 bg-slate-900/60 px-3 py-2"
                  >
                    <span className="shrink-0 font-mono text-[11px] font-semibold text-sky-400
                                     bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5
                                     tracking-wider leading-none mt-[1px]">
                      {ap.icao}
                    </span>
                    <div>
                      <div className="text-sm text-slate-200 font-medium leading-snug">{ap.name}</div>
                      <div className="text-[11px] text-slate-500 leading-snug mt-0.5">{ap.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* § 5 — Controls (full width) */}
          <section>
            <div className="font-mono text-[9px] tracking-widest text-sky-500/80 uppercase mb-3">
              Controls
            </div>
            <div className="flex flex-col sm:flex-row gap-4">

              {/* Keyboard */}
              <div className="flex-1 rounded-md border border-slate-700/50 bg-slate-900/60 px-4 py-3">
                <div className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase mb-2">
                  Keyboard
                </div>
                <div className="flex flex-col gap-1.5">
                  <Row hint="toggle 3D / 2D view" label={<Key>V</Key>} />
                  <Row hint="toggle live feed"    label={<Key>L</Key>} />
                  <Row hint="paths &amp; routes"  label={<Key>P</Key>} />
                  <Row hint="exit mode / deselect" label={<Key>Esc</Key>} />
                </div>
              </div>

              {/* Mouse */}
              <div className="flex-1 rounded-md border border-slate-700/50 bg-slate-900/60 px-4 py-3">
                <div className="text-[9px] font-semibold tracking-widest text-slate-500 uppercase mb-2">
                  Mouse
                </div>
                <div className="flex items-start gap-4">
                  <MouseSVG />
                  <div className="flex flex-col gap-1.5 mt-1">
                    <MouseRow side="L"      hint="drag — orbit (3D) / pan (2D)" />
                    <MouseRow side="R"      hint="drag — pan (3D only)" />
                    <MouseRow side="Scroll" hint="zoom" />
                    <MouseRow side="L"      hint="click — select &amp; inspect" />
                    <MouseRow side="L"      hint="double-click — focus aircraft" />
                  </div>
                </div>
              </div>

            </div>
          </section>
        </div>

        {/* Footer CTA — sticky at bottom */}
        <div className="px-5 pb-5 pt-2 bg-[#0D1117] sticky bottom-0 border-t border-slate-800/60">
          <button
            onClick={onDismiss}
            className="w-full py-2.5 font-mono text-xs tracking-widest uppercase
                       bg-sky-600 hover:bg-sky-500 active:bg-sky-700
                       text-white rounded transition-colors duration-150"
          >
            Acknowledge &amp; Enter
          </button>
          <p className="text-center font-mono text-[9px] text-slate-600 mt-2 tracking-wider">
            ESC to dismiss
          </p>
        </div>
      </div>
    </div>
  );
}
