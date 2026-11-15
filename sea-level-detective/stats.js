// Browser statistics for Sea Level Detective.
// A line-for-line port of pipeline/stats.py: regression() and fit_with_index().
// Sea level in mm, trends in mm/yr. Tested against Python by tests/check_stats.mjs.

// ---------- special functions (Numerical Recipes style) ----------
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
/** Survival function P(T > t) of Student's t with df degrees of freedom (df may be fractional). */
export function tSF(t, df) {
  const x = df / (df + t * t);
  const tail = 0.5 * betai(df / 2, 0.5, x);
  return t >= 0 ? tail : 1 - tail;
}
/** Quantile of Student's t (bisection on the survival function). */
export function tPPF(p, df) {
  let lo = 0, hi = 1000;
  const target = 1 - p;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tSF(mid, df) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- small linear algebra ----------
function invert(A) {
  const n = A.length, M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("rank-deficient design");
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col];
      if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map(row => row.slice(n));
}

const ordinal = ym => { const [y, m] = ym.split("-").map(Number); return y * 12 + m; };

/** Lag-one correlation of residuals using only adjacent calendar months (stats.residual_rho). */
function residualRho(res, ords) {
  const a = [], b = [];
  for (let i = 0; i + 1 < res.length; i++) if (ords[i + 1] - ords[i] === 1) { a.push(res[i]); b.push(res[i + 1]); }
  const sd = v => { const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };
  if (a.length < 3 || sd(a) < 1e-12 || sd(b) < 1e-12) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return Math.min(0.99, Math.max(-0.99, num / Math.sqrt(da * db)));
}

/** OLS with AR(1) effective-sample-size covariance (stats.regression). */
export function regression(y, X, ords) {
  const n = y.length, k = X[0].length;
  if (n <= k + 2) throw new Error("too few observations");
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, idx) => s + r[i] * y[idx], 0));
  const inv = invert(XtX);
  const beta = inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const fitted = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
  const residual = y.map((v, i) => v - fitted[i]);
  const rho = residualRho(residual, ords);
  const r = Math.max(0, rho);
  const nEff = Math.min(n, Math.max(k + 1, n * (1 - r) / (1 + r)));
  const rss = residual.reduce((s, v) => s + v * v, 0);
  const scale = rss / (n - k) * n / nEff;
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, row[i] * scale)));
  const df = nEff - k;
  const crit = tPPF(0.975, df);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const tss = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  return { beta, se, ci: beta.map((b, i) => [b - crit * se[i], b + crit * se[i]]), residual, fitted, rho, nEff, df,
           r2: tss > 0 ? 1 - rss / tss : NaN };
}

/**
 * Trend of monthly sea level in [start, end] (YYYY-MM strings), optionally with an ENSO index regressed out
 * jointly (trend + annual + semiannual harmonics [+ index]), exactly as stats.fit_with_index with lag 0.
 * Returns trend (mm/yr), 95% CI, p, rho, nEff, n, residual SD, and the series with the index part removed.
 */
export function fitWindow(series, start, end, index = null) {
  const idxMap = index ? new Map(index.dates.map((d, i) => [d, index.values[i]])) : null;
  const rows = [];
  series.dates.forEach((d, i) => {
    if (d < start || d > end) return;
    const v = series.values[i];
    if (v === null || v === undefined || Number.isNaN(v)) return;
    if (idxMap) { const e = idxMap.get(d); if (e === null || e === undefined) return; rows.push({ d, v, e }); }
    else rows.push({ d, v });
  });
  if (rows.length < 36) return null;
  const ords = rows.map(r => ordinal(r.d));
  const t = ords.map(o => (o - ords[0]) / 12);
  const tbar = t.reduce((s, v) => s + v, 0) / t.length;
  const X = rows.map((r, i) => {
    const month = ords[i] - Math.floor((ords[i] - 1) / 12) * 12; // 1..12
    const ph = 2 * Math.PI * (month - 1) / 12;
    const base = [1, t[i] - tbar, Math.sin(ph), Math.cos(ph), Math.sin(2 * ph), Math.cos(2 * ph)];
    return idxMap ? [...base, r.e] : base;
  });
  const y = rows.map(r => r.v);
  const fit = regression(y, X, ords);
  const slope = fit.beta[1], se = fit.se[1];
  const p = se > 0 ? 2 * tSF(Math.abs(slope / se), fit.df) : (slope === 0 ? 1 : 0);
  const k = X[0].length;
  const resSD = Math.sqrt(fit.residual.reduce((s, v) => s + v * v, 0) / (y.length - k));
  const coef = idxMap ? fit.beta[k - 1] : null;
  // Fitted seasonal cycle (annual + semiannual harmonics), removed for display only.
  const seasonal = X.map(r => r[2] * fit.beta[2] + r[3] * fit.beta[3] + r[4] * fit.beta[4] + r[5] * fit.beta[5]);
  return {
    deseason: y.map((v, i) => v - seasonal[i]),
    removedDeseason: idxMap ? rows.map((r, i) => r.v - coef * r.e - seasonal[i]) : null,
    n: y.length, start: rows[0].d, end: rows[rows.length - 1].d, trend: slope, ci: fit.ci[1], p, rho: fit.rho,
    nEff: fit.nEff, r2: fit.r2, resSD, indexCoef: coef, indexCI: idxMap ? fit.ci[k - 1] : null,
    dates: rows.map(r => r.d), values: y,
    removed: idxMap ? rows.map(r => r.v - coef * r.e) : null,
    trendLine: rows.map((r, i) => fit.beta[0] + slope * (t[i] - tbar)),
  };
}

/** Weatherhead et al. (1998): years of monthly data needed to detect trend w (mm/yr), 90% power, 5% level. */
export function yearsToDetect(sigma, phi, w) {
  if (!(Math.abs(w) > 0)) return Infinity;
  const f = Math.max(0, Math.min(phi, 0.99));
  return Math.pow((3.3 * sigma / Math.abs(w)) * Math.sqrt((1 + f) / (1 - f)), 2 / 3);
}
