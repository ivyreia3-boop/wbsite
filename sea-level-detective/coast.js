// East / West: which coast the globe and the panels after it tell the story for (?coast=west on load). Switching happens
// on the same page: app.js turns the globe across, rebuilds the globe section and the coast's panels from pristine copies
// with the other coast's data, and fades them back in.

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

export let COAST = COASTS[id];
export const coastConfig = c => COASTS[c];
export function setCoast(c) { COAST = COASTS[c]; }

// swap the names in every text node under the given roots, now and whenever the page writes new text there
let watchers = [];
export function speakCoast(roots) {
  for (const w of watchers) w.disconnect();
  watchers = [];
  if (!COAST.words) return;
  const fix = node => {
    if (node.parentElement && node.parentElement.closest(".coast-switch")) return;   // the switch names both coasts
    let t = node.nodeValue, u = t;
    for (const [re, to] of COAST.words) u = u.replace(re, to);
    if (u !== t) node.nodeValue = u;
  };
  const walk = root => {
    if (root.nodeType === 3) { fix(root); return; }
    if (root.nodeType !== 1) return;
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
    const mo = new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === "characterData") fix(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    });
    mo.observe(r, { childList: true, characterData: true, subtree: true });
    watchers.push(mo);
  }
  for (const [sel, txt] of Object.entries(COAST.texts || {})) { const e = document.querySelector(sel); if (e) e.textContent = txt; }
}

// the East / West buttons in the globe's title strip
export function coastSwitch(host, onPick) {
  if (!host) return;
  host.innerHTML = `<span class="cs-lab">Coast</span>` +
    `<button type="button" data-coast="east" aria-pressed="${COAST.id === "east"}">East · New York</button>` +
    `<button type="button" data-coast="west" aria-pressed="${COAST.id === "west"}">West · Los Angeles</button>`;
  host.addEventListener("click", e => {
    const b = e.target.closest("button[data-coast]");
    if (!b || b.dataset.coast === COAST.id) return;
    host.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    onPick(b.dataset.coast);
  });
}
