// 3D globe with three modes, plus the space/time charts.
//   signal : where on Earth temperature in a month goes with New York's next winter (bars) + click anywhere to ask
//   nasa   : real NASA imagery from GIBS on the globe for any date (sea temperature, sea-surface height, true colour)
//   winter : pick a winter; three columns rise at New York (observed, El Nino model, trend only)
// Data: data/globe.json (computed on the DGX by ntr/explore_*.py). Imagery: NASA GIBS WMTS (public, needs internet).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const $ = id => document.getElementById(id);
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const LAYERS = {
  sst: { id: "GHRSST_L4_MUR25_Sea_Surface_Temperature_Anomalies", set: "GoogleMapsCompatible_Level6", ext: "png", start: "2002-09-01", end: null,
    step: 1, play: 10, overlay: true, label: "Sea temperature, difference from normal", cm: "sst", vmax: 3, levels: [-3, -2, -1, 1, 2, 3], unit: "°C",
    key: "red chalk = warmer than normal, blue ink = cooler; a contour line every 1 °C" },
  ssh: { id: "JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies", set: "GoogleMapsCompatible_Level6", ext: "png", start: "1992-10-05", end: "2019-01-20",
    step: 5, play: 10, overlay: true, label: "Sea-surface height from satellite altimeters, difference from normal", cm: "ssh", vmax: 0.3, levels: [-0.3, -0.2, -0.1, 0.1, 0.2, 0.3], unit: "m",
    key: "red chalk = sea surface higher than normal, blue ink = lower; a contour line every 0.1 m" },
  clouds: { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", set: "GoogleMapsCompatible_Level9", ext: "jpg", start: "2015-11-24", end: null,
    step: 1, play: 1, overlay: false, label: "True colour from space, with that day's clouds", key: "what a satellite saw that day, printed in sepia" },
};
// NASA's own colour scales for the two anomaly layers (from gibs.earthdata.nasa.gov/colormaps/v1.3/*.xml): [r, g, b, value].
// Used to turn each imagery pixel back into its value, which is then redrawn in the manuscript palette.
const CMAPS = fetch("data/gibs_colormaps.json").then(r => r.json()).catch(() => null);
const LUTS = {};
function valueLut(rows, vmax) {   // 32x32x32 colour cube -> value / vmax (NaN if no colour on NASA's scale is close)
  const lut = new Float32Array(32768);
  for (let q = 0; q < 32768; q++) {
    const r = ((q >> 10) << 3) + 4, g = (((q >> 5) & 31) << 3) + 4, b = ((q & 31) << 3) + 4;
    let best = Infinity, v = NaN;
    for (const e of rows) { const d = (e[0] - r) ** 2 + (e[1] - g) ** 2 + (e[2] - b) ** 2; if (d < best) { best = d; v = e[3]; } }
    lut[q] = best < 1600 ? Math.max(-1, Math.min(1, v / vmax)) : NaN;
  }
  return lut;
}
const SANG = [168, 50, 31], INKB = [30, 53, 80];
// the colour key under the globe, in the same washes as the texture (blue ink, bare paper, red chalk)
function scaleHtml(L) {
  if (!L.cm) return "";
  const n = v => (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v);
  return `<span class="ms-scale" role="img" aria-label="colour scale from ${n(-L.vmax)} to ${n(L.vmax)} ${L.unit}">` +
    `<i style="background:linear-gradient(90deg,rgb(69,82,88),rgb(137,139,131),#ecdfc2,rgb(198,138,113),rgb(172,80,58))"></i>` +
    `<span class="ms-ticks"><b>${n(-L.vmax)}</b><b>0</b><b>${n(L.vmax)} ${L.unit}</b></span></span>`;
}
const day = 86400000;
const toDate = s => new Date(s + "T00:00:00Z");
const iso = d => d.toISOString().slice(0, 10);
const recent = iso(new Date(Date.now() - 5 * day));   // imagery is published with a few days' delay
for (const L of Object.values(LAYERS)) if (!L.end) L.end = recent;

