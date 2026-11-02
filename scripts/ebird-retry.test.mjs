// Checks that eBird requests back off and retry on HTTP 429.
import test from "node:test";
import assert from "node:assert/strict";

test("retries after 429 and succeeds", async () => {
  delete process.env.EBIRD_MOCK;
  process.env.EBIRD_API_KEY = " testkey123 ";
  const { ebird } = await import("../api/_lib/ebird.js?retry");
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push(opts.headers["X-eBirdApiToken"]);
    return seen.length < 3
      ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } })
      : new Response(JSON.stringify([{ ok: 1 }]), { status: 200 });
  };
  try {
    assert.deepEqual(await ebird("/ref/hotspot/geo?lat=1&lng=1"), [{ ok: 1 }]);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((k) => k === "testkey123"), "key is trimmed");
  } finally { globalThis.fetch = realFetch; process.env.EBIRD_MOCK = "1"; }
});

test("gives up with a clear message after repeated 429s", async () => {
  delete process.env.EBIRD_MOCK;
  process.env.EBIRD_API_KEY = "testkey123";
  const { ebird } = await import("../api/_lib/ebird.js?giveup");
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => { n++; return new Response("", { status: 429, headers: { "retry-after": "0.01" } }); };
  try {
    await assert.rejects(ebird("/x"), (e) => e.status === 503 && /limiting/.test(e.message));
    assert.equal(n, 4);
  } finally { globalThis.fetch = realFetch; process.env.EBIRD_MOCK = "1"; }
});
