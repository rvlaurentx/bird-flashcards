import test from "node:test";
import assert from "node:assert/strict";
import { pickDeckRecordings, estimateBytes, formatBytes, deckId } from "../public/decks.js";
import { audioUrl, mediaUrl } from "../public/lib.js";

test("deck saves the song first, then a call", () => {
  const recs = [{ id: "XC1", kind: "call" }, { id: "XC2", kind: "song" }, { id: "XC3", kind: "song" }, { id: "XC4", kind: "call" }];
  assert.deepEqual(pickDeckRecordings(recs, 0), []);
  assert.deepEqual(pickDeckRecordings(recs, 1).map((r) => r.id), ["XC2"]);
  assert.deepEqual(pickDeckRecordings(recs, 2).map((r) => r.id), ["XC2", "XC1"]);
  assert.deepEqual(pickDeckRecordings([{ id: "XC9", kind: "other" }], 2).map((r) => r.id), ["XC9"]);
});

test("size estimates and formatting", () => {
  assert.ok(estimateBytes(25, 2) > estimateBytes(25, 1));
  assert.ok(estimateBytes(25, 1) > estimateBytes(25, 0));
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(5.25 * 1024 * 1024), "5.3 MB");
  assert.equal(formatBytes(30 * 1024 * 1024), "30 MB");
});

test("ids and URLs are stable", () => {
  assert.equal(deckId({ lat: 36.2161, lng: -81.6746 }), "36.22,-81.67");
  assert.equal(audioUrl("XC012345"), "/api/audio?id=012345");
  assert.equal(mediaUrl({ sciName: "Poecile atricapillus", comName: "Black-capped Chickadee" }), "/api/media?sci=Poecile%20atricapillus&name=Black-capped%20Chickadee");
});
