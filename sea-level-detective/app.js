// Sea Level Detective: page logic. Statistics live in stats.js (tested against the Python pipeline).
import { fitWindow, yearsToDetect } from "./stats.js?v=20261115f";
import { renderWorld } from "./globe.js?v=20261115f";
import { COAST, coastConfig, setCoast, speakCoast, coastSwitch } from "./coast.js?v=20261115f";

const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (x, d = 1) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
let DATA = null;

// One animator for the moving charts: each chart steps on its own when it is on screen, a master button starts and
// stops them all, and touching a chart pauses just that chart for 15 s. Off by default under "reduce motion".
const Anim = window.SLDAnim = {
  on: !matchMedia("(prefers-reduced-motion: reduce)").matches, items: [],
  io: new IntersectionObserver(es => { for (const e of es) { const it = Anim.items.find(i => i.el === e.target); if (it) it.visible = e.isIntersecting; } Anim.sync(); }, { threshold: 0.35 }),
  register(el, step, ms, when = () => true) {
    if (!el) return;
    const it = { el, step, ms, when, timer: null, visible: false, hold: 0 };
    this.items.push(it); this.io.observe(el);
    const card = el.closest("figure, .winter-sheet") || el;
    for (const ev of ["pointerdown", "input", "wheel"]) card.addEventListener(ev, e => { if (e.isTrusted) it.hold = performance.now() + 15000; }, { passive: true });
    this.sync();
  },
  sync() {
    for (const it of this.items) {
      const go = this.on && it.visible;
      if (go && !it.timer) it.timer = setInterval(() => { if (performance.now() > it.hold && it.when()) it.step(); }, it.ms);
      if (!go && it.timer) { clearInterval(it.timer); it.timer = null; }
    }
    const b = document.getElementById("anim-master");
    if (b) { b.setAttribute("aria-pressed", String(this.on)); b.textContent = this.on ? "❚❚ Pause the moving charts" : "▶ Make the charts move"; }
  },
  toggle() { this.on = !this.on; this.sync(); },
};

const waitForPlotly = () => new Promise(res => {
  if (window.Plotly) return res();
  const t = setInterval(() => { if (window.Plotly) { clearInterval(t); res(); } }, 30);
});

function years(region) {
  const s = DATA.regions[region];
  const valid = s.dates.filter((d, i) => s.values[i] !== null);
  return [Number(valid[0].slice(0, 4)), Number(valid[valid.length - 1].slice(0, 4))];
}

function fillYears(keepSelection = false) {
  const [first, last] = years($("region").value);
  const prev = [Number($("start").value), Number($("end").value)];
  for (const id of ["start", "end"]) {
    $(id).innerHTML = "";
    for (let y = first; y <= last; y++) $(id).add(new Option(String(y), String(y)));
  }
  const defStart = Math.max(first, 1993);
  $("start").value = keepSelection && prev[0] >= first && prev[0] <= last ? prev[0] : defStart;
  $("end").value = keepSelection && prev[1] >= first && prev[1] <= last ? prev[1] : last;
}

function currentIndex() {
  const key = $("index-choice").value || "noaa_oni";
  return { key, ...DATA.indices[key] };
}

function layoutBase() {
  return {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",   // charts drawn straight onto the paper slip
    font: { family: "IM Fell English, Georgia, serif", color: css("--text-secondary"), size: 14 },
    margin: { l: 56, r: 16, t: 12, b: 40 },
    xaxis: { gridcolor: css("--grid"), linecolor: css("--axis"), zeroline: false, tickfont: { color: css("--muted") } },
    yaxis: { gridcolor: css("--grid"), linecolor: css("--axis"), zerolinecolor: css("--axis"),
             tickfont: { color: css("--muted") }, ticksuffix: " mm" },
    hovermode: "x unified",
    hoverlabel: { bgcolor: css("--surface-1"), bordercolor: css("--axis"), font: { family: "IM Fell English, Georgia, serif", color: css("--text-primary") } },
    legend: { orientation: "h", y: 1.08, x: 0, font: { color: css("--text-secondary") } },
  };
}

