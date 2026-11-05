// GET /api/hints?sci=Cardinalis%20cardinalis&name=Northern%20Cardinal
// Size, field-mark and habitat hints condensed from Wikipedia by Claude.
// Returns { available: false } while ANTHROPIC_API_KEY isn't set; that answer
// isn't cached, so hints switch on as soon as the key is added.
import { send, fail, ApiError } from "./_lib/ebird.js";
import { speciesHints } from "./_lib/hints.js";
import { mockHints } from "./_lib/mock.js";

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const sci = (q.get("sci") || "").trim();
    const name = (q.get("name") || "").trim();
    if (!sci && !name) throw new ApiError(400, "sci or name is required.");
    const data = process.env.EBIRD_MOCK === "1" ? mockHints(sci, name) : await speciesHints(sci, name);
    if (!data.available) res.setHeader("Cache-Control", "no-store");
    // Hints change only if Wikipedia does; cache for 30 days once made.
    send(res, 200, data, data.available ? 60 * 60 * 24 * 30 : 0);
  } catch (e) { fail(res, e); }
}
