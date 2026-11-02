"use strict";
/* History: NOAA station data via ACIS (daily highs, lows, rain, 1991-2020 normals, records). Open-Meteo ERA5 as fallback. */
const History = {
  days: 30, data: null, key: "", loading: false,
  init() {
    try { this.days = store.get("hDays", 30); } catch (e) {}
    document.querySelectorAll("#hRange .chip").forEach(b => {
      b.setAttribute("aria-pressed", +b.dataset.days === this.days);
      b.onclick = () => { this.days = +b.dataset.days; store.set("hDays", this.days); document.querySelectorAll("#hRange .chip").forEach(x => x.setAttribute("aria-pressed", x === b)); this.render(); };
    });
  },
  locKey() { return `${S.loc.lat.toFixed(2)},${S.loc.lon.toFixed(2)}`; },
  show() {
    const k = this.locKey();
    if (!this.data || this.key !== k) { const c = store.get("hist." + k, null); if (c) { this.data = c; this.key = k; } }
    this.render();
    if (!this.data || this.key !== k || Date.now() - this.data.at > 3 * 3600e3) this.load();
  },
  onData() { if (S.view === "history") this.show(); else if (this.data && this.key !== this.locKey()) this.data = null; },
  async acis(path, body) { return getJSON("https://data.rcc-acis.org/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 25000); },
  async load() {
    if (this.loading) return; this.loading = true;
    const k = this.locKey(), { lat, lon } = S.loc;
    const iso = d => d.toISOString().slice(0, 10), today = new Date(), start = new Date(Date.now() - 400 * 864e5);
    try {
      let res = null;
      try { res = await this.loadACIS(lat, lon, iso(start), iso(today)); } catch (e) { res = null; }
      if (!res) res = await this.loadArchive(lat, lon, iso(start), iso(new Date(Date.now() - 2 * 864e5)));
      if (k !== this.locKey()) return;
      res.at = Date.now(); this.data = res; this.key = k; store.set("hist." + k, res);
    } catch (e) {
      if (!this.data) $("#hStats").innerHTML = `<div class="err">Couldn't load past weather right now. It will try again next time you open this tab.</div>`;
    } finally { this.loading = false; this.render(); safe(() => Outlook.render()); }
  },
  async loadACIS(lat, lon, sdate, edate) {
    const recent = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const meta = await this.acis("StnMeta", { bbox: [lon - .45, lat - .35, lon + .45, lat + .35], elems: "maxt,mint,pcpn", sdate: recent, edate, meta: "name,uid,ll,valid_daterange,sids" });
    const fresh = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
    const cands = (meta.meta || []).filter(m => m.valid_daterange && m.valid_daterange.every(r => r.length && r[1] >= fresh)).map(m => {
      const km = Coast.dist(lat, lon, m.ll[1], m.ll[0]), since = m.valid_daterange[0][0];
      const icao = (m.sids || []).some(s => / 5$/.test(s));
      return { m, km, since, score: km - (since < "1991-01-01" ? 12 : 0) - (icao ? 4 : 0) };
    }).sort((a, b) => a.score - b.score);
    let pick = null;
    for (const c of cands.slice(0, 3)) {
      const r = await this.acis("StnData", { uid: c.m.uid, sdate, edate, elems: [{ name: "maxt" }, { name: "mint" }, { name: "pcpn" }, { name: "maxt", normal: "1" }, { name: "mint", normal: "1" }, { name: "pcpn", normal: "1" }] });
      if (!r.data) continue;
      const rows = r.data.map(d => ({ d: d[0], hi: acisNum(d[1]), lo: acisNum(d[2]), p: acisNum(d[3]), nhi: acisNum(d[4]), nlo: acisNum(d[5]), np: acisNum(d[6]) }));
      if (rows.filter(x => x.hi != null).length < 20) continue;
      const cur = { c, r, rows };
      if (rows.some(x => x.nhi != null)) { pick = cur; break; }
      if (!pick) pick = cur;
    }
    if (!pick) return null;
    const { c, r, rows } = pick;
    let rec = null;
    try {
      const md = rows[rows.length - 1].d.slice(5);
      const rr = await this.acis("StnData", { uid: c.m.uid, sdate: "por", edate: "por", elems: [
        { name: "maxt", interval: "dly", duration: "dly", smry: { reduce: "max", add: "date" }, smry_only: 1, groupby: ["year", md, md] },
        { name: "mint", interval: "dly", duration: "dly", smry: { reduce: "min", add: "date" }, smry_only: 1, groupby: ["year", md, md] }] });
      const s = rr.smry; rec = { hi: acisNum(s[0][0][0]), hiY: (s[0][0][1] || "").slice(0, 4), lo: acisNum(s[1][0][0]), loY: (s[1][0][1] || "").slice(0, 4) };
    } catch (e) {}
    return { src: "acis", name: titleCase(r.meta.name), since: c.since.slice(0, 4), km: c.km, rows, rec };
  },
  async loadArchive(lat, lon, sdate, edate) {
    const r = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=${sdate}&end_date=${edate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`, {}, 25000);
    const dl = r.daily;
    return { src: "era5", name: "Model reanalysis", rows: dl.time.map((d, i) => ({ d, hi: dl.temperature_2m_max[i], lo: dl.temperature_2m_min[i], p: dl.precipitation_sum[i], nhi: null, nlo: null, np: null })), rec: null };
  },

  render() {
    if (S.view !== "history") return;
    const D = this.data;
    if (!D) return;
    $("#hStation").textContent = D.src === "acis"
      ? `${D.name}, ${US() ? Math.round(D.km * .621) + " mi" : Math.round(D.km) + " km"} away. NOAA records here go back to ${D.since}. Normals are the 1991 to 2020 averages for each date.`
      : "No NOAA station with recent data nearby, so this uses model reanalysis (ERA5). It runs about two days behind and has no normals.";
    let rows = D.rows.slice();
    while (rows.length && rows[rows.length - 1].hi == null) rows.pop();
    const all = rows;
    rows = rows.slice(-this.days);
    if (!rows.length) return;
    const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const sum = a => a.filter(x => x != null).reduce((s, x) => s + x, 0);
    const hasN = rows.some(r => r.nhi != null);
    const aH = avg(rows.map(r => r.hi)), aL = avg(rows.map(r => r.lo)), nH = avg(rows.map(r => r.nhi)), nL = avg(rows.map(r => r.nlo));
    const pS = sum(rows.map(r => r.p)), pN = sum(rows.map(r => r.np));
    const rainDays = rows.filter(r => r.p >= .01).length;
    const wyStart = (() => { const last = all[all.length - 1].d; const y = +last.slice(0, 4), m = +last.slice(5, 7); return `${m >= 10 ? y : y - 1}-10-01`; })();
    const wy = all.filter(r => r.d >= wyStart), wyS = sum(wy.map(r => r.p)), wyN = sum(wy.map(r => r.np));
    const warm = rows.reduce((a, r) => r.hi != null && (!a || r.hi > a.hi) ? r : a, null), cold = rows.reduce((a, r) => r.lo != null && (!a || r.lo < a.lo) ? r : a, null);
    const dlbl = s => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const diff = (a, n) => { if (a == null || n == null) return ""; const d = US() ? a - n : (a - n) * 5 / 9; const r = Math.round(d * 10) / 10; return `<span class="${r > 0 ? "up" : r < 0 ? "down" : ""}">${r > 0 ? "+" : ""}${r.toFixed(1)}°</span> vs normal`; };
    const rin = v => US() ? `${v.toFixed(2)}"` : `${Math.round(v * 25.4)} mm`;
    const pct = (a, n) => n > .005 ? `${Math.round(a / n * 100)}% of normal (${rin(n)})` : n != null && hasN ? "Normally dry this time of year" : "";
    const last = all[all.length - 1], rec = D.rec;
    const rangeName = { 7: "7 days", 30: "30 days", 90: "90 days", 365: "year" }[this.days] || this.days + " days";
    $("#hStats").innerHTML = `<div class="label">Last ${rangeName}<span class="src">${dlbl(rows[0].d)} to ${dlbl(rows[rows.length - 1].d)}</span></div><div class="stats">
      <div class="stat"><div class="k">Average high</div><div class="v num">${Td(aH)}</div><div class="d">${hasN ? diff(aH, nH) : "&nbsp;"}</div></div>
      <div class="stat"><div class="k">Average low</div><div class="v num">${Td(aL)}</div><div class="d">${hasN ? diff(aL, nL) : "&nbsp;"}</div></div>
      <div class="stat"><div class="k">Rain</div><div class="v num">${rin(pS)}</div><div class="d">${hasN ? pct(pS, pN) : `${rainDays} day${rainDays === 1 ? "" : "s"} with rain`}</div></div>
      <div class="stat"><div class="k">Rain since Oct 1</div><div class="v num">${rin(wyS)}</div><div class="d">${hasN && wyN > 0 ? `${Math.round(wyS / wyN * 100)}% of normal for the season so far` : "Water year to date"}</div></div>
      <div class="stat"><div class="k">Extremes</div><div class="v num" style="font-size:20px"><span class="up">${Td(warm && warm.hi)}</span> / <span class="down">${Td(cold && cold.lo)}</span></div><div class="d">Warmest ${warm ? dlbl(warm.d) : "--"}, coldest ${cold ? dlbl(cold.d) : "--"}</div></div>
      <div class="stat"><div class="k">On ${dlbl(last.d)}</div><div class="v num" style="font-size:20px">${last.nhi != null ? `${Td(last.nhi)} / ${Td(last.nlo)}` : `${Td(last.hi)} / ${Td(last.lo)}`}</div><div class="d">${last.nhi != null ? "Normal high and low." : "High and low."}${rec && rec.hi != null ? ` Records ${Td(rec.hi)} in ${rec.hiY}, ${Td(rec.lo)} in ${rec.loY}.` : ""}</div></div>
    </div>`;
    this.tempChart(rows, hasN);
    this.rainChart(rows, hasN);
    this.table(rows, hasN);
  },
  axisDates(rows, X) {
    const n = rows.length, k = Math.min(5, n), out = [];
    for (let j = 0; j < k; j++) { const i = Math.round(j * (n - 1) / Math.max(1, k - 1)); const d = new Date(rows[i].d + "T12:00:00Z"); out.push(`<text x="${X(i)}" y="196" text-anchor="${j === 0 ? "start" : j === k - 1 ? "end" : "middle"}">${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</text>`); }
    return out.join("");
  },
  tempChart(rows, hasN) {
    const W = 600, H = 200, L = 30, R = 6, top = 8, bot = 180, n = rows.length;
    const vals = rows.flatMap(r => [r.hi, r.lo, r.nhi, r.nlo]).filter(v => v != null).map(v => +T(v));
    let mn = Math.floor(Math.min(...vals) / 10) * 10, mx = Math.ceil(Math.max(...vals) / 10) * 10; if (mx - mn < 20) mx = mn + 20;
    const X = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), Y = v => bot - (v - mn) / (mx - mn) * (bot - top);
    const bw = Math.max(1.2, Math.min(14, (W - L - R) / n * .62));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily highs and lows">`;
    for (let v = mn; v <= mx; v += 10) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}°</text>`;
    if (hasN) {
      const up = rows.map((r, i) => r.nhi != null ? `${X(i)},${Y(+T(r.nhi))}` : null).filter(Boolean), dn = rows.map((r, i) => r.nlo != null ? `${X(i)},${Y(+T(r.nlo))}` : null).filter(Boolean).reverse();
      s += `<polygon points="${up.concat(dn).join(" ")}" fill="rgba(255,255,255,.10)"/>`;
      s += `<polyline points="${up.join(" ")}" fill="none" stroke="rgba(255,255,255,.4)" stroke-dasharray="3 3"/><polyline points="${dn.join(" ")}" fill="none" stroke="rgba(255,255,255,.4)" stroke-dasharray="3 3"/>`;
    }
    rows.forEach((r, i) => { if (r.hi == null || r.lo == null) return; const y1 = Y(+T(r.hi)), y2 = Y(+T(r.lo)); s += `<rect x="${X(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(1.5, y2 - y1)}" rx="${Math.min(3, bw / 2)}" fill="${tempColor((r.hi + r.lo) / 2)}"><title>${r.d}: ${Td(r.hi)} / ${Td(r.lo)}</title></rect>`; });
    s += this.axisDates(rows, X) + `</svg>`;
    $("#hTempCard").innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>Highs and lows<span class="src">°${US() ? "F" : "C"}</span></div>${s}<div class="keyrow"><span><i style="background:linear-gradient(90deg,#5CC1E8,#E8D46A,#F2994A)"></i>Each bar spans that day's low to high</span>${hasN ? `<span><i style="background:rgba(255,255,255,.2);border:1px dashed rgba(255,255,255,.5)"></i>Normal range</span>` : ""}</div>`;
  },
  rainChart(rows, hasN) {
    const W = 600, H = 200, L = 34, R = 6, top = 8, bot = 180, n = rows.length;
    const cv = US() ? 1 : 25.4;
    let ca = 0, cn = 0; const cum = rows.map(r => { ca += r.p || 0; cn += r.np || 0; return [ca * cv, cn * cv]; });
    const mx = Math.max(US() ? .5 : 10, ...cum.map(c => Math.max(c[0], hasN ? c[1] : 0))) * 1.1;
    const dmx = Math.max(...rows.map(r => (r.p || 0) * cv), US() ? .25 : 6);
    const X = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), Y = v => bot - v / mx * (bot - top);
    const bw = Math.max(1.2, Math.min(12, (W - L - R) / n * .6));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rainfall, daily and accumulated">`;
    const step = niceStep(mx); for (let v = 0; v <= mx; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${US() ? v.toFixed(step < .1 ? 2 : 1) : Math.round(v)}</text>`;
    rows.forEach((r, i) => { const v = (r.p || 0) * cv; if (v <= 0) return; const h = Math.max(2, v / dmx * (bot - top) * .38); s += `<rect x="${X(i) - bw / 2}" y="${bot - h}" width="${bw}" height="${h}" rx="1.5" fill="#7CC4FF" opacity=".55"><title>${r.d}: ${US() ? (r.p < .01 ? "Trace" : r.p.toFixed(2) + '"') : (r.p * 25.4).toFixed(1) + " mm"}</title></rect>`; });
    if (hasN) s += `<polyline points="${cum.map((c, i) => `${X(i)},${Y(c[1])}`).join(" ")}" fill="none" stroke="rgba(255,255,255,.5)" stroke-dasharray="4 4" stroke-width="1.5"/>`;
    const line = cum.map((c, i) => `${X(i)},${Y(c[0])}`).join(" ");
    s += `<polygon points="${X(0)},${bot} ${line} ${X(n - 1)},${bot}" fill="rgba(124,196,255,.14)"/><polyline points="${line}" fill="none" stroke="#7CC4FF" stroke-width="2.4" stroke-linejoin="round"/><circle cx="${X(n - 1)}" cy="${Y(cum[n - 1][0])}" r="3.5" fill="#7CC4FF"/>`;
    s += this.axisDates(rows, X) + `</svg>`;
    $("#hRainCard").innerHTML = `<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c3 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 3-6.5 6-11z"/></svg>Rainfall<span class="src">${US() ? "inches" : "mm"}</span></div>${s}<div class="keyrow"><span><i style="background:#7CC4FF"></i>Total so far</span>${hasN ? `<span><i style="border-top:2px dashed rgba(255,255,255,.6);height:0"></i>Normal total</span>` : ""}<span><i style="background:rgba(124,196,255,.55)"></i>Daily rain</span></div>`;
  },
  table(rows, hasN) {
    const rin = v => v == null ? "--" : v < .01 && v > 0 ? "Trace" : US() ? `${v.toFixed(2)}"` : `${(v * 25.4).toFixed(1)} mm`;
    const nm = v => hasN && v != null ? ` <span class="nrm">${Td(v)}</span>` : "";
    let html;
    if (rows.length <= 31) {
      html = `<div class="label">Daily<span class="src">${hasN ? "normal in gray" : ""}</span></div><div class="tablewrap"><table class="daily num"><thead><tr><th>Date</th><th>High</th><th>Low</th><th>Rain</th></tr></thead><tbody>` +
        rows.slice().reverse().map(r => `<tr><td>${new Date(r.d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</td><td>${Td(r.hi)}${nm(r.nhi)}</td><td>${Td(r.lo)}${nm(r.nlo)}</td><td>${rin(r.p)}</td></tr>`).join("") + `</tbody></table></div>`;
    } else {
      const months = {}; rows.forEach(r => { const k = r.d.slice(0, 7); (months[k] ||= []).push(r); });
      const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const sum = a => a.filter(x => x != null).reduce((s, x) => s + x, 0);
      html = `<div class="label">By month<span class="src">${hasN ? "normal in gray" : ""}</span></div><div class="tablewrap"><table class="daily num"><thead><tr><th>Month</th><th>Avg high</th><th>Avg low</th><th>Rain</th></tr></thead><tbody>` +
        Object.keys(months).reverse().map(k => { const m = months[k]; const part = m.length < 25 ? ` <span class="nrm">(${m.length} days)</span>` : "";
          return `<tr><td>${new Date(k + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}${part}</td><td>${Td(avg(m.map(r => r.hi)))}${nm(avg(m.map(r => r.nhi)))}</td><td>${Td(avg(m.map(r => r.lo)))}${nm(avg(m.map(r => r.nlo)))}</td><td>${rin(sum(m.map(r => r.p)))}${hasN ? ` <span class="nrm">${rin(sum(m.map(r => r.np)))}</span>` : ""}</td></tr>`; }).join("") + `</tbody></table></div>`;
    }
    $("#hTable").innerHTML = html;
  }
};
function niceStep(mx) { const raw = mx / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
function acisNum(v) { return v === "M" || v == null || v === "" ? null : v === "T" ? .001 : parseFloat(v); }
