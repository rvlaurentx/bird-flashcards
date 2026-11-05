import test from "node:test";
import assert from "node:assert/strict";
import { splitSections, sourceText, sizeText, redact, toHints } from "../api/_lib/hints.js";
import { hintsFor } from "../public/learn.js";
import { hintsUrl } from "../public/lib.js";

const EXTRACT = `The northern cardinal (Cardinalis cardinalis) is a bird.

== Description ==
The northern cardinal is a mid-sized songbird with a body length of 21–23 cm. The male is vivid red with a black face mask.

== Taxonomy ==
Long taxonomy text that should be skipped.

== Distribution and habitat ==
Woodland edges, hedgerows and gardens.`;

test("Wikipedia sections: keeps intro, description and habitat; skips the rest", () => {
  const parts = splitSections(EXTRACT);
  assert.deepEqual(parts.sections.map((s) => s.title), ["Description", "Taxonomy", "Distribution and habitat"]);
  const text = sourceText(parts);
  assert.match(text, /21–23 cm/);
  assert.match(text, /hedgerows/);
  assert.doesNotMatch(text, /taxonomy text/);
});

test("size text compares with a familiar bird, never the bird itself", () => {
  assert.equal(sizeText(21, 23, "Northern Cardinal"), "21–23 cm (about 8.7 in), a little smaller than an American Robin");
  assert.match(sizeText(25, 25, "American Robin"), /cardinal/);
  assert.equal(sizeText(null, null), null);
});

test("names are hidden in hint text", () => {
  const t = redact("A Northern Cardinal male is red; cardinals have a crest. Cardinalis.", "Northern Cardinal", "Cardinalis cardinalis");
  assert.doesNotMatch(t, /cardinal/i);
  const h = toHints({ length_cm_min: 21, length_cm_max: 23, field_marks: ["Bright red male with black face", "Thick red bill"], habitat: "Gardens and woodland edges." }, "Northern Cardinal", "Cardinalis cardinalis");
  assert.equal(h.fieldMarks.length, 2);
  assert.equal(h.habitat, "Gardens and woodland edges.");
});

test("hint order: photo, song, size, habitat, family, field marks, choices", () => {
  const sp = { code: "norcar", family: "Cardinals" };
  const extra = { size: "21 cm", fieldMarks: ["a", "b"], habitat: "Gardens." };
  assert.deepEqual(hintsFor(sp, 2, 1, extra).map((h) => h.kind), ["photo", "sound", "size", "habitat", "family", "marks", "choices"]);
  assert.deepEqual(hintsFor(sp, 2, 1, null).map((h) => h.kind), ["photo", "sound", "family", "choices"]);
  assert.equal(hintsUrl({ sciName: "Cardinalis cardinalis", comName: "Northern Cardinal" }), "/api/hints?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal");
});

test("without ANTHROPIC_API_KEY the hints are simply off", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { speciesHints } = await import("../api/_lib/hints.js?nokey");
  const r = await speciesHints("Cardinalis cardinalis", "Northern Cardinal");
  assert.equal(r.available, false);
});

test("full pipeline: Wikipedia → Claude Haiku 5.5 (structured output) → hints", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { speciesHints, HINTS_MODEL } = await import("../api/_lib/hints.js?pipeline");
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("wikipedia.org")) {
      return new Response(JSON.stringify({ query: { pages: [{ title: "Northern cardinal", extract: EXTRACT }] } }), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.anthropic.com")) {
      sent = JSON.parse(typeof input === "string" ? init.body : await input.text());
      const json = { length_cm_min: 21, length_cm_max: 23, field_marks: ["Male bright red with black face mask", "Tall crest; thick red cone-shaped bill"], habitat: "Woodland edges, hedgerows and gardens" };
      return new Response(JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: HINTS_MODEL, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(json) }],
        usage: { input_tokens: 500, output_tokens: 60 },
      }), { headers: { "content-type": "application/json", "request-id": "req_test" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const r = await speciesHints("Cardinalis cardinalis", "Northern Cardinal");
    assert.equal(sent.model, "claude-haiku-5-5");
    assert.equal(sent.output_config.effort, "low");
    assert.equal(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /21–23 cm/);
    assert.equal(r.available, true);
    assert.equal(r.size, "21–23 cm (about 8.7 in), a little smaller than an American Robin");
    assert.deepEqual(r.fieldMarks, ["Male bright red with black face mask", "Tall crest; thick red cone-shaped bill"]);
    assert.equal(r.habitat, "Woodland edges, hedgerows and gardens.");
    assert.equal(r.source.license, "CC BY-SA 4.0");
    assert.ok(!JSON.stringify(r.fieldMarks).toLowerCase().includes("cardinal"));
  } finally { globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY; }
});
