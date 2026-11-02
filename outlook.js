"use strict";
/* Outlook: plain-language summary of the next day and the week ahead, written from the forecast data */
const Outlook = {
  render() {
    const el = $("#cOutlook"), om = S.d.om, h = om && om.hourly;
    if (!h || !S.days || !S.days.length) { el.hidden = true; return; }
    el.hidden = false;
    let day = "", week = "";
    try { day = this.dayText(h); } catch (e) { console.error(e); }
    try { week = this.weekText(); } catch (e) { console.error(e); }
    el.innerHTML = `<div class="olcol"><div class="label">The day ahead</div><p>${day}</p></div><div class="olcol"><div class="label">The week ahead</div><p>${week}</p></div>`;
  },
  idxFor(h, key, h1, h2, from) { const out = []; for (let i = from; i < h.time.length; i++) { const d = new Date(h.time[i] * 1000); if (dateKey(d) === key && localHour(d) >= h1 && localHour(d) <= h2) out.push(i); } return out; },
  stats(h, idx) {
    if (!idx.length) return null;
    const v = k => idx.map(i => h[k][i]).filter(x => x != null);
    const pops = idx.map(i => [h.precipitation_probability[i] || 0, i]).sort((a, b) => b[0] - a[0]);
    const gusts = idx.map(i => [h.wind_gusts_10m[i] || 0, i]).sort((a, b) => b[0] - a[0]);
    return { hi: Math.max(...v("temperature_2m")), lo: Math.min(...v("temperature_2m")), pop: pops[0][0], popAt: new Date(h.time[pops[0][1]] * 1000), gust: gusts[0][0], gustAt: new Date(h.time[gusts[0][1]] * 1000),
      cloud: v("cloud_cover").reduce((a, b) => a + b, 0) / Math.max(1, v("cloud_cover").length), uv: Math.max(0, ...v("uv_index")) };
  },
  // sky for daytime hours, with the coastal gray-morning case
  sky(h, key, from) {
    const mid = this.stats(h, this.idxFor(h, key, 11, 16, from));
    const morn = this.idxFor(h, key, 6, 10, from).filter(i => h.cloud_cover_low && (h.cloud_cover_low[i] ?? 0) >= 55);
    const base = !mid ? "" : mid.cloud < 20 ? "sunny" : mid.cloud < 45 ? "mostly sunny" : mid.cloud < 75 ? "partly cloudy" : "mostly cloudy";
    if (morn.length >= 2 && mid && mid.cloud < 60) {
      const clear = this.idxFor(h, key, 8, 14, from).find(i => (h.cloud_cover_low[i] ?? 0) < 40);
      return clear != null ? `gray in the morning, then ${base === "sunny" || base === "mostly sunny" ? "sunny" : base} by ${hourLbl(new Date(h.time[clear] * 1000))}` : `gray in the morning, then ${base}`;
    }
    return base;
  },
  rainWind(s, when) {
    const parts = [];
    if (s.pop >= 60) parts.push(`Rain is likely, mostly around ${hourLbl(s.popAt)}`);
    else if (s.pop >= 30) parts.push(`There's a ${Math.round(s.pop)}% chance of showers around ${hourLbl(s.popAt)}`);
    if (s.gust >= 35) parts.push(`${parts.length ? "and it gets" : "It gets"} windy, with gusts to ${W(s.gust)}`);
    else if (s.gust >= 25) parts.push(`${parts.length ? "and it's" : "It's"} breezy ${localHour(s.gustAt) >= 12 ? "in the afternoon" : "in the morning"}, gusting to ${W(s.gust)}`);
    if (!parts.length) return s.gust < 15 ? `Dry, with light wind ${when}.` : `Dry ${when}.`;
    return parts.join(" ") + ".";
  },
  // NWS forecast periods are the authority for sky, highs, lows, rain chance and wind; the model only adds timing
  dayText(h) {
    const P = S.d.fc && S.d.fc.properties && S.d.fc.properties.periods;
    if (!P || P.length < 3) return this.dayTextModel(h);
    const i0 = omIndexNow(h.time), out = [];
    const al = alertsList();
    if (al.length) { const a = al[0].properties, until = a.ends || a.expires; out.push(`There's a ${esc(a.event)} in effect${until ? ` until ${fmt(new Date(until), { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}.`); }
    const dayP = P[0].isDaytime ? P[0] : P[1], nightP = P[0].isDaytime ? P[1] : P[0];
    const dayWord = dateKey(new Date(dayP.startTime)) === dateKey(new Date()) ? "today" : "tomorrow";
    const nightWord = /overnight/i.test(nightP.name) ? "overnight" : "tonight";
    const dayKey = dateKey(new Date(dayP.startTime));
    const daySent = () => {
      let sky = nwsSky(dayP.shortForecast);
      if (/fog|low cloud|then/i.test(dayP.shortForecast) && h.cloud_cover_low) {
        const clear = this.idxFor(h, dayKey, 8, 14, i0).find(i => (h.cloud_cover_low[i] ?? 0) < 40);
        if (clear != null) sky += `, clearing around ${hourLbl(new Date(h.time[clear] * 1000))}`;
      }
      return `${cap(sky)} ${dayWord}, with a high near ${Td(dayP.temperature)}.`;
    };
    const nightSent = () => `${cap(nwsSky(nightP.shortForecast))} ${nightWord}, with a low around ${Td(nightP.temperature)}.`;
    const extras = () => {
      const pop = (dayP.probabilityOfPrecipitation && dayP.probabilityOfPrecipitation.value) || 0;
      const g = nwsGust(dayP), w = nwsWind(dayP), parts = [];
      if (pop >= 30) {
        const idx = this.idxFor(h, dayKey, 6, 20, i0); let best = null;
        idx.forEach(i => { const v = h.precipitation_probability[i] || 0; if (v >= 20 && (!best || v > best[0])) best = [v, i]; });
        parts.push(`${Math.round(pop)}% chance of ${/snow/i.test(dayP.shortForecast) ? "snow" : /shower/i.test(dayP.shortForecast) ? "showers" : "rain"}${best ? `, mainly around ${hourLbl(new Date(h.time[best[1]] * 1000))}` : ""}`);
      }
      if (g >= 35) parts.push(`${parts.length ? "and windy" : "Windy"}, with gusts up to ${W(g)}`);
      else if (g >= 25) parts.push(`${parts.length ? "and breezy" : "Breezy"}, with gusts up to ${W(g)}`);
      const wet = /rain|shower|drizzle|snow|storm|chance/i.test(dayP.shortForecast);
      if (!parts.length) return wet ? (w <= 10 ? "Light wind." : `Wind around ${W(w)}.`) : w <= 10 ? "Dry, with light wind." : `Dry, with wind around ${W(w)}.`;
      return parts.join(" ") + ".";
    };
    if (P[0].isDaytime) { out.push(daySent(), extras(), nightSent()); }
    else { out.push(nightSent(), daySent(), extras()); }
    const ti = this.stats(h, this.idxFor(h, dayKey, 9, 16, i0));
    if (ti && ti.uv >= 7) out.push(`UV gets up to ${Math.round(ti.uv)} midday.`);
    const aq = S.d.aq && S.d.aq.current && S.d.aq.current.us_aqi;
    if (aq > 100) out.push(`Air quality is ${aqiCat(aq)[1].toLowerCase()} right now (AQI ${Math.round(aq)}).`);
    return out.join(" ");
  },
  dayTextModel(h) {
    const i0 = omIndexNow(h.time), nowH = localHour(new Date());
    const today = dateKey(new Date()), tmrw = dateKey(new Date(Date.now() + 864e5));
    const out = [];
    const al = alertsList();
    if (al.length) { const a = al[0].properties, until = a.ends || a.expires; out.push(`There's a ${esc(a.event)} in effect${until ? ` until ${fmt(new Date(until), { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}.`); }
    // overnight stretch: evening through 8am tomorrow
    const nightIdx = [...this.idxFor(h, nowH < 15 ? today : today, 18, 23, i0), ...this.idxFor(h, tmrw, 0, 8, i0)];
    const night = this.stats(h, nightIdx);
    const fogNight = nightIdx.some(i => (h.cloud_cover_low[i] ?? 0) >= 60);
    if (nowH < 15) {
      const t = this.stats(h, this.idxFor(h, today, nowH, 18, i0));
      const sky = this.sky(h, today, i0);
      out.push(`${cap(sky || "mixed skies")} today${t.hi > (S.cur.t ?? -99) + 1 ? `, with a high of ${Td(t.hi)}` : `, holding near ${Td(S.cur.t)}`}.`);
      out.push(this.rainWind(t, "this afternoon"));
      if (night) out.push(`Tonight drops to ${Td(night.lo)}${fogNight ? ", with low clouds and fog moving back in" : night.cloud < 30 ? " under clear skies" : ""}.`);
    } else {
      if (night) out.push(`${night.cloud < 30 && !fogNight ? "Clear" : fogNight ? "Low clouds and fog" : night.cloud < 70 ? "Partly cloudy" : "Cloudy"} tonight, dropping to ${Td(night.lo)} by morning.`);
      const t = this.stats(h, this.idxFor(h, tmrw, 6, 20, i0));
      if (t) { out.push(`Tomorrow is ${this.sky(h, tmrw, i0) || "mixed"}, with a high of ${Td(t.hi)}.`); out.push(this.rainWind(t, "tomorrow")); if (t.uv >= 7) out.push(`UV gets up to ${Math.round(t.uv)} midday.`); }
    }
    const aq = S.d.aq && S.d.aq.current && S.d.aq.current.us_aqi;
    if (aq > 100) out.push(`Air quality is ${aqiCat(aq)[1].toLowerCase()} right now (AQI ${Math.round(aq)}).`);
    return out.join(" ");
  },
  weekText() {
    const D = S.days.slice(1, 8).filter(d => d.hi != null).map(d => d.day || d.night ? { ...d, gust: Math.max(nwsGust(d.day), nwsGust(d.night)) } : d);
    if (D.length < 3) return "The extended forecast isn't available right now.";
    const name = d => new Date(d.key + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const out = [];
    const his = D.map(d => d.hi), first = avg(his.slice(0, 3)), last = avg(his.slice(-3)), diff = last - first;
    const maxD = D.reduce((a, b) => b.hi > a.hi ? b : a), minD = D.reduce((a, b) => b.hi < a.hi ? b : a);
    if (diff >= 5) out.push(`Warming through the week, from ${Td(D[0].hi)} ${name(D[0])} up to ${Td(maxD.hi)} by ${name(maxD)}.`);
    else if (diff <= -5) out.push(`Cooling as the week goes on, with highs sliding from ${Td(D[0].hi)} ${name(D[0])} to ${Td(minD.hi)} by ${name(minD)}.`);
    else out.push(`Highs stay pretty steady, in the ${tens(avg(his))}${maxD.hi - minD.hi >= 4 ? `, warmest ${name(maxD)} at ${Td(maxD.hi)}` : ""}.`);
    // compare with normals from the History tab's station, when we have them
    const hist = store.get(`hist.${S.loc.lat.toFixed(2)},${S.loc.lon.toFixed(2)}`, null);
    const nrow = hist && hist.rows && [...hist.rows].reverse().find(r => r.nhi != null);
    if (nrow) {
      const dv = avg(his) - nrow.nhi, dd = Math.round(Math.abs(US() ? dv : dv * 5 / 9));
      const mo = new Date().toLocaleDateString("en-US", { month: "long", timeZone: S.tz }), dom = +new Date().toLocaleDateString("en-US", { day: "numeric", timeZone: S.tz });
      const when = `${dom <= 10 ? "early" : dom <= 20 ? "mid" : "late"} ${mo}`;
      out.push(Math.abs(dv) < 3 ? `That's about normal for ${when}.` : `That's ${dd}° ${dv > 0 ? "warmer" : "cooler"} than normal for ${when}, when highs usually run around ${Td(nrow.nhi)}.`);
    }
    const cold = D.reduce((a, b) => (b.lo ?? 99) < (a.lo ?? 99) ? b : a);
    if (cold.lo != null && cold.lo <= 42) out.push(`Coldest night is ${name(cold)}, down to ${Td(cold.lo)}.`);
    const wet = D.filter(d => d.pop >= 40);
    if (wet.length) {
      const top = wet.reduce((a, b) => b.pop > a.pop ? b : a), total = D.reduce((s, d) => s + (d.rain || 0), 0);
      out.push(`Rain chances ${list(wet.map(name))}${wet.length > 1 ? `, best ${name(top)}` : ""} at ${Math.round(top.pop)}%${total >= .1 ? `, adding up to around ${US() ? total.toFixed(1) + '"' : Math.round(total * 25.4) + " mm"}` : ""}.`);
    } else out.push(D.some(d => d.pop >= 20) ? "Just a slight chance of rain here and there." : "No rain in the forecast.");
    const windy = D.filter(d => d.gust >= 30);
    if (windy.length) { const w = windy.reduce((a, b) => b.gust > a.gust ? b : a); out.push(`${name(w)} looks windy, with gusts near ${W(w.gust)}.`); }
    const score = d => 100 - (d.pop || 0) * .8 - Math.abs(d.hi - 70) * 2 - Math.max(0, (d.gust || 0) - 20) * 1.5;
    const best = D.slice(0, 6).reduce((a, b) => score(b) > score(a) ? b : a);
    out.push(`Best day to get out: ${name(best)}, ${Td(best.hi)}${(best.pop || 0) < 20 ? " and dry" : ""}.`);
    return out.join(" ");
  }
};
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const tens = f => { const v = +T(f), t = Math.floor(v / 10) * 10, r = v - t; return `${r <= 3 ? "low" : r <= 6 ? "mid" : "upper"} ${t}s`; };
const list = a => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
function nwsSky(t) { return String(t || "").toLowerCase().replace(/\b(slight )?chance\b/, (m, sl) => `a ${sl || ""}chance of`).replace(/\s+/g, " "); }
function nwsGust(p) { if (!p) return 0; const m = /gusts as high as (\d+)/i.exec(p.detailedForecast || ""); return m ? +m[1] : 0; }
function nwsWind(p) { const n = String(p && p.windSpeed || "").match(/\d+/g); return n ? Math.max(...n.map(Number)) : 0; }
