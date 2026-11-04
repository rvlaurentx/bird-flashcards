// Server-side helpers for eBird API 2.0 and place geocoding.
// Files under api/_lib are not exposed as Vercel functions.
// The eBird key is read from process.env.EBIRD_API_KEY and never sent to the browser.

import { mockEbird, mockGeocode } from "./mock.js";

const EBIRD = "https://api.ebird.org/v2";
const isMock = () => process.env.EBIRD_MOCK === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Strip whitespace, line breaks and wrapping quotes that sneak in when pasting.
export function getKey() {
  return (process.env.EBIRD_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export async function ebird(path) {
  if (isMock()) return mockEbird(path);
  const key = getKey();
  if (!key) throw new ApiError(500, "EBIRD_API_KEY is not set for this deployment. Add it in Vercel → Settings → Environment Variables (Production and Preview), then redeploy.");
  let res;
  // On 429 (too many requests), wait and retry: 1s, 2s, 4s, or eBird's Retry-After.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(EBIRD + path, { headers: { "X-eBirdApiToken": key } });
    } catch (e) {
      throw new ApiError(502, `Could not reach eBird (${e.cause?.code || e.message}).`);
    }
    if (res.status !== 429 || attempt >= 3) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 8) * 1000 : 1000 * 2 ** attempt);
  }
  if (res.status === 401 || res.status === 403) throw new ApiError(502, `eBird refused the request (HTTP ${res.status}). The key is probably wrong; open /api/health for details.`);
  if (res.status === 429) throw new ApiError(503, "eBird is limiting requests right now. Wait a minute and try again.");
  if (!res.ok) throw new ApiError(502, `eBird returned ${res.status} for ${path.split("?")[0]}`);
  return res.json();
}

// A usable coordinate, or NaN (Number(null) would wrongly give 0).
export const coord = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

// Place-name search via Open-Meteo's free geocoder (no key needed).
export async function geocode(q) {
  if (isMock()) return mockGeocode(q);
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(502, `Place search failed (${res.status}).`);
  const data = await res.json();
  return (data.results || [])
    .map((r) => ({
      name: r.name,
      detail: [r.admin2, r.admin1, r.country].filter(Boolean).join(", "),
      lat: coord(r.latitude),
      lng: coord(r.longitude),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)); // unusable without coordinates
}

// Run async fn over items with limited concurrency.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      try { out[n] = await fn(items[n]); } catch (e) { out[n] = { error: e }; }
    }
  }));
  return out;
}

export function send(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheSeconds && status === 200) {
    res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`);
  }
  res.end(JSON.stringify(body));
}

export function fail(res, e) {
  const status = e instanceof ApiError ? e.status : 500;
  if (!(e instanceof ApiError)) console.error(e);
  send(res, status, { error: e instanceof ApiError ? e.message : `Unexpected server error: ${e.message}` });
}
