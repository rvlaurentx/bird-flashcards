// iNaturalist lookups for species photos and a short description.
// No key needed. Only openly licensed photos are returned, each with its
// attribution string, which the app must display.

import { ApiError } from "./ebird.js";

const INAT = "https://api.inaturalist.org/v1";
const UA = "BirdFlashcards/0.1 (https://github.com/rvlaurentx/bird-flashcards)";

// CC BY-NC is allowed because the app is non-commercial. If that changes,
// drop "cc-by-nc" (and re-check every cached deck). See CLAUDE.md.
export const ALLOWED_LICENSES = new Set(["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa"]);
const MAX_PHOTOS = 6;

async function inat(path) {
  let res;
  try {
    res = await fetch(INAT + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
  } catch (e) {
    throw new ApiError(502, `Could not reach iNaturalist (${e.cause?.code || e.message}).`);
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

export async function speciesMedia(sciName, comName) {
  const taxon = await findTaxon(sciName, comName);
  if (!taxon) return { taxonId: null, photos: [], summary: null };
  const { results = [] } = await inat(`/taxa/${taxon.id}`);
  const full = results[0] || taxon;
  const seen = new Set();
  const photos = [full.default_photo, ...(full.taxon_photos || []).map((tp) => tp.photo)]
    .map(toPhoto).filter((p) => p && !seen.has(p.url) && seen.add(p.url)).slice(0, MAX_PHOTOS);
  return {
    taxonId: taxon.id,
    inatUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
    photos,
    summary: stripHtml(full.wikipedia_summary) || null,
    wikipediaUrl: full.wikipedia_url || null,
  };
}
