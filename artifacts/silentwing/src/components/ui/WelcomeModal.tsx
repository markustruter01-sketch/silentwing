// ── WelcomeModal ──────────────────────────────────────────────────────────────
//
// Shown on every page load / refresh.  Dismissed by the CTA button or Escape.
// No localStorage — intentionally reappears each session so new controllers
// always see the briefing on cold start.

import { useEffect } from 'react';

interface Props { onDismiss: () => void }

const FEATURES = [
  'Live 3D airport visualisation with real taxiway geometry',
  'Separation, runway incursion & stale-track alert engine',
  'Automated director camera — cuts to active conflicts',
  'Arrival & departure sequence ladder',
  'Weather (METAR) and NOTAM widgets',
  '2D airfield plan view',
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
        className="relative w-full max-w-md mx-4 bg-[#0D1117] border border-slate-700/60 rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          <span className="font-mono text-[10px] tracking-widest text-slate-400 uppercase">
            SilentWing · System Briefing
          </span>
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* § 1 — What it is */}
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
        </div>

        {/* Footer CTA */}
        <div className="px-5 pb-5">
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
