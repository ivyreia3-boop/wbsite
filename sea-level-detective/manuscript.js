// Manuscript touches for the page: a pen sketch in the title page that draws itself (water eddies after Leonardo's
// studies of turbulent water, a small globe, and the beam from the Pacific to New York), and section rules that are
// drawn in as each section scrolls into view. Decoration only; nothing here carries data.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };

function spiral(cx, cy, a, b, turns, phase, dir = 1) {   // logarithmic spiral r = a e^(b t), drawn inward-out
  let d = "";
  for (let t = 0; t <= turns * 2 * Math.PI; t += 0.08) {
    const r = a * Math.exp(b * t), x = cx + dir * r * Math.cos(t + phase), y = cy + r * Math.sin(t + phase);
    d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d;
}
function wave(x0, y0, x1, amp, k, ph) {
  let d = "";
  for (let x = x0; x <= x1; x += 4) d += (d ? "L" : "M") + x + " " + (y0 + amp * Math.sin(k * (x - x0) + ph) + (x - x0) * 0.05).toFixed(1);
  return d;
}

function flourish() {
  const hero = document.querySelector(".hero"); if (!hero) return;
  const svg = el("svg", { class: "flourish", viewBox: "0 0 560 420", "aria-hidden": "true" }, null);
  hero.prepend(svg);
  const ink = "rgba(59,38,20,0.55)", red = "rgba(165,70,47,0.6)", faint = "rgba(59,38,20,0.25)";
  const paths = [];
  const add = (d, stroke, w, delay, parent = svg) => { const p = el("path", { d, stroke, "stroke-width": w, class: "draw" }, parent); p.style.setProperty("--d", delay + "s"); paths.push(p); return p; };

  // water pouring in from the left, curling into eddies (Leonardo, studies of water, c. 1510)
  for (let i = 0; i < 7; i++) add(wave(10, 150 + i * 14, 260, 6 + i, 0.045, i * 0.7), i % 3 ? faint : ink, 1.1, 0.1 * i);
  const eddy = el("g", { class: "spin" }, svg);
  for (let i = 0; i < 5; i++) add(spiral(330, 230, 4 + i * 1.5, 0.17, 2.6, i * 1.25), i === 0 ? red : ink, i === 0 ? 1.6 : 1.1, 0.6 + 0.15 * i, eddy);
  const small = el("g", { class: "spin" }, svg); small.style.animationDuration = "26s";
  for (let i = 0; i < 3; i++) add(spiral(250, 300, 3 + i, 0.2, 2.2, i * 2.1, -1), ink, 1, 1.2 + 0.15 * i, small);

  // a small globe in the corner, with the beam from the tropical Pacific to New York
  const gx = 470, gy = 110, R = 62;
  add(`M${gx + R} ${gy}A${R} ${R} 0 1 1 ${gx - R} ${gy}A${R} ${R} 0 1 1 ${gx + R} ${gy}`, ink, 1.3, 1.4);
  for (const rx of [20, 42]) add(`M${gx} ${gy - R}A${rx} ${R} 0 1 1 ${gx} ${gy + R}A${rx} ${R} 0 1 1 ${gx} ${gy - R}`, faint, 1, 1.6);
  add(`M${gx - R} ${gy}Q${gx} ${gy + 12} ${gx + R} ${gy}`, faint, 1, 1.7);
  add(`M${gx - 34} ${gy + 22}Q${gx - 20} ${gy - 46} ${gx + 22} ${gy - 30}`, red, 1.8, 2.0);   // Pacific -> New York
  el("circle", { cx: gx + 22, cy: gy - 30, r: 3, fill: "rgba(59,38,20,0.7)" }, svg);
  el("circle", { cx: gx - 34, cy: gy + 22, r: 3, fill: red }, svg);

  // mirror-written note, as in the notebooks
  const t = el("text", { x: -540, y: 400, class: "mirror", transform: "scale(-1,1)" }, svg);
  t.textContent = "l’acqua che tocchi de’ fiumi è l’ultima di quella che andò";

  for (const p of paths) p.style.setProperty("--len", Math.ceil(p.getTotalLength()));
}

function sectionRules() {
  const hs = document.querySelectorAll("main h2");
  if (!("IntersectionObserver" in window)) { hs.forEach(h => h.classList.add("drawn")); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("drawn"); io.unobserve(e.target); } }), { threshold: 0.6 });
  hs.forEach(h => io.observe(h));
}

flourish();
sectionRules();
