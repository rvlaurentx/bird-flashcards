// GET /api/sounds?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal
// Up to 2 songs and 2 calls from xeno-canto, each with recordist and license.
import { send, fail, ApiError } from "./_lib/ebird.js";
import { speciesSounds } from "./_lib/xc.js";
import { mockSounds } from "./_lib/mock.js";

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const sci = (q.get("sci") || "").trim();
    const name = (q.get("name") || "").trim();
    if (!sci && !name) throw new ApiError(400, "sci or name is required.");
    const data = process.env.EBIRD_MOCK === "1" ? mockSounds(sci, name) : await speciesSounds(sci, name);
    send(res, 200, data, 60 * 60 * 24 * 7);
  } catch (e) { fail(res, e); }
}
