// ─── MetarWidget ───────────────────────────────────────────────────────────────
//
// Displays authoritative aviation weather (METAR + TAF) from NOAA
// aviationweather.gov via the /api/metar proxy.  Augments the existing
// Open-Meteo WeatherWidget — does NOT replace it.
//
// Polling: immediate on mount (not gated on tab visibility), then every 5 min.
// Tab-visibility gating applies to interval polls only, matching the AdsbAdapter
// safe-polling pattern (in-flight guard, visibility-change re-poll).
//
// When a fresh METAR wind arrives, calls onWind(dir, speed) so App can update
// the active runway selection with authoritative METAR data.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AirportProfile } from '@/airports/types';

// ── NOAA response shape (subset of fields we care about) ─────────────────────
interface CloudLayer {
  cover:     string;         // "FEW" | "SCT" | "BKN" | "OVC" | "OVX" | "SKC" | "CLR"
  base:      number | null;  // feet AGL
}

interface MetarRecord {
  icaoId:     string;
  rawOb:      string;
  reportTime: string;
  temp:       number | null;
  dewp:       number | null;
  wdir:       number | null;  // degrees FROM; 0 = calm or variable
  wspd:       number | null;  // knots
  wgst:       number | null;  // gust knots, null if no gust
  visib:      string | null;  // statute miles, e.g. "6+", "3", "1/4"
  altim:      number | null;  // hPa if > 100, inHg if ~29–31
  clouds:     CloudLayer[];
  cover:      string | null;  // summary: "CLR" | "SKC" | "NCD" etc.
  fltCat:     string | null;  // "VFR" | "MVFR" | "IFR" | "LIFR"
}

interface TafRecord {
  icaoId:  string;
  rawTAF:  string;
  issueTime?: string;
}

interface MetarResponse {
  metar: MetarRecord | null;
  taf:   TafRecord   | null;
}

