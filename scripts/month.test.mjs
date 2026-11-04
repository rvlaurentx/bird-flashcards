import test from "node:test";
import assert from "node:assert/strict";
import { monthDates, interleave, rankSpecies } from "../api/species.js";
import { speciesUrl, periodText } from "../public/lib.js";

test("month dates: latest finished occurrence of the month, plus the year before", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const may = monthDates(5, now);
  assert.equal(may.length, 8);
  assert.deepEqual([...new Set(may.map((d) => d.y))], [2026, 2025]);
  assert.ok(may.every((d) => d.m === 5));
  // November is in progress, so use last year's November
  assert.deepEqual([...new Set(monthDates(11, now).map((d) => d.y))], [2025, 2024]);
  assert.deepEqual([...new Set(monthDates(12, now).map((d) => d.y))], [2025, 2024]);
});

test("interleave spreads checklists across dates", () => {
  assert.deepEqual(interleave([[1, 2, 3], [4], [5, 6]], 5), [1, 4, 5, 2, 6]);
  assert.deepEqual(interleave([[], []], 5), []);
});

test("month rankings reflect the season (mock data)", async () => {
  process.env.EBIRD_MOCK = "1";
  const jan = await rankSpecies(35.59, -82.55, 25, 1);
  const jul = await rankSpecies(35.59, -82.55, 25, 7);
  const has = (r, c) => r.species.some((s) => s.code === c);
  assert.equal(jan.period.label, "January");
  assert.ok(has(jan, "daejun") && !has(jul, "daejun"), "junco is a winter bird");
  assert.ok(jan.sample.from.slice(5, 7) === "01" && jul.sample.to.slice(5, 7) === "07");
});

test("URLs and labels include the month", () => {
  const p = { lat: 35.595, lng: -82.551 };
  assert.equal(speciesUrl(p), "/api/species?lat=35.59&lng=-82.55");
  assert.equal(speciesUrl(p, 5), "/api/species?lat=35.59&lng=-82.55&month=5");
  assert.equal(periodText(0), "recent checklists");
  assert.equal(periodText(5), "May checklists");
});

test("uses the most species-rich checklists", async () => {
  const { richestFirst } = await import("../api/species.js");
  assert.deepEqual(richestFirst([{ subId: "a", numSpecies: 5 }, { subId: "b", numSpecies: 40 }, { subId: "c", numSpecies: 5 }, { subId: "d" }]).map((c) => c.subId), ["b", "a", "c", "d"]);
  process.env.EBIRD_MOCK = "1";
  const { mockEbird } = await import("../api/_lib/mock.js");
  const feed = await mockEbird("/product/lists/US-XX-001?maxResults=200");
  const r = await rankSpecies(10.11, 10.11, 25, 0);
  assert.equal(r.sample.considered, feed.length);
  assert.equal(r.sample.richest, true);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const top = richestFirst(feed).slice(0, 25).map((c) => c.numSpecies);
  assert.ok(avg(top) > avg(feed.map((c) => c.numSpecies)), "sample is richer than average");
});

test("places without coordinates are dropped or rejected", async () => {
  const { coord } = await import("../api/_lib/ebird.js");
  const { hasCoords } = await import("../public/lib.js");
  assert.ok(Number.isNaN(coord(null)) && Number.isNaN(coord(undefined)) && Number.isNaN(coord("")));
  assert.equal(coord(-0.6), -0.6);
  assert.equal(coord("-90.4"), -90.4);
  assert.ok(hasCoords({ lat: -0.6, lng: -90.4 }));
  assert.ok(!hasCoords({ lat: null, lng: -90.4 }) && !hasCoords({ name: "x" }) && !hasCoords(undefined));
  // geocode filtering
  delete process.env.EBIRD_MOCK;
  const { geocode } = await import("../api/_lib/ebird.js");
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [
    { name: "Galápagos Islands", admin1: "Galápagos", country: "Ecuador" },
    { name: "Puerto Ayora", admin1: "Galápagos", country: "Ecuador", latitude: -0.74, longitude: -90.31 },
  ] }));
  try {
    const places = await geocode("Galapagos");
    assert.deepEqual(places.map((p) => p.name), ["Puerto Ayora"]);
  } finally { globalThis.fetch = real; process.env.EBIRD_MOCK = "1"; }
});
