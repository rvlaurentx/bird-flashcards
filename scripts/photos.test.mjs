import test from "node:test";
import assert from "node:assert/strict";
import { seasonWindow, photoContext, speciesMedia, RADII } from "../api/_lib/inat.js";
import { mediaUrl, photoContextFor } from "../public/lib.js";

test("season window wraps around the year", () => {
  assert.deepEqual(seasonWindow(5), [4, 5, 6]);
  assert.deepEqual(seasonWindow(1), [12, 1, 2]);
  assert.deepEqual(seasonWindow(12), [11, 12, 1]);
  assert.deepEqual(seasonWindow(0), []);
});

test("photo caption says when and where", () => {
  assert.equal(photoContext({ observed_on: "2024-05-12", place_guess: "Boone, NC, USA" }), "May 2024 · Boone, NC");
  assert.equal(photoContext({}), null);
});

test("photo URL carries trip place and season; stable for saved trips", () => {
  const sp = { sciName: "Cardinalis cardinalis", comName: "Northern Cardinal" };
  assert.equal(mediaUrl(sp), "/api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal");
  const place = { lat: 36.2161, lng: -81.6746 };
  // Trip month wins; "recent" uses the month of the newest checklist (from saved data, not today)
  assert.deepEqual(photoContextFor(place, 5, { sample: { to: "2026-10-25 07:30" } }), { lat: 36.2161, lng: -81.6746, month: 5 });
  assert.equal(photoContextFor(place, 0, { sample: { to: "2026-10-25 07:30" } }).month, 10);
  assert.equal(mediaUrl(sp, photoContextFor(place, 0, { sample: { to: "2026-10-25" } })), "/api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal&lat=36.2&lng=-81.7&month=10");
});

test("local in-season photos come first; search widens until enough", async () => {
  const real = globalThis.fetch;
  const calls = [];
  const obs = (id, date, place) => ({ id, observed_on: date, place_guess: place, photos: [{ id: id * 10, license_code: "cc-by-nc", url: `https://static.inaturalist.org/photos/${id}/square.jpg`, attribution: `(c) Obs ${id}, some rights reserved (CC BY-NC)` }] });
  globalThis.fetch = async (url) => {
    const u = new URL(url); calls.push(u);
    const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/taxa") return json({ results: [{ id: 9083, name: "Cardinalis cardinalis", preferred_common_name: "Northern Cardinal", iconic_taxon_name: "Aves" }] });
    if (u.pathname === "/v1/taxa/9083") return json({ results: [{ id: 9083, default_photo: { id: 1, license_code: "cc-by", url: "https://static.inaturalist.org/photos/1/square.jpg", attribution: "(c) General" } }] });
    if (u.pathname === "/v1/observations") {
      const r = Number(u.searchParams.get("radius"));
      // 100 km: one photo (plus an all-rights-reserved one), 400 km: three more
      if (r === 100) return json({ results: [obs(2, "2024-05-03", "Boone, NC, USA"), { id: 99, photos: [{ id: 990, license_code: null, url: "https://x/photos/990/square.jpg" }] }] });
      if (r === 400) return json({ results: [obs(3, "2023-04-28", "Asheville, NC"), obs(4, "2024-06-01", "Roanoke, VA"), obs(5, "2025-05-20", "Johnson City, TN")] });
      return json({ results: [] });
    }
    throw new Error("unexpected " + url);
  };
  try {
    const m = await speciesMedia("Cardinalis cardinalis", "Northern Cardinal", { lat: 36.2, lng: -81.7, month: 5 });
    const obsCalls = calls.filter((u) => u.pathname === "/v1/observations");
    assert.deepEqual(obsCalls.map((u) => Number(u.searchParams.get("radius"))), RADII.slice(0, 2), "stopped widening once 4 local photos found");
    assert.equal(obsCalls[0].searchParams.get("month"), "4,5,6");
    assert.equal(obsCalls[0].searchParams.get("quality_grade"), "research");
    assert.match(obsCalls[0].searchParams.get("photo_license"), /cc-by-nc/);
    assert.deepEqual(m.photos.slice(0, 4).map((p) => p.local), [true, true, true, true]);
    assert.equal(m.photos[0].context, "May 2024 · Boone, NC");
    assert.ok(!m.photos.some((p) => p.url.includes("/990/")), "all-rights-reserved photo excluded");
    assert.equal(m.photos.at(-1).url, "https://static.inaturalist.org/photos/1/medium.jpg", "general photo fills in after local ones");
    // No location: general photos only, no observation search
    calls.length = 0;
    const g = await speciesMedia("Cardinalis cardinalis", "Northern Cardinal");
    assert.ok(!calls.some((u) => u.pathname === "/v1/observations"));
    assert.equal(g.photos.length, 1);
  } finally { globalThis.fetch = real; }
});
