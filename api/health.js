// GET /api/health — diagnose the eBird setup without revealing the key.
// Reports whether EBIRD_API_KEY is present, its length, whether it contained
// stray characters, and what eBird answers to one small authenticated request.
import { getKey, send } from "./_lib/ebird.js";
import { getXcKey } from "./_lib/xc.js";

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
  // xeno-canto (bird sounds)
  const rawXc = process.env.XENO_CANTO_API_KEY;
  const xcKey = getXcKey();
  out.xenoCanto = { keyPresent: !!xcKey, keyLength: xcKey.length, hadStrayCharacters: rawXc !== undefined && rawXc !== xcKey, status: null };
  if (xcKey) {
    try {
      const r = await fetch(`https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent("gen:Cardinalis sp:cardinalis q:A")}&key=${encodeURIComponent(xcKey)}`);
      out.xenoCanto.status = r.status;
      out.xenoCanto.ok = r.ok;
      if (!r.ok) { try { out.xenoCanto.message = (await r.json()).message || null; } catch { /* ignore */ } }
    } catch (e) { out.xenoCanto.ok = false; out.xenoCanto.error = e.cause?.code || e.message; }
  }
  out.xenoCanto.verdict = !xcKey ? "No XENO_CANTO_API_KEY in this deployment (sounds disabled)." : out.xenoCanto.ok ? "xeno-canto key works." : "xeno-canto did not accept the request; see status/message.";

  // Claude (size / field-mark / habitat hints). Presence only; no paid call.
  const { getAnthropicKey, HINTS_MODEL } = await import("./_lib/hints.js");
  const ak = getAnthropicKey();
  out.hints = { model: HINTS_MODEL, keyPresent: !!ak, verdict: ak ? "Anthropic key is set; hints are on." : "No ANTHROPIC_API_KEY (size, field-mark and habitat hints are off)." };

  out.verdict =
    !out.key.present ? "No EBIRD_API_KEY in this deployment. Check the variable name and that it's enabled for this environment, then redeploy." :
    !out.ebird?.ok && (out.ebird?.status === 401 || out.ebird?.status === 403) ? "eBird rejected this key. Copy it again from https://ebird.org/api/keygen and replace the value." :
    !out.ebird?.ok ? "Could not get a good answer from eBird; see the ebird field." :
    "eBird key works.";
  res.setHeader("Cache-Control", "no-store");
  send(res, 200, out);
}
