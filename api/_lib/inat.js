// iNaturalist lookups for species photos and a short description.
// No key needed. Only openly licensed photos are returned, each with its
// attribution string, which the app must display.

import { ApiError } from "./ebird.js";
import { keepClearPhotos } from "./photocheck.js";
import { commonsPhotos } from "./commons.js";

const INAT = "https://api.inaturalist.org/v1";
const UA = "BirdFlashcards/0.1 (https://github.com/rvlaurentx/bird-flashcards)";

// CC BY-NC is allowed because the app is non-commercial. If that changes,
// drop "cc-by-nc" (and re-check every cached deck). See CLAUDE.md.
export const ALLOWED_LICENSES = new Set(["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa"]);
const MAX_PHOTOS = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inat(path) {
  let res;
  // iNaturalist asks clients to stay near 1 request/second; back off on 429.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(INAT + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
    } catch (e) {
      throw new ApiError(502, `Could not reach iNaturalist (${e.cause?.code || e.message}).`);
    }
    if (res.status !== 429 || attempt >= 2) break;
    await sleep(1000 * 2 ** attempt);
  }
  if (res.status === 429) throw new ApiError(503, "iNaturalist is limiting requests right now. Try again shortly.");
  if (!res.ok) throw new ApiError(502, `iNaturalist returned ${res.status}.`);
  return res.json();
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");

async function findTaxon(sciName, comName) {
  for (const q of [sciName, comName].filter(Boolean)) {
    const { results = [] } = await inat(`/taxa?q=${encodeURIComponent(q)}&rank=species&is_active=true&per_page=10`);
    const birds = results.filter((r) => r.iconic_taxon_name === "Aves");
    const hit = birds.find((r) => norm(r.name) === norm(sciName)) || birds.find((r) => norm(r.preferred_common_name) === norm(comName));
    if (hit) return hit;
  }
  return null;
}

export function toPhoto(p) {
  if (!p || !ALLOWED_LICENSES.has((p.license_code || "").toLowerCase())) return null;
  const url = p.medium_url || (p.url || "").replace("/square.", "/medium.");
  if (!url) return null;
  return {
    url,
    attribution: p.attribution || "iNaturalist observer",
    license: p.license_code.toUpperCase(),
    page: `https://www.inaturalist.org/photos/${p.id}`,
  };
}

export function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

// ---------- local, in-season photos ----------
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LICENSE_PARAM = [...ALLOWED_LICENSES].join(",");
// Search areas, tried in order until there are enough photos (km).
export const RADII = [100, 400, 1500];
const LOCAL_WANTED = 4;      // local photos to keep
const LOCAL_CANDIDATES = 10; // gathered before the photo check

// iNaturalist annotations to exclude: Evidence of Presence = feather (23),
// scat (25), track (26), bone (27), molt (28), egg (30), construction/nest
// (35); Alive or Dead = dead (19). Unannotated observations still pass, which
// is why the photo check below also runs.
export const EXCLUDE_TERM_VALUES = [19, 23, 25, 26, 27, 28, 30, 35];

// The trip month and the months either side (wrapping around the year).
export function seasonWindow(month) {
  if (!month) return [];
  return [month - 1, month, month + 1].map((m) => ((m + 11) % 12) + 1);
}

// "May 2024 · Boone, NC" from an observation.
export function photoContext(obs) {
  const d = /^(\d{4})-(\d{2})/.exec(obs.observed_on || "");
  const when = d ? `${MONTH_ABBR[Number(d[2]) - 1]} ${d[1]}` : "";
  const where = String(obs.place_guess || "").split(",").slice(0, 2).join(",").trim();
  return [when, where].filter(Boolean).join(" · ") || null;
}

export function observationPhotos(observations) {
  return (observations || []).map((o) => {
    const ph = toPhoto(o.photos?.[0]);
    return ph && { ...ph, local: true, context: photoContext(o), observation: `https://www.inaturalist.org/observations/${o.id}` };
  }).filter(Boolean);
}

// Returns { photos, check } (check = photo-check report, for /api/media).
async function localPhotos(taxonId, { lat, lng, month }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { photos: [], check: { ran: false, reason: "no location" } };
  const months = seasonWindow(month);
  const found = [];
  for (const radius of RADII) {
    const q = `/observations?taxon_id=${taxonId}&lat=${lat}&lng=${lng}&radius=${radius}` +
      `${months.length ? `&month=${months.join(",")}` : ""}&photos=true&quality_grade=research&captive=false` +
      `&without_term_value_id=${EXCLUDE_TERM_VALUES.join(",")}` +
      `&photo_license=${LICENSE_PARAM}&order_by=votes&per_page=12`;
    const { results = [] } = await inat(q);
    for (const p of observationPhotos(results)) if (!found.some((f) => f.url === p.url)) found.push(p);
    if (found.length >= LOCAL_CANDIDATES) break;
  }
  // Keep only photos where a bird is clearly the subject (see photocheck.js).
  const { photos, check } = await keepClearPhotos(found.slice(0, LOCAL_CANDIDATES));
  return { photos: photos.slice(0, LOCAL_WANTED), check };
}

/**
 * Photos for a species. With `where` ({ lat, lng, month }), photos taken near
 * the place in the trip season come first (local subspecies, seasonal
 * plumage), then the species' general photos fill the rest.
 */
export async function speciesMedia(sciName, comName, where = {}) {
  const taxon = await findTaxon(sciName, comName);
  if (!taxon) return { taxonId: null, photos: [], summary: null };
  const [{ results = [] }, local, commons] = await Promise.all([
    inat(`/taxa/${taxon.id}`),
    localPhotos(taxon.id, where).catch((e) => ({ photos: [], check: { ran: false, reason: `local search failed (${e.message})` } })),
    commonsPhotos(sciName || taxon.name, comName),
  ]);
  const full = results[0] || taxon;
  const seen = new Set();
  // Order: local in-season iNaturalist photos (checked), then Wikimedia
  // Commons (article photo + Quality images; freely licensed), then
  // iNaturalist's general species photos as a last resort.
  const general = [full.default_photo, ...(full.taxon_photos || []).map((tp) => tp.photo)].map(toPhoto);
  const photos = [...local.photos, ...commons, ...general]
    .filter((p) => p && !seen.has(p.url) && seen.add(p.url)).slice(0, MAX_PHOTOS);
  return {
    taxonId: taxon.id,
    inatUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
    photos,
    summary: stripHtml(full.wikipedia_summary) || null,
    wikipediaUrl: full.wikipedia_url || null,
    // Diagnostics: how many local photos were found and what the check did.
    localPhotos: local.photos.length,
    commonsPhotos: commons.length,
    photoCheck: local.check,
  };
}
