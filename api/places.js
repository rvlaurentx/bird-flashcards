// GET /api/places?q=Cape May  → up to 6 matching places with coordinates.
import { geocode, send, fail, ApiError } from "./_lib/ebird.js";

export default async function handler(req, res) {
  try {
    const q = (new URL(req.url, "http://x").searchParams.get("q") || "").trim();
    if (q.length < 2) throw new ApiError(400, "Type at least two letters of a place name.");
    send(res, 200, { places: await geocode(q) }, 60 * 60 * 24 * 7);
  } catch (e) { fail(res, e); }
}
