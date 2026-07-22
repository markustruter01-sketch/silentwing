// ─── NotamWidget ───────────────────────────────────────────────────────────────
//
// Always-visible NOTAM readout for a given ICAO.
// Fetches from aviationweather.gov (free, no key) every 30 minutes.
// Renders at most 6 active NOTAMs, truncated for readability.

import { useEffect, useState } from 'react';
import { useAirport } from '@/airports/context';

interface Notam {
  notamID:        string;
  text:           string;
  startDate?:     string;
  endDate?:       string;
  classification?: string;
}

const REFRESH_MS = 30 * 60 * 1_000;
const MAX_SHOWN  = 6;
const TEXT_LIMIT = 140; // chars before truncation

async function fetchNotams(icao: string): Promise<Notam[]> {
  const url = `https://aviationweather.gov/api/data/notam?ids=${icao}&format=json`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`NOTAM ${res.status}`);
  const json: Notam[] = await res.json();
  // Keep only entries that look like actual NOTAM objects
  return json.filter(n => n.notamID && n.text).slice(0, MAX_SHOWN);
}

/** Strip the common NOTAM preamble so the display text is concise. */
function summarise(text: string): string {
  // Raw NOTAM text often starts with "!ICAO/ICAO NOTAM..." — drop that header
  const trimmed = text.replace(/^![A-Z0-9/\s]+\s*/, '').trim();
  return trimmed.length > TEXT_LIMIT
    ? trimmed.slice(0, TEXT_LIMIT) + '…'
    : trimmed;
}

export default function NotamWidget() {
  const profile = useAirport();
  const icao = profile.icao;

  const [notams,    setNotams]    = useState<Notam[] | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = async () => {
    try {
      const data = await fetchNotams(icao);
      setNotams(data);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unavailable');
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icao]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: '1px solid rgba(250,204,21,0.18)' }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-3 pt-2 pb-1"
        style={{ borderBottom: '1px solid rgba(250,204,21,0.10)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[7px] tracking-[0.25em] font-bold uppercase"
            style={{ color: '#FDE047' }}
          >
            NOTAM
          </span>
          <span className="font-mono text-[7px] text-slate-600">·</span>
          <span className="font-mono text-[7px] text-slate-600 tracking-widest">{icao}</span>
        </div>
        {fetchedAt && (
          <span className="font-mono text-[6px] text-slate-700">
            {new Date(fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-1.5 flex flex-col gap-1.5">
        {error ? (
          <span className="font-mono text-[8px] text-slate-600">{error}</span>
        ) : notams === null ? (
          <span className="font-mono text-[8px] text-slate-700">Loading NOTAMs…</span>
        ) : notams.length === 0 ? (
          <span className="font-mono text-[8px] text-slate-600">No active NOTAMs</span>
        ) : (
          notams.map(n => (
            <div key={n.notamID} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="font-mono text-[7px] font-bold tracking-wide"
                  style={{ color: '#FDE047', opacity: 0.7 }}
                >
                  {n.notamID}
                </span>
                {n.classification && (
                  <span className="font-mono text-[6px] text-slate-600 uppercase tracking-wider">
                    {n.classification}
                  </span>
                )}
              </div>
              <span className="font-mono text-[8px] text-slate-300 leading-snug">
                {summarise(n.text)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