function update() {
  const region = $("region").value, s = DATA.regions[region];
  let start = $("start").value, end = $("end").value;
  if (Number(start) > Number(end)) [start, end] = [end, start];
  const removeEnso = $("enso").checked && Object.keys(DATA.indices).length > 0;
  const index = removeEnso ? currentIndex() : null;
  const fit = fitWindow(s, `${start}-01`, `${end}-12`, index);
  if (!fit) {
    $("t-trend").textContent = "–"; $("t-verdict").textContent = "Pick a longer span";
    $("t-p").textContent = "The detective needs 3 years or more"; Plotly.purge("chart"); return;
  }
  const sig = fit.ci[0] > 0 || fit.ci[1] < 0;
  $("t-trend").textContent = `${fmt(fit.trend)} mm/yr`;
  $("t-ci").textContent = `likely ${fit.ci[0].toFixed(1)} to ${fit.ci[1].toFixed(1)}`;
  const v = $("t-verdict");
  v.className = "tile-value verdict" + (sig ? " yes" : "");
  const word = fit.trend > 0 ? "Rising" : "Falling";
  v.innerHTML = sig ? `<span class="icon" aria-hidden="true">✔</span>${word}, and it stands out`
                    : `<span class="icon" aria-hidden="true">≈</span>No clear trend`;
  $("t-p").textContent = `${fit.start.slice(0, 4)}–${fit.end.slice(0, 4)}`;
  if (removeEnso) {
    const unit = index.key === "noaa_oni" ? "mm per °C" : "mm per index unit";
    $("t-enso").textContent = `${fmt(fit.indexCoef)} ${unit}`;
    $("t-enso-sub").textContent = `likely ${fit.indexCI[0].toFixed(1)} to ${fit.indexCI[1].toFixed(1)}`;
  } else {
    $("t-enso").textContent = "–"; $("t-enso-sub").textContent = "tick “Remove El Niño”";
  }
  const need = yearsToDetect(fit.resSD, fit.rho, Math.max(Math.abs(fit.trend), 0.5));
  $("t-years").textContent = Number.isFinite(need) ? `≈ ${Math.round(need)} years` : "–";
  $("t-years-sub").textContent = `for this rise to stand out`;

  const s1 = css("--series-1"), s2 = css("--series-2"), ink = css("--text-secondary");
  const x = fit.dates.map(d => `${d}-15`);
  const traces = [{
    x, y: fit.deseason, type: "scatter", mode: "lines", name: "Monthly sea level",
    line: { color: s1, width: removeEnso ? 1 : 1.6 }, opacity: removeEnso ? 0.55 : 1,
    hovertemplate: "%{y:.0f} mm<extra>measured</extra>",
  }];
  if (removeEnso) {
    traces.push({ x, y: fit.removedDeseason, type: "scatter", mode: "lines", name: "El Niño removed",
      line: { color: s2, width: 1.8 }, hovertemplate: "%{y:.0f} mm<extra>El Niño removed</extra>" });
  }
  traces.push({ x, y: fit.trendLine, type: "scatter", mode: "lines", name: `Trend ${fmt(fit.trend)} mm/yr`,
    line: { color: ink, width: 2, dash: "dash" }, hoverinfo: "skip" });
  const layout = layoutBase();
  layout.annotations = [{
    x: x[x.length - 1], y: fit.trendLine[fit.trendLine.length - 1], xanchor: "right", yanchor: "bottom", yshift: 6,
    text: `trend ${fmt(fit.trend)} mm/yr`, showarrow: false, font: { color: css("--text-primary"), size: 12 },
    bgcolor: css("--surface-1"), borderpad: 2,
  }];
  layout.dragmode = "zoom"; layout.yaxis.fixedrange = true;   // dragging across the chart picks a span of years (see bindSpan)
  if (fixedX) { layout.xaxis.range = fixedX; layout.xaxis.autorange = false; }   // while the record grows on its own, keep the axis still
  Plotly.react("chart", traces, layout, { displayModeBar: false, responsive: true, doubleClick: false });
  $("chart-caption").textContent = `${s.label} · ${s.source} · mm, yearly cycle removed` + (removeEnso ? " · red: El Niño removed" : "");
  renderTable(fit, removeEnso);
}

