import test from "node:test";
import assert from "node:assert/strict";
import { pickRecordings, seconds, licenseName, speciesSounds } from "../api/_lib/xc.js";

const r = (id, type, q, length, extra = {}) => ({ id, type, q, length, file: `https://xeno-canto.org/${id}/download`, rec: "A. Recordist", lic: "//creativecommons.org/licenses/by-nc-sa/4.0/", url: `//xeno-canto.org/${id}`, ...extra });

test("helpers", () => {
  assert.equal(seconds("1:05"), 65);
  assert.equal(seconds("0:09"), 9);
  assert.equal(licenseName("//creativecommons.org/licenses/by-nc-sa/4.0/"), "CC BY-NC-SA 4.0");
});

test("picks best-quality short songs and calls, with credits", () => {
  const out = pickRecordings([
    r(1, "song", "C", "0:20"), r(2, "song", "A", "0:40"), r(3, "song", "A", "0:15"),
    r(4, "call", "B", "0:05"), r(5, "call, flight call", "A", "0:08"), r(6, "song", "A", "3:10"),
    r(7, "song", "A", "0:10", { file: "" }),
  ]);
  assert.deepEqual(out.map((x) => x.id), ["XC3", "XC2", "XC5", "XC4"]);
  assert.equal(out[0].page, "https://xeno-canto.org/3");
  assert.equal(out[0].licenseUrl, "https://creativecommons.org/licenses/by-nc-sa/4.0/");
  assert.equal(out[0].recordist, "A. Recordist");
});

test("falls back from quality A to any quality, key stays server-side", async () => {
  process.env.XENO_CANTO_API_KEY = " xckey ";
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => {
    urls.push(String(u));
    const body = urls.length === 1 ? { recordings: [] } : { recordings: [r(9, "song", "C", "0:30")] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const out = await speciesSounds("Cardinalis cardinalis", "Northern Cardinal");
    assert.equal(out.recordings[0].id, "XC9");
    assert.match(decodeURIComponent(urls[0]), /query=gen:Cardinalis sp:cardinalis q:A&key=xckey$/);
    assert.match(decodeURIComponent(urls[1]), /query=gen:Cardinalis sp:cardinalis&key=xckey$/);
  } finally { globalThis.fetch = real; delete process.env.XENO_CANTO_API_KEY; }
});
