import test from "node:test";
import assert from "node:assert/strict";
import { grade, sessionOrder, requeue, hintsFor, lookalikes } from "../public/learn.js";
import { toPhoto, stripHtml } from "../api/_lib/inat.js";

const sp = (code, freq, familyCode, taxonOrder, extra = {}) => ({ code, comName: code, sciName: `Genus ${code}`, freq, familyCode, family: familyCode, taxonOrder, ...extra });

test("grading: promote only when known without hints; reset on miss", () => {
  let p = {};
  p = grade(p, "a", { knewIt: true, hintsUsed: 0 }); assert.equal(p.a.box, 1);
  p = grade(p, "a", { knewIt: true, hintsUsed: 0 }); assert.equal(p.a.box, 2);
  p = grade(p, "a", { knewIt: true, hintsUsed: 2 }); assert.equal(p.a.box, 2);
  p = grade(p, "a", { knewIt: false, hintsUsed: 0 }); assert.equal(p.a.box, 0);
  assert.equal(p.a.right, 3); assert.equal(p.a.wrong, 1);
  for (let i = 0; i < 9; i++) p = grade(p, "a", { knewIt: true, hintsUsed: 0 });
  assert.equal(p.a.box, 5);
});

test("session order: random, but weaker birds before known ones", () => {
  const deck = "abcdefghij".split("").map((c, i) => sp(c, 1 - i / 10));
  const orders = new Set();
  for (let i = 0; i < 20; i++) orders.add(sessionOrder(deck, {}).map((s) => s.code).join(""));
  assert.ok(orders.size > 10, "fresh deck is shuffled");
  assert.ok(!orders.has("abcdefghij") || orders.size > 1);
  for (let i = 0; i < 20; i++) {
    const order = sessionOrder(deck, { a: { box: 4 }, b: { box: 2 } }).map((s) => s.code);
    assert.equal(order.at(-1), "a");
    assert.equal(order.at(-2), "b");
    assert.equal(new Set(order).size, 10);
  }
});

test("missed cards return a few cards later", () => {
  assert.deepEqual(requeue(["b", "c", "d", "e"], "a").join(""), "bcdae");
  assert.deepEqual(requeue(["b"], "a").join(""), "ba");
});

test("hints: another photo first (when there is one), then family, then choices; no scientific names", () => {
  const bird = sp("dowwoo", 0.5, "picida1", 1);
  assert.deepEqual(hintsFor(bird, 3).map((x) => x.kind), ["photo", "family", "choices"]);
  assert.deepEqual(hintsFor(bird, 1).map((x) => x.kind), ["family", "choices"]);
  assert.ok(!hintsFor(bird, 3).some((h) => h.kind === "genus" || h.text.includes("Genus")));
  assert.deepEqual(hintsFor(bird, 3, 2).map((x) => x.kind), ["photo", "sound", "family", "choices"]);
});

test("look-alikes: curated pair first, then same family, then taxonomic neighbours", () => {
  const all = [
    sp("dowwoo", 0.5, "picida1", 100), sp("rebwoo", 0.6, "picida1", 90), sp("haiwoo", 0.1, "picida1", 101),
    sp("norfli", 0.3, "picida1", 120), sp("blujay", 0.7, "corvid1", 200), sp("belkin1", 0.1, "alcedi1", 95),
  ];
  const l = lookalikes(all[0], all).map((s) => s.code);
  assert.equal(l.length, 3);
  assert.equal(l[0], "haiwoo");
  assert.ok(l.includes("rebwoo") && l.includes("norfli"));
  const small = lookalikes(all[4], all.slice(3, 5)); // only one other bird available
  assert.equal(small.length, 1);
});

