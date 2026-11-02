"use strict";
/* Coast: NOAA CO-OPS tides, Open-Meteo marine (water temp, swell), and marine layer timing */
const Coast = {
  async stations() {
    const cached = store.get("tideStations", null);
    if (cached && Date.now() - cached.at < 30 * 864e5) return cached.list;
    const r = await getJSON("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions", {}, 30000);
    const list = (r.stations || []).map(s => [s.id, s.name, +s.lat, +s.lng, s.state || ""]);
    store.set("tideStations", { at: Date.now(), list });
    return list;
  },
  dist(a, b, c, d) { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); },
  async load(lat, lon) {
    const out = {};
    const tideP = (async () => {
      const list = await this.stations();
      let best = null, bd = 1e9;
      for (const s of list) { const d = this.dist(lat, lon, s[2], s[3]); if (d < bd) { bd = d; best = s; } }
      if (!best || bd > 60) return null;
      const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
      const start = new Date(Date.now() - 86400e3);
      const base = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&datum=MLLW&station=${best[0]}&begin_date=${ymd(start)}&range=96&units=english&time_zone=gmt&format=json&application=isobar_weather`;
      const [hilo, curve] = await Promise.all([getJSON(base + "&interval=hilo"), getJSON(base + "&interval=30")]);
      const parse = a => (a.predictions || []).map(p => ({ t: new Date(p.t.replace(" ", "T") + ":00Z"), v: +p.v, type: p.type }));
      return { id: best[0], name: best[1], state: best[4], km: bd, hilo: parse(hilo), curve: parse(curve) };
    })().catch(() => null);
    const marP = getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=sea_surface_temperature,wave_height,swell_wave_height,swell_wave_period,swell_wave_direction&temperature_unit=fahrenheit&length_unit=imperial&timezone=auto`).catch(() => null);
    const [tide, marine] = await Promise.all([tideP, marP]);
    out.tide = tide; out.marine = marine && marine.current && marine.current.sea_surface_temperature != null ? marine.current : null;
    return out;
  },
  render() { this.renderMarine(); this.renderTides(); },

  /* ---- marine layer ---- */
  renderMarine() {
    const el = $("#cMarine"), h = S.d.om && S.d.om.hourly;
    if (!h || !h.cloud_cover_low) { el.hidden = true; return; }
    const coastal = !!(S.d.coast && S.d.coast.tide);
    const i0 = omIndexNow(h.time), N = Math.min(h.time.length, i0 + 36);
    const at = i => new Date(h.time[i] * 1000), low = i => h.cloud_cover_low[i] ?? 0, LH = i => localHour(at(i));
    let anyLow = false; for (let i = i0; i < N; i++) if (low(i) >= 40) anyLow = true;
    const afdLine = this.afdMarine();
    if (!coastal && !afdLine) { el.hidden = true; return; } // a coastal feature: show it on the coast or when NWS forecasters mention it
    el.hidden = false;

    const today = dateKey(new Date()), nowH = localHour(new Date());
    const morningDay = nowH < 12 ? today : dateKey(new Date(Date.now() + 86400e3));
    const dayWord = morningDay === today ? "this morning" : "tomorrow morning";
    const idx = []; for (let i = i0; i < h.time.length; i++) if (dateKey(at(i)) === morningDay && LH(i) >= 5 && LH(i) <= 16) idx.push(i);
    let head, sub = "";
    const grayNow = low(i0) >= 50 && h.is_day[i0];
    const grayMorning = idx.filter(i => LH(i) <= 10).some(i => low(i) >= 50);
    let burn = null;
    for (const i of idx) { if (LH(i) < 7) continue; if (low(i) < 40 && (low(i + 1) ?? 0) < 40) { burn = at(i); break; } }
    const stillGray = idx.filter(i => LH(i) >= 13).every(i => low(i) >= 50);
    if (grayNow && morningDay === today) head = stillGray ? "Gray skies sticking around most of today" : burn ? `Gray now, sun breaking through around ${hourLbl(burn)}` : "Gray now, thinning this afternoon";
    else if (grayMorning) head = stillGray ? `Gray ${dayWord}, and it may not clear` : burn ? `Gray ${dayWord}, clearing around ${hourLbl(burn)}` : `Gray ${dayWord}`;
    else head = `No marine layer ${dayWord}`;
    // evening return
    for (let i = i0; i < N; i++) { const lh = LH(i); if (dateKey(at(i)) === today && lh >= 16 && low(i) >= 50 && i > i0) { sub = `Low clouds roll back in around ${hourLbl(at(i))}.`; break; } }
    // fog
    if (h.visibility) {
      let mv = 1e9, mi = -1; for (let i = i0; i < Math.min(N, i0 + 24); i++) if (h.visibility[i] != null && h.visibility[i] < mv) { mv = h.visibility[i]; mi = i; }
      if (mv < 1609) sub += ` Fog possible, visibility under ${US() ? "a mile" : "2 km"} around ${hourLbl(at(mi))}.`;
    }
    const strip = []; for (let i = i0; i < Math.min(h.time.length, i0 + 24); i++) {
      const p = low(i) / 100, day = h.is_day[i];
      const c = day ? mixHex("#4A8FDB", "#A7B2BE", p) : mixHex("#1B2A4A", "#4B5565", p);
      strip.push(`<i title="${hourLbl(at(i))}: ${Math.round(low(i))}% low cloud" style="background:${c}"></i>`);
    }
    const ticks = [0, 6, 12, 18, 23].map(k => i0 + k < h.time.length ? `<span>${k === 0 ? "Now" : hourLbl(at(i0 + k))}</span>` : "").join("");
    el.innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 10h18M5 14h14M8 18h8"/><path d="M7 6a5 5 0 0 1 10 0"/></svg>Marine layer<span class="src">HRRR low cloud</span></div>
      <div class="mlhead">${head}</div>${sub ? `<div class="s muted" style="font-size:14px;margin-top:4px">${sub.trim()}</div>` : ""}
      <div class="mlstrip" role="img" aria-label="Low cloud cover next 24 hours">${strip.join("")}</div>
      <div class="wticks">${ticks}</div>
      <div class="keyrow"><span><i style="background:#4A8FDB"></i>Sun</span><span><i style="background:#A7B2BE"></i>Low clouds</span><span><i style="background:#1B2A4A"></i>Night</span></div>
      ${afdLine ? `<div class="quote"><b>From the forecaster</b>${esc(afdLine)}</div>` : ""}`;
  },
  afdMarine() {
    const a = S.d.afd; if (!a || !a.text) return "";
    const t = a.text.replace(/\r/g, "").replace(/\n(?!\n)/g, " ").replace(/\s+/g, " ");
    const sents = t.split(/(?<=\.)\s+(?=[A-Z])/);
    const hits = sents.filter(s => /marine layer|low clouds and fog|stratus/i.test(s) && s.length < 400);
    if (!hits.length) return "";
    let s = hits.slice(0, 2).join(" ").replace(/^\.[A-Z /]+\.\.\.\s*/, "");
    if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\.\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return s;
  },

  /* ---- tides ---- */
  renderTides() {
    const el = $("#cTides"), c = S.d.coast, td = c && c.tide;
    if (!td || !td.curve.length) { el.hidden = true; return; }
    el.hidden = false;
    const now = Date.now(), t0 = now - 6 * 3600e3, t1 = now + 18 * 3600e3;
    const pts = td.curve.filter(p => p.t >= t0 && p.t <= t1);
    const ev = td.hilo.filter(p => p.t >= t0 && p.t <= t1);
    const hu = v => US() ? v : v * .3048, unit = US() ? "ft" : "m", fh = v => `${hu(v).toFixed(1).replace(/^-0\.0$/, "0.0")} ${unit}`;
    const W = 340, H = 140, padT = 26, padB = 22;
    const vs = pts.map(p => p.v), mn = Math.min(...vs), mx = Math.max(...vs), rg = Math.max(.5, mx - mn);
    const X = t => (t - t0) / (t1 - t0) * W, Y = v => padT + (1 - (v - mn) / rg) * (H - padT - padB);
    const path = smoothPath(pts.map(p => [+X(p.t).toFixed(1), +Y(p.v).toFixed(1)]));
    let svg = `<svg class="tidesvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tide height over the next 18 hours"><defs><linearGradient id="tdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7CC4FF" stop-opacity=".45"/><stop offset="1" stop-color="#7CC4FF" stop-opacity=".05"/></linearGradient></defs>`;
    svg += `<path d="${path} L${W},${H - padB} L0,${H - padB} Z" fill="url(#tdg)"/><path d="${path}" fill="none" stroke="#7CC4FF" stroke-width="2.2"/>`;
    const nx = X(now); svg += `<line x1="${nx}" x2="${nx}" y1="13" y2="${H - padB}" stroke="rgba(255,255,255,.55)" stroke-dasharray="3 3"/><text x="${nx}" y="9" text-anchor="middle" class="tl">Now</text>`;
    ev.forEach(e => { const x = X(e.t), y = Y(e.v); const anchor = x < 30 ? "start" : x > W - 30 ? "end" : "middle";
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff"/><text x="${x}" y="${e.type === "H" ? y - 9 : y + 16}" text-anchor="${anchor}">${tShort(e.t)}</text>`; });
    svg += `</svg>`;
    // current state
    let cur = null; for (let i = 0; i < td.curve.length - 1; i++) { const p0 = td.curve[i], p1 = td.curve[i + 1]; if (p0.t <= now && p1.t > now) { const f = (now - p0.t) / (p1.t - p0.t); cur = { v: p0.v + (p1.v - p0.v) * f, rising: p1.v > p0.v }; break; } }
    const next = td.hilo.filter(e => e.t > now).slice(0, 4);
    const nx1 = next[0];
    const head = cur && nx1 ? `${cur.rising ? "Rising" : "Falling"}, ${fh(cur.v)} now. ${nx1.type === "H" ? "High" : "Low"} tide ${fh(nx1.v)} at ${clock(nx1.t)}` : "";
    const m = c.marine;
    const sea = m ? `<div class="chipsrow"><span class="pchip">Water ${Td(m.sea_surface_temperature)}</span>${m.swell_wave_height != null ? `<span class="pchip">Swell ${US() ? m.swell_wave_height.toFixed(1) + " ft" : (m.swell_wave_height * .3048).toFixed(1) + " m"}${m.swell_wave_period ? ` at ${Math.round(m.swell_wave_period)}s` : ""}${m.swell_wave_direction != null ? " " + dirName(m.swell_wave_direction) : ""}</span>` : ""}</div>` : "";
    el.innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1"/><path d="M2 18c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" opacity=".6"/></svg>Tides<span class="src">NOAA ${esc(td.id)} ${esc(titleCase(td.name))}</span></div>
      <div class="mlhead" style="font-size:17px">${head}</div>${svg}
      <div class="tidelist">${next.map(e => `<div><b>${e.type === "H" ? "High" : "Low"} ${fh(e.v)}</b>${fmt(e.t, { weekday: "short" })} ${clock(e.t)}</div>`).join("")}</div>${sea}`;
  }
};
function mixHex(a, b, t) { const A = hexRGB(a), B = hexRGB(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
const tShort = d => clock(d).replace(/\s?([AP])M/, (m, a) => a.toLowerCase());
const titleCase = s => String(s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
