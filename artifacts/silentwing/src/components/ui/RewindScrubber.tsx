export default function RewindScrubber() {
  return (
    <div
      aria-label="Rewind scrubber (presentational)"
      className="fixed bottom-4 right-4 z-[170] w-[340px] rounded-full border border-white/15 bg-slate-950/75 px-4 py-2.5 shadow-2xl backdrop-blur-xl"
      title="Rewind control is presentational in this build"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 font-mono text-[10px] tracking-widest text-white">−30s</span>
        <div className="relative h-4 flex-1">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
          <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-emerald-200 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]" />
          <div className="absolute right-0 top-1/2 h-5 w-px -translate-y-1/2 bg-white/70" />
        </div>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] tracking-widest text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE
        </span>
      </div>
    </div>
  );
}