// ── Flight-category colour coding ─────────────────────────────────────────────
const CAT_STYLE: Record<string, { text: string; bg: string; dot: string }> = {
  VFR:  { text: 'text-emerald-300', bg: 'bg-emerald-900/30 border-emerald-700/40', dot: 'bg-emerald-400' },
  MVFR: { text: 'text-sky-300',     bg: 'bg-sky-900/30 border-sky-700/40',         dot: 'bg-sky-400'     },
  IFR:  { text: 'text-red-300',     bg: 'bg-red-900/30 border-red-700/40',         dot: 'bg-red-400'     },
  LIFR: { text: 'text-fuchsia-300', bg: 'bg-fuchsia-900/30 border-fuchsia-700/40', dot: 'bg-fuchsia-400' },
};
function catStyle(cat: string | null) {
  return CAT_STYLE[cat ?? ''] ?? { text: 'text-slate-400', bg: 'bg-slate-800/40 border-slate-700/40', dot: 'bg-slate-500' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(val: number | null | undefined, dec = 0): string {
  if (val == null) return '—';
  return dec === 0 ? Math.round(val).toString() : val.toFixed(dec);
}

function fmtWind(wdir: number | null, wspd: number | null, wgst: number | null): string {
  if (wspd == null) return '—';
  if (wspd === 0 || wdir === 0) return `Calm / ${wspd} kt`;
  const dir = wdir != null ? `${String(wdir).padStart(3, '0')}°` : '—';
  const gust = wgst ? ` G${wgst}` : '';
  return `${dir} / ${wspd}${gust} kt`;
}

function fmtQnh(altim: number | null): string {
  if (altim == null) return '—';
  return altim > 100 ? `Q${Math.round(altim)} hPa` : `A${(altim * 100).toFixed(0)}`;
}

function fmtVis(visib: string | null): string {
  if (!visib) return '—';
  return `${visib} SM`;
}

function fmtClouds(clouds: CloudLayer[], cover: string | null): string {
  if (clouds && clouds.length > 0) {
    return clouds.map(c => `${c.cover}${c.base != null ? `@${c.base}ft` : ''}`).join(' ');
  }
  if (!cover) return '—';
  const map: Record<string, string> = { CLR: 'Clear', SKC: 'Sky clear', NCD: 'NCD', CAVOK: 'CAVOK' };
  return map[cover] ?? cover;
}

function ceiling(clouds: CloudLayer[]): string {
  const layer = clouds.find(c => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'OVX');
  if (!layer || layer.base == null) return '—';
  return `${layer.cover} ${layer.base.toLocaleString()} ft`;
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ── Poll interval ─────────────────────────────────────────────────────────────
const POLL_MS = 5 * 60 * 1000;  // 5 minutes

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  profile:  AirportProfile;
  /** Called whenever fresh METAR wind arrives — use to update active runway. */
  onWind?: (dirDeg: number, speedKt: number) => void;
}

export default function MetarWidget({ profile, onWind }: Props) {
  const [data,      setData]      = useState<MetarResponse | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [showTaf,   setShowTaf]   = useState(false);

  const inFlightRef  = useRef(false);
  const onWindRef    = useRef(onWind);
  onWindRef.current  = onWind;
  // Keep a ref so the poll closure always reads the current ICAO without
  // needing to appear in the effect dependency array.
  const icaoRef = useRef(profile.icao);
  icaoRef.current = profile.icao;

  const doPoll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/metar?icao=${icaoRef.current}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MetarResponse = await res.json();
      setData(json);
      setFetchedAt(Date.now());
      setError(null);
      // Feed METAR wind to the active-runway override if we got a meaningful direction.
      const m = json.metar;
      if (m && m.wdir != null && m.wspd != null && m.wdir !== 0) {
        onWindRef.current?.(m.wdir, m.wspd);
      }
    } catch (e) {
      // Hold last good value; surface error note but don't clear display.
      setError(String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, []); // stable — reads icaoRef at call time

  useEffect(() => {
    // Immediate fetch on mount — NOT gated on visibility per spec.
    void doPoll();

    // Interval polls: every 5 min, skip if tab is hidden.
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') void doPoll();
    }, POLL_MS);

    // Re-poll immediately when tab becomes visible (catch up after background).
    const onVis = () => { if (document.visibilityState === 'visible') void doPoll(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [profile.icao, doPoll]); // re-run on airport switch → fresh ICAO

  const m = data?.metar ?? null;
  const t = data?.taf   ?? null;
  const cat = m?.fltCat ?? null;
  const cs  = catStyle(cat);

  return (
    <div
      className="rounded-lg overflow-hidden text-slate-300"
      style={{ border: '1px solid rgba(100,116,139,0.20)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-slate-800/50">
        <span className="font-mono text-[12px] tracking-[0.2em] text-slate-600 uppercase">{profile.icao}</span>
        <span className="text-slate-700 text-[12px]">·</span>
        <span className="font-mono text-[12px] tracking-wider text-slate-600 uppercase">METAR</span>
        <div className="ml-auto flex items-center gap-1.5">
          {cat && (
            <span className={`flex items-center gap-1 px-1.5 py-px rounded border font-mono text-[13px] font-bold tracking-wider ${cs.bg} ${cs.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cs.dot}`} />
              {cat}
            </span>
          )}
        </div>
      </div>

      {m ? (
        <>
          {/* ── Raw METAR ── */}
          <div className="px-3 py-2 border-b border-slate-800/40">
            <div className="font-mono text-[12px] tracking-widest text-slate-600 uppercase mb-1">Raw</div>
            <div className="font-mono text-[13px] text-slate-400 leading-relaxed break-all">
              {m.rawOb}
            </div>
          </div>

          {/* ── Decoded fields ── */}
          <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              ['WIND',  fmtWind(m.wdir, m.wspd, m.wgst)],
              ['VIS',   fmtVis(m.visib)],
              ['CLOUD', fmtClouds(m.clouds ?? [], m.cover)],
              ['CEIL',  m.clouds?.length ? ceiling(m.clouds) : '—'],
              ['TEMP',  m.temp != null ? `${fmt(m.temp)}° / DP ${fmt(m.dewp)}°` : '—'],
              ['QNH',   fmtQnh(m.altim)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="font-mono text-[11px] tracking-widest text-slate-600 uppercase">{label}</span>
                <span className="font-mono text-[13px] text-slate-300 leading-tight mt-px">{value}</span>
              </div>
            ))}
          </div>

          {/* ── TAF (collapsible) ── */}
          {t?.rawTAF && (
            <div className="border-t border-slate-800/40">
              <button
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-slate-800/30 transition-colors"
                onClick={() => setShowTaf(v => !v)}
              >
                <span className="font-mono text-[12px] tracking-widest text-slate-600 uppercase">TAF</span>
                <span className="font-mono text-[12px] text-slate-700">{showTaf ? '▲' : '▼'}</span>
              </button>
              {showTaf && (
                <div className="px-3 pb-2 font-mono text-[13px] text-slate-500 leading-relaxed break-all">
                  {t.rawTAF}
                </div>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          <div className="px-3 pb-2 pt-0 flex items-center justify-between">
            <span className="font-mono text-[11px] text-slate-700 tracking-wide">
              NOAA METAR · {fetchedAt ? new Date(fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '…'}
            </span>
            {error && (
              <span className="font-mono text-[11px] text-amber-700 tracking-wide" title={error}>
                ⚠ stale
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="px-3 py-3 font-mono text-[13px] text-slate-600">
          {error ? '⚠ METAR unavailable — retrying' : 'Fetching METAR…'}
        </div>
      )}
    </div>
  );
}
