// ─── WeatherWidget ─────────────────────────────────────────────────────────────
//
// Always-visible bottom-left overlay showing live YBBN weather from Open-Meteo
// (free, no API key) plus a 12-hour forward-look strip.
//
// Data refreshes every 15 minutes — weather doesn't change faster than that and
// we don't want to hammer the upstream.

import { useEffect, useRef, useState } from 'react';

// ── WMO weather-code → display ─────────────────────────────────────────────────
const WMO: Record<number, { label: string; icon: string; color: string }> = {
  0:  { label: 'Clear',          icon: '☀️',  color: '#FCD34D' },
  1:  { label: 'Mostly clear',   icon: '🌤️',  color: '#FCD34D' },
  2:  { label: 'Partly cloudy',  icon: '⛅',  color: '#94A3B8' },
  3:  { label: 'Overcast',       icon: '☁️',  color: '#64748B' },
  45: { label: 'Fog',            icon: '🌫️',  color: '#64748B' },
  48: { label: 'Icy fog',        icon: '🌫️',  color: '#64748B' },
  51: { label: 'Light drizzle',  icon: '🌦️',  color: '#38BDF8' },
  53: { label: 'Drizzle',        icon: '🌦️',  color: '#38BDF8' },
  55: { label: 'Heavy drizzle',  icon: '🌧️',  color: '#0EA5E9' },
  61: { label: 'Light rain',     icon: '🌧️',  color: '#38BDF8' },
  63: { label: 'Rain',           icon: '🌧️',  color: '#0EA5E9' },
  65: { label: 'Heavy rain',     icon: '🌧️',  color: '#0284C7' },
  71: { label: 'Light snow',     icon: '🌨️',  color: '#BAE6FD' },
  73: { label: 'Snow',           icon: '❄️',  color: '#BAE6FD' },
  75: { label: 'Heavy snow',     icon: '❄️',  color: '#BAE6FD' },
  80: { label: 'Showers',        icon: '🌦️',  color: '#38BDF8' },
  81: { label: 'Rain showers',   icon: '🌧️',  color: '#0EA5E9' },
  82: { label: 'Heavy showers',  icon: '⛈️',  color: '#0284C7' },
  95: { label: 'Thunderstorm',   icon: '⛈️',  color: '#F59E0B' },
  96: { label: 'Hail storm',     icon: '⛈️',  color: '#F59E0B' },
  99: { label: 'Hail storm',     icon: '⛈️',  color: '#F59E0B' },
};

function wmo(code: number) {
  return WMO[code] ?? { label: `WX${code}`, icon: '🌡️', color: '#94A3B8' };
}

// ── Wind direction ─────────────────────────────────────────────────────────────
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function bearing(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

// ── Open-Meteo response shapes ─────────────────────────────────────────────────
interface CurrentWeather {
  temperature_2m:     number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m:     number;
  wind_direction_10m: number;
  weather_code:       number;
  precipitation:      number;
}

interface HourlySlice {
  time:                   string;   // ISO-8601
  temperature_2m:         number;
  weather_code:           number;
  precipitation_probability: number;
  wind_speed_10m:         number;
  wind_direction_10m:     number;
}

interface WeatherState {
  fetchedAt: number;   // ms timestamp
  current:   CurrentWeather;
  hourly:    HourlySlice[];  // next 12 hours starting from now
}

// ── Fetch ──────────────────────────────────────────────────────────────────────
const BASE =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=-27.384&longitude=153.117' +
  '&timezone=Australia%2FBrisbane' +
  '&current=temperature_2m,apparent_temperature,relative_humidity_2m,' +
  'weather_code,wind_speed_10m,wind_direction_10m,precipitation' +
  '&hourly=temperature_2m,weather_code,precipitation_probability,' +
  'wind_speed_10m,wind_direction_10m' +
  '&forecast_days=2';

async function fetchWeather(): Promise<WeatherState> {
  const res  = await fetch(BASE);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();

  const current: CurrentWeather = {
    temperature_2m:       json.current.temperature_2m,
    apparent_temperature: json.current.apparent_temperature,
    relative_humidity_2m: json.current.relative_humidity_2m,
    wind_speed_10m:       json.current.wind_speed_10m,
    wind_direction_10m:   json.current.wind_direction_10m,
    weather_code:         json.current.weather_code,
    precipitation:        json.current.precipitation,
  };

  // Build per-hour index for the hourly array
  const times: string[]  = json.hourly.time;
  const nowIso = new Date().toISOString().slice(0, 13); // "2026-07-22T07"

  // Find the index of the current hour and take next 12
  const startIdx = times.findIndex((t: string) => t.startsWith(nowIso));
  const s = startIdx >= 0 ? startIdx : 0;

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

// ── Small wind arrow ───────────────────────────────────────────────────────────
function WindArrow({ deg, size = 10 }: { deg: number; size?: number }) {
  // Arrow points in the downwind (TO) direction
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ transform: `rotate(${deg}deg)`, display: 'inline-block' }}>
      <line x1="5" y1="8" x2="5" y2="2" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round"/>
      <polyline points="3,4 5,2 7,4" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Collapsed pill ─────────────────────────────────────────────────────────────
function WeatherPill({ wx }: { wx: WeatherState; onClick: () => void }) {
  const { current } = wx;
  const info = wmo(current.weather_code);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs tracking-wide">
      <span>{info.icon}</span>
      <span className="text-slate-200 font-semibold">{Math.round(current.temperature_2m)}°C</span>
      <span className="text-slate-500 text-[10px]">{info.label}</span>
      <span className="text-slate-600 text-[10px]">·</span>
      <WindArrow deg={current.wind_direction_10m} size={10} />
      <span className="text-slate-400 text-[10px]">{Math.round(current.wind_speed_10m)} km/h</span>
    </div>
  );
}