function lerpColor(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
// Manuscript palette (Leonardo's notebooks): parchment, iron-gall ink, red chalk (sanguine).
// Keys keep their old names: cyan = main ink, amber = sanguine (the confirmed link), warm/cool = data strokes.
const NEON = { warm0: "#c8765a", warm1: "#8e2414", cool0: "#6f86a0", cool1: "#1e3550", cyan: "#3b2614", amber: "#a8321f",
  ok: "#2f5a2a", grid: "rgba(70,45,20,0.16)", land: "rgba(70,45,20,0.85)", dim: "#8a7a63", paper: "#ecdfc2" };
function colorFor(r, r0) {   // diverging: warm arm = positive, cool arm = negative; brighter/hotter with strength
  const t = Math.max(0, Math.min(1, (Math.abs(r) - r0) / (0.6 - r0)));
  return r > 0 ? lerpColor(NEON.warm0, NEON.warm1, t) : lerpColor(NEON.cool0, NEON.cool1, t);
}
// Manuscript base texture, drawn once on canvases (equirectangular, 2048 x 1024):
//   MS.paper : parchment with grain, fibres, foxing and a darker rim
//   MS.lines : ink only (graticule, Leonardo-style water lines around the coasts, coastlines), transparent elsewhere
//   MS.hatch : diagonal ink hatching inside the land
// HOLO = paper + hatch + lines, used whenever no NASA imagery is shown.
const MS = { paper: null, lines: null, hatch: null };
const TW = 2048, TH = 1024;
const xy = (lon, lat) => [(lon + 180) / 360 * TW, (90 - lat) / 180 * TH];
function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function makePaper() {
  const c = document.createElement("canvas"); c.width = TW; c.height = TH;
  const x = c.getContext("2d"), rnd = seeded(7);
  x.fillStyle = NEON.paper; x.fillRect(0, 0, TW, TH);
  const img = x.getImageData(0, 0, TW, TH), d = img.data;                       // grain
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  x.putImageData(img, 0, 0);
  for (let k = 0; k < 70; k++) {                                                // foxing: soft brown stains
    const px = rnd() * TW, py = rnd() * TH, r = 20 + rnd() * 90, g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(140,95,45,${0.05 + rnd() * 0.08})`); g.addColorStop(1, "rgba(140,95,45,0)");
    x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r);
  }
  x.strokeStyle = "rgba(120,85,40,0.07)"; x.lineWidth = 1;                      // fibres
  for (let k = 0; k < 900; k++) { const px = rnd() * TW, py = rnd() * TH, a = rnd() * Math.PI; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 30, py + Math.sin(a) * 8); x.stroke(); }
  return c;
}
function landPaths(features) {
  const paths = [];
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const p = new Path2D();
      for (const ring of poly) ring.forEach(([lon, lat], i) => { const [px, py] = xy(lon, lat); i ? p.lineTo(px, py) : p.moveTo(px, py); });
      paths.push(p);
    }
  }
  return paths;
}
function makeLines(paths) {
  const c = document.createElement("canvas"); c.width = TW; c.height = TH;
  const x = c.getContext("2d");
  x.strokeStyle = NEON.grid; x.lineWidth = 1.2;                                 // graticule every 15 degrees
  for (let lon = -180; lon <= 180; lon += 15) { const [px] = xy(lon, 0); x.beginPath(); x.moveTo(px, 0); x.lineTo(px, TH); x.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const [, py] = xy(0, lat); x.beginPath(); x.moveTo(0, py); x.lineTo(TW, py); x.stroke(); }
  x.strokeStyle = "rgba(70,45,20,0.35)"; x.lineWidth = 1.6; x.setLineDash([10, 6]);
  x.beginPath(); x.moveTo(0, TH / 2); x.lineTo(TW, TH / 2); x.stroke(); x.setLineDash([]);   // the equator, dashed
  if (paths.length) {
    // Leonardo-style water lines: concentric strokes following each coast (drawn wide, then the inside erased)
    const ripples = document.createElement("canvas"); ripples.width = TW; ripples.height = TH;
    const r = ripples.getContext("2d"); r.lineJoin = "round";
    for (const [w, a] of [[30, 0.10], [20, 0.14], [11, 0.2]]) {
      r.globalCompositeOperation = "source-over"; r.strokeStyle = `rgba(70,45,20,${a})`; r.lineWidth = w; paths.forEach(p => r.stroke(p));
      r.globalCompositeOperation = "destination-out"; r.strokeStyle = "#000"; r.lineWidth = w - 2.2; paths.forEach(p => r.stroke(p));
    }
    r.globalCompositeOperation = "destination-out"; r.fillStyle = "#000"; paths.forEach(p => r.fill(p, "evenodd"));
    x.drawImage(ripples, 0, 0);
    x.strokeStyle = NEON.land; x.lineWidth = 1.8; x.lineJoin = "round"; paths.forEach(p => x.stroke(p));   // coastlines
  }
  return c;
}
function makeHatch(paths) {
  const c = document.createElement("canvas"); c.width = TW; c.height = TH;
  if (!paths.length) return c;
  const x = c.getContext("2d");
  x.save(); const clip = new Path2D(); paths.forEach(p => clip.addPath(p)); x.clip(clip, "evenodd");
  x.fillStyle = "rgba(150,110,60,0.10)"; x.fillRect(0, 0, TW, TH);              // light wash on land
  x.strokeStyle = "rgba(70,45,20,0.20)"; x.lineWidth = 1;
  for (let k = -TH; k < TW; k += 7) { x.beginPath(); x.moveTo(k, TH); x.lineTo(k + TH, 0); x.stroke(); }   // 45-degree hatching
  x.restore();
  return c;
}
function composeManuscript() {
  const c = document.createElement("canvas"); c.width = TW; c.height = TH;
  const x = c.getContext("2d");
  x.drawImage(MS.paper, 0, 0); if (MS.hatch) x.drawImage(MS.hatch, 0, 0); if (MS.lines) x.drawImage(MS.lines, 0, 0);
  return c;   // a canvas: textures are cross-faded canvas to canvas (setTexture)
}
MS.paper = makePaper(); MS.lines = makeLines([]);
let HOLO = composeManuscript();
function monthLabel(m) {
  if (m < 10) return `${MONTHS[m - 1]}: ${10 - m} month${10 - m === 1 ? "" : "s"} before the stormy season`;
  return `${MONTHS[m - 1]}: the stormy season has begun`;
}
function boxPath([s, n, w, e]) {
  const pts = [];
  for (let lon = w; lon <= e; lon += 2) pts.push([s, lon]);
  for (let lat = s; lat <= n; lat += 1) pts.push([lat, e]);
  for (let lon = e; lon >= w; lon -= 2) pts.push([n, lon]);
  for (let lat = n; lat >= s; lat -= 1) pts.push([lat, w]);
  return pts;
}
function gcKm(a, b) {
  const R = Math.PI / 180, dLa = (b.lat - a.lat) * R, dLo = (b.lng - a.lng) * R;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const fmtLL = (lat, lng) => { const a = Math.round(lat), o = Math.round(lng); return `${Math.abs(a)}°${a >= 0 ? "N" : "S"}, ${Math.abs(o)}°${o >= 0 ? "E" : "W"}`; };

// ---------------------------------------------------------------------------------------------- NASA imagery
// Load GIBS tiles (Web Mercator) for a date, re-project to the globe's equirectangular texture over the Blue Marble.
function loadTile(url) {
  return new Promise(res => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
async function composeImagery(L, date, z, base) {
  const n = 2 ** z, mw = 256 * n;
  const jobs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) jobs.push(loadTile(`${GIBS}/${L.id}/default/${date}/${L.set}/${z}/${y}/${x}.${L.ext}`).then(im => ({ x, y, im })));
  const tiles = await Promise.all(jobs);
  if (!tiles.some(t => t.im)) return null;
  const merc = document.createElement("canvas"); merc.width = merc.height = mw;
  const mc = merc.getContext("2d");
  for (const t of tiles) if (t.im) mc.drawImage(t.im, t.x * 256, t.y * 256);
  const W = TW, H = TH;
  const eq = document.createElement("canvas"); eq.width = W; eq.height = H;      // imagery re-projected to lon/lat
  const ec = eq.getContext("2d", { willReadFrequently: true }); ec.imageSmoothingEnabled = false;   // keep NASA's exact colours
  for (let j = 0; j < H; j++) {
    const lat = (90 - (j + 0.5) * 180 / H) * Math.PI / 180;
    if (Math.abs(lat) > 1.4844) continue;                                         // beyond Web Mercator (85.05 deg)
    const sy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * mw;
    ec.drawImage(merc, 0, Math.min(mw - 1, Math.floor(sy)), mw, 1, 0, j, W, 1);
  }
  const src = ec.getImageData(0, 0, W, H).data;
  if (!MS.paperData) MS.paperData = MS.paper.getContext("2d").getImageData(0, 0, W, H).data;
  const pd = MS.paperData, out = document.createElement("canvas"); out.width = W; out.height = H;
  const c = out.getContext("2d"), img = c.createImageData(W, H), o = img.data;
  const cmaps = L.cm ? await CMAPS : null;
  if (L.cm && cmaps) {
    // anomaly layers: read each pixel's value off NASA's scale, then wash the paper with red chalk (above normal)
    // or blue ink (below), stronger with the size of the anomaly, and hatch the strongest patches
    const lut = LUTS[L.cm] || (LUTS[L.cm] = valueLut(cmaps[L.cm], L.vmax));
    const vals = new Float32Array(W * H).fill(NaN);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      o[i] = pd[i]; o[i + 1] = pd[i + 1]; o[i + 2] = pd[i + 2]; o[i + 3] = 255;
      if (src[i + 3] < 128) continue;
      const t = lut[((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3)];
      if (t !== t) continue;
      vals[p] = t;
      const s = Math.abs(t), ink = t > 0 ? SANG : INKB, x = p % W, y = (p / W) | 0;
      let a = 0.8 * s ** 0.75;
      if (s > 0.5 && (t > 0 ? (x + y) % 9 : (x - y + 9 * W) % 9) < 2) a = Math.min(1, a + 0.35 * (s - 0.5) / 0.5 + 0.12);   // hatching
      for (let k = 0; k < 3; k++) o[i + k] = pd[i + k] * (1 - a * (1 - ink[k] / 255));
    }
    c.putImageData(img, 0, 0);
    if (MS.hatch) c.drawImage(MS.hatch, 0, 0);                                    // land keeps its pen hatching
    drawContours(c, vals, W, H, L.levels.map(v => v / L.vmax));
  } else {
    // true colour: printed in sepia on the paper (clouds = bare paper, dark sea = brown ink)
    const BR = [59, 38, 20];
    for (let i = 0; i < o.length; i += 4) {
      const lum = src[i + 3] < 128 ? 1 : 0.25 + 0.75 * ((0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]) / 255);
      for (let k = 0; k < 3; k++) o[i + k] = pd[i + k] * (BR[k] / 255 + (1 - BR[k] / 255) * lum);
      o[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  if (MS.lines) c.drawImage(MS.lines, 0, 0);                                      // ink coastlines and graticule on top
  return out;
}
// Contour lines of the anomaly field, drawn in ink like isolines on a hand-drawn chart.
// The field is averaged onto a 4x coarser grid and smoothed first, so the lines follow the large patterns.
const EDGES = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
function drawContours(c, vals, W, H, levels) {
  const f = 4, gw = W / f, gh = H / f;
  let g = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let s = 0, n = 0;
    for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) { const v = vals[(j * f + y) * W + i * f + x]; if (v === v) { s += v; n++; } }
    g[j * gw + i] = n >= 8 ? s / n : NaN;
  }
  for (let pass = 0; pass < 2; pass++) {                                          // 3x3 smoothing that ignores gaps
    const h = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const v0 = g[j * gw + i]; if (v0 !== v0) { h[j * gw + i] = NaN; continue; }
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const jj = j + dy, ii = (i + dx + gw) % gw; if (jj < 0 || jj >= gh) continue;
        const v = g[jj * gw + ii]; if (v === v) { s += v; n++; }
      }
      h[j * gw + i] = s / n;
    }
    g = h;
  }
  c.lineCap = "round"; c.lineJoin = "round";
  for (const lev of levels) {
    const major = Math.abs(Math.abs(lev) - Math.max(...levels.map(Math.abs)) / 1.5) < 0.01;   // ±2 °C / ±0.2 m drawn heavier
    c.strokeStyle = lev > 0 ? "rgba(110,26,12,0.85)" : "rgba(20,36,58,0.85)";
    c.lineWidth = major ? 2.4 : 1.5;
    c.beginPath();
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = g[j * gw + i], b = g[j * gw + i + 1], cc = g[(j + 1) * gw + i + 1], d = g[(j + 1) * gw + i];
      if (a !== a || b !== b || cc !== cc || d !== d) continue;
      const idx = (a > lev) << 3 | (b > lev) << 2 | (cc > lev) << 1 | (d > lev);
      if (idx === 0 || idx === 15) continue;
      const pt = e => e === 0 ? [i + (lev - a) / (b - a), j] : e === 1 ? [i + 1, j + (lev - b) / (cc - b)]
        : e === 2 ? [i + (lev - d) / (cc - d), j + 1] : [i, j + (lev - a) / (d - a)];
      for (const [e1, e2] of EDGES[idx]) {
        const [x1, y1] = pt(e1), [x2, y2] = pt(e2);
        c.moveTo(x1 * f + f / 2, y1 * f + f / 2); c.lineTo(x2 * f + f / 2, y2 * f + f / 2);
      }
    }
    c.stroke();
  }
}

// ---------------------------------------------------------------------------------------------- "Test a winter" lab
// Under the globe: pick one signal or overlay several, choose the month it is read in, and see every winter at once.
//   lead strip : the months of year Y and the surge season Oct-Apr; bars = how well the signal does when read in each
//                month (leave-one-winter-out skill vs trend only); an arrow carries the reading to the season
//   timeline   : surge days per winter (observed dots, trend dashed, each signal's prediction), which was closer,
//                and the running total of days missed; a pointer marks the winter on the globe
// Data: data/signal_winters.json (ntr/explore_signal_winters.py on the DGX).
const INKS = ["#a8321f", "#2f5a2a", "#b0761a", "#4a6d8c", "#7a4a2a"];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const BLUE = "#1e3550", FAINT = "rgba(70,45,20,0.18)";
function winterLab(host, SW, P, st, onPick, onChange) {
  if (!host || !SW) return { render() {}, point() {} };
  const n = SW.seasons.length, VW = 1000, L0 = 190, R0 = 130, span = VW - L0 - R0;
  const X = i => L0 + span / n * (i + 0.5);
  // a clue is read before the season (Jan-Sep); readings from Oct on fall inside the season and are not forecasts
  const best = k => Object.entries(SW.signals[k]).filter(([m]) => Number(m) <= 9)
    .reduce((b, [m, v]) => (!b || v.loo_skill > b[1].loo_skill ? [Number(m), v] : b), null) || [6, { loo_skill: -1 }];
  const works = k => {   // reading months where the clue helps clearly (skill >= 0.1), as "May–Sep"
    const ms = []; for (let m = 1; m <= 9; m++) if (SW.signals[k][m] && SW.signals[k][m].loo_skill >= 0.1) ms.push(m);
    if (!ms.length) return null;
    const runs = []; for (const m of ms) { const r = runs[runs.length - 1]; if (r && r[1] === m - 1) r[1] = m; else runs.push([m, m]); }
    return runs.map(([a, b]) => (a === b ? MON3[a - 1] : `${MON3[a - 1]}–${MON3[b - 1]}`)).join(", ");
  };
  const label0 = k => (P[k] ? P[k].label : k).replace(" (NASA GISTEMP Nino3.4)", " · NASA Niño3.4").replace(" (NOAA ONI)", " · NOAA ONI");
  let label = label0;
  const passed = k => k === "nino34_giss" || k === "oni";                 // the only signal that held up on winters kept back
  const order = Object.keys(SW.signals).sort((a, b) => best(b)[1].loo_skill - best(a)[1].loo_skill);
  const fmtS = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
  // the public sees a few named clues as one-click toggles; the rest sit behind "more clues"
  const CLUES = [["nino34_giss", "El Niño · tropical Pacific"], ["nao_power", "North Atlantic winds"], ["msl_portland", "Sea level in Maine"],
    ["seaice_arctic", "Arctic sea ice"], ["pdo_ncei", "North Pacific"]].filter(([k]) => SW.signals[k]);
  const NICE = Object.fromEntries(CLUES);
  label = k => NICE[k] || label0(k);
  host.innerHTML = `
    <div class="wl-controls">
      <span class="wl-ask">Which clue predicts New York's winter? <em>Tap to add or remove:</em></span>
      <span class="wl-chips" id="wl-chips"></span>
    </div>
    <svg class="wl-lead" id="wl-lead" viewBox="0 0 ${VW} 64" hidden></svg>
    <div class="wl-tally" id="wl-tally" aria-live="polite"></div>
    <div class="wl-key" id="wl-key"></div>
    <svg class="wl-time" id="wl-time" viewBox="0 0 ${VW} 300" role="img"></svg>
    <p class="wl-note">Each winter was predicted without peeking at it; the “simple guess” uses only the long-term average. ★ = passed our strict test on recent winters.
      Tap a winter to see it on the globe.</p>`;
  const lead = host.querySelector("#wl-lead"), time = host.querySelector("#wl-time");
  const chipsEl = host.querySelector("#wl-chips"), keyEl = host.querySelector("#wl-key"), tallyEl = host.querySelector("#wl-tally");
  const slot = document.getElementById("wl-slot");   // the clue buttons live in the sidebar, the timeline in the sheet below
  if (slot) slot.appendChild(host.querySelector(".wl-controls"));
  const toggle = k => {
    if (st.sigs.includes(k)) { if (st.sigs.length > 1) st.sigs = st.sigs.filter(s => s !== k); }
    else st.sigs = [...st.sigs, k].slice(-INKS.length);
    onChange();
  };
  chipsEl.addEventListener("click", e => { const b = e.target.closest("button[data-k]"); if (b) toggle(b.dataset.k); });
  // each clue is read in its own month (its best one, Jan-Sep, unless the visitor picks another for the first clue),
  // because clues work at different lead times; overlaid clues are then each shown at their own lead
  const monthOf = k => Math.min(9, st.readMonths[k] || best(k)[0]);
  lead.addEventListener("click", e => { const m = e.target.dataset && e.target.dataset.m; if (m) { st.readMonths[st.sigs[0]] = Number(m); onChange(); } });
  // interactions on the layers: a hover card for any winter, press-and-drag to scrub through winters (the globe follows),
  // tap a month dot to change when that clue is read, tap a clue's name to bring its layer forward
  const tip = document.createElement("div"); tip.className = "wl-tip"; tip.hidden = true; host.appendChild(tip);
  const geom = { sigs: [] };
  const toView = e => { const p = time.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(time.getScreenCTM().inverse()); };
  const winterAt = x => (x < L0 - 4 || x > VW - R0 + 4 ? -1 : Math.max(0, Math.min(n - 1, Math.floor((x - L0) / (span / n)))));
  let scrubbing = false, lastPick = -1;
  time.addEventListener("pointerdown", e => {
    const md = e.target.closest("[data-mk]");
    if (md) { st.readMonths[md.dataset.mk] = Number(md.dataset.m); tip.hidden = true; onChange(); return; }
    const fo = e.target.closest("[data-focus]");
    if (fo) { st.focus = st.focus === fo.dataset.focus ? null : fo.dataset.focus; renderTime(); point(st.winter); return; }
    const i = winterAt(toView(e).x); if (i < 0) return;
    scrubbing = true; time.setPointerCapture(e.pointerId); lastPick = i; onPick(i);
  });
  time.addEventListener("pointermove", e => {
    const i = winterAt(toView(e).x);
    if (!e.target.closest("[data-mk],[data-focus]")) showTip(i, e); else hideTip();
    if (scrubbing && i >= 0 && i !== lastPick) { lastPick = i; onPick(i); }
  });
  const endScrub = () => { scrubbing = false; };
  time.addEventListener("pointerup", endScrub); time.addEventListener("pointercancel", endScrub);
  time.addEventListener("pointerleave", () => { if (!scrubbing) hideTip(); });
  function hideTip() { tip.hidden = true; const h = time.querySelector("#wl-hover"); if (h) h.style.opacity = 0; }
  function showTip(i, e) {
    if (i < 0) return hideTip();
    const h = time.querySelector("#wl-hover"); if (h) { h.style.opacity = 1; h.style.transform = `translate(${X(i)}px, 0)`; }
    const yr = SW.seasons[i], obs = SW.observed[i], tr = SW.trend_loo[i];
    tip.innerHTML = `<b>Winter ${yr}–${String(yr + 1).slice(2)}</b><div>What happened: <b>${obs}</b> storm days</div><div class="muted">Simple guess: ${Math.round(tr)}</div>` +
      geom.sigs.map((k, j) => { const p = pred(k, i), ok = Math.abs(obs - p) < Math.abs(obs - tr);
        return `<div style="color:${INKS[j]}">${label(k)}: ${Math.round(p)}${ok ? " ✓ closer" : ""}</div>`; }).join("") +
      `<div class="muted">tap or drag to see it on the globe</div>`;
    tip.hidden = false;
    const hr = host.getBoundingClientRect(), w = tip.offsetWidth || 230;
    let x = e.clientX - hr.left + 16; if (x + w > hr.width) x = e.clientX - hr.left - w - 16;
    tip.style.left = `${Math.max(0, x)}px`; tip.style.top = `${e.clientY - hr.top + 14}px`;
  }

  // prediction of signal k for winter i at its read month; a winter the signal has no reading for falls back to trend
  const pred = (k, i) => { const v = SW.signals[k][monthOf(k)]; const p = v && v.pred[i]; return p === null || p === undefined ? SW.trend_loo[i] : p; };
  const has = k => !!SW.signals[k][monthOf(k)];
  const ahead = k => 10 - monthOf(k), aheadTxt = k => `${ahead(k)} month${ahead(k) > 1 ? "s" : ""} ahead`;
  let ptr = null, ptrLab = null, Xc = X;

  // reading months Jan-Sep (bars = how well the first clue works when read then), one arrow per clue to the season
  function renderLead() {
    const k0 = st.sigs[0], ink0 = INKS[0], mw = span * 0.6 / 9, mx = m => L0 + mw * (m - 0.5), base = 44;
    const sx = L0 + mw * 9 + 34, sw = VW - R0 - sx;            // the season box
    let s = `<defs>${INKS.map((c, j) => `<marker id="wl-arrow${j}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`).join("")}</defs>
      <text x="${L0 - 10}" y="${base - 4}" text-anchor="end" class="lab">read the clue in</text>
      <line x1="${L0}" x2="${L0 + mw * 9}" y1="${base}" y2="${base}" stroke="${FAINT}"/>
      <rect x="${sx}" y="14" width="${sw}" height="${base - 6}" rx="3" fill="rgba(168,50,31,0.07)" stroke="rgba(168,50,31,0.45)"/>
      <text x="${sx + sw / 2}" y="31" text-anchor="middle" class="season">stormy season · Oct → Apr</text>
      <text x="${sx + sw / 2}" y="47" text-anchor="middle" class="yr">what is predicted: its total storm-surge days</text>`;
    for (let m = 1; m <= 9; m++) {
      const v = SW.signals[k0][m] ? SW.signals[k0][m].loo_skill : 0, on = m === monthOf(k0), good = v >= 0.1;
      const h = Math.max(2, Math.min(30, v * 90));
      s += `<rect x="${mx(m) - mw * 0.3}" y="${base - h}" width="${mw * 0.6}" height="${h}" fill="${good ? ink0 : "#b9a684"}" opacity="${on ? 1 : good ? 0.45 : 0.5}"/>`;
      s += `<text x="${mx(m)}" y="${base + 16}" text-anchor="middle" class="${on ? "mon on" : "mon"}">${MON3[m - 1]}</text>`;
    }
    const used = {};
    st.sigs.filter(has).forEach((k, j) => {   // later clues drawn first so the first clue's arrow sits on top
      const m = monthOf(k), x1 = mx(m), y1 = base - 34 + 7 * (used[m] = (used[m] ?? -1) + 1), c = INKS[j];
      s = `<path class="wl-flow" d="M${x1} ${y1} Q ${(x1 + sx) / 2} ${4 + 5 * j} ${sx - 4} ${24 + 5 * j}" fill="none" stroke="${c}" stroke-width="${j ? 1.4 : 1.8}" marker-end="url(#wl-arrow${j})"/>` + s +
        `<circle cx="${x1}" cy="${y1}" r="4.5" fill="${c}" stroke="#f6eedb" stroke-width="1.5"/>`;
    });
    if (has(k0)) s += `<text x="${(mx(monthOf(k0)) + sx) / 2 + 6}" y="${base - 30}" text-anchor="middle" class="ahead">${aheadTxt(k0)}</text>`;
    for (let m = 1; m <= 9; m++) s += `<rect class="wl-hit" data-m="${m}" x="${mx(m) - mw / 2}" y="0" width="${mw}" height="64"><title>read ${label(k0)} in ${MONTHS[m - 1]}</title></rect>`;
    lead.innerHTML = s;
  }

  // One layer per clue, each read in its own month (its own lead time), so no clue hides behind another.
  // In every layer the middle line is the simple guess. Bars: how far each winter really landed above or below it
  // (coloured when this clue called that winter better). Line: what this clue predicted, above or below the simple guess.
  function renderTime() {
    const sigs = st.sigs.filter(has), H = 56, top = 6, rows = sigs.length;
    const VH = top + rows * H + 26;
    time.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
    const dev = SW.observed.map((o, i) => o - SW.trend_loo[i]);
    const A = Math.max(6, [...dev].map(Math.abs).sort((a, b) => a - b)[Math.floor(n * 0.9)]);   // 90th percentile, larger bars clipped
    const bw = span / n * 0.62;
    let s = "";
    geom.sigs = sigs;
    sigs.forEach((k, j) => {
      const y0 = top + j * H, mid = y0 + H / 2, sc = (H / 2 - 5) / A, c = INKS[j], m = monthOf(k);
      const y = v => mid - Math.max(-A, Math.min(A, v)) * sc;
      s += `<g class="wl-layer${st.focus === k ? " focus" : ""}" opacity="${st.focus && st.focus !== k ? 0.22 : 1}">`;
      if (j % 2 === 0 || st.focus === k) s += `<rect x="${L0 - 6}" y="${y0}" width="${span + 12}" height="${H}" fill="${st.focus === k ? `${c}14` : "rgba(110,80,40,0.045)"}"/>`;
      s += `<line x1="${L0}" x2="${VW - R0}" y1="${mid}" y2="${mid}" stroke="${BLUE}" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
      let wins = 0, offC = 0, offT = 0;
      SW.seasons.forEach((_, i) => {
        const p = pred(k, i), better = Math.abs(SW.observed[i] - p) < Math.abs(dev[i]);
        if (better) wins++; offC += Math.abs(SW.observed[i] - p); offT += Math.abs(dev[i]);
        const yt = y(dev[i]);
        s += `<rect x="${X(i) - bw / 2}" y="${Math.min(mid, yt)}" width="${bw}" height="${Math.max(0.8, Math.abs(mid - yt))}" fill="${better ? c : "#8a7a63"}" opacity="${better ? 0.55 : 0.28}"/>`;
      });
      s += `<path class="wl-draw" style="--len:1600" d="${SW.seasons.map((_, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + y(pred(k, i) - SW.trend_loo[i]).toFixed(1)).join("")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
      // left: the clue and its own prior (a little Jan-Sep track with its reading month, then the arrow to winter)
      const tx = 8, tw = 9;
      s += `<text x="${tx}" y="${y0 + 17}" class="layer-name" fill="${c}" data-focus="${k}"><title>tap to bring this layer forward</title>${label(k)}${passed(k) ? " ★" : ""}</text>`;
      s += `<line x1="${tx}" x2="${tx + tw * 8}" y1="${y0 + 29}" y2="${y0 + 29}" stroke="${FAINT}" stroke-width="2"/>`;
      for (let q = 1; q <= 9; q++) {
        const v = SW.signals[k][q], good = v && v.loo_skill >= 0.1;
        s += `<circle cx="${tx + tw * (q - 1)}" cy="${y0 + 29}" r="${q === m ? 4 : good ? 2.4 : 1.6}" fill="${q === m ? c : good ? `${c}99` : "#b9a684"}"/>` +
          `<circle class="wl-mdot" data-mk="${k}" data-m="${q}" cx="${tx + tw * (q - 1)}" cy="${y0 + 29}" r="5.5"><title>read ${label(k)} in ${MONTHS[q - 1]}${good ? " (works well)" : ""}</title></circle>`;
      }
      s += `<path d="M${tx + tw * 8 + 6} ${y0 + 29} L${L0 - 22} ${y0 + 29}" stroke="${c}" stroke-width="1.3" stroke-dasharray="3 3" class="wl-flow"/>
        <path d="M${L0 - 22} ${y0 + 25} L${L0 - 15} ${y0 + 29} L${L0 - 22} ${y0 + 33} z" fill="${c}"/>`;
      s += `<text x="${tx}" y="${y0 + 46}" class="layer-sub">read in ${MON3[m - 1]} · ${ahead(k)} month${ahead(k) > 1 ? "s" : ""} ahead</text>`;
      // right: how it did
      s += `<text x="${VW - R0 + 10}" y="${y0 + 22}" class="layer-score" fill="${c}">closer in ${wins}/${n}</text>`;
      s += `<text x="${VW - R0 + 10}" y="${y0 + 40}" class="layer-sub">${offC < offT ? `${Math.round(offT - offC)} fewer days off` : "no fewer days off"}</text>`;
      s += `</g>`;
    });
    const yb = top + rows * H;
    s += SW.seasons.map((yr, i) => (yr % 5 === 0 ? `<text x="${X(i)}" y="${yb + 16}" text-anchor="middle" class="tick">${yr}</text>` : "")).join("");
    s += `<g id="wl-hover" class="wl-hover" style="opacity:0"><rect x="${-span / n / 2}" y="2" width="${span / n}" height="${yb - 2}" fill="rgba(59,38,20,0.07)"/></g>`;
    s += `<g class="wt-pointer" id="wl-ptr"><line x1="0" x2="0" y1="2" y2="${yb}" stroke="#a8321f" stroke-width="1.3"/><path d="M-5 -2 L5 -2 L0 6 Z" fill="#a8321f"/></g>`;
    time.innerHTML = s;
    time.setAttribute("aria-label", `One row per clue, winters ${SW.seasons[0]} to ${SW.seasons[n - 1]}: ${sigs.map(k => `${label(k)} read in ${MONTHS[monthOf(k) - 1]}`).join("; ")}.`);
    ptr = time.querySelector("#wl-ptr");
    tallyEl.innerHTML = "";
    keyEl.innerHTML = `<span>Each row = one clue, read in its own month.</span><span><i class="wt-line dash"></i>middle line: the simple guess</span>` +
      `<span><i class="wl-bar"></i>bars: how far each winter really landed above or below it (coloured when the clue called it better)</span>` +
      `<span><i class="wt-line" style="background:#a8321f"></i>line: what the clue predicted</span>` +
      `<span class="wl-how">Hover or drag across the winters · tap a month dot to read a clue earlier or later · tap a clue's name to bring it forward</span>`;
  }

  function render() {
    const shown = [...CLUES.map(c => c[0]), ...st.sigs.filter(k => !NICE[k])];
    chipsEl.innerHTML = shown.map(k => {
      const j = st.sigs.indexOf(k), on = j >= 0;
      return `<button type="button" class="wl-chip${on ? " on" : ""}" data-k="${k}" aria-pressed="${on}" style="${on ? `border-color:${INKS[j]};color:${INKS[j]};background:${INKS[j]}1a` : ""}">${on ? "✓ " : "+ "}${label(k)}${passed(k) ? " ★" : ""}</button>`;
    }).join("");
    renderTime(); point(st.winter);
  }
  function point(i) { if (ptr) ptr.style.transform = `translate(${Xc(i)}px, 0)`; }
  return { render, point, pred, label, best, passed, has, monthOf };
}

