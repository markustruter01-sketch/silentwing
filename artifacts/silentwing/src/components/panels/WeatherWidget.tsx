// ─── WeatherWidget ─────────────────────────────────────────────────────────────
//
// Always-visible bottom-left overlay showing live YBBN weather from Open-Meteo
// (free, no API key) plus a 12-hour forward-look strip.
// Always expanded. Transparent background — only text, icons and a subtle border.
// Refreshes every 15 minutes.

import { useEffect, useState } from 'react';

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

  const times: string[] = json.hourly.time;
  const nowIso = new Date().toISOString().slice(0, 13);
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

// ── Hour card ──────────────────────────────────────────────────────────────────
function HourCard({ h }: { h: HourlySlice }) {
  const info = wmo(h.weather_code);
  const hr   = new Date(h.time).getHours().toString().padStart(2, '0');
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[40px] px-1">
      <span className="font-mono text-[8px] text-slate-500">{hr}:00</span>
      <span style={{ fontSize: 14, lineHeight: 1 }}>{info.icon}</span>
      <span className="font-mono text-[9px] text-slate-200 font-semibold">
        {Math.round(h.temperature_2m)}°
      </span>
      {h.precipitation_probability > 20 && (
        <span className="font-mono text-[7px] text-sky-400">{h.precipitation_probability}%</span>
      )}
      <div className="flex items-center gap-0.5">
        <WindArrow deg={h.wind_direction_10m} size={7} />
        <span className="font-mono text-[7px] text-slate-500">{Math.round(h.wind_speed_10m)}</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const REFRESH_MS = 15 * 60 * 1000;

export default function WeatherWidget() {
  const [wx,    setWx]    = useState<WeatherState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setWx(await fetchWeather());
      setError(null);
    } catch {
      setError('Weather unavailable');
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const info = wx ? wmo(wx.current.weather_code) : null;

  return (
    <div
      className="absolute bottom-4 left-4 z-40 pointer-events-none select-none"
      style={{ maxWidth: 420 }}
    >
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid rgba(100,116,139,0.20)' }}
      >
        {/* ── Location label ── */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
          <span className="font-mono text-[8px] text-slate-600 tracking-[0.2em] uppercase">YBBN</span>
          <span className="text-slate-700 text-[8px]">·</span>
          <span className="font-mono text-[8px] text-slate-600 tracking-wider">BRISBANE</span>
        </div>

        {/* ── Current conditions ── */}
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
                  {bearing(wx.current.wind_direction_10m)} {Math.round(wx.current.wind_speed_10m)} km/h
                </span>
              </div>
              <span className="font-mono text-[8px] text-slate-600">
                RH {wx.current.relative_humidity_2m}%
                {wx.current.precipitation > 0 ? `  · ${wx.current.precipitation.toFixed(1)} mm` : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="px-3 pb-2 pt-1 font-mono text-[9px] text-slate-600">
            {error ?? 'Loading…'}
          </div>
        )}

        {/* ── 12-hour forecast strip ── */}
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
              Open-Meteo · {new Date(wx.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
