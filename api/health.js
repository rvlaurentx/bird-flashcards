// GET /api/health — diagnose the eBird setup without revealing the key.
// Reports whether EBIRD_API_KEY is present, its length, whether it contained
// stray characters, and what eBird answers to one small authenticated request.
import { getKey, send } from "./_lib/ebird.js";

export default async function handler(req, res) {
  const raw = process.env.EBIRD_API_KEY;
  const key = getKey();
  const out = {
    deployment: process.env.VERCEL_ENV || "local",
    mock: process.env.EBIRD_MOCK === "1",
    key: {
      present: raw !== undefined && raw !== "",
      length: key.length,
      hadStrayCharacters: raw !== undefined && raw !== key,
      looksLikeEbirdKey: /^[a-z0-9]{8,20}$/i.test(key),
    },
    ebird: null,
  };
  if (key) {
    try {
      const r = await fetch("https://api.ebird.org/v2/data/obs/US-NY/recent?maxResults=1", { headers: { "X-eBirdApiToken": key } });
      out.ebird = { status: r.status, ok: r.ok };
    } catch (e) {
      out.ebird = { status: null, ok: false, error: e.cause?.code || e.message };
    }
  }
  out.verdict =
    !out.key.present ? "No EBIRD_API_KEY in this deployment. Check the variable name and that it's enabled for this environment, then redeploy." :
    !out.ebird?.ok && (out.ebird?.status === 401 || out.ebird?.status === 403) ? "eBird rejected this key. Copy it again from https://ebird.org/api/keygen and replace the value." :
    !out.ebird?.ok ? "Could not get a good answer from eBird; see the ebird field." :
    "eBird key works.";
  res.setHeader("Cache-Control", "no-store");
  send(res, 200, out);
}
