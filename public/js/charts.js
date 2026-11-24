// Charts & maps (SVG/HTML, no libraries). Every visual has a text/table equivalent for accessibility.
import { html, raw, esc, pct, num, str } from './ui.js';
import { t, L } from './i18n.js';
import { COUNTRIES } from './countries.js';

// Africa tile-grid map: [name, ISO3, col, row]
export const TILES = [["Morocco","MAR",1,0],["Algeria","DZA",2,0],["Tunisia","TUN",4,0],["Libya","LBY",5,0],["Egypt","EGY",6,0],["Sahrawi Republic","ESH",0,1],["Mauritania","MRT",1,1],["Mali","MLI",2,1],["Niger","NER",4,1],["Chad","TCD",5,1],["Sudan","SDN",6,1],["Eritrea","ERI",7,1],["Djibouti","DJI",8,1],["Gambia","GMB",0,2],["Senegal","SEN",1,2],["Burkina Faso","BFA",3,2],["Nigeria","NGA",4,2],["Cameroon","CMR",5,2],["South Sudan","SSD",6,2],["Ethiopia","ETH",7,2],["Somalia","SOM",8,2],["Guinea-Bissau","GNB",0,3],["Guinea","GIN",1,3],["Côte d'Ivoire","CIV",2,3],["Ghana","GHA",3,3],["Togo","TGO",4,3],["Benin","BEN",5,3],["Central African Republic","CAF",6,3],["Uganda","UGA",7,3],["Kenya","KEN",8,3],["Cabo Verde","CPV",0,4],["Sierra Leone","SLE",1,4],["Liberia","LBR",2,4],["São Tomé and Príncipe","STP",3,4],["Equatorial Guinea","GNQ",4,4],["Congo","COG",5,4],["DR Congo","COD",6,4],["Rwanda","RWA",7,4],["Tanzania","TZA",8,4],["Seychelles","SYC",9,4],["Gabon","GAB",4,5],["Angola","AGO",5,5],["Zambia","ZMB",6,5],["Burundi","BDI",7,5],["Malawi","MWI",8,5],["Comoros","COM",9,5],["Namibia","NAM",5,6],["Botswana","BWA",6,6],["Zimbabwe","ZWE",7,6],["Mozambique","MOZ",8,6],["Madagascar","MDG",9,6],["South Africa","ZAF",6,7],["Eswatini","SWZ",7,7],["Mauritius","MUS",9,7],["Lesotho","LSO",6,8]];
const nameToCode = Object.fromEntries(COUNTRIES.map((c) => [c[1], c[0]]));
const SCALE = ['c0', 'c1', 'c2', 'c3', 'c4'];
const bucket = (v) => (v <= 0 ? 0 : v < 0.25 ? 1 : v < 0.5 ? 2 : v < 0.75 ? 3 : 4);

/** Continental tile map. rows: analytics.tenants; metric: 'coverage' | 'enrolRate' | 'utilization' */
export function tileMap(rows, metric = 'coverage', selected = null) {
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const tiles = TILES.map(([name, iso, x, y]) => {
    const code = nameToCode[name], r = by[code], v = r ? r[metric] : 0, b = r && r.users ? Math.max(1, bucket(v)) : 0;
    const label = r && r.users ? `${name}: ${pct(v)}` : `${name}: ${t('map.not_started')}`;
    return `<div class="tile ${SCALE[b]} ${r && r.pilot ? 'pilot' : ''} ${selected === code ? 'sel' : ''}" style="grid-column:${x + 1};grid-row:${y + 1}" title="${esc(label)}" role="img" aria-label="${esc(label)}"><span>${code}</span><small>${r && r.users ? pct(v) : '–'}</small></div>`;
  }).join('');
  const lg = [[0, t('map.not_started')], [1, '<25%'], [2, '25–49%'], [3, '50–74%'], [4, '≥75%']].map(([b, l]) => `<span><i class="tile ${SCALE[b]}" style="display:inline-block;width:12px;height:12px;min-height:0;padding:0"></i>${l}</span>`).join('');
  return raw(`<div class="tmap" role="group" aria-label="${esc(t('map.title'))}">${tiles}</div><div class="legend">${lg}<span><i style="box-shadow:inset 0 0 0 2px var(--gold);background:#fff"></i>${esc(t('map.pilot'))}</span></div>`);
}

