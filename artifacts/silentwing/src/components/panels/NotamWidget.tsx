// ─── WeatherWidget (NotamWidget) ───────────────────────────────────────────────
//
// Live weather observations for the active airport ICAO.
// Fetches from aviationweather.gov (METAR, free, no key) every 10 minutes.
// Displays wind, temperature, visibility, QNH, and the raw observation string.

import { useEffect, useState } from 'react';
import { useAirport } from '@/airports/context';

interface Metar {
  icaoId:     string;
  reportTime: string;   // ISO
  temp:       number;   // °C
  dewp:       number;   // °C
  wdir:       number;   // degrees true (0 = variable)
  wspd:       number;   // knots
  wgst?:      number;   // gust knots
  visib:      number;   // statute miles
  altim:      number;   // hPa (QNH)
  wxString?:  string;   // present weather e.g. "FG", "RA"
  metarType:  string;   // "METAR" | "SPECI"
  rawOb:      string;
}

const REFRESH_MS = 10 * 60 * 1_000;

async function fetchMetar(icao: string): Promise<Metar> {
  const url = `/api/metar?icao=${encodeURIComponent(icao)}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as Metar[] | { error: string };
  if (!Array.isArray(json) || json.length === 0)
    throw new Error((json as { error?: string }).error ?? 'No data');
  return json[0];
}

function windDir(deg: number): string {
  if (deg === 0) return 'VRB';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function visFmt(sm: number): string {
  const m = Math.round(sm * 1_609.34 / 100) * 100;
  return m >= 9_999 ? '10 km+' : m >= 1_000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function wxLabel(code: string): string {
  const map: Record<string, string> = {
    FG: 'FOG', FZFG: 'FRZING FOG', BR: 'MIST', HZ: 'HAZE',
    RA: 'RAIN', DZ: 'DRIZZLE', SN: 'SNOW', GR: 'HAIL',
    TS: 'TSTORM', SQ: 'SQUALL', FU: 'SMOKE', SA: 'SAND',
    RASN: 'RAIN+SNOW', TSRA: 'TSTORM+RAIN',
  };
  return map[code] ?? code;
}

export default function NotamWidget() {
  const profile = useAirport();
  const icao = profile.icao;

  const [metar,     setMetar]     = useState<Metar | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = async () => {
    try {
      const data = await fetchMetar(icao);
      setMetar(data);
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
        className="flex items-center justify-between px-3 pt-1.5 pb-1"
        style={{ borderBottom: '1px solid rgba(250,204,21,0.10)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[7px] tracking-[0.25em] font-bold uppercase"
            style={{ color: '#FDE047' }}
          >
            WX
          </span>
          <span className="font-mono text-[7px] text-slate-600">·</span>
          <span className="font-mono text-[7px] text-slate-600 tracking-widest">{icao}</span>
          {metar && (
            <>
              <span className="font-mono text-[7px] text-slate-600">·</span>
              <span
                className="font-mono text-[6px] tracking-wider"
                style={{ color: metar.metarType === 'SPECI' ? '#F87171' : '#94A3B8' }}
              >
                {metar.metarType}
              </span>
            </>
          )}
        </div>
        {fetchedAt && (
          <span className="font-mono text-[6px] text-slate-700">
            {new Date(fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-2">
        {error ? (
          <span className="font-mono text-[9px] text-slate-600">{error}</span>
        ) : metar === null ? (
          <span className="font-mono text-[9px] text-slate-700">Loading…</span>
        ) : (
          <>
            {/* Single horizontal row — label stacked above value so each
                column is narrow enough for all fields to share one line. */}
            <div className="flex items-start gap-4">
              <Field label="WIND">
                {metar.wdir === 0
                  ? `VRB ${metar.wspd}KT`
                  : `${String(metar.wdir).padStart(3,'0')}° ${windDir(metar.wdir)} ${metar.wspd}KT`
                  + (metar.wgst ? ` G${metar.wgst}KT` : '')}
              </Field>
              <Field label="VIS">{visFmt(metar.visib)}</Field>
              {metar.wxString && (
                <Field label="WX">
                  <span style={{ color: '#F87171' }}>{wxLabel(metar.wxString)}</span>
                </Field>
              )}
              <Field label="TEMP">{metar.temp}°C</Field>
              <Field label="DP">{metar.dewp}°C</Field>
              <Field label="QNH">{metar.altim} hPa</Field>
            </div>

            {/* Raw METAR — same row underneath, slightly dimmer */}
            <div
              className="mt-1.5 pt-1 font-mono text-[8px] text-slate-500 leading-tight"
              style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
            >
              {metar.rawOb}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono text-[8px] tracking-widest"
        style={{ color: '#FDE047', opacity: 0.6 }}
      >
        {label}
      </span>
      <span className="font-mono text-[13px] font-medium text-slate-100 whitespace-nowrap leading-none">{children}</span>
    </div>
  );
}
