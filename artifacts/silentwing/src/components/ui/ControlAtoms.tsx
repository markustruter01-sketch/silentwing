// ── ControlAtoms — shared keyboard/mouse legend primitives ────────────────────
// Used by both ControlsHUD and WelcomeModal so the visual language stays
// consistent without duplicating JSX.

// ── Mouse SVG ────────────────────────────────────────────────────────────────
export function MouseSVG() {
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

// ── Keyboard key atom ─────────────────────────────────────────────────────────
export function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1
                    rounded border border-slate-600 bg-slate-800
                    text-[10px] font-mono text-slate-300 leading-none select-none">
      {children}
    </kbd>
  );
}

// ── Keyboard row ──────────────────────────────────────────────────────────────
export function Row({ label, hint }: { label: React.ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-slate-400 text-[10px] leading-tight">{hint}</span>
      {label}
    </div>
  );
}

// ── Mouse button row ──────────────────────────────────────────────────────────
export function MouseRow({ side, hint }: { side: 'L' | 'R' | 'Scroll'; hint: string }) {
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