// The sea-level chart picks its own window: drag across it, double-click for every year, or a quick-span button.
let fixedX = null;
function setSpan(a, b, keepAxis = false) {
  if (!keepAxis) fixedX = null;
  const [first, last] = years($("region").value);
  $("start").value = String(Math.max(first, Math.min(last, a))); $("end").value = String(Math.max(first, Math.min(last, b)));
  update();
}
function bindSpan() {
  const gd = $("chart");
  gd.on("plotly_relayout", ev => {
    const a = ev["xaxis.range[0]"], b = ev["xaxis.range[1]"];
    if (a && b) setSpan(Number(String(a).slice(0, 4)), Number(String(b).slice(0, 4)));
  });
  gd.on("plotly_doubleclick", () => { const [first, last] = years($("region").value); setSpan(first, last); });
  $("span-ctrl").addEventListener("click", e => {
    const b = e.target.closest("button[data-span]"); if (!b) return;
    const [first, last] = years($("region").value);
    setSpan(b.dataset.span === "all" ? first : last - Number(b.dataset.span) + 1, last);
  });
}

function renderTable(fit, removeEnso) {
  const rows = fit.dates.map((d, i) => `<tr><td>${d}</td><td>${fit.values[i].toFixed(0)}</td>` +
    (removeEnso ? `<td>${fit.removed[i].toFixed(0)}</td>` : "") + "</tr>").join("");
  $("table").innerHTML = `<div class="table-scroll"><table><thead><tr><th>Month</th><th>Sea level (mm)</th>` +
    (removeEnso ? "<th>El Niño removed (mm)</th>" : "") + `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderE1() {
  const order = [["naive_ols", "Straight<br>line"], ["plain_mk", "Mann–<br>Kendall"], ["seasonal_kendall", "Seasonal<br>Kendall"],
                 ["hamed_rao_mk", "Hamed–<br>Rao"], ["ar1_ols", "Memory-aware<br>(ours)"]];   // short, two-line names fit the narrow panel
  // two sliders: how long the record is, and how big a real rise is hidden in it (0 = none: then every "trend!" is a false alarm)
  const WIN = [10, 15, 20, 25, 30, 35], W = WIN[Number($("e1-years").value)], T = Number($("e1-trend").value);
  $("e1-years-l").textContent = `${W} years`; $("e1-trend-l").textContent = T ? `${T} mm a year` : "none";
  const rows = DATA.e1.settings.filter(r => r.window_years === W && r.true_trend_mm_yr === T);
  const pick = order.map(([m, label]) => ({ label, r: rows.find(r => r.method === m) })).filter(o => o.r);
  const layout = layoutBase();
  layout.yaxis.ticksuffix = "%"; layout.yaxis.range = T ? [0, 105] : [0, 50]; layout.hovermode = "closest";
  layout.margin.l = 48; layout.margin.b = 46; layout.xaxis.tickangle = 0; layout.xaxis.tickfont = { size: 11 }; layout.showlegend = false; layout.transition = { duration: 850, easing: "cubic-in-out" };
  layout.yaxis.title = { text: T ? "finds the real rise" : "false alarms", font: { size: 12 } };
  layout.shapes = T ? [] : [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 5, y1: 5, line: { color: css("--text-secondary"), dash: "dot", width: 1.5 } }];
  layout.annotations = T ? [] : [{ xref: "paper", x: 0, y: 5, yanchor: "bottom", xanchor: "left", showarrow: false, yshift: 2,
    text: "fair: 5 in 100", font: { color: css("--text-secondary"), size: 12 } }];
  const used = css("--series-1"), other = css("--axis");
  Plotly.react("e1chart", [{
    type: "bar", x: pick.map(o => o.label), y: pick.map(o => 100 * o.r.estimate),
    marker: { color: pick.map(o => o.label.includes("ours") ? css("--series-2") : "rgba(0,0,0,0)"),   // the test we use in red chalk; the rest pen-hatched
      line: { color: pick.map(o => o.label.includes("ours") ? css("--series-2") : css("--text-secondary")), width: 1.2 },
      pattern: { shape: "/", fgcolor: pick.map(o => o.label.includes("ours") ? css("--series-2") : css("--text-secondary")), size: 7, solidity: 0.2 } },
    error_y: { type: "data", symmetric: false, color: css("--muted"), thickness: 1,
      array: pick.map(o => 100 * (o.r.ci95[1] - o.r.estimate)), arrayminus: pick.map(o => 100 * (o.r.estimate - o.r.ci95[0])) },
    text: pick.map(o => `${(100 * o.r.estimate).toFixed(0)}%`), textposition: "outside", cliponaxis: false,
    textfont: { color: css("--text-primary") },
    hovertemplate: T ? "%{x}: finds the rise in %{y:.0f}% of records<extra></extra>" : "%{x}: %{y:.1f}% false alarms<extra></extra>",
  }], layout, { displayModeBar: false, responsive: true });
  const n = DATA.e1.noise;
  $("e1-caption").textContent = T ? `How often each test finds a real ${T} mm/yr rise in ${W} years. Tests that score high here also cry wolf at “none”.` : `False alarms in ${W}-year records with no trend; fair = 5 in 100.`;
}

let NTR = null;
function renderNTR() {
  if (!NTR) { document.getElementById("harbor").hidden = true; return; }
  const o = NTR.season_outlook, all = o.all_seasons;
  const pct = x => `${Math.round((x - 1) * 100)}%`;
  const strong = Object.values(o.strong_el_nino_seasons);
  const strongMean = strong.reduce((s, v) => s + v, 0) / strong.length;
  const valid = NTR.seasons.filter(s => s.surge_days !== null);
  const avg = valid.reduce((s, v) => s + v.surge_days, 0) / valid.length;
  const q = o.outlook;
  $("ntr-tiles").innerHTML = `
    <div class="tile"><div class="tile-label">Per step of El Niño</div>
      <div class="tile-value">+${pct(all.rate_ratio_per_sd)}</div>
      <div class="tile-sub">likely +${pct(all.ci95[0])} to +${pct(all.ci95[1])}</div></div>
    <div class="tile"><div class="tile-label">Strong El Niño winters</div>
      <div class="tile-value">${strongMean.toFixed(0)} days</div>
      <div class="tile-sub">vs ${avg.toFixed(0)} in an average winter</div></div>`;
  // the two forecast tiles sit under the lead-time chart, beside which they belong
  const forecastTiles = `
    <div class="tile"><div class="tile-label">Forecast test on 2012–2025</div>
      <div class="tile-value">+${Math.round(o.test_deviance_skill_vs_trend_only * 100)}%</div>
      <div class="tile-sub">better than the simple guess</div></div>
    <div class="tile"><div class="tile-label">Winter 2026–27</div>
      <div class="tile-value verdict"><span class="icon" aria-hidden="true">▲</span>Above normal</div>
      <div class="tile-sub">August El Niño ${q.enso_aug_sd.toFixed(1)} steps</div></div>`;
  if ($("lead-tiles")) $("lead-tiles").innerHTML = forecastTiles; else $("ntr-tiles").insertAdjacentHTML("beforeend", forecastTiles);
  const s2 = css("--series-2"), gray = css("--axis");
  const thr = Number($("ntr-thr").value);   // slider: how strong an August El Niño must be to count
  $("ntr-thr-l").textContent = `${thr.toFixed(1)} steps`;
  const isStrong = s => s.enso_aug_sd !== null && s.enso_aug_sd >= thr;
  const strongW = valid.filter(isStrong), otherW = valid.filter(s => !isStrong(s));
  const mean = a => a.reduce((t, s) => t + s.surge_days, 0) / Math.max(1, a.length);
  $("ntr-readout").innerHTML = strongW.length
    ? `<b>${strongW.length}</b> strong winter${strongW.length > 1 ? "s" : ""}: <b>${mean(strongW).toFixed(0)} days</b> vs ${mean(otherW).toFixed(0)} in the rest.`
    : `No winter since 1980 had an August El Niño that strong.`;
  const label = s => `${s.start_year}/${String(s.start_year + 1).slice(2)}`;
  const mk = (filter, name, color) => ({
    type: "bar", name, x: valid.filter(filter).map(label), y: valid.filter(filter).map(s => s.surge_days),
    marker: color === gray   // ordinary winters pen-hatched, strong El Niño winters in red chalk
      ? { color: "rgba(0,0,0,0)", line: { color: css("--text-secondary"), width: 1 }, pattern: { shape: "/", fgcolor: css("--text-secondary"), size: 6, solidity: 0.2 } }
      : { color, line: { color, width: 1 } },
    customdata: valid.filter(filter).map(s => s.enso_aug_sd),
    hovertemplate: "%{x}: %{y} surge days<br>August ENSO %{customdata:+.1f} SD<extra></extra>",
  });
  const layout = layoutBase();
  layout.yaxis.ticksuffix = ""; layout.yaxis.title = { text: "storm-surge days", font: { size: 12 } };
  layout.hovermode = "closest"; layout.barmode = "overlay"; layout.bargap = 0.25;   // no Plotly transition here: with pattern-filled bars it throws on every redraw
  layout.xaxis.type = "category"; layout.xaxis.categoryorder = "array"; layout.xaxis.categoryarray = valid.map(label);
  layout.xaxis.tickangle = -60; layout.margin.b = 64;
  layout.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: avg, y1: avg, line: { color: css("--text-secondary"), dash: "dot", width: 1.5 } }];
  layout.annotations = [{ xref: "paper", x: 0, y: avg, yanchor: "bottom", xanchor: "left", showarrow: false, yshift: 2,
    text: `average ${avg.toFixed(0)}`, font: { color: css("--text-secondary"), size: 12 } }];
  layout.shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: mean(strongW), y1: mean(strongW), visible: strongW.length > 0,
    line: { color: s2, dash: "dash", width: 1.5 } });
  layout.annotations.push({ xref: "paper", x: 1, y: mean(strongW), yanchor: "bottom", xanchor: "right", showarrow: false, yshift: 2, visible: strongW.length > 0,
    text: `strong El Niño average ${mean(strongW).toFixed(0)}`, font: { color: s2, size: 12 } });
  Plotly.react("ntrchart", [mk(s => !isStrong(s), "Other winters", gray), mk(isStrong, "Strong El Niño winters", s2)],
    layout, { displayModeBar: false, responsive: true });
  $("ntr-caption").textContent = COAST.id === "west" ? `Oct–Apr seasons at Los Angeles (NOAA 9410660). One step = a typical year-to-year swing.`
    : `Oct–Apr seasons at the Battery (NOAA 8518750); 1997/98 has too little data. One step = a typical year-to-year swing.`;
  const m = NTR.models || {}, conc = m["all concurrent (best lag 0-6)"], lead = m["all leading (lag 1-6, forecast)"], wind = m["wind (best lag)"];
  $("ntr-note").textContent = `How we tested it: the model learned from the winters of 1980–2011 and then predicted 2012–2025, reading El Niño ` +
    `in August, two months before each season starts. Leaving out any one winter keeps the effect between +${pct(all.leave_one_out_rr_range[0])} ` +
    `and +${pct(all.leave_one_out_rr_range[1])}. ` +
    (conc ? `Month by month, the harbor's average water level follows that month's weather: winds over the New York Bight and the North Atlantic ` +
      `pressure pattern explain ${Math.round(conc.skill * 100)}% of it (winds alone ${Math.round(wind.skill * 100)}%), and global clues add ` +
      `nothing a month ahead. ` : "") +
    (COAST.id === "west" ? `On the West Coast El Niño lifts the whole winter's sea level, and the high-water days come with it; it shows up months before winter.`
      : `El Niño's mark on New York is how often storms push water in, and it shows up months before winter.`);
}

