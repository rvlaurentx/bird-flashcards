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

test("size: combined length/wingspan/weight, compared within the bird's shape group", () => {
  const d = (length, wingspan, mass) => ({ length, wingspan, mass });
  // The case that prompted this: a Red-tailed Hawk is not "Mallard-sized"
  const rtha = sizeText(d([45, 65], [110, 145], [690, 1460]), "Red-tailed Hawk", "Hawks, Eagles, and Kites");
  assert.equal(rtha, "45–65 cm (about 22 in), wingspan 110–145 cm, 690–1460 g: bigger than a Barred Owl, smaller than an Osprey");
  assert.doesNotMatch(rtha, /Mallard/);
  assert.equal(sizeText(d([12, 15], [18, 20], [15, 20]), "Swamp Sparrow", "New World Sparrows"),
    "12–15 cm (about 5.3 in), wingspan 18–20 cm, 15–20 g: bigger than a chickadee, smaller than a Dark-eyed Junco");
  assert.match(sizeText(d([11.5, 12], [15, 20], [9, 12]), "Carolina Chickadee", "Tits, Chickadees, and Titmice"), /bigger than a kinglet, smaller than a Dark-eyed Junco$/);
  assert.match(sizeText(d([97, 137], [167, 201], [2100, 2500]), "Great Blue Heron", "Herons, Egrets, and Bitterns"), /bigger than a Great Egret, smaller than a Sandhill Crane$/, "'great' alone isn't the same kind");
  assert.match(sizeText(d([50, 65], [82, 95], [1000, 1300]), "Mallard", "Ducks, Geese, and Waterfowl"), /Wood Duck.*Canada Goose/);
  assert.match(sizeText(d([15, 17], null, null), "Song Sparrow", "New World Sparrows"), /^15–17 cm \(about 6.3 in\): bigger than a Dark-eyed Junco, smaller than an Eastern Bluebird$/, "length only; no House Sparrow for a sparrow");
  assert.equal(sizeText(d(null, null, null), "X"), null);
});

test("size groups from eBird family names", async () => {
  const { refGroup } = await import("../api/_lib/hints.js");
  assert.equal(refGroup("Hawks, Eagles, and Kites"), "raptors");
  assert.equal(refGroup("Owls"), "raptors");
  assert.equal(refGroup("Ducks, Geese, and Waterfowl"), "waterfowl");
  assert.equal(refGroup("Herons, Egrets, and Bitterns"), "waders");
  assert.equal(refGroup("Sandpipers and Allies"), "shorebirds");
  assert.equal(refGroup("Gulls, Terns, and Skimmers"), "gulls");
  assert.equal(refGroup("New World Sparrows"), "landbirds");
  assert.equal(refGroup(""), "landbirds");
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
  assert.equal(hintsUrl({ sciName: "Buteo jamaicensis", comName: "Red-tailed Hawk", family: "Hawks, Eagles, and Kites" }), "/api/hints?sci=Buteo%20jamaicensis&name=Red-tailed%20Hawk&family=Hawks%2C%20Eagles%2C%20and%20Kites");
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
      const json = { length_cm_min: 21, length_cm_max: 23, wingspan_cm_min: 25, wingspan_cm_max: 31, mass_g_min: 42, mass_g_max: 48, field_marks: ["Male bright red with black face mask", "Tall crest; thick red cone-shaped bill"], habitat: "Woodland edges, hedgerows and gardens" };
      return new Response(JSON.stringify({
        id: "msg_test", type: "message", role: "assistant", model: HINTS_MODEL, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(json) }],
        usage: { input_tokens: 500, output_tokens: 60 },
      }), { headers: { "content-type": "application/json", "request-id": "req_test" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const r = await speciesHints("Cardinalis cardinalis", "Northern Cardinal", "Cardinals, Grosbeaks, and Allies");
    assert.equal(sent.model, "claude-haiku-5-5");
    assert.equal(sent.output_config.effort, "low");
    assert.equal(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /21–23 cm/);
    assert.equal(r.available, true);
    assert.match(r.size, /^21–23 cm \(about 8.7 in\), wingspan 25–31 cm, 42–48 g: /);
    assert.doesNotMatch(r.size, /Cardinal/i, "never compared with itself");
    assert.deepEqual(r.fieldMarks, ["Male bright red with black face mask", "Tall crest; thick red cone-shaped bill"]);
    assert.equal(r.habitat, "Woodland edges, hedgerows and gardens.");
    assert.equal(r.source.license, "CC BY-SA 4.0");
    assert.ok(!JSON.stringify(r.fieldMarks).toLowerCase().includes("cardinal"));
  } finally { globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY; }
});
