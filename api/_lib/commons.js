// Species photos from Wikimedia Commons: the photo the species' Wikipedia
// article uses, then Commons "Quality images" of the species.
// Only freely reusable licences (public domain, CC0, CC BY, CC BY-SA), which
// also allow commercial use. Each photo carries its author and licence,
// which the app must show. No key needed.

const UA = "BirdFlashcards/0.1 (https://github.com/rvlaurentx/bird-flashcards)";
const WIKI = "https://en.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 640;
const MAX_QUALITY = 5;

// Files that usually aren't a photo of a live bird.
const NOT_A_BIRD_PHOTO = /\b(egg|eggs|nest|specimen|museum|skull|skeleton|map|range|distribution|illustration|drawing|plate|painting|stamp|sonogram|spectrogram|feather)\b/i;

async function getJSON(base, params) {
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikimedia returned ${res.status}`);
  return res.json();
}

export const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// Free licences only: public domain, CC0, CC BY, CC BY-SA (any version).
export function freeLicense(meta) {
  const code = String(meta?.License?.value || "").toLowerCase();
  const short = String(meta?.LicenseShortName?.value || "");
  if (/^(pd|cc0|cc-zero)/.test(code) || /public domain|^cc0/i.test(short)) return short || "Public domain";
  if (/^cc-by(-sa)?-\d/.test(code) && !/nc|nd/.test(code)) return short || code.toUpperCase();
  return null;
}

/** Turn a Commons imageinfo page into the app's photo shape, or null. */
export function toCommonsPhoto(page) {
  const info = page?.imageinfo?.[0];
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime || "")) return null;
  if (NOT_A_BIRD_PHOTO.test(page.title || "")) return null;
  const meta = info.extmetadata || {};
  const license = freeLicense(meta);
  if (!license) return null;
  const author = stripTags(meta.Artist?.value) || "Unknown author";
  return {
    url: info.thumburl || info.url,
    attribution: `${author.length > 80 ? author.slice(0, 77) + "…" : author}, ${license}`,
    license,
    licenseUrl: meta.LicenseUrl?.value || null,
    page: info.descriptionurl || null,
    source: "Wikimedia Commons",
  };
}

const IMAGEINFO = { prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: String(THUMB_WIDTH), iiextmetadatafilter: "Artist|License|LicenseShortName|LicenseUrl" };

/** The photo the Wikipedia article uses (by scientific, then common name). */
async function leadImage(sciName, comName) {
  for (const title of [sciName, comName].filter(Boolean)) {
    const page = (await getJSON(WIKI, { action: "query", prop: "pageimages", piprop: "name", pilicense: "free", redirects: "1", titles: title }))?.query?.pages?.[0];
    if (page?.pageimage) return `File:${page.pageimage}`;
  }
  return null;
}

/** Wikimedia Commons photos for a species, best first. Never throws. */
export async function commonsPhotos(sciName, comName) {
  try {
    const [lead, quality] = await Promise.all([
      leadImage(sciName, comName),
      sciName ? getJSON(COMMONS, {
        action: "query", generator: "search", gsrnamespace: "6", gsrlimit: "10",
        gsrsearch: `"${sciName}" incategory:Quality_images`, ...IMAGEINFO,
      }) : null,
    ]);
    const pages = [];
    if (lead) {
      const lp = (await getJSON(COMMONS, { action: "query", titles: lead, ...IMAGEINFO }))?.query?.pages?.[0];
      if (lp) pages.push(lp);
    }
    const qPages = [...(quality?.query?.pages || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).slice(0, MAX_QUALITY + 2);
    pages.push(...qPages);
    const seen = new Set();
    return pages.map(toCommonsPhoto).filter((p) => p && !seen.has(p.url) && seen.add(p.url));
  } catch (e) {
    console.error("Commons photos failed", e?.message);
    return [];
  }
}