export function renderWorld(G, css, layoutBase) {
  if (!G) { $("world").hidden = true; return; }
  const battery = { lat: G.battery[0], lng: G.battery[1] };
  const P = Object.fromEntries(G.predictors.map(p => [p.predictor, p]));
  const km = x => Math.round(x).toLocaleString("en-US");
  // Two clue maps, switchable: "sst" = NASA GISTEMP surface temperature (1980-2025, 43 winters), "ssh" = NASA altimetry
  // sea-surface height (MEaSUREs via GIBS, 1993-2018, 26 winters). Same cells, same method; CM() is the one in use.
  const SSHM = G.ssh && G.ssh.maps ? G.ssh : null;
  const CM = () => (state.src === "ssh" && SSHM ? SSHM : G);
  const cellMaps = {};   // "src:month" -> Map("lat,lon" -> r)
  const cellR = (m, lat, lng) => {
    const key = `${state.src}:${m}`;
    if (!cellMaps[key]) cellMaps[key] = new Map(CM().maps[String(m)].map(([la, lo, r]) => [`${la},${lo}`, r]));
    const la = 2 * Math.floor(lat / 2) + 1, lo = 2 * Math.floor(lng / 2) + 1;
    return cellMaps[key].get(`${la},${lo}`);
  };
  const state = { mode: "signal", month: 6, clicks: [], layer: "sst", date: "2026-08-15", winter: 0, token: 0, playing: null,
    src: SSHM ? "ssh" : "sst",
    sigs: ["nino34_giss", "nao_power", "msl_portland", "seaice_arctic", "pdo_ncei"], readMonths: {} };   // Test a winter: chosen clues; a month picked for a clue (otherwise its best)
  const el = $("globe");
  let world = null;
  const baseImg = null, baseReady = Promise.resolve();   // imagery is composited onto the parchment (MS.paper)

  // arcs: colour runs from faint at the source to bright at New York; "glow" adds a wide faint twin underneath
  const fade = (hex, a) => { const p = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgba(${p.join(",")},${a})`; };
  const staticArcs = [
    { p: P.nino34_giss, hue: NEON.amber, stroke: 1.1, dash: true, glow: true, text: "★ proven clue · 4–5 months ahead" },
    { p: P.nao_power, hue: NEON.cyan, stroke: 0.55, dash: true, glow: false, text: "clue for the same month" },
    { p: P.pdo_ncei, hue: NEON.dim, stroke: 0.35, dash: false, glow: false, text: "looked promising; missed recent winters" },
    { p: P.seaice_arctic, hue: NEON.dim, stroke: 0.35, dash: false, glow: false, text: "tested, no clue" },
    { p: P.subpolar_giss, hue: NEON.dim, stroke: 0.35, dash: false, glow: false, text: "tested, no clue" },
  ].filter(a => a.p).map(a => ({ ...a, lat: a.p.lat, lng: a.p.lon, color: [fade(a.hue, 0.35), a.hue],
    tip: `<b>${a.p.label}</b><br>${km(a.p.distance_km)} km from New York Harbor<br>${a.text}` }));
  // the confirmed link gets a second, thin "pentimento" stroke beside it, like a redrawn pen line
  const withGlow = arcs => arcs.flatMap(a => (a.glow ? [{ ...a, stroke: a.stroke * 0.35, color: [fade(a.hue, 0.15), fade(a.hue, 0.55)], dash: false, isGlow: true, alt: 0.42 }, a] : [a]));
  const sourceLabels = [
    { lat: -9, lng: -160, text: "El Niño region · Niño3.4", size: 0.9, color: NEON.amber, swirl: true },
    { lat: 51, lng: -24, text: "North Atlantic pressure · NAO", size: 0.7, color: "#2c4a6b" },
    { lat: 40, lng: -170, text: "North Pacific · PDO", size: 0.6, color: "#6b5a43" },
    { lat: 80, lng: -170, text: "Arctic sea ice", size: 0.6, color: "#6b5a43" },
  ];
  const nyLabel = { lat: battery.lat, lng: battery.lng, text: "New York Harbor", size: 1.1, color: NEON.cyan, alt: 0.16, swirl: true };
  // Leonardo's water vortex, drawn in ink and slowly turning (CSS animation), placed on the globe as an HTML element
  const VORTEX = `<svg viewBox="-50 -50 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round">
    <path stroke-width="1.6" d="M0 0 C 6 -2, 8 6, 2 9 C -6 13, -14 4, -11 -5 C -7 -16, 9 -19, 17 -9 C 26 2, 18 22, 2 25 C -18 29, -32 14, -30 -4 C -28 -24, -8 -36, 12 -33 C 34 -29, 44 -8, 38 12"/>
    <path stroke-width="0.9" opacity=".7" d="M3 3 C 9 1, 12 9, 5 13 C -4 18, -17 9, -15 -3 C -12 -18, 7 -24, 18 -15 C 30 -5, 27 18, 9 26 C -10 34, -30 24, -35 6"/>
    <path stroke-width="0.7" opacity=".5" d="M-38 18 C -30 30, -14 38, 4 37 M30 -30 C 38 -22, 43 -12, 44 -2"/></g></svg>`;
  let showHolo = true;   // true when the globe shows the dark grid base (land drawn as glowing dots)
  fetch("data/land.json").then(r => r.json()).then(j => {
    const paths = landPaths(j.features);
    MS.lines = makeLines(paths); MS.hatch = makeHatch(paths);
    HOLO = composeManuscript();
    if (world && showHolo) setTexture(null);
  }).catch(() => {});

  // ------------------------------------------------------------------ what each mode puts on the globe
  // Bars and towers are kept as the same objects from frame to frame, so the globe library tweens their height and
  // width (pointsTransitionDuration) instead of redrawing them: months and winters then flow into each other.
  const TWEEN_MS = 1000;
  const cellObjs = new Map();
  let shownBars = [], barsTimer = 0;
  function barsFor(month) {
    const seen = new Set(), out = [];
    for (const [lat, lng, r] of CM().maps[String(month)]) {
      if (Math.abs(r) < CM().r_p05) continue;
      const key = `${lat},${lng}`;
      let o = cellObjs.get(key);
      if (!o) { o = { lat, lng, r }; cellObjs.set(key, o); }
      o.r = r; o.hide = false; seen.add(key); out.push(o);
    }
    for (const o of shownBars) if (!seen.has(`${o.lat},${o.lng}`)) { o.hide = true; out.push(o); }   // shrink away, then dropped
    shownBars = out.filter(o => !o.hide);
    return out;
  }
  const towerObjs = [];
  function towers() {
    const i = state.winter, W = WINTERS[i];
    // columns over the Atlantic just east of New York; height = surge days: observed, trend, then each chosen signal
    const cols = [["What happened", W.observed, "#2a1a0c"], ["Simple guess", W.trend, "#7c8ea8"],
      ...state.sigs.filter(k => lab.has(k)).map((k, j) => [lab.label(k), lab.pred(k, i), INKS[j]])];
    return cols.map(([name, days, color], j) => Object.assign(towerObjs[j] || (towerObjs[j] = { kind: "tower" }),
      { name, days, color, lat: 36, lng: -70 + j * 9, alt: 0.01 + days * 0.016 }));
  }
  // arcs from each chosen signal's place to New York, in that signal's ink
  const sigArcs = () => state.sigs.filter(k => P[k] && P[k].distance_km > 60).map((k, j) => ({ p: P[k], hue: INKS[j], stroke: j ? 0.7 : 1.1, dash: true, glow: j === 0,
    lat: P[k].lat, lng: P[k].lon, color: [fade(INKS[j], 0.35), INKS[j]], tip: `<b>${P[k].label}</b><br>${km(P[k].distance_km)} km from New York Harbor` }));
  const sigLabels = () => state.sigs.filter(k => P[k]).map((k, j) => ({ lat: P[k].lat + (P[k].distance_km < 600 ? 3 + 2.5 * j : -6), lng: P[k].lon, text: lab.label(k), size: 0.75, color: INKS[j], swirl: j === 0 }));
  function refresh() {
    if (!world) return;
    updateKey();
    const m = state.mode;
    const bars = m === "signal" && !state.pic ? barsFor(state.month) : (shownBars = [], []);   // the satellite picture replaces the bars
    const tw = [];   // the winter's numbers are drawn as a 2D bar chart in the note instead of 3D columns on the globe
    world.pointsData([...bars, ...tw]);
    // bars that faded out (radius 0) are dropped once the tween has finished
    clearTimeout(barsTimer);
    if (bars.some(o => o.hide)) barsTimer = setTimeout(() => { if (world && state.mode === "signal") world.pointsData(world.pointsData().filter(o => !o.hide)); }, TWEEN_MS + 120);
    const arcs = m === "signal" ? [...staticArcs, ...state.clicks] : m === "winter" ? sigArcs() : state.clicks;
    world.arcsData(withGlow(arcs));
    const labels = [m === "winter" ? { ...nyLabel, lat: 45, lng: -80, alt: 0.02 } : nyLabel, ...(m === "signal" ? sourceLabels : m === "winter" ? sigLabels() : []),
      ...(el.clientWidth < 520 ? [] : tw).map(t => ({ lat: t.lat, lng: t.lng, text: `${t.days % 1 ? t.days.toFixed(1) : t.days}`, size: 1.5, color: t.color, alt: t.alt + 0.06 })),
      ...state.clicks.slice(-1).map(c => ({ lat: c.lat, lng: c.lng, text: c.short, size: 0.7, color: NEON.cyan, alt: 0.1 }))];
    world.htmlElementsData(labels);
    const nino = { lat: 0, lng: -145, color: NEON.amber, maxR: 9, speed: 2.2, period: 1800 };
    const sigRings = state.sigs.filter(k => P[k]).map((k, j) => ({ lat: P[k].lat, lng: P[k].lon, color: INKS[j], maxR: j ? 5 : 8, speed: 2, period: 1600 }));
    world.ringsData([{ ...battery, color: NEON.cyan, maxR: 5, speed: 1.6, period: 1300 }, ...(m === "signal" ? [nino] : m === "winter" ? sigRings : []),
      ...state.clicks.slice(-1).map(c => ({ lat: c.lat, lng: c.lng, color: c.hue, maxR: 4, speed: 2, period: 900 }))]);
  }

  // null = the dark holographic grid with glowing land dots; a URL = NASA imagery (land is in the picture)
  // Swap the globe's picture by cross-fading the old canvas into the new one on the globe's own texture, so dates and
  // winters dissolve into each other instead of jumping. null = the bare parchment.
  let shownCanvas = null, fadeRaf = 0, fadeOn = false;
  const fadeCanvas = document.createElement("canvas"); fadeCanvas.width = TW; fadeCanvas.height = TH;
  const fctx = fadeCanvas.getContext("2d");
  function setTexture(canvas) {
    if (!world) return;
    showHolo = !canvas;
    if (!canvas) { state.shown = null; if (typeof updateKey === "function") updateKey(); }
    const next = canvas || HOLO, mat = world.globeMaterial(), map = mat && mat.map;
    if (!map || !map.image || !shownCanvas || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(fadeRaf); fadeOn = false;
      if (map && map.image && shownCanvas) { fctx.globalAlpha = 1; fctx.drawImage(next, 0, 0); map.image = fadeCanvas; map.needsUpdate = true; }
      else world.globeImageUrl(next.toDataURL("image/jpeg", 0.9));
      shownCanvas = next; return;
    }
    let prev = shownCanvas;
    if (fadeOn) {   // a fade is still running: start from what is on screen now
      prev = document.createElement("canvas"); prev.width = TW; prev.height = TH; prev.getContext("2d").drawImage(fadeCanvas, 0, 0);
    }
    cancelAnimationFrame(fadeRaf); shownCanvas = next; fadeOn = true;
    // ~12 texture uploads per fade (one every ~65 ms) instead of one per frame: the same look at a fraction of the work
    const t0 = performance.now(), dur = 800; let last = 0;
    const step = now => {
      const a = Math.min(1, (now - t0) / dur), e = a * a * (3 - 2 * a);   // smoothstep
      if (a < 1 && now - last < 65) { fadeRaf = requestAnimationFrame(step); return; }
      last = now;
      fctx.globalAlpha = 1; fctx.drawImage(prev, 0, 0); fctx.globalAlpha = e; fctx.drawImage(next, 0, 0); fctx.globalAlpha = 1;
      map.image = fadeCanvas; map.needsUpdate = true;
      if (a < 1) fadeRaf = requestAnimationFrame(step); else fadeOn = false;
    };
    fadeRaf = requestAnimationFrame(step);
  }
  async function showImagery(layerKey, date, hd = true) {
    const L = LAYERS[layerKey], token = ++state.token;
    $("nasa-status").textContent = "Loading NASA imagery…";
    await baseReady;
    let d = date, url = null;
    for (let k = 0; k < 4 && !url; k++) {            // a few dates are missing in the archive: step back a day
      url = await composeImagery(L, d, 2, baseImg);
      if (token !== state.token) return;
      if (!url) d = iso(new Date(toDate(d).getTime() - day));
    }
    if (!url) { $("nasa-status").textContent = "NASA imagery could not be loaded (offline?). Showing the base map."; setTexture(null); return; }
    setTexture(url);
    $("nasa-status").textContent = `${L.label} · ${d} · NASA GIBS`;
    state.shown = { layer: layerKey, date: d }; updateKey();
    if (hd) {
      await new Promise(r => setTimeout(r, 600));
      if (token !== state.token) return;
      const sharp = await composeImagery(L, d, 3, baseImg);
      if (sharp && token === state.token) setTexture(sharp);
    }
  }

  // ------------------------------------------------------------------ B: click anywhere
  // Only places with a clue answer: a tap snaps to the nearest clue within ~1,200 km; elsewhere the pen line says so.
  function nearestClue(m, lat, lng, maxKm = 1200) {
    let best = null, bd = maxKm;
    for (const c of CM().maps[String(m)]) {
      if (Math.abs(c[2]) < CM().r_p05) continue;
      const d = gcKm({ lat, lng }, { lat: c[0], lng: c[1] }); if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // a tour of the clearest clues this month: strongest first, at least ~2,500 km apart
  function clueTour(m) {
    const cells = CM().maps[String(m)].filter(c => Math.abs(c[2]) >= CM().r_p05).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
    const picked = [];
    for (const c of cells) {
      if (picked.every(p => gcKm({ lat: p[0], lng: p[1] }, { lat: c[0], lng: c[1] }) > 2500)) picked.push(c);
      if (picked.length >= 8) break;
    }
    return picked;
  }
  function ask(lat, lng) {
    const m = state.mode === "nasa" ? Number(state.date.slice(5, 7)) : state.month;
    let r = cellR(m, lat, lng);
    if (r === undefined || Math.abs(r) < CM().r_p05) {
      const c = nearestClue(m, lat, lng);
      if (!c) { $("hud-cursor").textContent = "no clue here · tap a coloured bar, or press “Next clue”"; return; }
      [lat, lng, r] = c;
    }
    const d = gcKm({ lat, lng }, battery);
    const inBox = lat >= G.nino34_box[0] && lat <= G.nino34_box[1] && lng >= G.nino34_box[2] && lng <= G.nino34_box[3];
    const hue = r === undefined ? NEON.dim : r > 0 ? NEON.warm1 : NEON.cool1;
    const strength = r === undefined ? "no link" : Math.abs(r) >= 0.45 ? "strong link" : Math.abs(r) >= CM().r_p05 ? "clear link" : "weak link";
    state.clicks.push({ lat, lng, hue, color: [fade(hue, 0.1), hue], stroke: r === undefined ? 0.25 : 0.3 + 2.2 * Math.abs(r), dash: true,
      glow: r !== undefined && Math.abs(r) >= CM().r_p05, short: `${fmtLL(lat, lng)}`,
      tip: `<b>${fmtLL(lat, lng)}</b><br>${km(d)} km from New York Harbor<br>${strength}` });
    if (state.clicks.length > 5) state.clicks.shift();
    const lead = m < 10 ? `${10 - m} months before the stormy season` : "during the stormy season";
    const pct = r === undefined ? 0 : Math.round(Math.min(1, Math.abs(r) / 0.6) * 100);
    const status = inBox ? `<span class="chip-s ok">★ proven clue</span>` : r === undefined ? `<span class="chip-s none">no clue</span>` : `<span class="chip-s warn">possible clue</span>`;
    $("globe-info").innerHTML = `<div class="hud-h"><span class="blink">§</span> Nota · the place you tapped</div>
      <div class="hud-coord">${fmtLL(lat, lng)}</div>
      <dl class="hud-rows">
        <dt>Distance</dt><dd>${km(d)} km</dd>
        <dt>Read in</dt><dd>${MONTHS[m - 1]}</dd>
        <dt>Link</dt><dd style="color:${hue}">${strength}</dd>
        <dt>Verdict</dt><dd>${status}</dd>
      </dl>
      <div class="meter"><i style="width:${pct}%;background:${hue}"></i></div>
      <p>${r === undefined ? "Temperature here tracks nothing in New York's winters."
        : state.src === "ssh"
          ? `When the sea stands <strong>${r > 0 ? "higher" : "lower"}</strong> than usual here in ${MONTHS[m - 1]} (NASA altimetry), ${lead}, New York tends to get more storm-surge days.`
          : `When it is <strong>${r > 0 ? "warmer" : "cooler"}</strong> than usual here in ${MONTHS[m - 1]}, ${lead}, New York tends to get more storm-surge days.`}</p>
      ${inBox ? `<p class="ok">This is the El Niño region, the clue that held up when tested on recent winters.</p>`
        : `<p class="warn">The El Niño region (dashed outline) is the clue that held up on recent winters.</p>`}
      <p class="muted">Thicker line = closer link. <button type="button" class="link-btn" data-next-clue>Next clue ›</button></p>`;
    openNota(true);   // a tap always brings the note back
    refresh();
  }

  // ------------------------------------------------------------------ build the globe
  try {
    world = new window.Globe(el, { animateIn: false })
      .globeImageUrl(HOLO.toDataURL("image/jpeg", 0.9)).backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true).atmosphereColor("#6b4a26").atmosphereAltitude(0.06)
      .width(el.clientWidth).height(el.clientHeight)
      .pointLat("lat").pointLng("lng").pointResolution(5).pointsMerge(false)
      .pointsTransitionDuration(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : TWEEN_MS)
      .pointRadius(d => (d.kind === "tower" ? 1.7 : d.hide ? 0 : 0.26))
      .pointAltitude(d => (d.kind === "tower" ? d.alt : d.hide ? 0 : 0.01 + 0.85 * (Math.abs(d.r) - CM().r_p05)))
      .pointColor(d => (d.kind === "tower" ? d.color : colorFor(d.r, CM().r_p05)))
      .pointLabel(d => (d.kind === "tower" ? `<div class="tip"><b>${d.name}</b><br>${d.days} surge days</div>`
        : `<div class="tip">${fmtLL(d.lat, d.lng)}<br>${state.src === "ssh" ? (d.r > 0 ? "sea higher" : "sea lower") : (d.r > 0 ? "warmer" : "cooler")} here → more storm-surge days<br>tap to ask this place</div>`))
      .arcStartLat("lat").arcStartLng("lng").arcEndLat(() => battery.lat).arcEndLng(() => battery.lng)
      .arcColor("color").arcStroke("stroke").arcAltitudeAutoScale(0.35).arcsTransitionDuration(0)
      .arcAltitude(a => a.alt ?? null)
      .arcDashLength(a => (a.dash ? 0.1 : 1)).arcDashGap(a => (a.dash ? 0.035 : 0)).arcDashInitialGap(a => (a.dash ? 1 : 0))
      .arcDashAnimateTime(a => (a.dash ? 5000 : 0))
      .arcLabel(a => (a.isGlow ? null : `<div class="tip">${a.tip}</div>`))
      .htmlLat("lat").htmlLng("lng").htmlAltitude(d => d.alt ?? 0.16).htmlTransitionDuration(0)
      .htmlElement(d => { const e = document.createElement("div"); e.className = "globe-label"; e.textContent = d.text;
        if (d.swirl) { const s = document.createElement("span"); s.className = "vortex"; s.innerHTML = VORTEX; e.prepend(s); }
        e.style.color = d.color; e.style.fontSize = `${Math.round(11 + 3 * d.size)}px`; return e; })
      .pathsData([boxPath(G.nino34_box)]).pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathPointAlt(0.012)
      .pathColor(() => NEON.amber).pathStroke(1.4).pathDashLength(0.06).pathDashGap(0.02).pathDashAnimateTime(6000).pathTransitionDuration(0)
      .ringLat("lat").ringLng("lng").ringColor(d => t => fade(d.color || NEON.cyan, Math.max(0, 1 - t)))
      .ringMaxRadius(d => d.maxR || 4).ringPropagationSpeed(d => d.speed || 1.5).ringRepeatPeriod(d => d.period || 1400);
    world.pointOfView({ lat: 18, lng: -108, altitude: el.clientWidth < 520 ? 3.1 : 2.2 }, 0);
    // keep the page light: draw at most 1.25 device pixels per CSS pixel, and stop drawing the globe entirely while it
    // is scrolled out of view or the tab is in the background
    try { world.renderer().setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1)); } catch (e) { /* older globe.gl */ }
    let onScreen = true;
    const wake = () => { if (onScreen && !document.hidden) world.resumeAnimation(); else world.pauseAnimation(); };
    new IntersectionObserver(es => { onScreen = es[0].isIntersecting; wake(); }, { threshold: 0.02 }).observe(el);
    document.addEventListener("visibilitychange", wake);
    const ctl = world.controls();
    ctl.enableZoom = false;
    // slow idle spin; any touch stops it, it resumes after 10 s of quiet (never with reduced motion or in "Test a winter")
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idleTimer = null;
    const spin = on => { ctl.autoRotate = on && !calm && state.mode !== "winter"; ctl.autoRotateSpeed = 0.35; };
    const nudge = () => { spin(false); clearTimeout(idleTimer); idleTimer = setTimeout(() => spin(true), 10000); };
    el.addEventListener("pointerdown", nudge); el.addEventListener("wheel", nudge, { passive: true });
    state.spin = spin;
    spin(true);
    // live cursor readout (lat/lon, range to New York, link strength under the cursor)
    let raf = 0;
    el.addEventListener("pointermove", e => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const box = el.getBoundingClientRect(), c = world.toGlobeCoords(e.clientX - box.left, e.clientY - box.top);
        const out = $("hud-cursor"); if (!out) return;
        if (!c) { out.textContent = "beyond the Earth"; return; }
        const m = state.mode === "nasa" ? Number(state.date.slice(5, 7)) : state.month, rr = cellR(m, c.lat, c.lng);
        out.textContent = `${fmtLL(c.lat, c.lng)} · ${km(gcKm(c, battery))} km from New York · ${rr === undefined ? "no link" : Math.abs(rr) >= 0.45 ? "strong link" : Math.abs(rr) >= CM().r_p05 ? "clear link" : "weak link"}`;
      });
    });
    new ResizeObserver(() => world.width(el.clientWidth).height(el.clientHeight)).observe(el);
    // Click = press and release at (almost) the same spot. Done here rather than with the library's hover-based
    // click so that it also works on touch screens and right after the page becomes visible.
    let down = null;
    el.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener("pointerup", e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (moved > 6 || dt > 700) return;                       // that was a drag (rotate), not a click
      const box = el.getBoundingClientRect(), cam = world.camera();
      world.controls().update(); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      const c = world.toGlobeCoords(e.clientX - box.left, e.clientY - box.top);
      if (c) ask(c.lat, c.lng);
    });
  } catch (err) {
    console.error("globe failed", err);
    el.textContent = "The 3D globe needs WebGL. The charts and table below show the same results.";
    el.style.cssText = "display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#c3c2b7";
  }
  const fly = (lat, lng, altitude) => world && world.pointOfView({ lat, lng, altitude: el.clientWidth < 520 ? altitude * 1.35 : altitude }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200);
  const stopPlay = () => { if (state.playing) { clearInterval(state.playing); state.playing = null; }
    for (const id of ["globe-play", "nasa-play", "winter-play"]) { $(id).textContent = "▶ Play"; $(id).setAttribute("aria-pressed", "false"); } };
  function togglePlay(btn, tick, ms) {
    if (state.playing) return stopPlay();
    $(btn).textContent = "❚❚ Pause"; $(btn).setAttribute("aria-pressed", "true");
    state.playing = setInterval(tick, ms);
  }

  // ------------------------------------------------------------------ mode: signal
  const mSlider = $("globe-month");
  function setMonth(m) {
    state.month = m; mSlider.value = String(m); $("globe-month-label").textContent = monthLabel(m);
    if (state.pic) showPic({ layer: picLayer(), date: picDate(m, picLayer()), auto: true }); else refresh();
  }
  // The NASA satellite picture, folded into "Find the clue": sea temperature in the chosen month of the latest year
  // (it follows the month slider and the Play button), or one of two key moments.
  const picDate = (m, layer = "sst") => {   // the chosen month in the latest year the layer covers
    const end = LAYERS[layer].end, y = Number(end.slice(0, 4)), d = `${y}-${String(m).padStart(2, "0")}-15`;
    return d <= end ? d : `${y - 1}-${String(m).padStart(2, "0")}-15`;
  };
  const picLayer = () => (state.src === "ssh" ? "ssh" : "sst");   // the picture follows the temperature / altimetry switch
  function showPic(pic) {
    state.pic = pic; state.layer = pic ? pic.layer : state.layer;
    $("globe-pic").setAttribute("aria-pressed", String(!!pic));
    $("globe-pic").textContent = pic ? "Hide the satellite picture" : "Show the NASA satellite picture";
    $("pic-legend").hidden = !pic; $("legend-signal").hidden = !!pic;
    $("pic-moments").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(!!pic && !pic.auto && b.dataset.date === pic.date)));
    if (!pic) { state.token++; setTexture(null); $("nasa-status").textContent = ""; refresh(); return; }
    $("pic-legend").innerHTML = scaleHtml(LAYERS[pic.layer]) + `<span>${LAYERS[pic.layer].key}</span>`;
    refresh(); showImagery(pic.layer, pic.date, !state.playing);
  }
  const moments = [
    { text: "This year's El Niño · Aug 2026 (temperature)", layer: "sst", date: "2026-08-15", pov: [5, -135, 2.0] },
    { text: "Great El Niño · Nov 1997 (sea height)", layer: "ssh", date: "1997-11-15", pov: [5, -135, 2.0] },
    { text: "Blizzard hits New York · Jan 2016", layer: "clouds", date: "2016-01-23", pov: [36, -70, 1.3] },
  ];
  $("pic-moments").innerHTML = moments.map((p, i) => `<button type="button" data-i="${i}" data-date="${p.date}">${p.text}</button>`).join("");
  $("pic-moments").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"), p = b && moments[b.dataset.i]; if (!p) return;
    stopPlay(); showPic({ layer: p.layer, date: p.date, auto: false }); fly(...p.pov);
  });
  $("globe-pic").addEventListener("click", () => showPic(state.pic ? null : { layer: picLayer(), date: picDate(state.month, picLayer()), auto: true }));
  mSlider.addEventListener("input", () => setMonth(Number(mSlider.value)));
  $("globe-play").addEventListener("click", () => togglePlay("globe-play", () => setMonth(state.month % 12 + 1), 1400));

  // ------------------------------------------------------------------ mode: nasa
  const dSlider = $("nasa-date");
  function setLayer(key, date) {
    const L = LAYERS[key];
    state.layer = key;
    $("nasa-layers").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layer === key)));
    const span = Math.round((toDate(L.end) - toDate(L.start)) / day);
    dSlider.max = String(Math.floor(span / L.step));
    const clamped = iso(new Date(Math.min(toDate(L.end), Math.max(toDate(L.start), toDate(date || state.date)))));
    $("nasa-legend").innerHTML = scaleHtml(L) + `<span>${L.key}</span>`;
    setDate(clamped);
  }
  function setDate(date, hd = true) {
    const L = LAYERS[state.layer];
    state.date = date;
    dSlider.value = String(Math.round((toDate(date) - toDate(L.start)) / day / L.step));
    $("nasa-date-label").textContent = toDate(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    if (state.mode === "nasa") showImagery(state.layer, date, hd);
  }
  dSlider.addEventListener("input", () => { stopPlay(); setDate(iso(new Date(toDate(LAYERS[state.layer].start).getTime() + Number(dSlider.value) * LAYERS[state.layer].step * day)), false); });
  dSlider.addEventListener("change", () => showImagery(state.layer, state.date, true));
  $("nasa-play").addEventListener("click", () => togglePlay("nasa-play", () => {
    const L = LAYERS[state.layer], next = toDate(state.date).getTime() + L.play * day;
    setDate(iso(new Date(next > toDate(L.end) ? toDate(L.start) : next)), false);
  }, 1500));
  const big = G.surge_dates ? G.surge_dates.top_days[0] : null;
  const presets = [
    { text: "This year's El Niño · Aug 2026", layer: "sst", date: "2026-08-15", pov: [5, -135, 2.0] },
    { text: "Great El Niño · Nov 1997", layer: "ssh", date: "1997-11-15", pov: [5, -135, 2.0] },
    { text: "El Niño · Nov 2015", layer: "ssh", date: "2015-11-15", pov: [5, -135, 2.0] },
    { text: "Blizzard hits New York · Jan 2016", layer: "clouds", date: "2016-01-23", pov: [36, -70, 1.3] },
    ...(big ? [{ text: `Biggest recent surge · ${toDate(big.date).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`,
      layer: "clouds", date: big.date, pov: [36, -70, 1.3] }] : []),
  ];
  $("nasa-presets").innerHTML = `<span class="presets-ask">Jump to a moment:</span>` + presets.map((p, i) => `<button type="button" data-i="${i}">${p.text}</button>`).join("");
  $("nasa-presets").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); const p = b && presets[b.dataset.i]; if (!p) return;
    stopPlay(); setLayer(p.layer, p.date); fly(...p.pov);
    $("nasa-presets").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  $("nasa-layers").addEventListener("click", e => { const b = e.target.closest("button[data-layer]"); if (b) { stopPlay(); setLayer(b.dataset.layer); } });
  $("globe-best").addEventListener("click", () => { stopPlay(); setMonth(6); fly(2, -150, 2.0); ask(0, -145); });
  // "Next clue": fly from one clear clue to the next for the chosen month (also offered in the note after each tap)
  let tourI = -1;
  function nextClue() {
    stopPlay();
    const t = clueTour(state.month); if (!t.length) return;
    tourI = (tourI + 1) % t.length;
    const [la, lo] = t[tourI];
    fly(la, lo, 1.9); ask(la, lo);
  }
  $("globe-next").addEventListener("click", nextClue);
  $("globe-info").addEventListener("click", e => { if (e.target.closest("[data-next-clue]")) nextClue(); });

  // ------------------------------------------------------------------ mode: winter
  const SW = G.sw || null, wSlider = $("winter-year");
  const WINTERS = SW ? SW.seasons.map((year, i) => ({ year, observed: SW.observed[i], trend: SW.trend_loo[i] }))
    : (G.winters || []).map(w => ({ year: w.year, observed: w.observed, trend: w.trend }));
  wSlider.max = String(Math.max(0, WINTERS.length - 1));
  const WSCALE = Math.max(25, ...WINTERS.map(w => w.observed)) * 1.05;   // one fixed scale for the note's bars, so they can glide
  const lab = winterLab($("winter-timeline"), SW, P, state, i => { stopPlay(); setWinter(i); }, () => { lab.render(); setWinter(state.winter); });
  if (!SW) Object.assign(lab, { pred: () => 0, label: k => k, has: () => false });
  function setWinter(i) {
    state.winter = Math.max(0, Math.min(WINTERS.length - 1, i));
    const w = WINTERS[state.winter], yy = `${w.year}–${String(w.year + 1).slice(2)}`;
    wSlider.value = String(state.winter);
    $("winter-label").textContent = `Winter ${yy}`;
    const sigs = state.sigs.filter(k => lab.has(k));
    const vals = sigs.map(k => lab.pred(k, state.winter));
    const m0 = sigs.length ? lab.monthOf(sigs[0]) : 6, mon = MONTHS[m0 - 1];
    const when = k => { const m = lab.monthOf(k), a = 10 - m; return `read in ${MONTHS[m - 1].slice(0, 3)}, ${a} month${a > 1 ? "s" : ""} ahead`; };
    // a 2D bar chart that stays in place from winter to winter: bars glide to the new values (CSS width transition),
    // a thin ink mark in every row shows what really happened, so the nearest bar is easy to spot
    const rows = [{ key: "obs", name: "What happened", v: w.observed, c: "#2a1a0c" }, { key: "trend", name: "Simple guess", v: w.trend, c: "#7c8ea8" },
      ...sigs.map((k, j) => ({ key: k, name: lab.label(k), sub: when(k), v: vals[j], c: INKS[j] }))];
    const pct = v => `${Math.min(100, Math.max(0, v / WSCALE * 100)).toFixed(1)}%`;
    const info = $("globe-info"), layout = rows.map(r => r.key).join("|");
    if (info.dataset.view !== layout || !info.querySelector(".wbars")) {   // other modes write their own note here
      info.dataset.view = layout;
      info.innerHTML = `<div class="hud-h"><span class="blink">§</span> Nota · a winter put to the test</div>
        <div class="hud-coord" id="wb-title"></div>
        <div class="wbars">${rows.map(r => `<div class="wbar" data-k="${r.key}">
          <div class="wbar-name">${r.name}${r.sub ? `<small>${r.sub}</small>` : ""}</div>
          <div class="wbar-track"><i class="wbar-fill" style="background:${r.c};width:0"></i>${r.key === "obs" ? "" : `<b class="wbar-obs" style="left:0"></b>`}</div>
          <div class="wbar-val"></div></div>`).join("")}</div>
        <p class="big" id="wb-verdict"></p>
        <p class="muted">Storm-surge days at New York's Battery, October to April. Ink mark = what really happened. Each clue is read in its own month.</p>`;
      info.offsetWidth;   // start the bars from zero the first time
    }
    $("wb-title").textContent = `WINTER ${yy}`;
    for (const r of rows) {
      const row = info.querySelector(`.wbar[data-k="${r.key}"]`); if (!row) continue;
      row.querySelector(".wbar-fill").style.width = pct(r.v);
      const mark = row.querySelector(".wbar-obs"); if (mark) mark.style.left = pct(w.observed);
      row.querySelector(".wbar-val").textContent = r.key === "obs" ? `${r.v} days` : `${Math.round(r.v)}`;
      row.classList.toggle("best", false);
    }
    // the verdict: which clue came nearest this winter, and did it beat the simple guess
    const eT = Math.abs(w.observed - w.trend);
    const bi = vals.reduce((b, v, j) => (Math.abs(w.observed - v) < Math.abs(w.observed - vals[b]) ? j : b), 0);
    const v = $("wb-verdict");
    if (sigs.length && Math.abs(w.observed - vals[bi]) < eT) {
      v.className = "big ok"; v.textContent = `Closest: ${lab.label(sigs[bi])}`;
      const row = info.querySelector(`.wbar[data-k="${sigs[bi]}"]`); if (row) row.classList.add("best");
    } else { v.className = "big"; v.textContent = "The simple guess was closest"; }
    refresh();
    lab.point(state.winter);
    if (state.mode === "winter") {
      // the globe shows the ocean in the month the signals were read: what a forecaster could have seen
      const d = `${w.year}-${String(m0).padStart(2, "0")}-15`;
      const sshOK = d >= LAYERS.ssh.start && d <= LAYERS.ssh.end, sstOK = d >= LAYERS.sst.start;
      const key = state.src === "ssh" ? (sshOK ? "ssh" : sstOK ? "sst" : null) : (sstOK ? "sst" : sshOK ? "ssh" : null);   // follows the switch where both exist
      if (key) { state.layer = key; showImagery(key, d, !(state.playing || state.autoStep)); }   // no sharp re-load while playing: lighter
      else { state.token++; setTexture(null); $("nasa-status").textContent = `NASA satellite pictures begin in late 1992; the globe shows the base map for ${mon} ${w.year}.`; }
      $("winter-note").innerHTML = key ? `Globe: NASA ${key === "sst" ? "sea temperature" : "sea height"} on 15 ${mon} ${w.year}, when ${lab.label(sigs[0] || "nino34_giss")} was read. ` + scaleHtml(LAYERS[key]) : `Satellite pictures begin in late 1992.`;
    }
  }
  lab.render();
  wSlider.addEventListener("input", () => setWinter(Number(wSlider.value)));
  $("winter-prev").addEventListener("click", () => { stopPlay(); setWinter(state.winter - 1); });
  $("winter-next").addEventListener("click", () => { stopPlay(); setWinter(state.winter + 1); });
  // one click: walk through every winter, the pointer and the globe moving together
  $("winter-play").addEventListener("click", () => togglePlay("winter-play", () => setWinter((state.winter + 1) % WINTERS.length), 2200));

  // ------------------------------------------------------------------ mode switch
  const hint = `<div class="hud-h"><span class="blink">§</span> Nota · ask the Earth</div>
    <p>Tap anywhere on Earth. A line flies to New York: the thicker it is, the more that place knows about New York's coming winter.</p>
    <dl class="hud-rows"><dt>Clues tested</dt><dd>${G.predictors.length}</dd><dt>Proven clue</dt><dd class="ok">★ El Niño</dd>
      <dt>Winters checked</dt><dd>${G.n_seasons}</dd><dt>Distance</dt><dd>${km(P.nino34_giss ? P.nino34_giss.distance_km : 8400)} km</dd></dl>`;
  const nasaHint = `<div class="hud-h"><span class="blink">§</span> Nota · seen from space</div>
    <p>Pick a moment below. The globe shows what NASA satellites saw that day.</p>
    <p class="muted">Red chalk = warmer or higher than normal; blue ink = cooler or lower. Tap the ocean to ask what it knows about New York's winter.</p>`;
  // ------------------------------------------------------------------ "You are looking at": the key on the globe
  // One line that always says what each layer on the globe is, where it comes from, when, and how to read its colours;
  // the switch beside it chooses temperature or altimetry for both the clue bars and the satellite picture.
  const SRC_TXT = {
    ssh: { what: "sea-surface height", from: "NASA altimetry (MEaSUREs)", hi: "sea higher", lo: "sea lower" },
    sst: { what: "surface temperature", from: "NASA GISTEMP", hi: "warmer", lo: "cooler" },
  };
  const fmtDay = d => toDate(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  function updateKey() {
    const k = $("gk-text"); if (!k) return;
    const s = SRC_TXT[state.src], cm = CM(), parts = [];
    if (state.mode === "signal" && !state.pic)
      parts.push(`<b>Bars</b>: places where ${s.what} in <b>${MONTHS[state.month - 1]}</b> goes with New York's storm-surge days the next winter ` +
        `(${s.from}, ${cm.years[0]}–${cm.years[1]}, ${cm.n_seasons} winters). <i class="sw r"></i>${s.hi} → more surges · <i class="sw b"></i>${s.lo} → more surges · taller = closer link.`);
    if (state.shown) {
      const L = state.shown.layer;
      parts.push(L === "clouds" ? `<b>Picture</b>: what a NASA satellite (VIIRS) saw on <b>${fmtDay(state.shown.date)}</b>, clouds included.`
        : `<b>Picture</b>: NASA ${L === "ssh" ? "sea-surface height (altimetry, MEaSUREs)" : "sea temperature (GHRSST MUR)"} on <b>${fmtDay(state.shown.date)}</b>, ` +
          `against normal: <i class="sw r"></i>${L === "ssh" ? "higher" : "warmer"} · <i class="sw b"></i>${L === "ssh" ? "lower" : "cooler"} · ink lines every ${L === "ssh" ? "10 cm" : "1 °C"}.`);
    }
    if (!parts.length) parts.push(`<b>Globe</b>: the Earth on parchment; tap a coloured place, or switch the picture on.`);
    parts.push(`<b>Lines</b> fly to New York Harbor from the clue you picked.`);
    k.innerHTML = parts.join(" ");
    if ($("lg-hi")) { $("lg-hi").textContent = `${s.hi} here → more storm-surge days in New York`; $("lg-lo").textContent = `${s.lo} here → more storm-surge days`; }
    document.querySelectorAll("#gk-switch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.src === state.src)));
  }
  function setSrc(src) {
    if (src === "ssh" && !SSHM) return;
    state.src = src;
    if (state.mode === "signal") { if (state.pic && state.pic.auto) showPic({ layer: picLayer(), date: picDate(state.month, picLayer()), auto: true }); else refresh(); }
    if (state.mode === "winter") setWinter(state.winter);
    updateKey();
  }
  $("gk-switch").addEventListener("click", e => { const b = e.target.closest("button[data-src]"); if (b) setSrc(b.dataset.src); });
  if (!SSHM) $("gk-switch").querySelector('[data-src="ssh"]').disabled = true;

  const MODES = ["signal", "winter"];   // the public page shows two ways in; the old satellite mode lives on inside "signal"
  function setMode(mode) {
    stopPlay(); state.mode = mode;
    if (state.spin) state.spin(true);
    $("hud-mode").textContent = { signal: "Folio I · where the clue lies", nasa: "Folio I · what the satellites saw", winter: "Folio II · a winter put to the test" }[mode];
    for (const m of MODES) $(`tab-${m}`).setAttribute("aria-pressed", String(m === mode));
    for (const m of ["signal", "nasa", "winter"]) $(`panel-${m}`).hidden = m !== mode;
    $("drawer-title").textContent = { signal: "I · Find the clue", nasa: "See it from space", winter: "II · Test a winter" }[mode];
    $("winter-sheet").hidden = mode !== "winter";
    openDrawer(true);
    if (mode === "signal") { state.pic = null; showPic(null); $("globe-info").innerHTML = hint; fly(18, -108, 2.2); }
    if (mode === "nasa") { $("globe-info").innerHTML = nasaHint; refresh(); setLayer(state.layer, state.date); fly(5, -135, 2.0); }
    if (mode === "winter") { fly(27, -84, 1.7); setWinter(state.winter || Math.max(0, WINTERS.findIndex(w => w.year === 2015))); }
  }
  // one stage, pop-up sidebars: the rail picks the mode and opens its sidebar (tap the open one again to fold it away);
  // the note slides in on the right. The globe slides to stay centred in the space the sidebars leave free.
  const stage = $("globe-stage"), drawer = $("drawer"), notaWrap = $("nota-wrap");
  function centreGlobe() {
    if (matchMedia("(max-width: 820px)").matches) { el.style.transform = ""; return; }
    const railW = 64, left = stage.classList.contains("drawer-open") ? drawer.offsetLeft + drawer.offsetWidth : railW;
    const right = stage.classList.contains("nota-open") ? stage.clientWidth - notaWrap.offsetLeft : 0;
    const gx = Math.round((left - right) / 2);
    el.style.transform = `translateX(${gx}px)`; stage.style.setProperty("--gx", `${gx}px`);   // the title follows the globe
  }
  function openDrawer(on) { stage.classList.toggle("drawer-open", on); centreGlobe(); }
  function openNota(on) { stage.classList.toggle("nota-open", on); centreGlobe(); }
  for (const m of MODES) $(`tab-${m}`).addEventListener("click", () => {
    if (state.mode === m) openDrawer(!stage.classList.contains("drawer-open")); else setMode(m);
  });
  $("drawer-close").addEventListener("click", () => openDrawer(false));
  $("nota-close").addEventListener("click", () => openNota(false));
  $("nota-reopen").addEventListener("click", () => openNota(true));
  new ResizeObserver(centreGlobe).observe(stage);
  $("globe-month-label").textContent = monthLabel(state.month);
  setMode("signal");
  window.seaLevelGlobe = { world, state, ask, setMode, setMonth, setWinter, setLayer };   // for tests and scripted demos

  $("globe-caption").textContent = `Each bar marks a place whose sea height or temperature in the chosen month tracks how many storm-surge days New York's ` +
    `Battery gets the next winter; taller bar, closer link. Switch on the globe: NASA altimetry (MEaSUREs sea-surface height, ` +
    `${SSHM ? `${SSHM.years[0]}–${SSHM.years[1]}, ${SSHM.n_seasons} winters` : "not loaded"}) or NASA GISTEMP temperature (${G.years[0]}–${G.years[1]}, ${G.n_seasons} winters). ` +
    `Surge days: NOAA tide gauge. The outlined El Niño region is the clue that held up when tested on recent winters. Satellite pictures: NASA GIBS. Drag to spin, tap to ask.`;

  // ------------------------------------------------------------------ distance charts
  const s1 = css("--series-1"), s2 = css("--series-2");
  const groups = [["NASA data", p => p.nasa, s1], ["NOAA / USGS data", p => !p.nasa, s2]];
  const short = p => p.label.replace(/ \((NASA|NOAA)[^)]*\)/, "").replace(" sea level", "");
  function distChart(target, yOf, yTitle, labelled, zero) {
    const rows = G.predictors.filter(p => yOf(p) !== null && yOf(p) !== undefined && p.distance_km > 0);
    const traces = groups.map(([name, f, color]) => {
      const g = rows.filter(f);
      return { type: "scatter", mode: "markers", name, x: g.map(p => p.distance_km), y: g.map(yOf),
        marker: { color, size: 9, line: { color: css("--surface-1"), width: 2 } }, customdata: g.map(p => p.label),
        hovertemplate: "%{customdata}<br>%{x:,} km<br>" + yTitle + " %{y:.2f}<extra></extra>" };
    });
    const L = layoutBase();
    L.hovermode = "closest"; L.xaxis.type = "log"; L.xaxis.title = { text: "distance from New York Harbor (km)", font: { size: 12 } };
    L.xaxis.tickvals = [10, 100, 1000, 10000]; L.xaxis.ticktext = ["10", "100", "1,000", "10,000"];
    L.yaxis.ticksuffix = ""; L.yaxis.title = { text: yTitle, font: { size: 12 } }; L.margin.l = 60; L.margin.b = 48;
    if (zero) L.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: css("--axis"), width: 1.5 } }];
    L.annotations = rows.filter(p => labelled.includes(p.predictor)).map(p => ({
      x: Math.log10(p.distance_km), y: yOf(p), text: short(p), showarrow: false, xanchor: p.distance_km > 3000 ? "right" : "left",
      xshift: p.distance_km > 3000 ? -8 : 8, yshift: 8, font: { size: 11, color: css("--text-secondary") } }));
    if ($(target)) Plotly.react(target, traces, L, { displayModeBar: false, responsive: true });   // charts removed from the public page
  }
  distChart("dist-now", p => (p.same_month_r === null || p.same_month_r === undefined ? null : Math.abs(p.same_month_r)),
    "link this month (0 none, 1 perfect)", ["msl_sandy_hook", "wind_ne_power", "msl_charleston", "nino34_giss"], false);
  distChart("dist-later", p => p.season_loo_skill, "predicts next winter (above 0 = useful)", ["nino34_giss", "pdo_ncei", "msl_sandy_hook"], true);

  // ------------------------------------------------------------------ lead-time curve
  const L = layoutBase();
  L.hovermode = "x unified"; L.yaxis.ticksuffix = ""; L.yaxis.title = { text: "× storm-surge days per El Niño step", font: { size: 12 } };
  L.xaxis.tickvals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; L.xaxis.ticktext = MONTHS.map(m => m[0]); L.xaxis.tickangle = 0; L.margin.l = 60;
  L.legend = { ...L.legend, y: -0.18, x: 0, yanchor: "top" }; L.margin.b = 58; L.margin.t = 18;   // legend under the plot, clear of the season mark
  L.shapes = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), width: 1.5 } },
    { type: "line", yref: "paper", y0: 0, y1: 1, x0: 9.5, x1: 9.5, line: { color: css("--text-secondary"), dash: "dot", width: 1.5 } }];
  L.annotations = [{ x: 9.5, yref: "paper", y: 1, text: "season →", showarrow: false, xanchor: "left", xshift: 6,
    font: { size: 11, color: css("--text-secondary") } }];
  const curve = (idx, name, color) => {
    const c = G.lead_curve.filter(r => r.index === idx);
    return { type: "scatter", mode: "lines+markers", name, x: c.map(r => r.month), y: c.map(r => r.rr), line: { color, width: 2 }, marker: { size: 8 },
      error_y: { type: "data", symmetric: false, array: c.map(r => r.ci[1] - r.rr), arrayminus: c.map(r => r.rr - r.ci[0]), color, thickness: 1, width: 3 },
      hovertemplate: "×%{y:.2f}<extra>" + name + "</extra>" };
  };
  Plotly.react("lead-curve", [curve("nino34_giss", "NASA GISTEMP Niño3.4", s1), curve("oni", "NOAA ONI", s2)], L, { displayModeBar: false, responsive: true });
  const best = G.lead_curve.filter(r => r.index === "nino34_giss").reduce((a, b) => (b.loo > a.loo ? b : a));
  const first = G.lead_curve.filter(r => r.index === "nino34_giss" && r.p < 0.01)[0];
  $("lead-caption").innerHTML = `Each dot reads El Niño in one month and shows how many ` +
    `times more storm-surge days New York gets the next winter for each step of El Niño (one step = a typical year-to-year swing; 1 = no effect; ` +
    `bars = 95% range). The clue appears in ${MONTHS[first.month - 1]}. By ${MONTHS[best.month - 1]}, ${10 - best.month} months before the stormy season, ` +
    `it reads ×${best.rr.toFixed(2)}. NASA's and NOAA's temperature records agree.`;

  // ------------------------------------------------------------------ charts below talk to the globe
  // tap a month on the lead-time curve: Test a winter opens with El Niño read in that month;
  // tap a winter's bar in the New York chart: that winter is replayed on the globe
  const toGlobe = () => document.querySelector(".globe-card").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  // Lead-time chart: pick (or play) the month El Niño is read in; a band marks it and the readout gives the effect
  // and this year's outlook from that month; a button replays every winter on the globe with that reading month.
  const leadBase = L.shapes.slice();
  const OUT = Object.fromEntries((G.outlook || []).filter(o => o.index === "nino34_giss").map(o => [o.month, o]));
  const LC = Object.fromEntries(G.lead_curve.filter(r => r.index === "nino34_giss").map(r => [r.month, r]));
  let leadM = 6, leadTimer = null;
  // the month band is an HTML overlay that glides (CSS transition) instead of a Plotly shape that jumps
  const lcEl = $("lead-curve"), band = document.createElement("div");
  band.className = "lead-band"; lcEl.style.position = "relative"; lcEl.appendChild(band);
  function placeBand() {
    const fl = lcEl._fullLayout; if (!fl || !fl._size) return;
    const s = fl._size, [a, b] = fl.xaxis.range, px = x => s.l + (x - a) / (b - a) * s.w;
    band.style.left = `${px(leadM - 0.42)}px`; band.style.width = `${px(0.84) - px(0)}px`;
    band.style.top = `${s.t}px`; band.style.height = `${s.h}px`;
  }
  if (lcEl.on) lcEl.on("plotly_afterplot", placeBand);
  function setLeadMonth(m) {
    leadM = m; $("lead-month").value = String(m); $("lead-month-l").textContent = MONTHS[m - 1];
    placeBand();
    const r = LC[m], o = OUT[m], mon = MONTHS[m - 1];
    let t = m >= 10 ? `<b>${mon}</b> is already inside the stormy season.`
      : !r || r.p >= 0.05 ? `<b>Read in ${mon}</b>, ${10 - m} months ahead: the Pacific says little yet (×${r ? r.rr.toFixed(2) : "1.00"} per step).`
      : `<b>Read in ${mon}</b>, ${10 - m} months ahead: each step of El Niño brings <b>×${r.rr.toFixed(2)}</b> storm-surge days.`;
    if (o) t += ` This year's ${mon} reading: ${o.value_sd.toFixed(1)} steps${o.extrapolation ? ", the strongest since 1980" : ""}. ` +
      `Winter 2026–27 outlook: <b>about ${Math.round(o.expected)} storm-surge days</b> (likely ${Math.round(o.ci[0])}–${Math.round(o.ci[1])}), against about ${Math.round(o.trend_only)} in a normal winter.`;
    if (m <= 9) t += ` <button type="button" class="link-btn" id="lead-go">Replay 42 winters read in ${mon} →</button>`;
    $("lead-readout").innerHTML = t;
  }
  const stopLead = () => {};   // the month now steps on its own (the page's shared animator); touching the chart pauses it
  $("lead-month").addEventListener("input", () => setLeadMonth(Number($("lead-month").value)));
  if (window.SLDAnim) {
    window.SLDAnim.register($("lead-curve"), () => setLeadMonth(leadM % 12 + 1), 900);
    // the winter layers replay the winters on their own while "Test a winter" is open
    window.SLDAnim.register($("winter-timeline"), () => { state.autoStep = true; setWinter((state.winter + 1) % WINTERS.length); state.autoStep = false; }, 1500,
      () => state.mode === "winter" && !state.playing);
  }
  $("lead-readout").addEventListener("click", e => {
    if (!e.target.closest("#lead-go")) return;
    stopLead(); state.readMonths.nino34_giss = Math.min(9, leadM);
    if (!state.sigs.includes("nino34_giss")) state.sigs = ["nino34_giss", ...state.sigs].slice(0, INKS.length);
    if (state.mode !== "winter") setMode("winter"); else { lab.render(); setWinter(state.winter); }
    toGlobe();
  });
  const lc = $("lead-curve");
  if (lc && lc.on) lc.on("plotly_click", ev => { const m = ev.points && ev.points[0] && Number(ev.points[0].x); if (m) { stopLead(); setLeadMonth(m); } });
  setLeadMonth(6);
  const nc = $("ntrchart");
  if (nc && nc.on) nc.on("plotly_click", ev => {
    const yr = ev.points && ev.points[0] && parseInt(String(ev.points[0].x), 10); const i = WINTERS.findIndex(w => w.year === yr);
    if (i < 0) return;
    state.winter = i; if (state.mode !== "winter") setMode("winter"); else setWinter(i);
    toGlobe();
  });
  const ncap = $("ntr-caption"); if (ncap) ncap.innerHTML += ` <em class="tap-hint">Tap a winter's bar to replay it on the globe.</em>`;

  // ------------------------------------------------------------------ table
  const rows = [...G.predictors].sort((a, b) => a.distance_km - b.distance_km).map(p =>
    `<tr><td style="text-align:left">${p.label}</td><td>${km(p.distance_km)}</td>` +
    `<td>${p.same_month_r === null || p.same_month_r === undefined ? "–" : p.same_month_r.toFixed(2)}</td>` +
    `<td>${p.season_loo_skill === null || p.season_loo_skill === undefined ? "–" : p.season_loo_skill.toFixed(2)}</td>` +
    `<td>${p.predictor === "nino34_giss" || p.predictor === "oni" ? "★" : ""}</td></tr>`).join("");
  $("world-table").innerHTML = `<div class="table-scroll"><table><thead><tr><th style="text-align:left">Clue</th><th>Distance (km)</th>` +
    `<th>Link this month (r)</th><th>Predicts next winter (skill)</th><th>Proven</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
