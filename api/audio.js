// GET /api/audio?id=123456 → the xeno-canto recording XC123456 as audio.
// Used only to save recordings into an offline trip deck: the browser needs
// a same-origin, complete copy of the file to store and replay offline.
// No key needed (recording files are public); responses are CDN-cached.
import { ApiError, fail } from "./_lib/ebird.js";
import { mockAudio } from "./_lib/mock.js";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions return at most ~4.5 MB

export default async function handler(req, res) {
  try {
    const id = (new URL(req.url, "http://x").searchParams.get("id") || "").trim();
    if (!/^\d{1,9}$/.test(id)) throw new ApiError(400, "id must be a xeno-canto recording number.");
    let buf, type = "audio/mpeg";
    if (process.env.EBIRD_MOCK === "1") { buf = mockAudio(id); type = "audio/wav"; }
    else {
      let r;
      try { r = await fetch(`https://xeno-canto.org/${id}/download`, { redirect: "follow" }); }
      catch (e) { throw new ApiError(502, `Could not reach xeno-canto (${e.cause?.code || e.message}).`); }
      if (!r.ok) throw new ApiError(r.status === 404 ? 404 : 502, `xeno-canto returned ${r.status} for XC${id}.`);
      const len = Number(r.headers.get("content-length"));
      if (len > MAX_BYTES) throw new ApiError(413, `Recording XC${id} is too large to save offline.`);
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new ApiError(413, `Recording XC${id} is too large to save offline.`);
      type = r.headers.get("content-type")?.startsWith("audio/") ? r.headers.get("content-type") : "audio/mpeg";
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
    res.end(buf);
  } catch (e) { fail(res, e); }
}
