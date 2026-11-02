// GET /api/species?lat=..&lng=..[&dist=25]
// Returns species ranked by how often they appear on recent complete eBird
// checklists in the county (eBird subnational2 region) around the point.
// "freq" = share of sampled complete checklists that reported the species,
// which is the same idea as eBird's own "frequency" in bar charts.

import { ebird, pool, send, fail, ApiError } from "./_lib/ebird.js";

// eBird rate-limits bursts, so stay small and slow: ~25 checklist requests,
// at most 3 in flight. Results are also cached per county (see below).
const MAX_CHECKLISTS = 25;
const CONCURRENCY = 3;
const MIN_LISTS = 8;         // need at least this many checklists to rank
const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map();     // region -> { at, result }; lives while the function instance is warm
const COUNTABLE = new Set(["species"]);
const ROLLUP = new Set(["issf", "form", "intergrade"]); // count as their parent species

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const lat = Number(url.searchParams.get("lat") ?? NaN);
    const lng = Number(url.searchParams.get("lng") ?? NaN);
    const dist = Math.min(50, Math.max(5, Number(url.searchParams.get("dist")) || 25));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ApiError(400, "lat and lng are required.");
    }
    send(res, 200, await rankSpecies(lat, lng, dist), 60 * 60 * 12);
  } catch (e) { fail(res, e); }
}

export async function rankSpecies(lat, lng, dist) {
  const ll = `lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`;

  // 1. Nearby hotspots tell us which county the place is in.
  const hotspots = await ebird(`/ref/hotspot/geo?${ll}&dist=${dist}&fmt=json`);
  if (!hotspots.length) throw new ApiError(404, `No eBird hotspots within ${dist} km of this place.`);
  const region = pickRegion(hotspots, lat, lng);
  const hit = cache.get(region);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  // 2. Recent checklists submitted in that region.
  const feed = await ebird(`/product/lists/${region}?maxResults=200`);
  const recent = feed.filter((c) => (c.numSpecies ?? 1) > 0).slice(0, MAX_CHECKLISTS);
  if (!recent.length) throw new ApiError(404, "No recent eBird checklists found for this area.");

  // 3. Full checklist details (species on each list).
  const details = (await pool(recent, CONCURRENCY, (c) => ebird(`/product/checklist/view/${c.subId || c.subID}`)))
    .filter((d) => d && !d.error && Array.isArray(d.obs));
  const complete = details.filter((d) => d.allObsReported);
  const used = complete.length >= MIN_LISTS ? complete : details; // fall back if few complete lists
  if (used.length < Math.min(MIN_LISTS, recent.length)) {
    const limited = details.length < recent.length && recent.length > 0;
    throw new ApiError(limited ? 503 : 502, limited
      ? "eBird is limiting requests right now. Wait a minute and try again."
      : "Could not load checklist details from eBird.");
  }

  // 4. Taxonomy: names, families, and roll subspecies groups up to species.
  const codes = [...new Set(used.flatMap((d) => d.obs.map((o) => o.speciesCode)))];
  const tax = await taxonomy(codes);
  const parents = [...new Set(Object.values(tax).filter((t) => ROLLUP.has(t.category) && t.reportAs && !tax[t.reportAs]).map((t) => t.reportAs))];
  Object.assign(tax, await taxonomy(parents));

  const toSpecies = (code) => {
    const t = tax[code];
    if (!t) return null;
    if (COUNTABLE.has(t.category)) return code;
    if (ROLLUP.has(t.category) && t.reportAs && tax[t.reportAs]?.category === "species") return t.reportAs;
    return null; // spuh, slash, hybrid, domestic
  };

  const counts = new Map();
  for (const d of used) {
    const seen = new Set(d.obs.map((o) => toSpecies(o.speciesCode)).filter(Boolean));
    for (const s of seen) counts.set(s, (counts.get(s) || 0) + 1);
  }

  const species = [...counts].map(([code, n]) => {
    const t = tax[code];
    return {
      code, comName: t.comName, sciName: t.sciName,
      family: t.familyComName || null, familyCode: t.familyCode || null,
      taxonOrder: t.taxonOrder ?? null,
      checklists: n, freq: Math.round((n / used.length) * 1000) / 1000,
    };
  }).sort((a, b) => b.freq - a.freq || a.taxonOrder - b.taxonOrder);

  let regionName = region;
  try { regionName = (await ebird(`/ref/region/info/${region}`)).result || region; } catch { /* keep code */ }

  const dates = used.map((d) => d.obsDt).filter(Boolean).sort();
  const result = {
    source: "eBird",
    region: { code: region, name: regionName },
    sample: { checklists: used.length, completeOnly: used === complete, from: dates[0] || null, to: dates.at(-1) || null },
    species,
  };
  cache.set(region, { at: Date.now(), result });
  return result;
}

function pickRegion(hotspots, lat, lng) {
  const d2 = (h) => (h.lat - lat) ** 2 + ((h.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
  const near = [...hotspots].sort((a, b) => d2(a) - d2(b)).slice(0, 25);
  const tally = {};
  for (const h of near) {
    const r = h.subnational2Code || h.subnational1Code || h.countryCode;
    if (r) tally[r] = (tally[r] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

async function taxonomy(codes) {
  const out = {};
  for (let i = 0; i < codes.length; i += 150) {
    const chunk = codes.slice(i, i + 150);
    const rows = await ebird(`/ref/taxonomy/ebird?fmt=json&locale=en&species=${chunk.join(",")}`);
    for (const t of rows) out[t.speciesCode] = t;
  }
  return out;
}
