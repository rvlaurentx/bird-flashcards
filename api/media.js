// GET /api/media?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal
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
    const data = process.env.EBIRD_MOCK === "1" ? mockMedia(sci, name) : await speciesMedia(sci, name);
    send(res, 200, data, 60 * 60 * 24 * 7);
  } catch (e) { fail(res, e); }
}
