// build/seed-races.mjs — turn RacesCatalog/RacesCatalog1.json into the flat
// list the app bulk-writes into Firestore (web/races-seed.json).
//
// The catalog has NO routes — just names/cities/distances. Each record becomes
// a race doc with routeStatus 'none' (or 'candidate' where the catalog already
// flagged a candidate). The owner attaches real GPX later from the app.
//
//   npm run seed:races   →   web/races-seed.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => join(ROOT, ...p);

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KM = { marathon: 42.195, half_marathon: 21.0975 };

// Hebrew display names for races an Israeli user is likely to search.
const HE = {
  'tel-aviv-marathon': 'מרתון תל אביב',
  'tel-aviv-half-marathon': 'חצי מרתון תל אביב',
  'jerusalem-marathon': 'מרתון ירושלים',
  'jerusalem-half-marathon': 'חצי מרתון ירושלים',
  'tiberias-marathon': 'מרתון טבריה',
  'dead-sea-marathon': 'מרתון ים המלח',
  'sovev-emek-half-marathon': 'חצי מרתון סובב עמק',
  'haifa-half-marathon': 'חצי מרתון חיפה',
};

// Israeli races missing from the international catalog.
const EXTRA = [
  { id: 'tel-aviv-marathon',      name: 'Samsung Tel Aviv Marathon', distance: 'marathon',      city: 'Tel Aviv',       country_code: 'IL', tier: 2 },
  { id: 'jerusalem-marathon',     name: 'Jerusalem Marathon',        distance: 'marathon',      city: 'Jerusalem',      country_code: 'IL', tier: 2 },
  { id: 'tiberias-marathon',      name: 'Tiberias Marathon',         distance: 'marathon',      city: 'Tiberias',       country_code: 'IL', tier: 2 },
  { id: 'dead-sea-marathon',      name: 'Dead Sea Marathon',         distance: 'marathon',      city: 'Ein Bokek',      country_code: 'IL', tier: 3 },
  { id: 'sovev-emek-half-marathon', name: 'Sovev Emek Half Marathon', distance: 'half_marathon', city: 'Jezreel Valley', country_code: 'IL', tier: 3 },
  { id: 'haifa-half-marathon',    name: 'Haifa Half Marathon',       distance: 'half_marathon', city: 'Haifa',          country_code: 'IL', tier: 3 },
];

const catalog = JSON.parse(readFileSync(r('RacesCatalog/RacesCatalog1.json'), 'utf8'));
const raw = [...(catalog.races || []), ...EXTRA];

const seen = new Set();       // dedup key: name|distance|city|country
const out = [];
let skipped = 0;

for (const rec of raw) {
  const id = String(rec.id || '').trim();
  if (!ID_RE.test(id)) { skipped++; continue; }

  const key = [rec.name, rec.distance, rec.city, rec.country_code]
    .map((s) => String(s || '').toLowerCase().trim()).join('|');
  if (seen.has(key)) { skipped++; continue; }
  seen.add(key);

  const name = String(rec.name || '').trim();
  const city = String(rec.city || '').trim();
  const cc = String(rec.country_code || '').trim().toUpperCase();

  out.push({
    id,
    name,
    nameHe: HE[id] || null,
    distance: rec.distance,
    distanceKm: KM[rec.distance] ?? null,
    city,
    region: rec.region ? String(rec.region).trim() : null,
    countryCode: cc,
    tier: rec.tier ?? 3,
    routeStatus: rec.gpx_status === 'candidate_found' ? 'candidate' : 'none',
    gain: null, loss: null, startLat: null, startLon: null,
    profileFlat: null, trackFlat: null,
    gpxPath: null, sourceUrl: null, license: null, attribution: null,
    search: [name, HE[id] || '', city, cc, rec.distance]
      .join(' ').toLowerCase().replace(/\s+/g, ' ').trim(),
  });
}

out.sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name));
writeFileSync(r('web/races-seed.json'), JSON.stringify(out, null, 0) + '\n');

const byDist = out.reduce((m, x) => ((m[x.distance] = (m[x.distance] || 0) + 1), m), {});
console.log(`web/races-seed.json — ${out.length} races (${skipped} skipped/deduped)`);
console.log('  by distance :', byDist);
console.log('  Israeli     :', out.filter((x) => x.countryCode === 'IL').length);
