import test from "node:test";
import assert from "node:assert/strict";
import { freeLicense, toCommonsPhoto, commonsPhotos } from "../api/_lib/commons.js";
import { speciesMedia } from "../api/_lib/inat.js";

const meta = (code, short, artist = '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a>') => ({
  License: { value: code }, LicenseShortName: { value: short }, Artist: { value: artist }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
});
const page = (title, m, mime = "image/jpeg") => ({ title, imageinfo: [{ mime, url: `https://upload.wikimedia.org/full/${title}`, thumburl: `https://upload.wikimedia.org/thumb/${title}/640px`, descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: m }] });

test("only freely reusable licences", () => {
  assert.equal(freeLicense(meta("cc-by-sa-4.0", "CC BY-SA 4.0")), "CC BY-SA 4.0");
  assert.equal(freeLicense(meta("cc-by-2.0", "CC BY 2.0")), "CC BY 2.0");
  assert.equal(freeLicense(meta("cc0", "CC0")), "CC0");
  assert.equal(freeLicense(meta("pd", "Public domain")), "Public domain");
  assert.equal(freeLicense(meta("cc-by-nc-2.0", "CC BY-NC 2.0")), null);
  assert.equal(freeLicense(meta("gfdl", "GFDL")), null);
});

test("photo shape with author credit; skips eggs, specimens, maps and non-images", () => {
  const p = toCommonsPhoto(page("File:Swamp sparrow (Melospiza georgiana).jpg", meta("cc-by-sa-4.0", "CC BY-SA 4.0")));
  assert.equal(p.attribution, "Jane Doe, CC BY-SA 4.0");
  assert.equal(p.source, "Wikimedia Commons");
  assert.match(p.url, /640px$/);
  assert.equal(toCommonsPhoto(page("File:Melospiza georgiana eggs MHNT.jpg", meta("cc-by-sa-4.0", "CC BY-SA 4.0"))), null);
  assert.equal(toCommonsPhoto(page("File:Melospiza georgiana map.png", meta("cc0", "CC0"), "image/png")), null);
  assert.equal(toCommonsPhoto(page("File:Song.ogg", meta("cc0", "CC0"), "audio/ogg")), null);
});

function fakeWikimedia(calls) {
  return async (input) => {
    const u = new URL(typeof input === "string" ? input : input.url); calls.push(u);
    const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    const q = u.searchParams;
    if (u.hostname === "en.wikipedia.org") return json({ query: { pages: [{ title: "Swamp sparrow", pageimage: "Lead_swamp_sparrow.jpg" }] } });
    if (u.hostname === "commons.wikimedia.org" && q.get("titles")) return json({ query: { pages: [page("File:Lead_swamp_sparrow.jpg", meta("cc-by-2.0", "CC BY 2.0"))] } });
    if (u.hostname === "commons.wikimedia.org" && q.get("generator") === "search") {
      return json({ query: { pages: [
        { ...page("File:QI swamp sparrow 2.jpg", meta("cc-by-sa-4.0", "CC BY-SA 4.0")), index: 2 },
        { ...page("File:QI swamp sparrow 1.jpg", meta("cc0", "CC0")), index: 1 },
        { ...page("File:QI swamp sparrow nc.jpg", meta("cc-by-nc-4.0", "CC BY-NC 4.0")), index: 3 },
      ] } });
    }
    if (u.hostname === "api.inaturalist.org" && u.pathname === "/v1/taxa") return json({ results: [{ id: 9, name: "Melospiza georgiana", preferred_common_name: "Swamp Sparrow", iconic_taxon_name: "Aves" }] });
    if (u.hostname === "api.inaturalist.org" && u.pathname === "/v1/taxa/9") return json({ results: [{ id: 9, default_photo: { id: 5, license_code: "cc-by-nc", url: "https://static.inaturalist.org/photos/5/square.jpg", attribution: "(c) iNat person" } }] });
    throw new Error("unexpected " + u);
  };
}

test("Commons: article photo first, then Quality images in search order, free licences only", async () => {
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = fakeWikimedia(calls);
  try {
    const photos = await commonsPhotos("Melospiza georgiana", "Swamp Sparrow");
    assert.deepEqual(photos.map((p) => p.url.split("/")[4]), ["File:Lead_swamp_sparrow.jpg", "File:QI swamp sparrow 1.jpg", "File:QI swamp sparrow 2.jpg"]);
    const search = calls.find((u) => u.searchParams.get("generator") === "search");
    assert.equal(search.searchParams.get("gsrsearch"), '"Melospiza georgiana" incategory:Quality_images');
  } finally { globalThis.fetch = real; }
});

test("species photos: local first, then Commons, then iNaturalist general photos", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const real = globalThis.fetch;
  globalThis.fetch = fakeWikimedia([]);
  try {
    const m = await speciesMedia("Melospiza georgiana", "Swamp Sparrow"); // no location → no local photos
    assert.deepEqual(m.photos.map((p) => p.source || "iNaturalist"), ["Wikimedia Commons", "Wikimedia Commons", "Wikimedia Commons", "iNaturalist"]);
    assert.equal(m.commonsPhotos, 3);
  } finally { globalThis.fetch = real; }
});

test("Commons failure never breaks photos", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.deepEqual(await commonsPhotos("Melospiza georgiana", "Swamp Sparrow"), []); }
  finally { globalThis.fetch = real; }
});

test("local and Commons photos alternate, so card photo and hint photo differ in source", async () => {
  const { alternate } = await import("../api/_lib/inat.js");
  assert.deepEqual(alternate(["L1", "L2", "L3"], ["C1"]), ["L1", "C1", "L2", "L3"]);
  assert.deepEqual(alternate([], ["C1", "C2"]), ["C1", "C2"]);
  assert.deepEqual(alternate(["L1", "L2"], ["C1", "C2"]), ["L1", "C1", "L2", "C2"]);
});
