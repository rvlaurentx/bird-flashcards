// GET /api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal[&lat=36.2&lng=-81.7&month=5]
// Licensed photos (with attribution) and a short description for one species.
import { send, fail, ApiError } from "./_lib/ebird.js";
import { speciesMedia } from "./_lib/inat.js";
import { mockMedia } from "./_lib/mock.js";

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const sci = (q.get("sci") || "").trim();
    const name = (q.get("name") || "").trim();
    if (!sci && !name) throw new ApiError(400, "sci or name is required.");
    // Optional trip context: prefer photos taken near here, in this season.
    const num = (k) => (q.get(k) === null || q.get(k) === "" ? NaN : Number(q.get(k)));
    const where = { lat: num("lat"), lng: num("lng"), month: Math.round(num("month")) || 0 };
    if (!(where.month >= 0 && where.month <= 12)) where.month = 0;
    const data = process.env.EBIRD_MOCK === "1" ? mockMedia(sci, name, where) : await speciesMedia(sci, name, where);
    send(res, 200, data, 60 * 60 * 24 * 7);
  } catch (e) { fail(res, e); }
}
