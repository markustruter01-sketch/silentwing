// ─── WeatherWidget ─────────────────────────────────────────────────────────────
//
// Bottom-left overlay with two sections:
//   1. AUTO METAR strip — formatted observation string controllers can read off
//   2. Current conditions + 12-hour forecast strip
//
// Fetches Open-Meteo (no API key) for the active airport.
// Refreshes every 15 minutes or immediately on airport change.

import { useEffect, useState } from 'react';
import type { AirportProfile } from '@/airports/types';

// ── WMO weather-code → display ─────────────────────────────────────────────────
const WMO: Record<number, { label: string; icon: string }> = {
  0:  { label: 'Clear',          icon: '☀️'  },
  1:  { label: 'Mostly clear',   icon: '🌤️'  },
  2:  { label: 'Partly cloudy',  icon: '⛅'  },
  3:  { label: 'Overcast',       icon: '☁️'  },
  45: { label: 'Fog',            icon: '🌫️'  },
  48: { label: 'Icy fog',        icon: '🌫️'  },
  51: { label: 'Light drizzle',  icon: '🌦️'  },
  53: { label: 'Drizzle',        icon: '🌦️'  },
  55: { label: 'Heavy drizzle',  icon: '🌧️'  },
  61: { label: 'Light rain',     icon: '🌧️'  },
  63: { label: 'Rain',           icon: '🌧️'  },
  65: { label: 'Heavy rain',     icon: '🌧️'  },
  71: { label: 'Light snow',     icon: '🌨️'  },
  73: { label: 'Snow',           icon: '❄️'  },
  75: { label: 'Heavy snow',     icon: '❄️'  },
  80: { label: 'Showers',        icon: '🌦️'  },
  81: { label: 'Rain showers',   icon: '🌧️'  },
  82: { label: 'Heavy showers',  icon: '⛈️'  },
  95: { label: 'Thunderstorm',   icon: '⛈️'  },
  96: { label: 'Hail storm',     icon: '⛈️'  },
  99: { label: 'Hail storm',     icon: '⛈️'  },
};
function wmo(code: number) {
  return WMO[code] ?? { label: `WX${code}`, icon: '🌡️' };
}

