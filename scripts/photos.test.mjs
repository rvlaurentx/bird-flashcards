import test from "node:test";
import assert from "node:assert/strict";
import { seasonWindow, photoContext, speciesMedia, RADII, EXCLUDE_TERM_VALUES } from "../api/_lib/inat.js";
import { mediaUrl, photoContextFor } from "../public/lib.js";

test("season window wraps around the year", () => {
  assert.deepEqual(seasonWindow(5), [4, 5, 6]);
  assert.deepEqual(seasonWindow(1), [12, 1, 2]);
  assert.deepEqual(seasonWindow(12), [11, 12, 1]);
  assert.deepEqual(seasonWindow(0), []);
});

test("photo caption says when and where", () => {
  assert.equal(photoContext({ observed_on: "2024-05-12", place_guess: "Boone, NC, USA" }), "May 2024 · Boone, NC");
  assert.equal(photoContext({}), null);
});

test("photo URL carries trip place and season; stable for saved trips", () => {
  const sp = { sciName: "Cardinalis cardinalis", comName: "Northern Cardinal" };
  assert.equal(mediaUrl(sp), "/api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal");
  const place = { lat: 36.2161, lng: -81.6746 };
  // Trip month wins; "recent" uses the month of the newest checklist (from saved data, not today)
  assert.deepEqual(photoContextFor(place, 5, { sample: { to: "2026-10-25 07:30" } }), { lat: 36.2161, lng: -81.6746, month: 5 });
  assert.equal(photoContextFor(place, 0, { sample: { to: "2026-10-25 07:30" } }).month, 10);
  assert.equal(mediaUrl(sp, photoContextFor(place, 0, { sample: { to: "2026-10-25" } })), "/api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal&lat=36.2&lng=-81.7&month=10");
});

test("local in-season photos come first; search widens for more candidates", async () => {
  delete process.env.ANTHROPIC_API_KEY; // no photo check in this test
  const real = globalThis.fetch;
  const calls = [];
  const obs = (id, date, place) => ({ id, observed_on: date, place_guess: place, photos: [{ id: id * 10, license_code: "cc-by-nc", url: `https://static.inaturalist.org/photos/${id}/square.jpg`, attribution: `(c) Obs ${id}, some rights reserved (CC BY-NC)` }] });
  globalThis.fetch = async (url) => {
    const u = new URL(url); calls.push(u);
    const json = (b) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/taxa") return json({ results: [{ id: 9083, name: "Cardinalis cardinalis", preferred_common_name: "Northern Cardinal", iconic_taxon_name: "Aves" }] });
    if (u.pathname === "/v1/taxa/9083") return json({ results: [{ id: 9083, default_photo: { id: 1, license_code: "cc-by", url: "https://static.inaturalist.org/photos/1/square.jpg", attribution: "(c) General" } }] });
    if (u.pathname === "/v1/observations") {
      const r = Number(u.searchParams.get("radius"));
      // 100 km: one photo (plus an all-rights-reserved one), 400 km: three more
      if (r === 100) return json({ results: [obs(2, "2024-05-03", "Boone, NC, USA"), { id: 99, photos: [{ id: 990, license_code: null, url: "https://x/photos/990/square.jpg" }] }] });
      if (r === 400) return json({ results: [obs(3, "2023-04-28", "Asheville, NC"), obs(4, "2024-06-01", "Roanoke, VA"), obs(5, "2025-05-20", "Johnson City, TN")] });
      return json({ results: [] });
    }
    throw new Error("unexpected " + url);
  };
  try {
    const m = await speciesMedia("Cardinalis cardinalis", "Northern Cardinal", { lat: 36.2, lng: -81.7, month: 5 });
    const obsCalls = calls.filter((u) => u.pathname === "/v1/observations");
    assert.deepEqual(obsCalls.map((u) => Number(u.searchParams.get("radius"))), RADII, "widened while short of candidates");
    assert.equal(obsCalls[0].searchParams.get("captive"), "false");
    assert.equal(obsCalls[0].searchParams.get("without_term_value_id"), EXCLUDE_TERM_VALUES.join(","));
    assert.equal(obsCalls[0].searchParams.get("month"), "4,5,6");
    assert.equal(obsCalls[0].searchParams.get("quality_grade"), "research");
    assert.match(obsCalls[0].searchParams.get("photo_license"), /cc-by-nc/);
    assert.deepEqual(m.photos.slice(0, 4).map((p) => p.local), [true, true, true, true]);
    assert.equal(m.photos[0].context, "May 2024 · Boone, NC");
    assert.ok(!m.photos.some((p) => p.url.includes("/990/")), "all-rights-reserved photo excluded");
    assert.equal(m.photos.at(-1).url, "https://static.inaturalist.org/photos/1/medium.jpg", "general photo fills in after local ones");
    // No location: general photos only, no observation search
    calls.length = 0;
    const g = await speciesMedia("Cardinalis cardinalis", "Northern Cardinal");
    assert.ok(!calls.some((u) => u.pathname === "/v1/observations"));
    assert.equal(g.photos.length, 1);
  } finally { globalThis.fetch = real; }
});

test("photo check keeps only photos where a bird is clearly visible", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { keepClearPhotos } = await import("../api/_lib/photocheck.js?check");
  const real = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("static.inaturalist.org")) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (!url.includes("api.anthropic.com")) throw new Error("unexpected " + url);
    sent = JSON.parse(typeof input === "string" ? init.body : await input.text());
    return new Response(JSON.stringify({
      id: "msg_t", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify({ bird_is_clear_subject: [true, false, true] }) }],
      usage: { input_tokens: 900, output_tokens: 20 },
    }), { headers: { "content-type": "application/json", "request-id": "req_t" } });
  };
  try {
    const photos = [1, 2, 3].map((i) => ({ url: `https://static.inaturalist.org/photos/${i}/medium.jpg` }));
    const { photos: kept, check } = await keepClearPhotos(photos);
    assert.deepEqual(kept.map((p) => p.url), [photos[0].url, photos[2].url]);
    assert.deepEqual(check, { ran: true, of: 3, kept: 2 });
    assert.equal(sent.model, "claude-haiku-5-5");
    const imgs = sent.messages[0].content.filter((b) => b.type === "image");
    assert.equal(imgs.length, 3);
    assert.equal(imgs[0].source.type, "base64", "photos are sent inline, not fetched by Anthropic");
    assert.equal(imgs[0].source.media_type, "image/jpeg");
    // Fails closed: with a key, a failed check drops the unchecked photos
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      return url.includes("static.inaturalist.org")
        ? new Response(new Uint8Array([0xff, 0xd8]), { headers: { "content-type": "image/jpeg" } })
        : new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400, headers: { "content-type": "application/json" } });
    };
    const { keepClearPhotos: again } = await import("../api/_lib/photocheck.js?failopen");
    const r = await again(photos);
    assert.equal(r.photos.length, 0, "a failed check keeps no unchecked local photos");
    assert.equal(r.check.ran, false);
    assert.match(r.check.reason, /check failed \(400\)/);
  } finally { globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY; }
});
