// ─── OurAirportsPanel (DEV only) ─────────────────────────────────────────────
//
// A floating panel that proves the OurAirports lookup works by letting
// the developer type any ICAO and see the official ARP coordinates, elevation,
// and runway list returned by getAirportInfo().
//
// This component is NEVER rendered in production builds — the parent (App.tsx)
// gates it behind `import.meta.env.DEV`.
//
// Keyboard shortcut: Alt+Shift+O  (opens/closes the panel)

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAirportInfo, type OurAirportInfo } from '@/airports/ourairports';

type Status = 'idle' | 'loading' | 'found' | 'notfound' | 'error';

export default function OurAirportsPanel() {
  const [open,   setOpen]   = useState(false);
  const [icao,   setIcao]   = useState('YSSY');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<OurAirportInfo | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // ── Lookup ─────────────────────────────────────────────────────────────────
  const lookup = useCallback(async () => {
    const q = icao.trim().toUpperCase();
    if (!q) return;
    setStatus('loading');
    setResult(null);
    setErrMsg('');
    try {
      const info = await getAirportInfo(q);
      if (info) {
        setResult(info);
        setStatus('found');
      } else {
        setStatus('notfound');
      }
    } catch (e) {
      setStatus('error');
      setErrMsg(String(e));
    }
  }, [icao]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="OurAirports lookup (Alt+Shift+O)"
        className="font-mono text-[11px] text-slate-500 hover:text-amber-400 transition-colors px-1.5 py-0.5 rounded border border-slate-700/50 hover:border-amber-700/50 bg-slate-900/60"
      >
        OA
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="w-[560px] max-h-[80vh] flex flex-col rounded-xl overflow-hidden"
        style={{ background: '#0f172a', border: '1px solid rgba(100,116,139,0.30)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <span className="font-mono text-[11px] tracking-widest text-amber-400 uppercase">
            OurAirports Lookup
          </span>
          <span className="font-mono text-[10px] text-slate-600 ml-1">
            (DEV only — public domain dataset)
          </span>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto font-mono text-[12px] text-slate-600 hover:text-slate-300 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60">
          <input
            ref={inputRef}
            value={icao}
            onChange={e => setIcao(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') void lookup(); }}
            maxLength={10}
            placeholder="ICAO e.g. YSSY"
            className="flex-1 font-mono text-[13px] bg-slate-800/60 border border-slate-700/60 rounded px-3 py-1.5 text-slate-200 placeholder:text-slate-600 outline-none focus:border-amber-600/60"
          />
          <button
            onClick={() => void lookup()}
            disabled={status === 'loading'}
            className="font-mono text-[12px] px-3 py-1.5 rounded border bg-amber-900/30 border-amber-700/50 text-amber-300 hover:bg-amber-900/50 transition-colors disabled:opacity-50"
          >
            {status === 'loading' ? 'Looking up…' : 'Look up'}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {status === 'idle' && (
            <p className="font-mono text-[11px] text-slate-600">
              Enter an ICAO code and press Look up or Enter.
              Data source: OurAirports large + medium airports (public domain).
            </p>
          )}

          {status === 'notfound' && (
            <p className="font-mono text-[12px] text-amber-500">
              ⚠ "{icao.trim().toUpperCase()}" not found — may be a small aerodrome
              (below large/medium threshold) or an unknown identifier.
            </p>
          )}

          {status === 'error' && (
            <p className="font-mono text-[12px] text-red-400">
              ✕ Fetch error: {errMsg}
            </p>
          )}

          {status === 'found' && result && (
            <div className="space-y-4">
              {/* Identity */}
              <div>
                <div className="font-mono text-[10px] text-slate-600 uppercase tracking-widest mb-1">Identity</div>
                <table className="w-full font-mono text-[12px]">
                  <tbody>
                    {[
                      ['ICAO',      result.icao],
                      ['IATA',      result.iata || '—'],
                      ['Name',      result.name],
                      ['Type',      result.type],
                      ['Country',   result.country],
                      ['Region',    result.region],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-800/40">
                        <td className="py-0.5 pr-4 text-slate-600 w-24">{k}</td>
                        <td className="py-0.5 text-slate-200">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ARP */}
              <div>
                <div className="font-mono text-[10px] text-slate-600 uppercase tracking-widest mb-1">
                  Airport Reference Point (ARP)
                </div>
                <table className="w-full font-mono text-[12px]">
                  <tbody>
                    {[
                      ['Lat',  result.lat.toFixed(6) + '°'],
                      ['Lon',  result.lon.toFixed(6) + '°'],
                      ['Elev', result.elevFt + ' ft MSL'],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-800/40">
                        <td className="py-0.5 pr-4 text-slate-600 w-24">{k}</td>
                        <td className="py-0.5 text-emerald-300">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Runways */}
              <div>
                <div className="font-mono text-[10px] text-slate-600 uppercase tracking-widest mb-1">
                  Runways ({result.runways.length})
                </div>
                {result.runways.length === 0 ? (
                  <p className="font-mono text-[11px] text-slate-600">No runway data available.</p>
                ) : (
                  <div className="space-y-2">
                    {result.runways.map((rw, i) => (
                      <div
                        key={i}
                        className="rounded border border-slate-800 bg-slate-800/30 px-3 py-2"
                      >
                        <div className="font-mono text-[13px] text-sky-300 font-bold mb-1">
                          {rw.le ?? '?'} / {rw.he ?? '?'}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px]">
                          <span className="text-slate-600">LE hdg</span>
                          <span className="text-slate-300">{rw.leHdg != null ? rw.leHdg + '°T' : '—'}</span>
                          <span className="text-slate-600">HE hdg</span>
                          <span className="text-slate-300">{rw.heHdg != null ? rw.heHdg + '°T' : '—'}</span>
                          <span className="text-slate-600">LE threshold</span>
                          <span className="text-slate-300">
                            {rw.leLat != null ? `${rw.leLat.toFixed(4)}, ${rw.leLon?.toFixed(4)}` : '—'}
                          </span>
                          <span className="text-slate-600">HE threshold</span>
                          <span className="text-slate-300">
                            {rw.heLat != null ? `${rw.heLat.toFixed(4)}, ${rw.heLon?.toFixed(4)}` : '—'}
                          </span>
                          <span className="text-slate-600">Length</span>
                          <span className="text-slate-300">{rw.lengthFt != null ? rw.lengthFt.toLocaleString() + ' ft' : '—'}</span>
                          <span className="text-slate-600">Width</span>
                          <span className="text-slate-300">{rw.widthFt != null ? rw.widthFt + ' ft' : '—'}</span>
                          <span className="text-slate-600">Surface</span>
                          <span className="text-slate-300">{rw.surface || '—'}</span>
                          <span className="text-slate-600">Lighted</span>
                          <span className={rw.lighted ? 'text-emerald-400' : 'text-slate-500'}>
                            {rw.lighted ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw JSON */}
              <details className="border border-slate-800 rounded">
                <summary className="px-3 py-1.5 font-mono text-[10px] text-slate-600 cursor-pointer hover:text-slate-400 tracking-widest uppercase">
                  Raw JSON
                </summary>
                <pre className="px-3 py-2 font-mono text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800/60">
          <span className="font-mono text-[10px] text-slate-700">
            Source: OurAirports large + medium airports · public domain · 5 276 airports · Alt+Shift+O to close
          </span>
        </div>
      </div>
    </div>
  );
}