test("photos: only open licenses, medium size, attribution kept", () => {
  assert.equal(toPhoto({ id: 1, license_code: null, url: "https://x/photos/1/square.jpg" }), null);
  assert.equal(toPhoto({ id: 1, license_code: "cc-by-nd", url: "https://x/photos/1/square.jpg" }), null);
  const p = toPhoto({ id: 7, license_code: "cc-by", url: "https://x/photos/7/square.jpg", attribution: "(c) A B, some rights reserved (CC BY)" });
  assert.equal(p.url, "https://x/photos/7/medium.jpg");
  assert.equal(p.license, "CC-BY");
  assert.match(p.attribution, /A B/);
  assert.equal(stripHtml("<p>The <b>Downy</b>&nbsp;Woodpecker</p>"), "The Downy Woodpecker");
});

test("points: 10 with no hints, hint costs subtract, floor of 1, misses 0", async () => {
  const { scoreAnswer, HINT_COST } = await import("../public/learn.js");
  assert.equal(scoreAnswer({ knewIt: true }).points, 10);
  assert.equal(scoreAnswer({ knewIt: true, hintKinds: ["photo"] }).points, 9);
  assert.equal(scoreAnswer({ knewIt: true, hintKinds: ["sound", "family"] }).points, 6);
  assert.equal(scoreAnswer({ knewIt: true, hintKinds: Object.keys(HINT_COST) }).points, 1, "all hints still earn 1");
  assert.equal(scoreAnswer({ knewIt: false, hintKinds: [] }).points, 0);
});

test("points: streak bonus from the 3rd clean answer; hints or a miss reset it", async () => {
  const { scoreAnswer } = await import("../public/learn.js");
  let streak = 0; const pts = [];
  for (const kinds of [[], [], [], [], ["family"], []]) {
    const r = scoreAnswer({ knewIt: true, hintKinds: kinds, streak });
    streak = r.streak; pts.push(r.points);
  }
  assert.deepEqual(pts, [10, 10, 12, 12, 8, 10]);
  assert.equal(scoreAnswer({ knewIt: false, streak: 5 }).streak, 0);
});

test("points: a repeat after a miss is practice (0 points, streak kept)", async () => {
  const { scoreAnswer } = await import("../public/learn.js");
  const r = scoreAnswer({ knewIt: true, firstAttempt: false, streak: 2 });
  assert.deepEqual([r.points, r.streak, r.practice], [0, 2, true]);
});

test("max score includes streak bonuses", async () => {
  const { maxScore } = await import("../public/learn.js");
  assert.equal(maxScore(25), 25 * 10 + 23 * 2);
  assert.equal(maxScore(2), 20);
});

test("sound quiz: hint order and costs; ear progress kept separate", async () => {
  const { soundHintsFor, progressKey, sessionOrder, scoreAnswer } = await import("../public/learn.js");
  const sp = { code: "swaspa", family: "New World Sparrows" };
  const extra = { size: "14 cm", habitat: "Marshes.", fieldMarks: ["x"] };
  assert.deepEqual(soundHintsFor(sp, 2, 3, extra).map((h) => h.kind), ["recording", "habitat", "family", "size", "seephoto", "choices"]);
  assert.deepEqual(soundHintsFor(sp, 1, 0, null).map((h) => h.kind), ["family", "choices"], "no second recording, no photo, no extras");
  assert.ok(!soundHintsFor(sp, 2, 3, extra).some((h) => h.kind === "marks"), "visual field marks aren't sound hints");
  assert.equal(progressKey("swaspa"), "swaspa");
  assert.equal(progressKey("swaspa", "sound"), "swaspa@ear");
  // Ordering by ear uses the ear progress, not the sight progress
  const deck = [{ code: "a", freq: 1 }, { code: "b", freq: 1 }];
  const progress = { a: { box: 0 }, b: { box: 5 }, "a@ear": { box: 5 }, "b@ear": { box: 0 } };
  for (let i = 0; i < 5; i++) assert.equal(sessionOrder(deck, progress, Math.random, (s) => progressKey(s.code, "sound"))[0].code, "b");
  assert.equal(scoreAnswer({ knewIt: true, hintKinds: ["recording", "seephoto"] }).points, 6);
});
