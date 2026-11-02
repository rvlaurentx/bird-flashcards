// Xeno-canto API v3: bird sound recordings.
// The key (XENO_CANTO_API_KEY) is used only here, on the server.
// Every recording carries its own Creative Commons license; the app must show
// the recordist, XC number and license with each recording.

import { ApiError } from "./ebird.js";

const XC = "https://xeno-canto.org/api/3/recordings";
const MAX_SECONDS = 90;   // long recordings are tedious as flashcards

export function getXcKey() {
  return (process.env.XENO_CANTO_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export async function xcQuery(query) {
  const key = getXcKey();
  if (!key) throw new ApiError(500, "XENO_CANTO_API_KEY is not set for this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy.");
  let res;
  try {
    res = await fetch(`${XC}?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`);
  } catch (e) {
    throw new ApiError(502, `Could not reach xeno-canto (${e.cause?.code || e.message}).`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) throw new ApiError(502, `xeno-canto refused the request (HTTP ${res.status}). Check XENO_CANTO_API_KEY; /api/health has details.`);
  if (res.status === 429) throw new ApiError(503, "xeno-canto is limiting requests right now. Try again shortly.");
  if (!res.ok) throw new ApiError(502, `xeno-canto returned ${res.status}${body?.message ? `: ${body.message}` : ""}.`);
  return body || { recordings: [] };
}

const https = (u) => (!u ? null : u.startsWith("//") ? `https:${u}` : u);

export function seconds(len) {
  const parts = String(len || "").split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

export function licenseName(url) {
  const m = String(url || "").match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : "CC license";
}

export function toRecording(r) {
  const kind = /song/i.test(r.type || "") ? "song" : /call/i.test(r.type || "") ? "call" : "other";
  return {
    id: `XC${r.id}`,
    kind,
    type: r.type || "",
    url: https(r.file),
    recordist: r.rec || "unknown recordist",
    license: licenseName(r.lic),
    licenseUrl: https(r.lic),
    page: https(r.url) || `https://xeno-canto.org/${r.id}`,
    length: r.length || null,
    country: r.cnt || null,
    quality: r.q || null,
  };
}

// Best recordings: quality A/B first, short enough to study, a mix of song
// and call (up to 2 of each).
export function pickRecordings(raw) {
  const rank = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const list = (raw || [])
    .filter((r) => r.file && (seconds(r.length) ?? 0) <= MAX_SECONDS)
    .sort((a, b) => (rank[a.q] ?? 5) - (rank[b.q] ?? 5) || (seconds(a.length) ?? 999) - (seconds(b.length) ?? 999))
    .map(toRecording);
  const songs = list.filter((r) => r.kind === "song").slice(0, 2);
  const calls = list.filter((r) => r.kind === "call").slice(0, 2);
  const out = [...songs, ...calls];
  if (!out.length) out.push(...list.slice(0, 2));
  return out;
}

export async function speciesSounds(sciName, comName) {
  const [gen, sp] = (sciName || "").trim().split(/\s+/);
  const queries = [];
  if (gen && sp) queries.push(`gen:${gen} sp:${sp} q:A`, `gen:${gen} sp:${sp}`);
  if (comName) queries.push(`en:"${comName.replace(/"/g, "")}"`);
  for (const q of queries) {
    const { recordings = [] } = await xcQuery(q);
    const picked = pickRecordings(recordings);
    if (picked.length) return { recordings: picked };
  }
  return { recordings: [] };
}
