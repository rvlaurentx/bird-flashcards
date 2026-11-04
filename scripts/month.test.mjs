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
