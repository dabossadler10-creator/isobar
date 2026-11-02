"use strict";
/* Ride planner: wind for each leg, conditions at the turnaround, best start times, kit */
const Ride = {
  day: 0, start: null, dur: 2.5, turn: null, turnData: null, turnKey: "", recent: [],
  init() {
    this.dur = store.get("rideDur", 2.5); this.turn = store.get("rideTurn", null); this.recent = store.get("rideRecent", []);
    $("#rDur").value = this.dur; $("#rDurV").textContent = this.dur + " h";
    $("#rDur").oninput = e => { this.dur = +e.target.value; $("#rDurV").textContent = this.dur + " h"; store.set("rideDur", this.dur); this.render(); };
    $("#rDay").onchange = e => { this.day = +e.target.value; this.start = null; this.fillTimes(); this.render(); };
    $("#rTime").onchange = e => { this.start = +e.target.value; this.render(); };
    let qT;
    $("#rTurnQ").oninput = e => {
      clearTimeout(qT); const q = e.target.value.trim(), box = $("#rTurnRes");
      if (q.length < 2) { box.hidden = true; return; }
      qT = setTimeout(async () => {
        try {
          const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
          const list = (r.results || []).sort((a, b) => Coast.dist(S.loc.lat, S.loc.lon, a.latitude, a.longitude) - Coast.dist(S.loc.lat, S.loc.lon, b.latitude, b.longitude));
          box.hidden = false;
          box.innerHTML = list.length ? list.map((x, i) => `<button class="res" data-i="${i}"><span>${esc(x.name)}<br><small>${esc([x.admin1, x.country_code].filter(Boolean).join(", "))} · ${US() ? Math.round(Coast.dist(S.loc.lat, S.loc.lon, x.latitude, x.longitude) * .621) + " mi" : Math.round(Coast.dist(S.loc.lat, S.loc.lon, x.latitude, x.longitude)) + " km"} away${x.elevation != null ? ` · ${US() ? Math.round(x.elevation * 3.281).toLocaleString() + " ft" : Math.round(x.elevation) + " m"}` : ""}</small></span></button>`).join("") : `<div class="muted" style="padding:10px">No matches.</div>`;
          box.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; this.setTurn({ name: x.name, lat: x.latitude, lon: x.longitude }); });
        } catch (err) { box.hidden = false; box.innerHTML = `<div class="muted" style="padding:10px">Search isn't responding right now.</div>`; }
      }, 280);
    };
    document.addEventListener("click", e => { if (!e.target.closest(".turn")) $("#rTurnRes").hidden = true; });
    this.chips();
  },
  setTurn(t) {
    this.turn = t; store.set("rideTurn", t);
    if (t) { this.recent = [t, ...this.recent.filter(r => r.name !== t.name)].slice(0, 5); store.set("rideRecent", this.recent); }
    $("#rTurnQ").value = ""; $("#rTurnRes").hidden = true; this.chips(); this.loadTurn();
  },
  chips() {
    const el = $("#rTurnChips");
    const items = [`<button data-k="none" ${!this.turn ? 'style="background:var(--ink);color:#0d1726"' : ""}>Loop, no turnaround</button>`].concat(this.recent.map((r, i) => `<button data-k="${i}" ${this.turn && this.turn.name === r.name ? 'style="background:var(--ink);color:#0d1726"' : ""}>${esc(r.name)}</button>`));
    el.innerHTML = items.join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => b.dataset.k === "none" ? (this.turn = null, store.set("rideTurn", null), this.chips(), this.render()) : this.setTurn(this.recent[+b.dataset.k]));
  },
  async loadTurn() {
    if (!this.turn) { this.turnData = null; this.render(); return; }
    const k = `${this.turn.lat},${this.turn.lon}`;
    if (this.turnKey === k && this.turnData && Date.now() - this.turnData._at < 30 * 60e3) { this.render(); return; }
    $("#rSummary").innerHTML = `<span class="skel" style="width:100%;height:160px"></span>`;
    try {
      const r = await getJSON(`${OM}?latitude=${this.turn.lat.toFixed(4)}&longitude=${this.turn.lon.toFixed(4)}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day,cloud_cover_low&timezone=auto&forecast_hours=96&past_hours=4&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime`);
      r._at = Date.now(); this.turnData = r; this.turnKey = k; store.set("rideTurnData", { k, r });
    } catch (e) { const c = store.get("rideTurnData", null); this.turnData = c && c.k === k ? c.r : null; this.turnKey = k; }
    this.render();
  },
  show() { if (this.turn && (!this.turnData || this.turnKey !== `${this.turn.lat},${this.turn.lon}`)) this.loadTurn(); else this.render(); },
  refresh() { if (S.view === "ride") this.show(); },
  home() { return S.d.om && S.d.om.hourly; },
  fillDays() {
    const h = this.home(); if (!h) return;
    const keys = []; h.time.forEach(t => { const k = dateKey(new Date(t * 1000)); if (!keys.includes(k)) keys.push(k); });
    const today = dateKey(new Date()); const usable = keys.filter(k => k >= today).slice(0, 3);
    this.days = usable;
    if (this.start == null) { // default start: next hour if early enough, else tomorrow 8am
      const nowH = localHour(new Date());
      this.day = nowH < 15 ? 0 : 1;
    }
    $("#rDay").innerHTML = usable.map((k, i) => `<option value="${i}" ${i === this.day ? "selected" : ""}>${i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(k + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}</option>`).join("");
    this.fillTimes();
  },
  fillTimes() {
    const h = this.home(); if (!h || !this.days) return;
    const k = this.days[this.day], now = Date.now() / 1000;
    const opts = h.time.filter(t => dateKey(new Date(t * 1000)) === k && localHour(new Date(t * 1000)) >= 4 && localHour(new Date(t * 1000)) <= 20 && t + 3600 > now);
    if (!opts.length) return;
    if (this.start == null || !opts.includes(this.start)) {
      const pref = this.day === 0 ? opts.find(t => t > now) || opts[0] : opts.find(t => localHour(new Date(t * 1000)) === 8) || opts[0];
      this.start = pref;
    }
    $("#rTime").innerHTML = opts.map(t => `<option value="${t}" ${t === this.start ? "selected" : ""}>${clock(new Date(t * 1000))}</option>`).join("");
  },
  // value of an hourly series at unix time t, linear between hours
  at(src, key, t) {
    const T = src.time; let i = 0; while (i < T.length - 2 && T[i + 1] <= t) i++;
    const a = src[key][i], b = src[key][i + 1]; if (a == null) return b; if (b == null) return a;
    const f = Math.max(0, Math.min(1, (t - T[i]) / (T[i + 1] - T[i]))); return a + (b - a) * f;
  },
  dirAt(src, t) { const s = this.at(src, "wind_speed_10m", t) || .1; const i = (() => { let j = 0; while (j < src.time.length - 1 && src.time[j + 1] <= t) j++; return j; })(); return src.wind_direction_10m[i] ?? 0; },
  bearing(a, b, c, d) { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return (Math.atan2(y, x) / r + 360) % 360; },
  compute(start, dur) {
    const h = this.home(), tr = this.turn && this.turnData && this.turnData.hourly;
    const out = [], n = Math.max(2, Math.round(dur * 2)), heading = tr ? this.bearing(S.loc.lat, S.loc.lon, this.turn.lat, this.turn.lon) : null;
    for (let j = 0; j <= n; j++) {
      const t = start + j * dur * 3600 / n, frac = j / n, p = tr ? (frac <= .5 ? frac * 2 : (1 - frac) * 2) : 0;
      const mix = k => { const a = this.at(h, k, t); if (!tr) return a; const b = this.at(tr, k, t); return a == null ? b : b == null ? a : a + (b - a) * p; };
      const dh = this.dirAt(h, t), dtn = tr ? this.dirAt(tr, t) : dh;
      const vx = (1 - p) * Math.sin(dh * Math.PI / 180) + p * Math.sin(dtn * Math.PI / 180), vy = (1 - p) * Math.cos(dh * Math.PI / 180) + p * Math.cos(dtn * Math.PI / 180);
      const wdir = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
      const leg = !tr ? "loop" : frac < .5 ? "out" : frac > .5 ? "back" : "turn";
      const hd = leg === "out" ? heading : leg === "back" ? (heading + 180) % 360 : null;
      const ws = mix("wind_speed_10m");
      let comp = null;
      if (hd != null) { let d = Math.abs(((wdir - hd) % 360 + 540) % 360 - 180); comp = { d, kind: d <= 50 ? "head" : d >= 130 ? "tail" : "cross", along: ws * Math.cos(d * Math.PI / 180) }; }
      const iDay = (() => { let i = 0; while (i < h.time.length - 1 && h.time[i + 1] <= t) i++; return h.is_day[i]; })();
      out.push({ t, p, leg, temp: mix("temperature_2m"), app: mix("apparent_temperature"), ws, gust: mix("wind_gusts_10m"), wdir, pop: mix("precipitation_probability") || 0, uv: mix("uv_index") || 0, low: mix("cloud_cover_low") || 0, day: iDay, comp, hd });
    }
    return { pts: out, heading };
  },
  score(r) {
    const P = r.pts, avg = f => P.reduce((s, x) => s + f(x), 0) / P.length;
    const minT = Math.min(...P.map(x => x.temp)), maxT = Math.max(...P.map(x => x.temp));
    let pen = Math.max(...P.map(x => x.pop)) * .55 + Math.max(0, 52 - minT) * 2.2 + Math.max(0, maxT - 82) * 2.2 + Math.max(0, avg(x => x.ws) - 9) * 2.2 + Math.max(0, Math.max(...P.map(x => x.gust)) - 22) * 1.2 + P.filter(x => !x.day).length / P.length * 70;
    const back = P.filter(x => x.leg === "back" && x.comp); if (back.length) pen += Math.max(0, back.reduce((s, x) => s + x.comp.along, 0) / back.length) * 1.2;
    return Math.max(0, Math.min(100, 100 - pen));
  },
  render() {
    if (S.view !== "ride") return;
    const h = this.home();
    if (!h) { $("#rSummary").innerHTML = `<div class="err">The forecast hasn't loaded yet. Pull down to refresh.</div>`; return; }
    if (!this.days || this.days[0] !== dateKey(new Date())) { this.start = null; this.fillDays(); } else { this.fillTimes(); }
    if (this.start == null) { $("#rSummary").innerHTML = `<div class="err">No daylight start times left in the forecast window.</div>`; return; }
    if (this.turn && this.turnKey !== `${this.turn.lat},${this.turn.lon}`) { this.loadTurn(); return; }
    const r = this.compute(this.start, this.dur), P = r.pts;
    this.renderStarts();
    const minT = Math.min(...P.map(x => x.temp)), maxT = Math.max(...P.map(x => x.temp)), minA = Math.min(...P.map(x => x.app));
    const sc = this.score(r), grade = sc >= 80 ? "Great ride" : sc >= 60 ? "Good ride" : sc >= 40 ? "Rideable" : "Rough ride";
    const end = new Date((this.start + this.dur * 3600) * 1000);
    const startD = new Date(this.start * 1000);
    const tempRange = Math.round(T(minT)) === Math.round(T(maxT)) ? Td(minT) : `${Td(minT)} to ${Td(maxT)}`;
    const legInfo = leg => { const L = P.filter(x => x.leg === leg && x.comp); if (!L.length) return null; const along = L.reduce((s, x) => s + x.comp.along, 0) / L.length, ws = L.reduce((s, x) => s + x.ws, 0) / L.length, cross = L.filter(x => x.comp.kind === "cross").length > L.length / 2; return { along, ws, kind: cross ? "cross" : along > 1.5 ? "head" : along < -1.5 ? "tail" : "calm", hd: L[0].hd, wdir: L[Math.floor(L.length / 2)].wdir }; };
    const out = legInfo("out"), back = legInfo("back");
    const windWord = l => l.kind === "head" ? `${Wn(Math.abs(l.along))} ${Wu()} headwind` : l.kind === "tail" ? `${Wn(Math.abs(l.along))} ${Wu()} tailwind` : l.kind === "cross" ? `${Wn(l.ws)} ${Wu()} crosswind` : "Little wind";
    const arrow = (hd, wdir) => `<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="rgba(255,255,255,.18)"/><g transform="rotate(${hd} 17 17)"><path d="M17 6l5 9h-10z" fill="#F6F8FB"/><line x1="17" y1="14" x2="17" y2="27" stroke="#F6F8FB" stroke-width="2"/></g><g transform="rotate(${wdir + 180} 17 17)"><path d="M17 3l3 5h-6z" fill="#FFD36B"/></g></svg>`;
    let legs = "";
    if (out && back) {
      legs = `<div class="legs">
        <div class="leg">${arrow(out.hd, out.wdir)}<div class="k">Out · heading ${dirName(out.hd)}</div><div class="v">${windWord(out)}</div><div class="d">Wind from the ${dirName(out.wdir)}</div></div>
        <div class="leg">${arrow(back.hd, back.wdir)}<div class="k">Back · heading ${dirName(back.hd)}</div><div class="v">${windWord(back)}</div><div class="d">Wind from the ${dirName(back.wdir)}</div></div>
      </div>`;
    } else {
      const mid = P[Math.floor(P.length / 2)];
      legs = `<div class="legs"><div class="leg" style="grid-column:1/-1">${arrow(mid.wdir, mid.wdir)}<div class="k">Wind</div><div class="v">${W(mid.ws)} from the ${dirName(mid.wdir)}</div><div class="d">Start heading ${dirName(mid.wdir)}, into the wind, so it pushes you home when you're tired.</div></div></div>`;
    }
    // turnaround comparison
    let turnBox = "";
    if (this.turn && this.turnData) {
      const mid = P.find(x => x.leg === "turn") || P[Math.floor(P.length / 2)];
      const homeT = this.at(h, "temperature_2m", mid.t), tt = this.at(this.turnData.hourly, "temperature_2m", mid.t);
      const eH = S.d.om.elevation, eT = this.turnData.elevation, gain = eT != null && eH != null ? eT - eH : null;
      const dT = tt - homeT, dTd = US() ? dT : dT * 5 / 9;
      const lowT = this.at(this.turnData.hourly, "cloud_cover_low", mid.t);
      turnBox = `<div class="legs"><div class="leg"><div class="k">At ${esc(this.turn.name)}</div><div class="v num">${Td(tt)} <small class="muted" style="font-size:13px">around ${hourLbl(new Date(mid.t * 1000))}</small></div><div class="d">${Math.abs(dTd) < 1.5 ? "About the same as town" : `${Math.round(Math.abs(dTd))}° ${dT < 0 ? "colder" : "warmer"} than town`}${lowT >= 60 ? ". Likely in the clouds" : ""}</div></div>
        <div class="leg"><div class="k">Distance and climb</div><div class="v num">${US() ? Math.round(Coast.dist(S.loc.lat, S.loc.lon, this.turn.lat, this.turn.lon) * .621) + " mi" : Math.round(Coast.dist(S.loc.lat, S.loc.lon, this.turn.lat, this.turn.lon)) + " km"} <small class="muted" style="font-size:13px">straight line</small></div><div class="d">${gain != null ? `${gain > 0 ? "Up" : "Down"} ${US() ? Math.round(Math.abs(gain) * 3.281).toLocaleString() + " ft" : Math.round(Math.abs(gain)) + " m"} from home` : ""}</div></div></div>`;
    }
    // daylight
    let warn = "";
    const dark = P.filter(x => !x.day);
    if (dark.length) warn = `<div class="warn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg><span>Part of this ride is in the dark${dark[0].t > this.start ? `, starting around ${clock(new Date(dark[0].t * 1000))}` : ""}. Bring front and rear lights.</span></div>`;
    const maxPop = Math.max(...P.map(x => x.pop));
    $("#rSummary").innerHTML = `<div class="label">Forecast for your ride<span class="src">${fmt(startD, { weekday: "short" })} ${clock(startD)} to ${clock(end)}</span></div>
      <div class="verdict">${grade}, ${tempRange}<small>${maxPop >= 20 ? `${Math.round(maxPop)}% chance of rain at some point. ` : "Dry. "}${minA < minT - 3 ? `Feels as cool as ${Td(minA)} at times. ` : ""}${Math.max(...P.map(x => x.gust)) < 12 ? "Light wind." : `Gusts up to ${W(Math.max(...P.map(x => x.gust)))}.`}</small></div>${legs}${turnBox}${warn}`;
    this.renderKit(r, minT, maxT, maxPop);
    this.renderTimeline(r);
  },
  renderStarts() {
    const h = this.home(), now = Date.now() / 1000, el = $("#rStarts");
    const hrs = h.time.filter(t => t + 1800 > now).slice(0, 60).filter(t => { const i = h.time.indexOf(t); return h.is_day[i] && localHour(new Date(t * 1000)) >= 5; });
    if (!hrs.length) { el.innerHTML = ""; return; }
    const sc = hrs.map(t => ({ t, s: this.score(this.compute(t, this.dur)) }));
    const best = sc.reduce((a, b) => b.s > a.s ? b : a, sc[0]);
    const col = s => s >= 80 ? "#3FBF6F" : s >= 60 ? "#9ACD5A" : s >= 40 ? "#E8C547" : s >= 20 ? "#F5A524" : "#E5484D";
    const bd = new Date(best.t * 1000), sameDay = dateKey(bd) === dateKey(new Date());
    el.innerHTML = `<div class="label">Best time to start<span class="src">${this.dur} h ride${this.turn ? " · " + esc(this.turn.name) : ""}</span></div>
      <div class="mlhead" style="font-size:18px">${sameDay ? "Today" : fmt(bd, { weekday: "long" })} at ${clock(bd)}</div>
      <div class="s muted" style="font-size:13px;margin-top:2px">Daylight start times only. Scored on rain, temperature, wind, gusts, the wind on your way home, and riding after dark. Tap a bar to plan it.</div>
      <div class="starts">${sc.map(x => `<button aria-pressed="${x.t === this.start}" aria-label="${fmt(new Date(x.t * 1000), { weekday: "short" })} ${clock(new Date(x.t * 1000))}: score ${Math.round(x.s)}" data-t="${x.t}" style="height:${Math.max(6, x.s)}%;background:${col(x.s)}"></button>`).join("")}</div>
      <div class="startticks">${[0, Math.floor(sc.length / 2), sc.length - 1].map(i => `<span>${fmt(new Date(sc[i].t * 1000), { weekday: "short" })} ${hourLbl(new Date(sc[i].t * 1000))}</span>`).join("")}</div>`;
    el.querySelectorAll(".starts button").forEach(b => b.onclick = () => {
      const t = +b.dataset.t, k = dateKey(new Date(t * 1000)), di = this.days.indexOf(k);
      if (di >= 0) { this.day = di; $("#rDay").value = di; }
      this.start = t; this.fillTimes(); this.render();
    });
  },
  renderKit(r, minT, maxT, maxPop) {
    const P = r.pts, el = $("#rKit"); el.hidden = false;
    const t = Math.round(minT), lines = [];
    const base = t >= 72 ? "Jersey and bibs." : t >= 64 ? "Jersey and bibs. Arm warmers if you're starting early or descending." : t >= 56 ? "Arm warmers and a vest. A light base layer if it's gray." : t >= 48 ? "Long-sleeve jersey or arm and knee warmers, a vest, and light full-finger gloves." : t >= 40 ? "Thermal jacket, tights, full-finger gloves and shoe covers." : "Full winter kit: thermal jacket, tights, heavy gloves, shoe covers and a cap under the helmet.";
    lines.push(`<div><b>Clothing.</b> ${base}${maxT - minT >= 10 ? ` It swings ${Math.round(US() ? maxT - minT : (maxT - minT) * 5 / 9)}° over the ride, so pick layers you can pocket.` : ""}</div>`);
    if (this.turn && this.turnData) {
      const gain = (this.turnData.elevation ?? 0) - (S.d.om.elevation ?? 0);
      if (gain > 450) lines.push(`<div><b>Descent.</b> You'll come down about ${US() ? Math.round(gain * 3.281).toLocaleString() + " ft" : Math.round(gain) + " m"} at speed. A wind vest or packable shell makes it a lot more pleasant.</div>`);
    }
    if (maxPop >= 40) lines.push(`<div><b>Rain.</b> ${Math.round(maxPop)}% chance. Bring a rain shell, and expect wet descents.</div>`);
    const maxUV = Math.max(...P.map(x => x.uv)); if (maxUV >= 6) lines.push(`<div><b>Sun.</b> UV reaches ${Math.round(maxUV)}. Sunscreen before you leave and a top-up halfway.</div>`);
    if (maxT >= 80) lines.push(`<div><b>Heat.</b> Up to ${Td(maxT)}. Two bottles with electrolytes, and plan a refill if you're out past two hours.</div>`);
    const g = Math.max(...P.map(x => x.gust)); if (g >= 25) lines.push(`<div><b>Gusts.</b> Up to ${W(g)}. Deep-section wheels will be a handful on exposed roads.</div>`);
    el.innerHTML = `<div class="label">What to bring</div><div class="kit">${lines.join("")}</div>`;
  },
  renderTimeline(r) {
    const el = $("#rTimeline"); el.hidden = false;
    const where = x => x.leg === "loop" ? "" : x.p < .05 ? "Home" : x.p > .95 ? "Turnaround" : `${x.leg === "out" ? "Out" : "Back"}, ${Math.round(x.p * 100)}%`;
    const tag = x => !x.comp ? `${Wn(x.ws)} ${dirName(x.wdir)}` : `<span class="wtag ${x.comp.kind}">${x.comp.kind === "head" ? "Head" : x.comp.kind === "tail" ? "Tail" : "Cross"} ${Wn(x.ws)}</span>`;
    el.innerHTML = `<div class="label">Along the way<span class="src">every 30 min</span></div><div class="tablewrap"><table class="rtl num"><thead><tr><th>Time</th>${this.turn ? "<th>Where</th>" : ""}<th>Temp</th><th>Wind ${Wu()}</th><th>Gust</th><th>Rain</th></tr></thead><tbody>${r.pts.map(x => `<tr${x.day ? "" : ' style="opacity:.6"'}><td>${clock(new Date(x.t * 1000))}</td>${this.turn ? `<td>${where(x)}</td>` : ""}<td>${Td(x.temp)}</td><td>${tag(x)}</td><td>${Wn(x.gust)}</td><td>${Math.round(x.pop)}%</td></tr>`).join("")}</tbody></table></div>`;
  }
};
