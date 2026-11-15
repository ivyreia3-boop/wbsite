// East / West: which coast the globe and the panels after it tell the story for. The page loads one coast at a time
// (?coast=west), so every chart and the globe are built once for that coast's data; the switch slides the stage and the
// panels out, loads the other coast and slides them back in.

const param = new URLSearchParams(location.search).get("coast");
const id = param === "west" ? "west" : "east";

const COASTS = {
  east: {
    id: "east", suffix: "",
    pov: { signal: [18, -108, 2.2], winter: [27, -84, 1.7], local: [36, -72, 0.8] },
    moment: { text: "Blizzard hits New York · Jan 2016", layer: "clouds", date: "2016-01-23", pov: [36, -70, 1.3] },
    explorerRegion: "gauge_the_battery",
  },
  west: {
    id: "west", suffix: "_west",
    pov: { signal: [14, -128, 2.2], winter: [24, -132, 1.7], local: [39, -124, 0.85] },
    moment: { text: "El Niño lifts California’s sea · Jan 1998 (sea height)", layer: "ssh", date: "1998-01-15", pov: [28, -132, 1.6] },
    explorerRegion: "gauge_la_jolla",
    // words: the globe and the panels after it are written for New York; on the West they read for Los Angeles
    words: [
      [/New York Harbor['’]s/g, "Los Angeles’s"],
      [/New York Harbor/g, "Los Angeles Harbor"],
      [/New York['’]s/g, "Los Angeles’s"],
      [/New York/g, "Los Angeles"],
      [/\bthe Battery\b/g, "the Los Angeles gauge"],
      [/\bThe Battery\b/g, "Los Angeles"],
      [/\bBattery\b/g, "Los Angeles gauge"],
      [/8518750/g, "9410660"],
      [/Storm-surge day/g, "High-water day"],
      [/storm-surge day/g, "high-water day"],
      [/storm-surge/g, "high-water"],
      [/storm surges/g, "high-water days"],
      [/\bsurge days\b/g, "high-water days"],
      [/\bsurge season\b/g, "high-water season"],
    ],
    // whole sentences that differ, not just names
    texts: {
      "#harbor .panel-lede": "High-water day: Los Angeles water level, tide removed, in its top 2% of days (12 cm above the running yearly mean). " +
        "On this coast El Niño lifts the whole winter’s sea level, and the high-water days come with it.",
      "#pacific-lede": "Trade winds weaken, warm water surges east: in 2015–16 the equatorial Pacific rose about 20 cm. " +
        "Along California it arrives as a higher winter sea and more high-water days.",
    },
  },
};

export const COAST = COASTS[id];

// arriving from the other coast: hold the stage and panels off to the side (CSS) until the page is built
let ARRIVE = null;
try { ARRIVE = JSON.parse(sessionStorage.getItem("sld-coast-slide")); sessionStorage.removeItem("sld-coast-slide"); } catch {}
if (ARRIVE) {
  const root = document.documentElement;
  root.dataset.coastFrom = ARRIVE.dir === 1 ? "east" : "west";
  root.style.setProperty("--cs-from", -ARRIVE.dir);
  root.classList.add("cs-arriving");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
}

// swap the names in every text node under the given roots, now and whenever the page writes new text there
export function speakCoast(roots) {
  if (!COAST.words) return;
  const fix = node => {
    if (node.parentElement && node.parentElement.closest(".coast-switch")) return;   // the switch names both coasts
    let t = node.nodeValue, u = t;
    for (const [re, to] of COAST.words) u = u.replace(re, to);
    if (u !== t) node.nodeValue = u;
  };
  const walk = root => {
    if (root.nodeType === 3) { fix(root); return; }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fix(n);
  };
  for (const r of roots) {
    if (!r) continue;
    walk(r);
    for (const a of r.querySelectorAll("[aria-label]")) {
      let v = a.getAttribute("aria-label"), u = v;
      for (const [re, to] of COAST.words) u = u.replace(re, to);
      if (u !== v) a.setAttribute("aria-label", u);
    }
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === "characterData") fix(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(r, { childList: true, characterData: true, subtree: true });
  }
  for (const [sel, txt] of Object.entries(COAST.texts || {})) { const e = document.querySelector(sel); if (e) e.textContent = txt; }
}

// the East / West switch: slide out, load the other coast, slide in (keeping the reader's place on the page)
export function coastSwitch(host, slideEls) {
  host.innerHTML = `<span class="cs-lab">Coast</span>` +
    `<button type="button" data-coast="east" aria-pressed="${COAST.id === "east"}">East · New York</button>` +
    `<button type="button" data-coast="west" aria-pressed="${COAST.id === "west"}">West · Los Angeles</button>`;
  host.addEventListener("click", e => {
    const b = e.target.closest("button[data-coast]");
    if (!b || b.dataset.coast === COAST.id) return;
    const to = b.dataset.coast, dir = to === "west" ? 1 : -1;   // going west, the page pans to the left: content moves right
    try { sessionStorage.setItem("sld-coast-slide", JSON.stringify({ y: scrollY, dir })); } catch {}
    host.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    for (const el of slideEls) { el.style.setProperty("--cs-dir", dir); el.classList.add("cs-leave"); }
    const url = new URL(location.href);
    if (to === "west") url.searchParams.set("coast", "west"); else url.searchParams.delete("coast");
    setTimeout(() => location.assign(url), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
  });
  // arriving: back to the same place on the page, then slide in from the side we came from
  if (ARRIVE) {
    scrollTo(0, ARRIVE.y);
    void document.body.offsetWidth;   // lay out the held-off position first, so removing it slides
    setTimeout(() => { scrollTo(0, ARRIVE.y); document.documentElement.classList.remove("cs-arriving"); }, 60);
  }
  return ARRIVE;
}