// ── Wind direction ─────────────────────────────────────────────────────────────
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function bearing(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface CurrentWeather {
  temperature_2m:       number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m:       number;
  wind_direction_10m:   number;
  weather_code:         number;
  precipitation:        number;
  // Extended fields for METAR
  surface_pressure:     number | null;
  cloud_cover:          number | null;  // 0–100 %
  dew_point_2m:         number | null;
  wind_gusts_10m:       number | null;
  visibility:           number | null;  // metres
}

interface HourlySlice {
  time:                      string;
  temperature_2m:            number;
  weather_code:              number;
  precipitation_probability: number;
  wind_speed_10m:            number;
  wind_direction_10m:        number;
}

interface WeatherState {
  fetchedAt: number;
  current:   CurrentWeather;
  hourly:    HourlySlice[];
}

// ── URL builder ────────────────────────────────────────────────────────────────
function makeWeatherUrl(lat: number, lon: number, tz: string): string {
  return (
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    `&timezone=${encodeURIComponent(tz)}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,' +
    'weather_code,wind_speed_10m,wind_direction_10m,precipitation,' +
    'surface_pressure,cloud_cover,dew_point_2m,wind_gusts_10m,visibility' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,' +
    'wind_speed_10m,wind_direction_10m' +
    '&forecast_days=2'
  );
}

const REFRESH_MS = 15 * 60 * 1_000;

async function fetchWeather(url: string): Promise<WeatherState> {
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const c    = json.current;

  const current: CurrentWeather = {
    temperature_2m:       c.temperature_2m,
    apparent_temperature: c.apparent_temperature,
    relative_humidity_2m: c.relative_humidity_2m,
    wind_speed_10m:       c.wind_speed_10m,
    wind_direction_10m:   c.wind_direction_10m,
    weather_code:         c.weather_code,
    precipitation:        c.precipitation,
    surface_pressure:     c.surface_pressure     ?? null,
    cloud_cover:          c.cloud_cover          ?? null,
    dew_point_2m:         c.dew_point_2m         ?? null,
    wind_gusts_10m:       c.wind_gusts_10m       ?? null,
    visibility:           c.visibility           ?? null,
  };

  const times: string[] = json.hourly.time;
  const nowIso = new Date().toISOString().slice(0, 13);
  const s = Math.max(0, times.findIndex((t: string) => t.startsWith(nowIso)));

  const hourly: HourlySlice[] = times.slice(s, s + 12).map((_: string, i: number) => ({
    time:                      times[s + i],
    temperature_2m:            json.hourly.temperature_2m[s + i],
    weather_code:              json.hourly.weather_code[s + i],
    precipitation_probability: json.hourly.precipitation_probability[s + i],
    wind_speed_10m:            json.hourly.wind_speed_10m[s + i],
    wind_direction_10m:        json.hourly.wind_direction_10m[s + i],
  }));

  return { fetchedAt: Date.now(), current, hourly };
}

// ── METAR string builder ───────────────────────────────────────────────────────
// Produces a standard METAR observation string from Open-Meteo current values.
// All fields follow ICAO Annex 3 / WMO-No.49 conventions.

function fmtC(v: number): string {
  // Negative temps use M prefix, e.g. M03
  return v < 0
    ? `M${String(Math.abs(Math.round(v))).padStart(2, '0')}`
    : String(Math.round(v)).padStart(2, '0');
}

function buildMetar(icao: string, wx: CurrentWeather): string {
  // ── Datetime ────────────────────────────────────────────────────────────────
  const now = new Date();
  const dt  = `${String(now.getUTCDate()).padStart(2,'0')}` +
              `${String(now.getUTCHours()).padStart(2,'0')}` +
              `${String(now.getUTCMinutes()).padStart(2,'0')}Z`;

  // ── Wind (km/h → knots) ─────────────────────────────────────────────────────
  const windKt  = Math.round(wx.wind_speed_10m / 1.852);
  const gustKt  = wx.wind_gusts_10m != null ? Math.round(wx.wind_gusts_10m / 1.852) : 0;
  let windStr: string;
  if (windKt < 1) {
    windStr = '00000KT';
  } else {
    const dir10 = Math.round(wx.wind_direction_10m / 10) * 10;
    const dirS  = String(dir10 === 360 ? 360 : dir10 % 360).padStart(3, '0');
    windStr     = `${dirS}${String(windKt).padStart(2,'0')}`;
    if (gustKt >= windKt + 10) windStr += `G${String(gustKt).padStart(2,'0')}`;
    windStr += 'KT';
  }

  // ── Visibility ──────────────────────────────────────────────────────────────
  let visStr: string;
  if (wx.visibility != null) {
    const v = wx.visibility;
    if (v >= 10000)      visStr = '9999';
    else if (v >= 5000)  visStr = `${Math.round(v / 1000)}000`;
    else if (v >= 800)   visStr = String(Math.round(v / 100) * 100).padStart(4, '0');
    else                 visStr = String(Math.round(v / 50) * 50).padStart(4, '0');
  } else {
    // Estimate from WMO code
    const code = wx.weather_code;
    if      (code >= 95) visStr = '3000';
    else if (code >= 80) visStr = '6000';
    else if (code >= 61) visStr = '5000';
    else if (code >= 51) visStr = '7000';
    else if (code >= 48) visStr = '0200'; // ice fog
    else if (code >= 45) visStr = '0600'; // fog
    else                 visStr = '9999';
  }

  // ── Cloud groups ────────────────────────────────────────────────────────────
  // Estimate cloud base from dew-point spread (LCL approximation):
  //   cloudBase_ft ≈ (temp − dewpoint) × 400
  const temp = wx.temperature_2m;
  const dewp = wx.dew_point_2m
    ?? (temp - (100 - wx.relative_humidity_2m) / 5); // Magnus approximation

  const lclFt       = Math.max(1000, Math.round((temp - dewp) * 400 / 100) * 100);
  const baseHundreds = String(Math.round(lclFt / 100)).padStart(3, '0');

  const cc = wx.cloud_cover ?? 0;
  let cloudStr: string;
  if      (cc < 6)  cloudStr = 'SKC';
  else if (cc < 31) cloudStr = `FEW${baseHundreds}`;
  else if (cc < 56) cloudStr = `SCT${baseHundreds}`;
  else if (cc < 94) cloudStr = `BKN${baseHundreds}`;
  else              cloudStr = `OVC${baseHundreds}`;

  // Add CB modifier for thunderstorm codes
  const code = wx.weather_code;
  if (code >= 95 && cloudStr !== 'SKC') cloudStr += 'CB';

  // CAVOK replaces vis + cloud when: vis ≥ 10 km, SKC, no significant wx
  const isCavok = visStr === '9999' && cloudStr === 'SKC' && code < 3;

  // ── Temperature / dew point ─────────────────────────────────────────────────
  const tdStr = `${fmtC(temp)}/${fmtC(dewp)}`;

  // ── QNH (surface_pressure ≈ QNH for sea-level / low-elevation airports) ─────
  const qnhStr = wx.surface_pressure != null
    ? `Q${String(Math.round(wx.surface_pressure)).padStart(4,'0')}`
    : '';

  // ── Trend ───────────────────────────────────────────────────────────────────
  const trend = code >= 95 ? 'TEMPO TSRA'
              : code >= 80 ? 'TEMPO SHRA'
              : 'NOSIG';

  if (isCavok) {
    return ['METAR', icao, dt, windStr, 'CAVOK', tdStr, qnhStr, trend]
      .filter(Boolean).join(' ');
  }
  return ['METAR', icao, dt, windStr, visStr, cloudStr, tdStr, qnhStr, trend]
    .filter(Boolean).join(' ');
}

// ── Active runway & crosswind computation ──────────────────────────────────────
interface RunwayWind {
  designator:  string;   // e.g. "19R"
  headwindKt:  number;   // positive = headwind
  crosswindKt: number;   // always ≥ 0
}

function activeRunwayWind(
  runways: AirportProfile['runways'],
  windDirDeg: number,
  windKmh: number,
): RunwayWind | null {
  if (!runways || runways.length === 0) return null;
  const windKt = windKmh / 1.852;

  let best: RunwayWind | null = null;

  for (const rwy of runways) {
    for (const { designator, headingDeg } of [
      { designator: rwy.lowDesignator,  headingDeg: rwy.headingDeg },
      { designator: rwy.highDesignator, headingDeg: (rwy.headingDeg + 180) % 360 },
    ]) {
      const angleDeg = windDirDeg - headingDeg;
      const rad      = (angleDeg * Math.PI) / 180;
      const hw       = windKt * Math.cos(rad);
      const xw       = Math.abs(windKt * Math.sin(rad));
      if (!best || hw > best.headwindKt) {
        best = { designator, headwindKt: Math.round(hw), crosswindKt: Math.round(xw) };
      }
    }
  }
  return best;
}

// ── Wind arrow ─────────────────────────────────────────────────────────────────
function WindArrow({ deg, size = 10 }: { deg: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10"
         style={{ transform: `rotate(${deg}deg)`, display: 'inline-block' }}>
      <line x1="5" y1="8" x2="5" y2="2" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
      <polyline points="3,4 5,2 7,4" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Hourly card ────────────────────────────────────────────────────────────────
function HourCard({ h }: { h: HourlySlice }) {
  const { icon } = wmo(h.weather_code);
  const localHour = new Date(h.time + ':00').getHours();
  return (
    <div className="flex flex-col items-center gap-[2px] min-w-[36px] px-1 py-1.5">
      <span className="font-mono text-[8px] text-slate-600">
        {String(localHour).padStart(2, '0')}h
      </span>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span className="font-mono text-[8px] text-slate-300">
        {Math.round(h.temperature_2m)}°
      </span>
      {h.precipitation_probability > 20 && (
        <span className="font-mono text-[7px] text-sky-600">
          {h.precipitation_probability}%
        </span>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function WeatherWidget({ profile }: { profile: AirportProfile }) {
  const [wx,    setWx]    = useState<WeatherState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = makeWeatherUrl(profile.origin.lat, profile.origin.lon, profile.timezone);
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchWeather(url);
        if (!cancelled) { setWx(data); setError(null); }
      } catch {
        if (!cancelled) setError('Weather unavailable');
      }
    };

    setWx(null);
    setError(null);
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [profile.icao, profile.origin.lat, profile.origin.lon, profile.timezone]);

  const info      = wx ? wmo(wx.current.weather_code) : null;
  const metar     = wx ? buildMetar(profile.icao, wx.current) : null;
  const rwyWind   = wx
    ? activeRunwayWind(profile.runways, wx.current.wind_direction_10m, wx.current.wind_speed_10m)
    : null;
  const dewpSpread = wx && wx.current.dew_point_2m != null
    ? Math.round(wx.current.temperature_2m - wx.current.dew_point_2m)
    : null;

  return (
    <div
      className="absolute bottom-4 left-4 z-40 pointer-events-none select-none"
      style={{ maxWidth: 480 }}
    >
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid rgba(100,116,139,0.20)' }}
      >

        {/* ══ AUTO METAR strip ══════════════════════════════════════════════ */}
        {metar && (
          <div
            className="px-3 pt-2.5 pb-2"
            style={{ borderBottom: '1px solid rgba(217,119,6,0.18)', background: 'rgba(120,53,15,0.10)' }}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className="font-mono text-[7px] tracking-[0.25em] uppercase px-1.5 py-0.5 rounded"
                style={{ color: '#d97706', border: '1px solid rgba(217,119,6,0.35)', letterSpacing: '0.2em' }}
              >
                AUTO METAR
              </span>
              <span className="font-mono text-[7px] text-amber-900/60 tracking-wider">
                {profile.icao} · {new Date(wx!.fetchedAt).toLocaleTimeString('en-AU', {
                  hour: '2-digit', minute: '2-digit', timeZone: profile.timezone,
                })} LT
              </span>
            </div>

            {/* METAR string — wraps gracefully on smaller viewports */}
            <p
              className="font-mono leading-snug break-all"
              style={{ fontSize: '10px', color: '#fbbf24', wordBreak: 'break-word' }}
            >
              {metar}
            </p>

            {/* Quick-read derived row: active runway wind · QNH · T/D spread */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
              {rwyWind && (
                <span className="font-mono text-[8px]" style={{ color: '#f59e0b' }}>
                  RWY&nbsp;{rwyWind.designator}
                  &nbsp;
                  <span className="text-amber-200/80">
                    {rwyWind.headwindKt >= 0
                      ? `▲ ${rwyWind.headwindKt}kt HW`
                      : `▼ ${Math.abs(rwyWind.headwindKt)}kt TW`}
                  </span>
                  &nbsp;·&nbsp;
                  <span className="text-amber-200/80">
                    XW&nbsp;{rwyWind.crosswindKt}kt
                  </span>
                </span>
              )}
              {wx?.current.surface_pressure != null && (
                <span className="font-mono text-[8px]" style={{ color: '#f59e0b' }}>
                  QNH&nbsp;{Math.round(wx.current.surface_pressure)}&nbsp;hPa
                </span>
              )}
              {dewpSpread != null && (
                <span
                  className="font-mono text-[8px]"
                  style={{ color: dewpSpread <= 3 ? '#ef4444' : dewpSpread <= 6 ? '#f97316' : '#f59e0b' }}
                  title="Temp/dewpoint spread — narrow spread indicates fog risk"
                >
                  T/D&nbsp;{dewpSpread}°{dewpSpread <= 3 ? ' ⚠ FOG RISK' : ''}
                </span>
              )}
              {wx?.current.visibility != null && wx.current.visibility < 10000 && (
                <span className="font-mono text-[8px]" style={{ color: '#f97316' }}>
                  VIS&nbsp;{(wx.current.visibility / 1000).toFixed(1)}&nbsp;km
                </span>
              )}
            </div>
          </div>
        )}

        {/* Loading / error state for METAR strip */}
        {!wx && !error && (
          <div
            className="px-3 py-2"
            style={{ borderBottom: '1px solid rgba(217,119,6,0.18)', background: 'rgba(120,53,15,0.10)' }}
          >
            <span className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color: '#92400e' }}>
              AUTO METAR
            </span>
            <p className="font-mono text-[9px] mt-0.5" style={{ color: '#92400e' }}>
              {error ?? 'Fetching observation…'}
            </p>
          </div>
        )}

        {/* ── Location label ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
          <span className="font-mono text-[8px] text-slate-600 tracking-[0.2em] uppercase">{profile.icao}</span>
          <span className="text-slate-700 text-[8px]">·</span>
          <span className="font-mono text-[8px] text-slate-600 tracking-wider">{profile.nameShort}</span>
        </div>

        {/* ── Current conditions ──────────────────────────────────────────── */}
        {wx ? (
          <div className="flex items-center gap-3 px-3 pb-2 pt-1">
            <span style={{ fontSize: 20, lineHeight: 1 }}>{info?.icon}</span>
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-base font-bold text-slate-100 leading-none">
                  {Math.round(wx.current.temperature_2m)}°C
                </span>
                <span className="font-mono text-[9px] text-slate-500">
                  feels {Math.round(wx.current.apparent_temperature)}°
                </span>
              </div>
              <span className="font-mono text-[9px] text-slate-400 mt-0.5">{info?.label}</span>
            </div>
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <WindArrow deg={wx.current.wind_direction_10m} size={10} />
                <span className="font-mono text-[9px] text-slate-300">
                  {bearing(wx.current.wind_direction_10m)}&nbsp;{Math.round(wx.current.wind_speed_10m)}&nbsp;km/h
                  {wx.current.wind_gusts_10m != null && wx.current.wind_gusts_10m > wx.current.wind_speed_10m + 10
                    ? ` G${Math.round(wx.current.wind_gusts_10m)}`
                    : ''}
                </span>
              </div>
              <span className="font-mono text-[8px] text-slate-600">
                RH&nbsp;{wx.current.relative_humidity_2m}%
                {wx.current.dew_point_2m != null
                  ? `  ·  DP ${Math.round(wx.current.dew_point_2m)}°`
                  : ''}
                {wx.current.precipitation > 0
                  ? `  ·  ${wx.current.precipitation.toFixed(1)} mm`
                  : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="px-3 pb-2 pt-1 font-mono text-[9px] text-slate-600">
            {error ?? 'Loading…'}
          </div>
        )}

        {/* ── 12-hour forecast strip ──────────────────────────────────────── */}
        {wx && wx.hourly.length > 0 && (
          <>
            <div className="px-3 pt-1 pb-0.5 font-mono text-[8px] text-slate-700 tracking-[0.2em] uppercase"
                 style={{ borderTop: '1px solid rgba(100,116,139,0.12)' }}>
              12-Hour Outlook
            </div>
            <div className="flex overflow-x-auto pb-2 px-2 gap-0"
                 style={{ scrollbarWidth: 'none' }}>
              {wx.hourly.map((h, i) => <HourCard key={i} h={h} />)}
            </div>
            <div className="px-3 pb-1.5 font-mono text-[7px] text-slate-700 tracking-wide">
              Open-Meteo · {new Date(wx.fetchedAt).toLocaleTimeString('en-AU', {
                hour: '2-digit', minute: '2-digit', timeZone: profile.timezone,
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