/** Facility/region point map inside one country. regions: analytics.regions for that tenant */
export function regionMap(facs, regs) {
  if (!facs.length) return raw('');
  const lats = facs.map((f) => f.lat).filter(Number.isFinite), lons = facs.map((f) => f.lon).filter(Number.isFinite); if (!lats.length) return raw('');
  const pad = 0.6, la0 = Math.min(...lats) - pad, la1 = Math.max(...lats) + pad, lo0 = Math.min(...lons) - pad, lo1 = Math.max(...lons) + pad, W = 640, H = Math.max(260, Math.min(460, (W * (la1 - la0)) / (lo1 - lo0)));
  const X = (lo) => ((lo - lo0) / (lo1 - lo0)) * (W - 40) + 20, Y = (la) => H - 20 - ((la - la0) / (la1 - la0)) * (H - 40);
  const dots = facs.map((f) => { const c = f.covered ? 'var(--green)' : 'var(--maroon)'; return `<circle cx="${X(f.lon).toFixed(1)}" cy="${Y(f.lat).toFixed(1)}" r="${5 + Math.min(9, (f.learners || 0) / 3)}" fill="${c}" fill-opacity=".75" stroke="#fff" stroke-width="1.5"><title>${esc(f.name)} — ${f.learners || 0} ${esc(t('common.learners'))}</title></circle>`; }).join('');
  const labels = regs.map((r) => (r.lat ? `<text x="${X(r.lon).toFixed(1)}" y="${(Y(r.lat) - 12).toFixed(1)}" font-size="11" text-anchor="middle" fill="#0F4D26" font-weight="700">${esc(r.region)}</text>` : '')).join('');
  return raw(`<div class="map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('map.facility_title'))}"><rect width="${W}" height="${H}" fill="#F3F7F4"/>${dots}${labels}</svg><div class="legend"><span><i style="background:var(--green)"></i>${esc(t('map.facility_covered'))}</span><span><i style="background:var(--maroon)"></i>${esc(t('map.facility_not'))}</span><span>${esc(t('map.facility_note'))}</span></div></div>`);
}

/** Horizontal bars. items: [{label, value, max?, text?}] */
export function hbars(items, { max, cls = '' } = {}) {
  const m = max || Math.max(1, ...items.map((i) => (typeof i.value === 'number' ? i.value : 0)));
  return raw(items.map((i) => `<div class="hbar"><span>${esc(i.label)}</span><div class="bar ${cls}" role="img" aria-label="${esc(i.label)} ${esc(i.text ?? i.value)}"><i style="width:${typeof i.value === 'number' ? Math.min(100, (i.value / m) * 100) : 0}%"></i></div><span class="v">${esc(i.text ?? i.value)}</span></div>`).join(''));
}

/** Two-series column chart (enrolments vs completions) */
export function columns(rows, keyA, keyB, labels) {
  const W = 640, H = 220, pad = 28, m = Math.max(1, ...rows.flatMap((r) => [r[keyA], r[keyB]])), bw = (W - pad * 2) / rows.length;
  const bars = rows.map((r, i) => { const x = pad + i * bw, ha = (r[keyA] / m) * (H - 50), hb = (r[keyB] / m) * (H - 50); return `<rect x="${x + 2}" y="${H - 24 - ha}" width="${bw / 2 - 3}" height="${ha}" fill="#A9C9B0"><title>${esc(r.m)} ${esc(labels[0])}: ${r[keyA]}</title></rect><rect x="${x + bw / 2}" y="${H - 24 - hb}" width="${bw / 2 - 3}" height="${hb}" fill="#1B7A3D"><title>${esc(r.m)} ${esc(labels[1])}: ${r[keyB]}</title></rect><text x="${x + bw / 2}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#595959">${esc(r.m.slice(5))}</text>`; }).join('');
  return raw(`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="${esc(labels.join(' / '))}">${bars}<text x="${pad}" y="12" font-size="10" fill="#595959">max ${m}</text></svg><div class="legend"><span><i style="background:#A9C9B0"></i>${esc(labels[0])}</span><span><i style="background:#1B7A3D"></i>${esc(labels[1])}</span></div>`);
}

export function ring(p, inner) { return raw(`<div class="ring" style="--p:${Math.round(p)}" role="img" aria-label="${Math.round(p)}%"><div>${str(inner)}</div></div>`); }
