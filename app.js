"use strict";
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("isobar." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("isobar." + k, JSON.stringify(v)); } catch (e) {} }
};
const DEFAULT_LOC = { name: "Santa Barbara, CA", lat: 34.4208, lon: -119.6982, named: true };
const S = { loc: store.get("loc", DEFAULT_LOC), units: store.get("units", "us"), tz: undefined, d: {}, saved: store.get("saved", [DEFAULT_LOC]) };

/* ---------- fetch helpers ---------- */
async function getJSON(url, opts = {}, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: c.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function nws(path, retry = 1) {
  const url = path.startsWith("http") ? path : "https://api.weather.gov" + path;
  try { return await getJSON(url, { headers: { Accept: "application/geo+json" } }); }
  catch (e) { if (retry > 0) { await new Promise(r => setTimeout(r, 700)); return nws(path, retry - 1); } throw e; }
}
const OM = "https://api.open-meteo.com/v1/forecast";
function omUrl(la, lo) {
  return `${OM}?latitude=${la}&longitude=${lo}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,dew_point_2m,uv_index" +
    "&minutely_15=precipitation&forecast_minutely_15=24" +
    "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,relative_humidity_2m,dew_point_2m,is_day,cloud_cover,cloud_cover_low,visibility,pressure_msl" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max" +
    "&timezone=auto&forecast_days=11&forecast_hours=96&past_hours=4&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime";
}
function aqUrl(la, lo) {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la}&longitude=${lo}` +
    "&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen" +
    "&hourly=us_aqi&forecast_days=3&timezone=auto&timeformat=unixtime";
}
async function getObs(stationsUrl) {
  // check the nearest few stations at once and use the closest one that reported within the last 75 minutes
  const st = await nws(stationsUrl);
  const list = (st.features || []).slice(0, 5);
  const res = await Promise.all(list.map(async f => {
    try {
      const id = f.properties.stationIdentifier;
      const o = await nws(`/stations/${id}/observations/latest?require_qc=false`, 0);
      const p = o.properties;
      if (!p.temperature || p.temperature.value == null) return null;
      return { ...o, station: { id, name: f.properties.name }, age: Date.now() - new Date(p.timestamp).getTime() };
    } catch (e) { return null; }
  }));
  const ok = res.filter(Boolean);
  return ok.find(o => o.age < 75 * 60e3) || ok.filter(o => o.age < 3 * 3600e3).sort((x, y) => x.age - y.age)[0] || null;
}
async function getAFD(cwa) {
  const list = await nws(`/products/types/AFD/locations/${cwa}`);
  const first = (list["@graph"] || [])[0]; if (!first) return null;
  const prod = await nws(first["@id"]);
  return { text: prod.productText, issued: prod.issuanceTime, office: cwa };
}

/* ---------- units ---------- */
const cToF = c => c == null ? null : c * 9 / 5 + 32;
const US = () => S.units === "us";
const T = f => f == null || isNaN(f) ? "--" : Math.round(US() ? f : (f - 32) * 5 / 9);
const Td = f => T(f) + "°";
const W = mph => mph == null ? "--" : US() ? `${Math.round(mph)} mph` : `${Math.round(mph * 1.609)} km/h`;
const Wn = mph => mph == null ? "--" : Math.round(US() ? mph : mph * 1.609);
const Wu = () => US() ? "mph" : "km/h";
const P = inch => inch == null ? "--" : US() ? `${inch < 0.1 && inch > 0 ? inch.toFixed(2) : inch.toFixed(2)} in` : `${(inch * 25.4).toFixed(1)} mm`;
const Pr = inHg => inHg == null ? "--" : US() ? inHg.toFixed(2) : Math.round(inHg * 33.8639);
const Pru = () => US() ? "inHg" : "hPa";
const V = mi => mi == null ? "--" : US() ? (mi >= 10 ? "10+" : mi.toFixed(mi < 3 ? 1 : 0)) : (mi * 1.609 >= 16 ? "16+" : (mi * 1.609).toFixed(mi < 3 ? 1 : 0));
const Vu = () => US() ? "mi" : "km";
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const dirName = d => d == null ? "" : DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const DIRDEG = Object.fromEntries(DIRS.map((d, i) => [d, i * 22.5]));

/* ---------- time ---------- */
const fmt = (d, o) => new Intl.DateTimeFormat("en-US", { timeZone: S.tz, ...o }).format(d);
const clock = d => fmt(d, { hour: "numeric", minute: "2-digit" });
const hourLbl = d => fmt(d, { hour: "numeric" }).replace(/\s/g, "").toLowerCase();
const dateKey = d => new Intl.DateTimeFormat("en-CA", { timeZone: S.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const localHour = d => +new Intl.DateTimeFormat("en-US", { timeZone: S.tz, hour: "numeric", hourCycle: "h23" }).format(d);
const ago = d => { const m = Math.round((Date.now() - d) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`; };

/* ---------- conditions and icons ---------- */
function textType(s) {
  if (!s) return null; s = s.toLowerCase();
  if (/thunder|t-storm|tstorm/.test(s)) return "storm";
  if (/snow|flurr|sleet|ice|wintry|blizzard/.test(s)) return "snow";
  if (/rain|shower|drizzle/.test(s)) return "rain";
  if (/fog|haze|smoke|mist|dust/.test(s)) return "fog";
  if (/partly|mostly sunny|mostly clear|few clouds|scattered clouds|partly sunny/.test(s)) return "partly";
  if (/cloud|overcast/.test(s)) return "cloud";
  if (/wind|breez|blustery/.test(s)) return "wind";
  if (/sunny|clear|fair/.test(s)) return "clear";
  return null;
}
function wmoType(c) {
  if (c == null) return "cloud";
  if (c === 0) return "clear"; if (c <= 2) return "partly"; if (c === 3) return "cloud";
  if (c === 45 || c === 48) return "fog"; if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95) return "storm"; if (c >= 51) return "rain"; return "cloud";
}
const WMO_TEXT = {0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Freezing fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",56:"Freezing drizzle",57:"Freezing drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",66:"Freezing rain",67:"Freezing rain",71:"Light snow",73:"Snow",75:"Heavy snow",77:"Snow grains",80:"Rain showers",81:"Rain showers",82:"Heavy showers",85:"Snow showers",86:"Heavy snow showers",95:"Thunderstorms",96:"Thunderstorms with hail",99:"Thunderstorms with hail"};
const wmoText = c => WMO_TEXT[c] || "";
const SUNP = '<circle cx="16" cy="16" r="6.5" fill="#FFD36B"/><g stroke="#FFD36B" stroke-width="2" stroke-linecap="round"><path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1"/></g>';
const MOONP = '<path d="M20.5 5.5a10.5 10.5 0 1 0 6 18.4A9 9 0 0 1 20.5 5.5z" fill="#E7E8FF"/>';
const CLOUDP = (y = 0, op = 1, fill = "#F3F6FA") => `<path transform="translate(0 ${y})" d="M9.5 25.5h14.2a5.3 5.3 0 0 0 .6-10.6 7.4 7.4 0 0 0-14.1 1.8 4.4 4.4 0 0 0-.7 8.8z" fill="${fill}" opacity="${op}"/>`;
function iconInner(type, day = true) {
  switch (type) {
    case "clear": return day ? SUNP : MOONP;
    case "partly": return `<g transform="translate(-5 -5) scale(.8)">${day ? SUNP : MOONP}</g>${CLOUDP(2)}`;
    case "cloud": return `${CLOUDP(-4, .55, "#C9D2DD")}${CLOUDP(1)}`;
    case "rain": return `${CLOUDP(-4)}<g stroke="#7CC4FF" stroke-width="2" stroke-linecap="round"><path d="M12 25l-1.5 4M17 25l-1.5 4M22 25l-1.5 4"/></g>`;
    case "snow": return `${CLOUDP(-4)}<g fill="#fff"><circle cx="11" cy="26.5" r="1.4"/><circle cx="16.5" cy="28.5" r="1.4"/><circle cx="22" cy="26.5" r="1.4"/></g>`;
    case "storm": return `${CLOUDP(-4, 1, "#C9D2DD")}<path d="M17.5 21.5l-4 6h3.2l-1.7 4.5 5.2-6.5h-3.3l1.6-4z" fill="#FFD36B"/>`;
    case "fog": return `${CLOUDP(-5, .8)}<g stroke="#E6EBF0" stroke-width="2" stroke-linecap="round" opacity=".9"><path d="M6 24h20M9 28h15"/></g>`;
    case "wind": return `<g stroke="#F3F6FA" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M4 12h15a3.5 3.5 0 1 0-3.5-3.5"/><path d="M4 18h21a3.5 3.5 0 1 1-3.5 3.5"/><path d="M4 24h11"/></g>`;
  }
  return CLOUDP(0);
}
const icon = (type, day, cls = "ic") => `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">${iconInner(type, day)}</svg>`;

/* ---------- live sky ---------- */
const Sky = (() => {
  const cv = $("#sky"), cx = cv.getContext("2d");
  let Wd, Ht, type = "clear", tod = "day", parts = [], clouds = [], stars = [], raf = 0, flash = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CLEAR = { day: ["#1A5DC0", "#4A8FDB", "#97C6EE"], dawn: ["#283877", "#8C72AE", "#F1A57E"], dusk: ["#22205A", "#7E4A83", "#E77B5C"], night: ["#050A1C", "#0E1A3B", "#20325C"] };
  const GREY = { day: ["#46576A", "#66788B", "#9AA9B7"], dawn: ["#3B4054", "#716C80", "#AF958E"], dusk: ["#312E44", "#655263", "#A07672"], night: ["#0A0E17", "#141B27", "#283141"] };
  const AMT = { clear: 0, partly: .3, wind: .2, cloud: .82, fog: .9, rain: .92, storm: 1, snow: .85 };
  const SHADE = { rain: -.15, storm: -.38, snow: .12, fog: .1 };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  function palette() {
    const a = AMT[type] ?? .5, s = SHADE[type] || 0;
    return CLEAR[tod].map((c, i) => { let m = mix(c, GREY[tod][i], a); if (s) m = mix(m, s > 0 ? "#ffffff" : "#000000", Math.abs(s)); return m; });
  }
  function seed() {
    stars = Array.from({ length: 140 }, () => ({ x: Math.random() * Wd, y: Math.random() * Ht * .7, r: Math.random() * 1.1 + .3, p: Math.random() * 6 }));
    const nC = { clear: 1, partly: 5, wind: 4, cloud: 10, rain: 10, storm: 11, snow: 9, fog: 7 }[type] ?? 4;
    clouds = Array.from({ length: nC }, () => ({ x: Math.random() * Wd * 1.4 - Wd * .2, y: Math.random() * Ht * .55, s: 140 + Math.random() * 240, v: .04 + Math.random() * .14 }));
    const nP = type === "rain" ? 240 : type === "storm" ? 320 : type === "snow" ? 150 : 0;
    parts = Array.from({ length: nP }, () => newP(true));
  }
  function newP(init) { return { x: Math.random() * Wd * 1.2 - Wd * .1, y: init ? Math.random() * Ht : -20, v: type === "snow" ? .5 + Math.random() * 1.1 : 10 + Math.random() * 7, l: 10 + Math.random() * 16, d: Math.random() * 6.28 }; }
  function resize() { Wd = cv.width = innerWidth; Ht = cv.height = innerHeight; seed(); }
  function frame(t) {
    const [a, b, c] = palette();
    const g = cx.createLinearGradient(0, 0, 0, Ht); g.addColorStop(0, a); g.addColorStop(.55, b); g.addColorStop(1, c);
    cx.fillStyle = g; cx.fillRect(0, 0, Wd, Ht);
    const night = tod === "night";
    if (night && (type === "clear" || type === "partly" || type === "wind")) {
      for (const s of stars) { cx.globalAlpha = .45 + .45 * Math.sin(t / 900 + s.p); cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, 6.28); cx.fill(); }
      cx.globalAlpha = 1;
    }
    if (type === "clear" || type === "partly" || type === "wind") {
      const x = Wd * .82, y = Ht * .13, R = night ? 160 : 320;
      const rg = cx.createRadialGradient(x, y, 0, x, y, R);
      rg.addColorStop(0, night ? "rgba(220,225,255,.30)" : tod === "day" ? "rgba(255,240,200,.55)" : "rgba(255,190,140,.5)");
      rg.addColorStop(1, "rgba(255,255,255,0)"); cx.fillStyle = rg; cx.fillRect(0, 0, Wd, Ht);
    }
    const cAlpha = (night ? .10 : .22) * (type === "storm" ? .7 : 1);
    for (const k of clouds) {
      if (!reduce) { k.x += k.v; if (k.x - k.s > Wd) k.x = -k.s * 1.5; }
      for (let i = 0; i < 4; i++) {
        const bx = k.x + i * k.s * .38, by = k.y + Math.sin(i * 1.7) * k.s * .12, br = k.s * (.42 + .1 * Math.cos(i));
        const rg = cx.createRadialGradient(bx, by, 0, bx, by, br);
        rg.addColorStop(0, `rgba(255,255,255,${cAlpha})`); rg.addColorStop(1, "rgba(255,255,255,0)");
        cx.fillStyle = rg; cx.beginPath(); cx.arc(bx, by, br, 0, 6.28); cx.fill();
      }
    }
    if (type === "rain" || type === "storm") {
      cx.strokeStyle = "rgba(200,225,255,.38)"; cx.lineWidth = 1.1; cx.beginPath();
      for (const p of parts) { cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.l * .22, p.y + p.l); if (!reduce) { p.y += p.v; p.x -= p.v * .22; if (p.y > Ht) Object.assign(p, newP(false)); } }
      cx.stroke();
    }
    if (type === "snow") {
      cx.fillStyle = "rgba(255,255,255,.85)";
      for (const p of parts) { cx.beginPath(); cx.arc(p.x, p.y, 1.2 + p.l / 14, 0, 6.28); cx.fill(); if (!reduce) { p.y += p.v; p.x += Math.sin(t / 1200 + p.d) * .5; if (p.y > Ht) Object.assign(p, newP(false)); } }
    }
    if (type === "fog") {
      for (let i = 0; i < 5; i++) { const y = Ht * (.35 + i * .13) + Math.sin(t / 4000 + i) * 12; const lg = cx.createLinearGradient(0, y - 60, 0, y + 60); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(.5, "rgba(255,255,255,.10)"); lg.addColorStop(1, "rgba(255,255,255,0)"); cx.fillStyle = lg; cx.fillRect(0, y - 60, Wd, 120); }
    }
    if (type === "storm" && !reduce) {
      if (flash <= 0 && Math.random() < .004) flash = 1;
      if (flash > 0) { cx.fillStyle = `rgba(230,235,255,${flash * .35})`; cx.fillRect(0, 0, Wd, Ht); flash -= .06; }
    }
    // soft darkening at the bottom so cards stay legible
    const sh = cx.createLinearGradient(0, Ht * .45, 0, Ht); sh.addColorStop(0, "rgba(5,10,20,0)"); sh.addColorStop(1, "rgba(5,10,20,.35)");
    cx.fillStyle = sh; cx.fillRect(0, 0, Wd, Ht);
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  return {
    init() { addEventListener("resize", () => { resize(); if (reduce) frame(0); }); resize(); frame(0); },
    set(ty, td) { if (ty === type && td === tod) return; type = ty; tod = td; seed(); cancelAnimationFrame(raf); frame(performance.now()); document.querySelector('meta[name="theme-color"]').content = palette()[0]; }
  };
})();

/* ---------- derived data ---------- */
// NWS formulas: wind chill at or below 50°F with wind over 3 mph, heat index at or above 80°F, otherwise the air temperature
function feelsLike(t, mph, rh) {
  if (t == null) return null;
  if (t <= 50 && mph > 3) return 35.74 + 0.6215 * t - 35.75 * Math.pow(mph, .16) + 0.4275 * t * Math.pow(mph, .16);
  if (t >= 80 && rh != null) {
    const r = rh;
    return -42.379 + 2.04901523 * t + 10.14333127 * r - .22475541 * t * r - .00683783 * t * t - .05481717 * r * r + .00122874 * t * t * r + .00085282 * t * r * r - .00000199 * t * t * r * r;
  }
  return t;
}
function omIndexNow(times) { const now = Date.now() / 1000; let i = 0; while (i < times.length - 1 && times[i + 1] <= now) i++; return i; }
function current() {
  const o = S.d.obs, om = S.d.om && S.d.om.current, c = {};
  if (o) {
    const p = o.properties;
    const spd = q => q && q.value != null ? (String(q.unitCode).includes("m_s-1") ? q.value * 2.237 : q.value * .6214) : null;
    c.src = "obs"; c.station = o.station; c.time = new Date(p.timestamp);
    c.t = cToF(p.temperature.value); c.dew = cToF(p.dewpoint && p.dewpoint.value);
    c.rh = p.relativeHumidity && p.relativeHumidity.value; c.wind = spd(p.windSpeed); c.gust = spd(p.windGust);
    c.dir = p.windDirection && p.windDirection.value;
    const pa = (p.barometricPressure && p.barometricPressure.value) ?? (p.seaLevelPressure && p.seaLevelPressure.value);
    c.pres = pa != null ? pa / 3386.39 : null;
    c.vis = p.visibility && p.visibility.value != null ? p.visibility.value / 1609.34 : null;
    c.text = p.textDescription || "";
    const fl = (p.heatIndex && p.heatIndex.value) ?? (p.windChill && p.windChill.value);
    c.feels = fl != null ? cToF(fl) : feelsLike(c.t, c.wind, c.rh);
  }
  if (om) {
    c.t ??= om.temperature_2m; c.dew ??= om.dew_point_2m; c.rh ??= om.relative_humidity_2m;
    c.wind ??= om.wind_speed_10m; if (c.src !== "obs") c.gust ??= om.wind_gusts_10m; c.dir ??= om.wind_direction_10m; // a station that reports no gust means no gusts
    c.pres ??= om.pressure_msl != null ? om.pressure_msl / 33.8639 : null;
    c.vis ??= om.visibility != null ? om.visibility / 1609.34 : null;
    c.feels ??= om.apparent_temperature; c.uv = om.uv_index; c.cloud = om.cloud_cover; c.isDay = om.is_day; c.code = om.weather_code;
    if (!c.text) c.text = wmoText(om.weather_code);
  }
  c.feels ??= c.t;
  if (c.isDay == null) { const h = localHour(new Date()); c.isDay = h >= 7 && h < 18 ? 1 : 0; }
  c.type = textType(c.text) || wmoType(c.code);
  if (!c.isDay && c.type === "clear") c.type = "clear";
  return c;
}
function timeOfDay() {
  const d = S.d.om && S.d.om.daily; const now = Date.now() / 1000;
  if (!d) return current().isDay ? "day" : "night";
  const sr = d.sunrise[0], ss = d.sunset[0], w = 45 * 60;
  if (Math.abs(now - sr) < w) return "dawn"; if (Math.abs(now - ss) < w) return "dusk";
  return now > sr && now < ss ? "day" : "night";
}
function hourly() {
  const om = S.d.om && S.d.om.hourly, out = [];
  const omMap = {};
  if (om) om.time.forEach((t, i) => omMap[t] = i);
  const hp = S.d.hr && S.d.hr.properties && S.d.hr.properties.periods;
  const nowH = Math.floor(Date.now() / 3600e3) * 3600;
  if (hp && hp.length) {
    for (const p of hp) {
      const t = new Date(p.startTime), u = t.getTime() / 1000;
      if (u + 3600 <= Date.now() / 1000) continue;
      const i = omMap[u];
      out.push({ t, temp: p.temperature, pop: p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value || 0 : 0,
        wind: parseInt(p.windSpeed) || 0, dir: DIRDEG[p.windDirection], text: p.shortForecast, isDay: p.isDaytime,
        type: textType(p.shortForecast) || "cloud", uv: i != null ? om.uv_index[i] : null, gust: i != null ? om.wind_gusts_10m[i] : null });
      if (out.length >= 48) break;
    }
  } else if (om) {
    for (let i = 0; i < om.time.length && out.length < 48; i++) {
      if (om.time[i] < nowH) continue;
      out.push({ t: new Date(om.time[i] * 1000), temp: om.temperature_2m[i], pop: om.precipitation_probability[i] || 0, wind: om.wind_speed_10m[i], dir: om.wind_direction_10m[i],
        text: wmoText(om.weather_code[i]), isDay: !!om.is_day[i], type: wmoType(om.weather_code[i]), uv: om.uv_index[i], gust: om.wind_gusts_10m[i] });
    }
  }
  // attach model is_day for icon accuracy when NWS present
  if (om) out.forEach(h => { const i = omMap[Math.floor(h.t.getTime() / 3600e3) * 3600]; if (i != null) h.omDay = !!om.is_day[i]; });
  return out;
}
function days() {
  const om = S.d.om && S.d.om.daily;
  const fc = (S.d.fc && S.d.fc.properties && S.d.fc.properties.periods) || [];
  const byKey = {};
  for (const p of fc) { const k = dateKey(new Date(p.startTime)); const e = byKey[k] || (byKey[k] = {}); if (p.isDaytime) e.day = p; else e.night = p; }
  const out = [];
  if (!om) {
    Object.keys(byKey).sort().forEach(k => { const e = byKey[k]; out.push(mkDay(k, e, null, -1)); });
    return out;
  }
  for (let i = 0; i < Math.min(10, om.time.length); i++) {
    const k = dateKey(new Date((om.time[i] + 12 * 3600) * 1000));
    out.push(mkDay(k, byKey[k] || {}, om, i));
  }
  return out;
}
function mkDay(k, e, om, i) {
  const pop = v => v && v.probabilityOfPrecipitation ? v.probabilityOfPrecipitation.value : null;
  const nwsPop = Math.max(pop(e.day) ?? -1, pop(e.night) ?? -1);
  const d = {
    key: k, date: new Date(k + "T12:00:00"),
    hi: e.day ? e.day.temperature : om ? om.temperature_2m_max[i] : null,
    lo: e.night ? e.night.temperature : om ? om.temperature_2m_min[i] : null,
    pop: nwsPop >= 0 ? nwsPop : om ? om.precipitation_probability_max[i] : null,
    type: textType((e.day || e.night || {}).shortForecast) || (om ? wmoType(om.weather_code[i]) : "cloud"),
    short: (e.day || e.night || {}).shortForecast || (om ? wmoText(om.weather_code[i]) : ""),
    day: e.day, night: e.night, src: e.day || e.night ? "NWS" : "Model",
    uv: om ? om.uv_index_max[i] : null, rain: om ? om.precipitation_sum[i] : null,
    wind: om ? om.wind_speed_10m_max[i] : null, gust: om ? om.wind_gusts_10m_max[i] : null,
    sunrise: om ? om.sunrise[i] : null, sunset: om ? om.sunset[i] : null
  };
  return d;
}

/* ---------- rendering ---------- */
function render() {
  const d = S.d, c = current();
  S.cur = c;
  $("#locName").textContent = S.loc.name;
  $("#hPlace").textContent = S.loc.name;
  document.title = `${Td(c.t)} ${S.loc.name} · Isobar`;
  $("#hTemp").innerHTML = c.t == null ? "--" : `${T(c.t)}<sup>°${US() ? "F" : "C"}</sup>`;
  $("#hCond").textContent = c.text || "";
  const dd = days(); S.days = dd; const today = dd[0];
  $("#hHL").innerHTML = today ? `H ${Td(today.hi)} &nbsp;L ${Td(today.lo)} &nbsp;·&nbsp; Feels like ${Td(c.feels)}` : `Feels like ${Td(c.feels)}`;
  $("#hObs").textContent = c.src === "obs" && c.station ? `${c.station.id} · ${ago(c.time)}` : "";
  $("#hSide").innerHTML = icon(c.type, !!c.isDay, "bigicon");
  Sky.set(c.type, timeOfDay());
  renderAlertsBanner(); renderMinutely(); renderHourly(); renderDays(); renderNow(); renderAir(); renderAlerts(); renderAFD();
  safe(() => Coast.render()); safe(() => Outlook.render()); safe(() => Ride.refresh()); safe(() => History.onData());
  if (S.offline) $("#hObs").innerHTML = `<span class="status"><i></i>Offline · from ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d.at)}</span>`;
  Radar.update();
  $("#updated").textContent = d.at ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d.at)}` + (d.pts ? ` · NWS ${d.pts.properties.gridId} grid ${d.pts.properties.gridX},${d.pts.properties.gridY}` : " · Outside NWS coverage, showing global model data") : "";
  if (!d.pts && !d.om) {
    $("#hTemp").innerHTML = `<span style="font-size:.45em;color:var(--ink-2)">No data</span>`;
    $("#hCond").textContent = "No connection yet. Pull down or tap refresh to try again.";
    $("#hHL").innerHTML = "&nbsp;";
  }
}
const SEV = { Extreme: "var(--bad)", Severe: "var(--bad)", Moderate: "var(--usg)", Minor: "var(--mod)" };
function alertsList() {
  const f = (S.d.alerts && S.d.alerts.features) || [];
  const rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
  return f.filter(a => a.properties.status === "Actual" || !a.properties.status).sort((a, b) => (rank[a.properties.severity] ?? 5) - (rank[b.properties.severity] ?? 5));
}
function renderAlertsBanner() {
  const al = alertsList(), el = $("#hAlert");
  if (!al.length) { el.hidden = true; el.innerHTML = ""; return; }
  const a = al[0].properties, more = al.length - 1;
  const until = a.ends || a.expires;
  el.hidden = false;
  el.innerHTML = `<button class="alertbanner" id="toAlerts"><span class="sev" style="background:${SEV[a.severity] || "var(--rain)"}"></span><span><b>${esc(a.event)}</b><small>${until ? "Until " + fmt(new Date(until), { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}${more > 0 ? ` · ${more} more alert${more > 1 ? "s" : ""}` : ""}</small></span></button>`;
  $("#toAlerts").onclick = () => $("#cAlerts").scrollIntoView({ behavior: "smooth", block: "start" });
}
function safe(fn) { try { fn(); } catch (e) { console.error(e); } }
const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function renderMinutely() {
  const m = S.d.om && S.d.om.minutely_15, el = $("#cMin");
  const label = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c3 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 3-6.5 6-11z"/></svg>Next 6 hours<span class="src">${S.d.pts ? "HRRR 15-min" : "Model 15-min"}</span></div>`;
  if (!m) { el.innerHTML = label + `<div class="err">Precipitation timing isn't available right now.</div>`; $("#hNow").innerHTML = ""; return; }
  const now = Date.now() / 1000; let s = 0; while (s < m.time.length - 1 && m.time[s + 1] <= now) s++;
  const pts = []; for (let i = s; i < Math.min(m.time.length, s + 24); i++) pts.push({ t: new Date(m.time[i] * 1000), r: (m.precipitation[i] || 0) * 4 });
  const wet = r => r >= 0.01;
  const snowy = (S.cur.t ?? 50) <= 33, kind = snowy ? "Snow" : "Rain";
  let sum;
  const firstWet = pts.findIndex(p => wet(p.r));
  if (firstWet === -1) sum = "No precipitation expected for the next 6 hours";
  else if (firstWet === 0) {
    const stop = pts.findIndex(p => !wet(p.r));
    const peak = Math.max(...pts.map(p => p.r));
    const inten = peak > .3 ? "Heavy " + kind.toLowerCase() : peak > .1 ? kind : "Light " + kind.toLowerCase();
    sum = stop === -1 ? `${inten} continuing for at least 6 hours` : `${inten} ending around ${clock(pts[stop].t)}`;
  } else {
    const peak = Math.max(...pts.slice(firstWet).map(p => p.r));
    sum = `${peak > .1 ? kind : "Light " + kind.toLowerCase()} starting around ${clock(pts[firstWet].t)}`;
  }
  const bars = pts.map(p => { const h = wet(p.r) ? Math.max(10, Math.min(100, Math.pow(p.r / .4, .55) * 100)) : 3; return `<i class="${wet(p.r) ? "" : "dry"}" style="height:${h}%" title="${clock(p.t)}: ${US() ? p.r.toFixed(2) + " in/hr" : (p.r * 25.4).toFixed(1) + " mm/hr"}"></i>`; }).join("");
  const ticks = [0, 4, 8, 12, 16, 20].map(i => pts[i] ? `<span>${i === 0 ? "Now" : hourLbl(pts[i].t)}</span>` : "").join("");
  el.innerHTML = label + `<div class="msum">${sum}</div><div class="mcast" role="img" aria-label="${sum}">${bars}</div><div class="mticks">${ticks}</div>`;
  $("#hNow").innerHTML = firstWet === -1 ? "" : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c3 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 3-6.5 6-11z"/></svg>${sum}`;
}

function smoothPath(pts) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function renderHourly() {
  const hs = hourly(), el = $("#cHour");
  if (hs.length && S.cur && S.cur.src === "obs" && S.cur.t != null) hs[0] = { ...hs[0], temp: S.cur.t };
  const src = S.d.hr ? "NWS" : "Model";
  const label = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Hourly<span class="src">${src} · 48 hr</span></div>`;
  if (!hs.length) { el.innerHTML = label + `<div class="err">Hourly forecast isn't available right now.</div>`; return; }
  const cw = 56, H = 178, n = hs.length, Wd = cw * n;
  const temps = hs.map(h => T(h.temp)), mn = Math.min(...temps), mx = Math.max(...temps), rg = Math.max(1, mx - mn);
  const y = t => 122 - (t - mn) / rg * 46;
  const pts = hs.map((h, i) => [i * cw + cw / 2, +y(T(h.temp)).toFixed(1)]);
  let s = `<svg width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Hourly temperature and precipitation chance"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD36B" stop-opacity=".35"/><stop offset="1" stop-color="#FFD36B" stop-opacity="0"/></linearGradient></defs>`;
  hs.forEach((h, i) => {
    const x = i * cw; const lh = localHour(h.t);
    if (lh === 0 && i > 0) s += `<line x1="${x}" x2="${x}" y1="6" y2="${H - 4}" stroke="rgba(255,255,255,.18)"/>`;
    const lbl = i === 0 ? "Now" : lh === 0 ? fmt(h.t, { weekday: "short" }).toUpperCase() : hourLbl(h.t);
    s += `<text x="${x + cw / 2}" y="16" text-anchor="middle" class="${lh === 0 && i > 0 ? "t-day" : "t-sm"}">${lbl}</text>`;
    s += `<svg x="${x + cw / 2 - 15}" y="24" width="30" height="30" viewBox="0 0 32 32">${iconInner(h.type, h.omDay ?? h.isDay)}</svg>`;
    s += `<text x="${x + cw / 2}" y="${pts[i][1] - 10}" text-anchor="middle" class="t-temp">${T(h.temp)}°</text>`;
    const bh = h.pop / 100 * 22; if (h.pop > 0) s += `<rect x="${x + cw / 2 - 9}" y="${158 - bh}" width="18" height="${bh}" rx="3" fill="#7CC4FF" opacity=".75"/>`;
    s += `<text x="${x + cw / 2}" y="172" text-anchor="middle" class="t-pop">${h.pop >= 10 ? h.pop + "%" : ""}</text>`;
  });
  const path = smoothPath(pts);
  s += `<path d="${path} L${pts[n - 1][0]},136 L${pts[0][0]},136 Z" fill="url(#tg)"/><path d="${path}" fill="none" stroke="#FFD36B" stroke-width="2.4" stroke-linecap="round"/>`;
  pts.forEach(p => s += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#FFD36B"/>`);
  s += `</svg>`;
  el.innerHTML = label + `<div class="hscroll">${s}</div>`;
}
const tempColor = f => { const st = [[-10, "#6A3FB5"], [15, "#3B6FD6"], [32, "#5CC1E8"], [50, "#7FD4A2"], [65, "#E8D46A"], [80, "#F2994A"], [95, "#E5484D"], [110, "#9B1C3C"]]; return colorAt(st, f, "hex"); };
function colorAt(st, v, mode) {
  if (v <= st[0][0]) return st[0][1]; if (v >= st[st.length - 1][0]) return st[st.length - 1][1];
  for (let i = 0; i < st.length - 1; i++) if (v <= st[i + 1][0]) {
    const t = (v - st[i][0]) / (st[i + 1][0] - st[i][0]);
    const a = hexRGB(st[i][1]), b = hexRGB(st[i + 1][1]);
    return "#" + a.map((x, j) => Math.round(x + (b[j] - x) * t).toString(16).padStart(2, "0")).join("");
  }
}
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function renderDays() {
  const dd = S.days, el = $("#cDay");
  const label = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>10-day forecast<span class="src">NWS 7 day + model</span></div>`;
  if (!dd || !dd.length) { el.innerHTML = label + `<div class="err">The daily forecast isn't available right now.</div>`; return; }
  const lows = dd.map(d => d.lo ?? d.hi).filter(v => v != null), highs = dd.map(d => d.hi ?? d.lo).filter(v => v != null);
  const mn = Math.min(...lows), mx = Math.max(...highs), rg = Math.max(1, mx - mn);
  const rows = dd.map((d, i) => {
    const lo = d.lo ?? d.hi, hi = d.hi ?? d.lo;
    const l = (lo - mn) / rg * 100, w = Math.max(4, (hi - lo) / rg * 100);
    const dot = i === 0 && S.cur.t != null ? `<b style="left:${Math.min(100, Math.max(0, (S.cur.t - mn) / rg * 100))}%"></b>` : "";
    const name = i === 0 ? "Today" : fmt(d.date, { weekday: "short", timeZone: "UTC" });
    const det = [];
    if (d.day) det.push(`<div><b>${esc(d.day.name)}.</b> ${esc(d.day.detailedForecast)}</div>`);
    if (d.night) det.push(`<div><b>${esc(d.night.name)}.</b> ${esc(d.night.detailedForecast)}</div>`);
    if (!d.day && !d.night) det.push(`<div>${esc(d.short)}. Extended outlook from the GFS model blend, beyond the NWS 7-day forecast.</div>`);
    const meta = [d.uv != null ? `UV ${Math.round(d.uv)}` : null, d.rain != null ? `Precip ${P(d.rain)}` : null, d.gust != null ? `Gusts ${W(d.gust)}` : null, d.sunrise ? `Sun ${clock(new Date(d.sunrise * 1000))} to ${clock(new Date(d.sunset * 1000))}` : null].filter(Boolean).join("  ·  ");
    return `<div class="day"><button class="dayrow" aria-expanded="false"><span class="dn">${name}</span>${icon(d.type, true)}<span class="pop num">${d.pop >= 10 ? d.pop + "%" : ""}</span><span class="lo num">${Td(lo)}</span><span class="range"><i style="left:${l}%;width:${Math.min(w, 100 - l)}%;background:linear-gradient(90deg,${tempColor(lo)},${tempColor(hi)})"></i>${dot}</span><span class="hi num">${Td(hi)}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button><div class="daydetail" hidden>${det.join("")}<div class="meta">${meta} <span class="tag">${d.src}</span></div></div></div>`;
  }).join("");
  el.innerHTML = label + `<div class="days">${rows}</div>`;
  el.querySelectorAll(".dayrow").forEach(b => b.onclick = () => { const p = b.parentElement, open = !p.classList.contains("open"); p.classList.toggle("open", open); b.setAttribute("aria-expanded", open); p.querySelector(".daydetail").hidden = !open; });
}
function uvCat(u) { return u == null ? ["--", "var(--ink-3)"] : u < 3 ? ["Low", "var(--good)"] : u < 6 ? ["Moderate", "var(--mod)"] : u < 8 ? ["High", "var(--usg)"] : u < 11 ? ["Very high", "var(--bad)"] : ["Extreme", "var(--vbad)"]; }
function renderNow() {
  const c = S.cur, el = $("#cNow"), om = S.d.om;
  const src = c.src === "obs" ? `${c.station.id} ${esc(c.station.name)}` : "Model analysis";
  // pressure trend from model
  let trend = "";
  if (om && om.hourly) { const h = om.hourly, i = omIndexNow(h.time); if (i >= 3 && h.pressure_msl[i] != null) { const dp = h.pressure_msl[i] - h.pressure_msl[i - 3]; trend = dp > 1 ? "Rising" : dp < -1 ? "Falling" : "Steady"; } }
  // uv: today's protection window, or tomorrow's once the sun is down
  let uvLine = "";
  const afterSunset = om && om.daily && Date.now() / 1000 > om.daily.sunset[0];
  if (om && om.hourly) {
    const h = om.hourly, k = dateKey(new Date(Date.now() + (afterSunset ? 864e5 : 0))); let pk = -1, pt = null, on = null, off = null;
    h.time.forEach((t, i) => { const dt = new Date(t * 1000); if (dateKey(dt) !== k) return; const u = h.uv_index[i]; if (u > pk) { pk = u; pt = dt; } if (u >= 3) { if (!on) on = dt; off = new Date((t + 3600) * 1000); } });
    const pre = afterSunset ? "Tomorrow: " : "";
    uvLine = on ? `${pre}protect ${clock(on)} to ${clock(off)}` : pk >= 0 ? `${pre}peak ${Math.round(pk)} around ${hourLbl(pt)}` : "";
    uvLine = uvLine && uvLine[0].toUpperCase() + uvLine.slice(1);
  }
  const [uvc, uvcol] = uvCat(c.uv);
  const dirDeg = c.dir ?? 0;
  const dial = `<svg class="dial" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>${[0, 90, 180, 270].map((a, i) => `<text x="${32 + 21 * Math.sin(a * Math.PI / 180)}" y="${32 - 21 * Math.cos(a * Math.PI / 180) + 3.5}" text-anchor="middle" font-size="8" font-family="IBM Plex Mono, monospace" fill="rgba(246,248,251,.55)">${"NESW"[i]}</text>`).join("")}<g transform="rotate(${dirDeg + 180} 32 32)"><path d="M32 9l5 14h-10z" fill="#FFD36B"/><line x1="32" y1="20" x2="32" y2="50" stroke="#FFD36B" stroke-width="2"/></g></svg>`;
  // sun arc
  let sun = "";
  const dl = om && om.daily;
  if (dl) {
    const di = afterSunset && dl.sunrise.length > 1 ? 1 : 0, sr = dl.sunrise[di], ss = dl.sunset[di], now = Date.now() / 1000, f = Math.min(1, Math.max(0, (now - sr) / (ss - sr)));
    const ang = Math.PI * (1 - f), cx = 150 + 130 * Math.cos(ang), cy = 62 - 52 * Math.sin(ang);
    const len = ss - sr, hrs = Math.floor(len / 3600), mins = Math.round(len % 3600 / 60);
    sun = `<div class="tile wide"><div class="label">${di ? "Sun tomorrow" : "Sun"}</div><svg class="sunarc" viewBox="0 0 300 70" preserveAspectRatio="none"><path d="M20 62 A130 52 0 0 1 280 62" fill="none" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 5"/><line x1="0" x2="300" y1="62" y2="62" stroke="rgba(255,255,255,.2)"/>${now > sr && now < ss ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#FFD36B"/>` : ""}</svg><div class="s num" style="display:flex;justify-content:space-between"><span>Sunrise ${clock(new Date(sr * 1000))}</span><span>${hrs}h ${mins}m of daylight</span><span>Sunset ${clock(new Date(ss * 1000))}</span></div></div>`;
  }
  const dewFeel = c.dew == null ? "" : c.dew < 50 ? "Dry and comfortable" : c.dew < 60 ? "Comfortable" : c.dew < 65 ? "Getting sticky" : c.dew < 70 ? "Muggy" : "Oppressive";
  el.innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>Current conditions<span class="src">${src}</span></div>
  <div class="tiles">
    <div class="tile">${dial}<div class="label">Wind</div><div class="v num">${Wn(c.wind)}<small>${Wu()}</small></div><div class="s">${dirName(c.dir) ? "From " + dirName(c.dir) : "Calm"}${c.gust ? ` · Gusts ${W(c.gust)}` : ""}</div></div>
    <div class="tile"><div class="label">Feels like</div><div class="v num">${Td(c.feels)}</div><div class="s">${c.feels != null && c.t != null && Math.abs(c.feels - c.t) >= 3 ? (c.feels < c.t ? "Wind chill is making it feel colder" : "Humidity is making it feel warmer") : "Close to the actual temperature"}</div></div>
    <div class="tile"><div class="label">Humidity</div><div class="v num">${c.rh == null ? "--" : Math.round(c.rh)}<small>%</small></div><div class="s">Dew point ${Td(c.dew)}${dewFeel ? ". " + dewFeel : ""}</div></div>
    <div class="tile"><div class="label">Pressure</div><div class="v num">${Pr(c.pres)}<small>${Pru()}</small></div><div class="s">${trend || "Station pressure"}</div></div>
    <div class="tile"><div class="label">UV index</div><div class="v num" style="color:${uvcol}">${c.uv == null ? "--" : Math.round(c.uv)}<small>${uvc}</small></div><div class="s">${uvLine}</div></div>
    <div class="tile"><div class="label">Visibility</div><div class="v num">${V(c.vis)}<small>${Vu()}</small></div><div class="s">${c.cloud != null ? `Cloud cover ${Math.round(c.cloud)}%` : ""}</div></div>
    ${sun}
  </div>`;
}
const AQI = [[50, "Good", "var(--good)", "Air quality is fine for any outdoor activity."], [100, "Moderate", "var(--mod)", "Unusually sensitive people should consider easing off long or hard outdoor efforts."], [150, "Unhealthy for sensitive groups", "var(--usg)", "Sensitive groups should cut back long or hard outdoor efforts."], [200, "Unhealthy", "var(--bad)", "Everyone should cut back long or hard outdoor efforts."], [300, "Very unhealthy", "var(--vbad)", "Avoid long or hard efforts outside."], [1e9, "Hazardous", "var(--haz)", "Avoid all outdoor exertion."]];
const aqiCat = v => AQI.find(a => v <= a[0]);
const aqiHex = v => v <= 50 ? "#3FBF6F" : v <= 100 ? "#E8C547" : v <= 150 ? "#F5A524" : v <= 200 ? "#E5484D" : v <= 300 ? "#9B5DE5" : "#8E1F45";
function renderAir() {
  const el = $("#cAir"), aq = S.d.aq;
  let html = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h7"/></svg>Air and health<span class="src">EPA AQI · CAMS</span></div>`;
  if (aq && aq.current && aq.current.us_aqi != null) {
    const v = Math.round(aq.current.us_aqi), cat = aqiCat(v), f = Math.min(v, 300) / 300;
    const a = Math.PI * (1 - f), nx = 75 + 58 * Math.cos(a), ny = 80 - 58 * Math.sin(a);
    const segs = [[0, 50, "#3FBF6F"], [50, 100, "#E8C547"], [100, 150, "#F5A524"], [150, 200, "#E5484D"], [200, 300, "#9B5DE5"]].map(([s, e, col]) => {
      const a1 = Math.PI * (1 - s / 300), a2 = Math.PI * (1 - e / 300);
      return `<path d="M${75 + 58 * Math.cos(a1)},${80 - 58 * Math.sin(a1)} A58 58 0 0 1 ${75 + 58 * Math.cos(a2)},${80 - 58 * Math.sin(a2)}" stroke="${col}" stroke-width="9" fill="none" opacity=".9"/>`;
    }).join("");
    const cu = aq.current;
    const chips = [["PM2.5", cu.pm2_5, "µg/m³"], ["PM10", cu.pm10, "µg/m³"], ["O₃", cu.ozone, "µg/m³"], ["NO₂", cu.nitrogen_dioxide, "µg/m³"]].filter(x => x[1] != null).map(x => `<span class="pchip">${x[0]} ${Math.round(x[1])}</span>`).join("");
    let bars = "";
    if (aq.hourly) { const i0 = omIndexNow(aq.hourly.time); const hv = aq.hourly.us_aqi.slice(i0, i0 + 24).filter(x => x != null); const mx = Math.max(100, ...hv); bars = `<div class="aqbars" role="img" aria-label="AQI next 24 hours">${hv.map(x => `<i style="height:${Math.max(6, x / mx * 100)}%;background:${aqiHex(x)}"></i>`).join("")}</div><div class="wticks"><span>Now</span><span>+12h</span><span>+24h</span></div>`; }
    html += `<div class="aqwrap"><svg class="gauge" viewBox="0 0 150 92">${segs}<circle cx="${nx}" cy="${ny}" r="7" fill="#fff" stroke="rgba(10,20,36,.7)" stroke-width="3"/><text x="75" y="78" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="30" font-weight="500" fill="#F6F8FB">${v}</text></svg><div><div class="aqcat" style="color:${cat[2]}">${cat[1]}</div><div class="s muted" style="font-size:14px;margin-top:2px">${cat[3]}</div><div class="chipsrow">${chips}</div></div></div>${bars}`;
  } else html += `<div class="err">Air quality data isn't available right now.</div>`;
  html += outdoorWindow();
  el.innerHTML = html;
}
function outdoorWindow() {
  const om = S.d.om && S.d.om.hourly; if (!om) return "";
  const aqh = S.d.aq && S.d.aq.hourly, aqMap = {}; if (aqh) aqh.time.forEach((t, i) => aqMap[t] = aqh.us_aqi[i]);
  const i0 = omIndexNow(om.time), hrs = [];
  for (let i = i0; i < Math.min(om.time.length, i0 + 24); i++) {
    if (!om.is_day[i]) continue;
    const t = om.temperature_2m[i], pop = om.precipitation_probability[i] || 0, w = om.wind_speed_10m[i], g = om.wind_gusts_10m[i], uv = om.uv_index[i] || 0, a = aqMap[om.time[i]] ?? 30;
    let sc = 100 - pop * .7 - Math.max(0, 58 - t) * 2 - Math.max(0, t - 76) * 2.4 - Math.max(0, w - 10) * 2 - Math.max(0, g - 20) * 1.2 - Math.max(0, uv - 6) * 4 - Math.max(0, a - 50) * .5;
    hrs.push({ t: new Date(om.time[i] * 1000), sc: Math.max(0, Math.min(100, sc)), temp: t, w, pop });
  }
  if (hrs.length < 2) return `<div class="sub"><div class="label" style="margin-bottom:6px">Outdoor window</div><div class="s muted" style="font-size:13px">No more daylight in the next 24 hours.</div></div>`;
  let best = 0, bi = 0;
  for (let i = 0; i < hrs.length - 1; i++) { const sc = (hrs[i].sc + hrs[i + 1].sc) / 2; if (sc > best && hrs[i + 1].t - hrs[i].t <= 3600e3) { best = sc; bi = i; } }
  const a = hrs[bi], b = hrs[bi + 1];
  const end = new Date(b.t.getTime() + 3600e3);
  const day = dateKey(a.t) === dateKey(new Date()) ? "" : fmt(a.t, { weekday: "long" }) + " ";
  const grade = best >= 80 ? "Great" : best >= 60 ? "Good" : best >= 40 ? "Fair" : "Poor";
  const col = s => s >= 80 ? "#3FBF6F" : s >= 60 ? "#9ACD5A" : s >= 40 ? "#E8C547" : s >= 20 ? "#F5A524" : "#E5484D";
  return `<div class="sub"><div class="label" style="margin-bottom:4px">Outdoor window</div><div class="window">${grade}: ${day}${hourLbl(a.t)} to ${hourLbl(end)}</div><div class="s muted" style="font-size:13px">${Td((a.temp + b.temp) / 2)}, wind ${W((a.w + b.w) / 2)}, ${Math.max(a.pop, b.pop)}% chance of rain. Scored on temperature, rain, wind, UV and air quality for a run or ride.</div><div class="wstrip">${hrs.map((h, i) => `<i title="${hourLbl(h.t)}: ${Math.round(h.sc)}" style="background:${col(h.sc)};opacity:${i === bi || i === bi + 1 ? 1 : .55}"></i>`).join("")}</div><div class="wticks"><span>${hourLbl(hrs[0].t)}</span><span>${hourLbl(hrs[hrs.length - 1].t)}</span></div></div>`;
}
function renderAlerts() {
  const al = alertsList(), el = $("#cAlerts");
  if (!al.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>Active alerts<span class="src">NWS</span></div>` + al.map(a => {
    const p = a.properties, until = p.ends || p.expires;
    return `<div class="alert" style="border-left-color:${SEV[p.severity] || "var(--rain)"}"><h4>${esc(p.event)}</h4><div class="when">${p.onset || p.effective ? fmt(new Date(p.onset || p.effective), { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}${until ? " to " + fmt(new Date(until), { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""} · ${esc(p.senderName || "")}</div><div class="area">${esc((p.areaDesc || "").slice(0, 180))}${(p.areaDesc || "").length > 180 ? "…" : ""}</div><details><summary>Full statement</summary><pre>${esc(p.description || "")}${p.instruction ? "\n\n" + esc(p.instruction) : ""}</pre></details></div>`;
  }).join("");
}
function renderAFD() {
  const a = S.d.afd, el = $("#cAfd");
  if (!a || !a.text) { el.hidden = true; return; }
  el.hidden = false;
  let txt = a.text.replace(/\r/g, "");
  const k = txt.search(/^\.[A-Z]/m); if (k > 0) txt = txt.slice(k);
  txt = txt.replace(/\n&&\n/g, "\n\n").trim();
  const ll = S.loc;
  el.innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v11H8l-4 4z"/></svg>Forecaster discussion<span class="src">NWS ${esc(a.office)} · ${fmt(new Date(a.issued), { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></div><pre class="afd" id="afdText">${esc(txt)}</pre><div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap"><button class="linkbtn" id="afdMore">Show full discussion</button><a class="linkbtn" href="https://forecast.weather.gov/MapClick.php?lat=${ll.lat.toFixed(4)}&lon=${ll.lon.toFixed(4)}" target="_blank" rel="noopener">Open on weather.gov</a></div>`;
  $("#afdMore").onclick = e => { const p = $("#afdText"), full = p.classList.toggle("full"); e.target.textContent = full ? "Show less" : "Show full discussion"; };
}

/* ---------- maps ---------- */
const PRECIP_STOPS = [[0.004, [0, 0, 0, 0]], [0.01, [70, 205, 125, .5]], [0.05, [40, 170, 70, .72]], [0.12, [240, 220, 60, .84]], [0.3, [245, 150, 40, .9]], [0.6, [228, 58, 58, .92]], [1.2, [190, 60, 190, .95]]];
const TEMP_STOPS = [[-10, [106, 63, 181]], [15, [59, 111, 214]], [32, [92, 193, 232]], [50, [127, 212, 162]], [65, [232, 212, 106]], [80, [242, 153, 74]], [95, [229, 72, 77]], [110, [155, 28, 60]]];
function lerpStops(st, v) {
  if (v <= st[0][0]) return st[0][1]; if (v >= st[st.length - 1][0]) return st[st.length - 1][1];
  for (let i = 0; i < st.length - 1; i++) if (v <= st[i + 1][0]) { const t = (v - st[i][0]) / (st[i + 1][0] - st[i][0]); return st[i][1].map((x, j) => x + (st[i + 1][1][j] - x) * t); }
}
const Radar = {
  map: null, mode: "radar", frames: [], idx: 0, timer: null, overlay: null, gridKey: "", playing: false, sat: null, alertLayer: null, marker: null,
  radarLayers: [], radarSrc: "", radarAt: 0, ZOOM: 8,
  init() {
    if (!window.L) { $("#map").innerHTML = `<div class="err" style="padding:20px">The map didn't load. Check your connection and refresh.</div>`; return; }
    const m = this.map = L.map("map", { zoomControl: false, attributionControl: true, worldCopyJump: true, zoomSnap: .5 }).setView([S.loc.lat, S.loc.lon], this.ZOOM);
    m.attributionControl.setPrefix(false);
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
    L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "© Esri", maxNativeZoom: 16, maxZoom: 12, className: "basemap" }).addTo(m);
    m.createPane("labels"); m.getPane("labels").style.zIndex = 650; m.getPane("labels").style.pointerEvents = "none";
    L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { pane: "labels", maxNativeZoom: 16, maxZoom: 12, className: "labels" }).addTo(m);
    this.marker = L.marker([S.loc.lat, S.loc.lon], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, keyboard: false }).addTo(m);
    this.alertLayer = L.geoJSON(null, { style: f => ({ color: { Extreme: "#E5484D", Severe: "#E5484D", Moderate: "#F5A524", Minor: "#E8C547" }[f.properties.severity] || "#7CC4FF", weight: 1.5, fillOpacity: .1, dashArray: "4 4" }) }).addTo(m);
    $("#zIn").onclick = () => m.zoomIn(); $("#zOut").onclick = () => m.zoomOut();
    $("#zHome").onclick = () => m.setView([S.loc.lat, S.loc.lon], this.ZOOM);
    document.querySelectorAll(".seg button").forEach(b => b.onclick = () => this.setMode(b.dataset.mode));
    $("#playBtn").onclick = () => this.toggle();
    $("#frameRange").oninput = e => { this.stop(); this.show(+e.target.value); };
    m.on("moveend", () => { if (this.mode === "future" || this.mode === "temp") { clearTimeout(this._mt); this._mt = setTimeout(() => this.loadGrid(), 600); } });
    this.setMode("radar");
  },
  // Past two hours of NOAA NEXRAD, smoothed and clutter-filtered by RainViewer. Falls back to raw NEXRAD from Iowa State.
  async loadRadar() {
    this.radarLayers.forEach(f => this.map.hasLayer(f.layer) && this.map.removeLayer(f.layer));
    let layers = [];
    try {
      const r = await getJSON("https://api.rainviewer.com/public/weather-maps.json", {}, 10000);
      layers = r.radar.past.map(p => ({ t: new Date(p.time * 1000), layer: L.tileLayer(`${r.host}${p.path}/256/{z}/{x}/{y}/4/1_1.png`, { opacity: 0, zIndex: 400, maxNativeZoom: 7, maxZoom: 12, attribution: "NEXRAD: NOAA via RainViewer" }) }));
      this.radarSrc = "NOAA NEXRAD";
    } catch (e) {
      const base = Math.floor(Date.now() / 300000) * 300000 - 300000;
      layers = [50, 40, 30, 20, 10, 0].map(o => ({ t: new Date(base - o * 60000), layer: L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${o ? `nexrad-n0q-900913-m${String(o).padStart(2, "0")}m` : "nexrad-n0q-900913"}/{z}/{x}/{y}.png`, { opacity: 0, zIndex: 400, maxZoom: 12, attribution: "NEXRAD: NOAA via IEM" }) }));
      this.radarSrc = "NOAA NEXRAD (raw)";
    }
    this.radarLayers = layers; this.radarAt = Date.now();
  },
  update() {
    if (!this.map) return;
    const ll = [S.loc.lat, S.loc.lon];
    if (this._loc !== ll.join()) { this._loc = ll.join(); this.map.setView(ll, this.ZOOM); this.marker.setLatLng(ll); this.gridKey = ""; if (this.mode === "future" || this.mode === "temp") this.loadGrid(); }
    this.alertLayer.clearLayers();
    alertsList().forEach(a => { if (a.geometry) this.alertLayer.addData(a); });
    if (this.mode === "radar" && Date.now() - this.radarAt > 9 * 60e3) this.setMode("radar");
    setTimeout(() => this.map.invalidateSize(), 50);
  },
  note(txt) { const n = $("#mapNote"); n.hidden = !txt; n.textContent = txt || ""; },
  clear() {
    this.stop();
    this.radarLayers.forEach(f => this.map.hasLayer(f.layer) && this.map.removeLayer(f.layer));
    if (this.overlay) { this.map.removeLayer(this.overlay); this.overlay = null; }
    if (this.sat) { this.map.removeLayer(this.sat); this.sat = null; }
    this.frames = []; this.note("");
  },
  async setMode(mode) {
    this.mode = mode; this.clear();
    document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode));
    $("#tl").hidden = mode === "sat";
    $("#mapSrc").textContent = { radar: "", future: "HRRR model", sat: "NOAA GOES", temp: "HRRR model" }[mode];
    if (mode === "radar" || mode === "sat") {
      if (!this.radarLayers.length || Date.now() - this.radarAt > 9 * 60e3) { $("#fTime").textContent = "Loading"; await this.loadRadar(); }
      if (this.mode !== mode) return;
    }
    if (mode === "radar") {
      $("#mapSrc").textContent = this.radarSrc;
      this.radarLayers.forEach(f => f.layer.addTo(this.map));
      const n = this.radarLayers.length;
      this.frames = this.radarLayers.map((f, i) => ({ label: i === n - 1 ? "Now" : clock(f.t), show: on => f.layer.setOpacity(on ? .85 : 0) }));
      this.legend("precip", "Light", "Heavy");
      if (!S.d.pts && S.d.om) this.note("Radar covers the US and a few other countries. Future shows model rain anywhere.");
      this.show(n - 1); this.play();
    } else if (mode === "sat") {
      this.makeSat();
      const last = this.radarLayers[this.radarLayers.length - 1]; if (last) last.layer.addTo(this.map).setOpacity(.6);
      $("#legend").innerHTML = `<span>Latest scan. True color by day, infrared at night</span>`;
    } else {
      this.legend(mode === "temp" ? "temp" : "precip", mode === "temp" ? (US() ? "-10°" : "-23°") : "Light", mode === "temp" ? (US() ? "110°" : "43°") : "Heavy");
      this.loadGrid();
    }
  },
  makeSat() {
    const sat = S.loc.lon < -105 ? "GOES-West" : "GOES-East";
    // GeoColor: true color by day, infrared with city lights at night. Falls back to plain infrared.
    const opts = [[`${sat}_ABI_GeoColor`, 7, "jpg"], [`${sat}_ABI_Band13_Clean_Infrared`, 6, "png"]]; let li = 0;
    const mk = () => { const [lyr, lv, ext] = opts[li]; return L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${lyr}/default/GoogleMapsCompatible_Level${lv}/{z}/{y}/{x}.${ext}`, { maxNativeZoom: lv, maxZoom: 12, opacity: .95, zIndex: 300, attribution: "GOES: NOAA via NASA GIBS" }); };
    const attach = () => { this.sat = mk(); let errs = 0; this.sat.on("tileerror", () => { if (++errs === 4 && li < opts.length - 1 && this.mode === "sat") { this.map.removeLayer(this.sat); li++; attach(); } }); this.sat.addTo(this.map); };
    attach();
  },
  legend(kind, lo, hi) {
    const g = kind === "temp" ? TEMP_STOPS.map(s => `rgb(${s[1].join(",")})`).join(",") : "#7FE38A,#23A84B,#F4E04D,#F59B2A,#E23D3D,#C447C9";
    $("#legend").innerHTML = `<span>${lo}</span><i style="background:linear-gradient(90deg,${g})"></i><span>${hi}</span>`;
  },
  async loadGrid() {
    const m = this.map, mode = this.mode;
    let b = m.getBounds(); const c = b.getCenter();
    let dLat = Math.min(4, (b.getNorth() - b.getSouth()) / 2 * 1.1), dLon = Math.min(5.5, (b.getEast() - b.getWest()) / 2 * 1.1);
    const N = 13, n = c.lat + dLat, s = c.lat - dLat, w = c.lng - dLon, e = c.lng + dLon;
    const key = [n, s, w, e].map(v => v.toFixed(2)).join() + mode;
    if (key === this.gridKey) return; this.gridKey = key;
    const lats = [], lons = [];
    for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) { lats.push((n - r * (n - s) / (N - 1)).toFixed(3)); lons.push((((w + q * (e - w) / (N - 1)) + 540) % 360 - 180).toFixed(3)); }
    $("#fTime").textContent = "Loading";
    try {
      const url = `${OM}?latitude=${lats.join(",")}&longitude=${lons.join(",")}&` + (mode === "future" ? "minutely_15=precipitation&forecast_minutely_15=24" : "hourly=temperature_2m&forecast_hours=12") + "&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT";
      const res = await getJSON(url, {}, 25000);
      if (this.mode !== mode || this.gridKey !== key) return;
      const arr = Array.isArray(res) ? res : [res];
      const series = arr.map(x => mode === "future" ? x.minutely_15.precipitation.map(v => (v || 0) * 4) : x.hourly.temperature_2m);
      const times = mode === "future" ? arr[0].minutely_15.time : arr[0].hourly.time;
      const nowS = Date.now() / 1000; let st = 0; while (st < times.length - 1 && times[st + 1] <= nowS) st++;
      const urls = [];
      for (let f = st; f < times.length; f++) urls.push({ t: times[f], url: this.paint(series.map(sr => sr[f]), N, mode) });
      if (this.overlay) this.map.removeLayer(this.overlay);
      this.overlay = L.imageOverlay(urls[0].url, [[s, w], [n, e]], { opacity: mode === "temp" ? .55 : .85, zIndex: 400, interactive: false, className: "smooth" }).addTo(this.map);
      this.frames = urls.map((u, i) => ({ label: i === 0 ? "Now" : clock(new Date(u.t * 1000)), show: on => on && this.overlay.setUrl(u.url) }));
      this.show(0); this.play();
    } catch (err) { $("#fTime").textContent = "Unavailable"; this.gridKey = ""; }
  },
  paint(vals, N, mode) {
    const R = 176, cv = document.createElement("canvas"); cv.width = cv.height = R; const cx = cv.getContext("2d"), img = cx.createImageData(R, R);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const gy = y / (R - 1) * (N - 1), gx = x / (R - 1) * (N - 1), r0 = Math.floor(gy), c0 = Math.floor(gx), r1 = Math.min(N - 1, r0 + 1), c1 = Math.min(N - 1, c0 + 1), fy = gy - r0, fx = gx - c0;
      const v = (vals[r0 * N + c0] ?? 0) * (1 - fx) * (1 - fy) + (vals[r0 * N + c1] ?? 0) * fx * (1 - fy) + (vals[r1 * N + c0] ?? 0) * (1 - fx) * fy + (vals[r1 * N + c1] ?? 0) * fx * fy;
      const k = (y * R + x) * 4;
      if (mode === "temp") { const c = lerpStops(TEMP_STOPS, v); img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; }
      else { const c = lerpStops(PRECIP_STOPS, v); img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = Math.round(c[3] * 255); }
    }
    cx.putImageData(img, 0, 0); return cv.toDataURL();
  },
  show(i) {
    if (!this.frames.length) return;
    this.frames.forEach((f, j) => j !== i && f.show(false));
    this.idx = i; this.frames[i].show(true);
    const r = $("#frameRange"); r.max = this.frames.length - 1; r.value = i;
    $("#fTime").textContent = this.frames[i].label;
  },
  play() {
    this.stop(); if (matchMedia("(prefers-reduced-motion: reduce)").matches || this.frames.length < 2) { this.icon(); return; }
    this.playing = true; this.icon();
    const step = () => { const last = this.idx === this.frames.length - 1; this.show(last ? 0 : this.idx + 1); this.timer = setTimeout(step, this.idx === this.frames.length - 1 ? 1600 : 450); };
    this.timer = setTimeout(step, 900);
  },
  stop() { clearTimeout(this.timer); this.playing = false; this.icon(); },
  toggle() { this.playing ? this.stop() : this.play(); },
  icon() { $("#playBtn").innerHTML = this.playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>'; $("#playBtn").setAttribute("aria-label", this.playing ? "Pause" : "Play"); }
};
const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}`; };

/* ---------- load ---------- */
let loading = false;
async function loadAll() {
  if (loading) return; loading = true; $("#refresh").classList.add("spin");
  const { lat, lon } = S.loc, la = lat.toFixed(4), lo = lon.toFixed(4);
  try {
    const omP = getJSON(omUrl(la, lo)).catch(() => null), aqP = getJSON(aqUrl(la, lo)).catch(() => null);
    let pts = null; try { pts = await nws(`/points/${la},${lo}`, 0); } catch (e) {}
    let fc = null, hr = null, obs = null, alerts = null, afd = null;
    if (pts) {
      const p = pts.properties;
      [fc, hr, obs, alerts, afd] = await Promise.all([nws(p.forecast).catch(() => null), nws(p.forecastHourly).catch(() => null), getObs(p.observationStations).catch(() => null), nws(`/alerts/active?point=${la},${lo}`).catch(() => null), getAFD(p.gridId).catch(() => null)]);
      if (!S.loc.named && p.relativeLocation) { const r = p.relativeLocation.properties; S.loc.name = `${r.city}, ${r.state}`; store.set("loc", S.loc); }
    } else {
      alerts = null;
    }
    const [om, aq] = await Promise.all([omP, aqP]);
    if (!pts && !om) { // nothing reachable: keep whatever is on screen
      if (S.d.at) { S.offline = true; render(); } else { const snap = loadSnap(); if (snap) { useSnap(snap, true); } else { S.d = {}; render(); } }
      return;
    }
    S.offline = false;
    S.tz = (om && om.timezone) || (pts && pts.properties.timeZone) || undefined;
    const coast = await Coast.load(lat, lon).catch(() => null);
    S.d = { pts, fc, hr, obs, alerts, afd, om, aq, coast, at: Date.now() };
    render();
    saveSnap();
    if (!store.get(`hist.${S.loc.lat.toFixed(2)},${S.loc.lon.toFixed(2)}`, null)) History.load();
  } finally { loading = false; $("#refresh").classList.remove("spin"); }
}
// Last good data per place, so the app opens instantly and works with no signal
const snapKey = () => `snap.${S.loc.lat.toFixed(2)},${S.loc.lon.toFixed(2)}`;
function saveSnap() {
  const d = S.d, hr = d.hr && { properties: { periods: d.hr.properties.periods.slice(0, 96).map(p => ({ startTime: p.startTime, temperature: p.temperature, probabilityOfPrecipitation: p.probabilityOfPrecipitation, windSpeed: p.windSpeed, windDirection: p.windDirection, shortForecast: p.shortForecast, isDaytime: p.isDaytime })) } };
  const alerts = d.alerts && { features: (d.alerts.features || []).map(f => ({ type: f.type, geometry: f.geometry, properties: f.properties })) };
  store.set(snapKey(), { ...d, hr, alerts, tz: S.tz });
}
function loadSnap() { return store.get(snapKey(), null); }
function useSnap(snap, off) { S.tz = snap.tz; delete snap.tz; S.d = snap; S.offline = !!off; render(); }
function setLoc(loc) { S.loc = loc; store.set("loc", loc); closeSheet(); $("#locName").textContent = loc.name; const snap = loadSnap(); if (snap) useSnap(snap); loadAll(); }

/* ---------- sheet ---------- */
function openSheet() { $("#sheet").hidden = false; renderSaved(); setTimeout(() => $("#q").focus(), 30); }
function closeSheet() { $("#sheet").hidden = true; $("#q").value = ""; $("#results").innerHTML = ""; }
function renderSaved() {
  const isSaved = S.saved.some(s => Math.abs(s.lat - S.loc.lat) < .01 && Math.abs(s.lon - S.loc.lon) < .01);
  $("#saveBtn").innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${isSaved ? "#FFD36B" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z"/></svg><span>${isSaved ? "Saved" : "Save"} ${esc(S.loc.name)}</span>`;
  $("#saveBtn").onclick = () => { if (!isSaved) { S.saved.push({ ...S.loc }); store.set("saved", S.saved); } renderSaved(); };
  $("#savedList").innerHTML = S.saved.length ? S.saved.map((s, i) => `<div class="res" role="button" tabindex="0" data-i="${i}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/></svg><span>${esc(s.name)}</span><button class="x" data-del="${i}" aria-label="Remove ${esc(s.name)}">✕</button></div>`).join("") : `<div class="muted" style="padding:6px 10px;font-size:14px">No saved places yet.</div>`;
  $("#savedList").querySelectorAll("[data-i]").forEach(r => { const go = e => { if (e.target.closest("[data-del]")) return; setLoc({ ...S.saved[+r.dataset.i] }); }; r.onclick = go; r.onkeydown = e => { if (e.key === "Enter") go(e); }; });
  $("#savedList").querySelectorAll("[data-del]").forEach(b => b.onclick = e => { e.stopPropagation(); S.saved.splice(+b.dataset.del, 1); store.set("saved", S.saved); renderSaved(); });
}
let qT;
$("#q").addEventListener("input", e => {
  clearTimeout(qT); const q = e.target.value.trim();
  if (q.length < 2) { $("#results").innerHTML = ""; return; }
  qT = setTimeout(async () => {
    try {
      const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=en&format=json`);
      const list = r.results || [];
      $("#results").innerHTML = list.length ? list.map((x, i) => `<button class="res" data-r="${i}"><span>${esc(x.name)}<br><small>${esc([x.admin1, x.country].filter(Boolean).join(", "))}</small></span></button>`).join("") : `<div class="muted" style="padding:8px 10px">No places match "${esc(q)}".</div>`;
      $("#results").querySelectorAll("[data-r]").forEach(b => b.onclick = () => { const x = list[+b.dataset.r]; const st = x.country_code === "US" && x.admin1 ? (US_ABBR[x.admin1] || x.admin1) : x.country; setLoc({ name: `${x.name}, ${st}`, lat: x.latitude, lon: x.longitude, named: true }); });
    } catch (err) { $("#results").innerHTML = `<div class="muted" style="padding:8px 10px">Search isn't responding. Try again in a moment.</div>`; }
  }, 280);
});
const US_ABBR = {Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY","District of Columbia":"DC"};
$("#geoBtn").onclick = () => {
  const span = $("#geoBtn span");
  if (!navigator.geolocation) { span.textContent = "Location isn't available in this browser"; return; }
  span.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(p => { span.textContent = "Use my location"; setLoc({ name: "My location", lat: p.coords.latitude, lon: p.coords.longitude, named: false }); },
    () => { span.textContent = "Location permission was denied. Search instead."; }, { timeout: 12000, maximumAge: 600000 });
};
$("#locBtn").onclick = openSheet; $("#closeSheet").onclick = closeSheet;
$("#sheet").onclick = e => { if (e.target.id === "sheet") closeSheet(); };
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
function setUnits(u) { S.units = u; store.set("units", u); $("#uF").setAttribute("aria-pressed", u === "us"); $("#uC").setAttribute("aria-pressed", u !== "us"); if (S.d.at) { render(); if (Radar.mode === "temp") Radar.setMode("temp"); } }
$("#uF").onclick = () => setUnits("us"); $("#uC").onclick = () => setUnits("si");
$("#refresh").onclick = () => loadAll();
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (S.d.at || 0) > 10 * 60e3) loadAll(); });
setInterval(() => { if (!document.hidden) loadAll(); }, 10 * 60e3);

/* tabs */
const VIEWS = ["today", "ride", "history"];
function showView(v) {
  if (!VIEWS.includes(v)) v = "today";
  VIEWS.forEach(n => { $("#v" + n[0].toUpperCase() + n.slice(1)).hidden = n !== v; });
  document.querySelectorAll(".tabbar button").forEach(b => b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  S.view = v;
  if (v === "today" && Radar.map) setTimeout(() => Radar.map.invalidateSize(), 30);
  if (v === "ride") safe(() => Ride.show());
  if (v === "history") safe(() => History.show());
  scrollTo(0, 0);
}
document.querySelectorAll(".tabbar button").forEach(b => b.onclick = () => {
  const v = b.dataset.view;
  if (v === "today") history.replaceState(null, "", location.pathname); else location.hash = v;
  showView(v);
});
addEventListener("hashchange", () => showView(location.hash.slice(1)));

/* pull to refresh (touch devices) */
(function () {
  const el = $("#ptr"); let y0 = null, dy = 0;
  addEventListener("touchstart", e => { y0 = scrollY <= 0 && $("#sheet").hidden && !e.target.closest("#map,.hscroll") ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener("touchmove", e => {
    if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0);
    const d = Math.min(dy, 120); el.style.opacity = Math.min(1, d / 70); el.style.transform = `translateY(${d * .6 - 30}px) rotate(${d * 3}deg)`;
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 == null) return; y0 = null;
    if (dy > 80) { el.style.transform = "translateY(30px)"; el.classList.add("spin"); loadAll().finally(() => { el.classList.remove("spin"); el.style.opacity = 0; el.style.transform = "translateY(-60px)"; }); }
    else { el.style.opacity = 0; el.style.transform = "translateY(-60px)"; }
  });
})();

/* offline app shell */
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

/* boot */
setUnits(S.units);
Sky.init();
Radar.init();
safe(() => Ride.init());
safe(() => History.init());
showView(location.hash.slice(1));
{ const snap = loadSnap(); if (snap) useSnap(snap); }
loadAll();