// ── Hour card ──────────────────────────────────────────────────────────────────
function HourCard({ h }: { h: HourlySlice }) {
  const info = wmo(h.weather_code);
  const local = new Date(h.time);
  const hr    = local.getHours().toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center gap-1 min-w-[44px] px-1.5">
      <span className="font-mono text-[9px] text-slate-500 tracking-wide">{hr}:00</span>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{info.icon}</span>
      <span className="font-mono text-[10px] text-slate-200 font-semibold">
        {Math.round(h.temperature_2m)}°
      </span>
      {h.precipitation_probability > 20 && (
        <span className="font-mono text-[8px] text-sky-400">{h.precipitation_probability}%</span>
      )}
      <div className="flex items-center gap-0.5">
        <WindArrow deg={h.wind_direction_10m} size={8} />
        <span className="font-mono text-[8px] text-slate-500">{Math.round(h.wind_speed_10m)}</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

export default function WeatherWidget() {
  const [wx,       setWx]       = useState<WeatherState | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    try {
      const data = await fetchWeather();
      setWx(data);
      setError(null);
    } catch (e) {
      setError('Weather unavailable');
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Auto-collapse after 20 s of inactivity
  useEffect(() => {
    if (!expanded) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setExpanded(false), 20_000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [expanded]);

  const info = wx ? wmo(wx.current.weather_code) : null;

  return (
    <div
      className="absolute bottom-14 left-3 z-40 pointer-events-auto select-none"
      style={{ maxWidth: expanded ? 480 : 280 }}
    >
      <div
        className="rounded-lg overflow-hidden shadow-xl shadow-black/60 transition-all duration-300"
        style={{
          background:     'rgba(7,10,22,0.90)',
          border:         '1px solid rgba(100,116,139,0.25)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* ── Header / pill — always visible ── */}
        <button
          className="w-full text-left"
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse weather' : 'Expand weather'}
        >
          <div className="flex items-center justify-between px-3 pt-2 pb-1"
               style={{ borderBottom: expanded ? '1px solid rgba(100,116,139,0.15)' : 'none' }}>
            {/* Left: location label */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-slate-600 tracking-[0.2em] uppercase">YBBN</span>
              <span className="text-slate-700 text-[9px]">·</span>
              <span className="font-mono text-[9px] text-slate-600 tracking-wider">BRISBANE</span>
            </div>
            {/* Right: expand chevron */}
            <span className="text-slate-600 text-[10px] leading-none ml-4">
              {expanded ? '▲' : '▼'}
            </span>
          </div>

          {/* Current conditions row */}
          {wx ? (
            <div className="flex items-center gap-3 px-3 pb-2 pt-1">
              <span style={{ fontSize: 22, lineHeight: 1 }}>{info?.icon}</span>
              <div className="flex flex-col">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-lg font-bold text-slate-100 leading-none">
                    {Math.round(wx.current.temperature_2m)}°C
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    Feels {Math.round(wx.current.apparent_temperature)}°
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-400 mt-0.5">{info?.label}</span>
              </div>
              <div className="ml-auto flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1">
                  <WindArrow deg={wx.current.wind_direction_10m} size={11} />
                  <span className="font-mono text-[10px] text-slate-300">
                    {bearing(wx.current.wind_direction_10m)} {Math.round(wx.current.wind_speed_10m)} km/h
                  </span>
                </div>
                <span className="font-mono text-[9px] text-slate-600">
                  RH {wx.current.relative_humidity_2m}%
                  {wx.current.precipitation > 0 ? `  · ${wx.current.precipitation.toFixed(1)} mm` : ''}
                </span>
              </div>
            </div>
          ) : (
            <div className="px-3 pb-2 pt-1 font-mono text-[10px] text-slate-600">
              {error ?? 'Loading…'}
            </div>
          )}
        </button>

        {/* ── Expanded: 12-hour forecast strip ── */}
        {expanded && wx && wx.hourly.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(100,116,139,0.12)' }}>
            <div className="px-3 pt-2 pb-1 font-mono text-[9px] text-slate-600 tracking-[0.2em] uppercase">
              12-Hour Outlook
            </div>
            <div className="flex overflow-x-auto pb-2 px-2 gap-0 scrollbar-none"
                 style={{ scrollbarWidth: 'none' }}>
              {wx.hourly.map((h, i) => (
                <HourCard key={i} h={h} />
              ))}
            </div>
            <div className="px-3 pb-2 font-mono text-[8px] text-slate-700 tracking-wide">
              Source: Open-Meteo · Updated {new Date(wx.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
