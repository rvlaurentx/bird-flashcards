// Run with: npm test  (uses mock eBird data, no key or network)
import test from "node:test";
import assert from "node:assert/strict";
import { rankSpecies } from "../api/species.js";

test("ranks species by checklist frequency and filters non-species taxa", async () => {
  const r = await rankSpecies(38.93, -74.9, 25);
  assert.equal(r.region.code, "US-XX-001");
  assert.ok(r.sample.checklists >= 10);
  assert.ok(r.species.length > 10);
  for (let i = 1; i < r.species.length; i++) assert.ok(r.species[i - 1].freq >= r.species[i].freq);
  assert.ok(!r.species.some((s) => s.code === "woodpe1"), "spuh excluded");
  assert.ok(!r.species.some((s) => s.code === "yshfli"), "subspecies group rolled up");
  assert.ok(r.species.every((s) => s.freq > 0 && s.freq <= 1));
  assert.ok(["norcar", "moudov"].includes(r.species[0].code));
});