// ---------------------------------------------------------------- East / West
// Each coast has its own data (data/*.json for New York, data/*_west.json for Los Angeles). Switching stays on this page:
// the globe turns across to the other coast while its panels fade, then the globe section and the coast's panels are
// rebuilt from pristine copies with the other coast's data, the old globe's last frame cross-fades into the new one, and
// everything fades back in.
const coastCache = {};
function loadCoast(c) {
  if (!coastCache[c.id]) coastCache[c.id] = (async () => {
    const get = async f => { try { const r = await fetch(`data/${f}${c.suffix}.json`); return r.ok ? await r.json() : null; } catch { return null; } };
    const [ntr, globe, sw, ssh, local] = await Promise.all(["ntr", "globe", "signal_winters", "clue_map_ssh", "local_gauges"].map(get));
    if (globe) Object.assign(globe, { sw, ssh, local });
    return { ntr, globe };
  })();
  return coastCache[c.id];
}
let TPL = null, GW = null, switching = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function switchCoast(to) {
  if (switching || to === COAST.id || !TPL) return;
  switching = true;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches, cfg = coastConfig(to);
  const mode = GW.mode ? GW.mode() : "signal", src = GW.src ? GW.src() : "ssh";
  const target = src === "local" ? cfg.pov.local : mode === "winter" ? cfg.pov.winter : cfg.pov.signal;
  const dir = to === "west" ? 1 : -1;   // going west the view pans left, so the old content leaves to the right
  const panels = [$("lead-panel"), $("harbor"), $("explorer"), $("pacific-panel")];
  // 1. turn the old globe across to the other coast while the words around it fade away
  $("world").classList.add("cs-out");
  for (const p of panels) { p.style.setProperty("--cs-dir", dir); p.classList.add("cs-out"); }
  GW.fly(target, calm ? 0 : 1400);
  const [data] = await Promise.all([loadCoast(cfg), sleep(calm ? 0 : 1450)]);
  // 2. keep the old globe's last frame as a ghost over the stage, retire that build, rebuild for the new coast
  const oldGlobe = $("globe"), box = oldGlobe.getBoundingClientRect();
  GW.retire();
  for (const it of [...Anim.items]) if (it.el.closest("#world, #lead-panel")) { clearInterval(it.timer); Anim.io.unobserve(it.el); Anim.items.splice(Anim.items.indexOf(it), 1); }
  const old = GW;
  setCoast(to);
  const url = new URL(location.href);
  if (to === "west") url.searchParams.set("coast", "west"); else url.searchParams.delete("coast");
  history.replaceState(null, "", url);
  const w = TPL.world.cloneNode(true), lead = TPL.lead.cloneNode(true);
  w.classList.add("cs-in"); lead.classList.add("cs-in"); lead.style.setProperty("--cs-dir", -dir);
  oldGlobe.id = "globe-ghost"; oldGlobe.classList.add("globe-ghost");
  Object.assign(oldGlobe.style, { left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" });
  document.body.appendChild(oldGlobe);
  $("world").replaceWith(w); $("lead-panel").replaceWith(lead);
  for (const [k, html] of TPL.text) { const e = k.startsWith("#") ? document.querySelector(k) : $(k); if (e) e.innerHTML = html; }
  $("ntrchart").setAttribute("aria-label", TPL.ntrLabel);
  NTR = data.ntr;
  Plotly.purge("ntrchart");   // a fresh chart: redrawing patterned bars in place trips Plotly
  renderNTR();
  GW = renderWorld(data.globe, css, layoutBase, { startPov: target });
  if (src !== "ssh" && GW.setSrc) GW.setSrc(src);
  if (mode === "winter" && GW.setMode) GW.setMode("winter");
  speakCoast([$("world"), $("lead-panel"), $("harbor"), $("pacific-lede")]);
  coastSwitch($("coast-switch"), switchCoast);
  if (COAST.explorerRegion && [...$("region").options].some(o => o.value === COAST.explorerRegion)) {
    $("region").value = COAST.explorerRegion; $("region").dispatchEvent(new Event("change"));
  }
  Anim.sync();
  // 3. fade everything back in; the ghost of the old globe fades out over the new one, then is freed
  void document.body.offsetWidth;
  await sleep(40);
  w.classList.remove("cs-in"); lead.classList.remove("cs-in");
  for (const p of panels) if (p.isConnected) p.classList.remove("cs-out");
  oldGlobe.classList.add("gone");
  await sleep(calm ? 0 : 700);
  oldGlobe.remove(); old.dispose();
  switching = false;
}

async function main() {
  DATA = await (await fetch("data/series.json")).json();
  const first = await loadCoast(COAST);
  NTR = first.ntr;
  const GLOBE = first.globe;
  // pristine copies of everything a coast switch rebuilds, taken before anything is drawn into them
  TPL = { world: $("world").cloneNode(true), lead: $("lead-panel").cloneNode(true),
    text: ["harbor-title", "pacific-lede"].map(id => [id, $(id).innerHTML]).concat([["#harbor .panel-lede", document.querySelector("#harbor .panel-lede").innerHTML]]),
    ntrLabel: $("ntrchart").getAttribute("aria-label") };
  await waitForPlotly();
  const order = ["global", "west_pacific", "east_pacific", "california_shelf", "ny_bight", "global_nasa_gmsl_indicator",
                 "gauge_la_jolla", "gauge_san_francisco", "gauge_the_battery"];
  const keys = Object.keys(DATA.regions).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const k of keys) $("region").add(new Option(DATA.regions[k].label, k));
  const idxKeys = Object.keys(DATA.indices);
  for (const k of idxKeys) $("index-choice").add(new Option(DATA.indices[k].label, k));
  $("index-choice-wrap").hidden = idxKeys.length < 2;
  if (idxKeys.includes("nasa_enso")) $("index-choice").value = "nasa_enso";
  if (COAST.explorerRegion && keys.includes(COAST.explorerRegion)) $("region").value = COAST.explorerRegion;
  fillYears();
  $("region").addEventListener("change", () => { fillYears(true); update(); });
  for (const id of ["start", "end", "enso", "index-choice"]) $(id).addEventListener("change", update);
  $("generated").textContent = `Data generated ${DATA.generated}. ${DATA.units}.`;
  update(); renderE1(); renderNTR(); bindSpan();
  for (const id of ["e1-years", "e1-trend"]) $(id).addEventListener("input", renderE1);
  $("ntr-thr").addEventListener("input", renderNTR);
  // the charts move on their own: spans for the sea-level detective, rise and record length for the false-alarm test,
  // the El Niño bar for New York's winters
  // sea level: the record grows a year at a time and the trend is refitted as it goes (the axis stays still)
  let growEnd = null, pause = 0;
  Anim.register($("chart"), () => {
    const [first, last] = years($("region").value), start = Math.max(first, last - 40);
    if (pause > 0) { pause--; return; }
    growEnd = growEnd === null || growEnd >= last ? start + 5 : growEnd + 1;
    fixedX = [`${start}-01-01`, `${last}-12-31`];
    setSpan(start, growEnd, true);
    if (growEnd >= last) pause = 6;   // rest on the full record for a moment
  }, 380);
  $("region").addEventListener("change", () => { fixedX = null; growEnd = null; });
  Anim.register($("e1chart"), () => {
    const t = $("e1-trend"), y = $("e1-years"); let tv = Number(t.value) + 1;
    if (tv > 4) { tv = 0; y.value = String((Number(y.value) + 1) % 6); }
    t.value = String(tv); renderE1(); }, 1100);
  let thrDir = 1;
  Anim.register($("ntrchart"), () => {
    const s = $("ntr-thr"); let v = Math.round((Number(s.value) + 0.1 * thrDir) * 10) / 10;
    if (v > 2 || v < 0.5) { thrDir = -thrDir; v = Math.round((Number(s.value) + 0.1 * thrDir) * 10) / 10; }
    s.value = String(v); renderNTR(); }, 320);
  $("anim-master").addEventListener("click", () => Anim.toggle());
  Anim.sync();
  GW = renderWorld(GLOBE, css, layoutBase);
  // East / West: the globe and every panel after it follow the chosen coast
  speakCoast([$("world"), $("lead-panel"), $("harbor"), $("pacific-lede")]);
  coastSwitch($("coast-switch"), switchCoast);
  loadCoast(coastConfig(COAST.id === "east" ? "west" : "east"));   // fetch the other coast quietly, so a switch is instant
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { update(); renderE1(); renderNTR(); });
}
main().catch(err => { console.error(err); $("chart").textContent = "Could not load data: " + err.message; });
