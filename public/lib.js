// Shared helpers for the browser code.

export const $ = (s) => document.querySelector(s);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...children.flat().filter((c) => c != null && c !== false));
  return n;
}

// Replace a node's content, skipping empty parts (null/undefined/false).
// The DOM's own replaceChildren(null) would print the word "null".
export function fill(node, ...parts) {
  node.replaceChildren(...parts.flat().filter((c) => c != null && c !== false));
  return node;
}

export async function api(path) {
  const res = await fetch(path);
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(body?.error || (navigator.onLine ? `Request failed (${res.status}).` : "You're offline and this isn't saved on this device yet."));
  return body;
}

// localStorage wrappers: storage can be unavailable (private mode, blocked).
export function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } }

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

// API addresses in one place. Trip decks store responses under exactly these
// URLs, and the service worker serves them back offline, so the study screen
// and the deck downloader must build them identically.
// A usable coordinate, or NaN (Number(null) would wrongly give 0).
export const coord = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
export const hasCoords = (p) => Number.isFinite(coord(p?.lat)) && Number.isFinite(coord(p?.lng));

// month: 0 = recent sightings, 1–12 = that month in past years.
export const speciesUrl = (p, month = 0) => `/api/species?lat=${p.lat.toFixed(2)}&lng=${p.lng.toFixed(2)}${month ? `&month=${month}` : ""}`;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const periodText = (month) => (month ? `${MONTHS[month - 1]} checklists` : "recent checklists");
// Photo context: prefer photos from near the trip place in the trip season.
// `where` = { lat, lng, month } from photoContextFor(); coarse rounding so
// nearby places share cached results.
export const mediaUrl = (sp, where = null) => `/api/media?sci=${encodeURIComponent(sp.sciName)}&name=${encodeURIComponent(sp.comName)}` +
  (where && Number.isFinite(where.lat) && Number.isFinite(where.lng) ? `&lat=${where.lat.toFixed(1)}&lng=${where.lng.toFixed(1)}${where.month ? `&month=${where.month}` : ""}` : "");

// Trip month, or for "recent sightings" the month of the newest checklist
// used. Derived from the saved species data so it's identical offline.
export function photoContextFor(place, month, data) {
  if (!place) return null;
  const latest = /^\d{4}-(\d{2})/.exec(data?.sample?.to || "");
  return { lat: place.lat, lng: place.lng, month: month || (latest ? Number(latest[1]) : 0) };
}
export const soundsUrl = (sp) => `/api/sounds?sci=${encodeURIComponent(sp.sciName)}&name=${encodeURIComponent(sp.comName)}`;
export const hintsUrl = (sp) => `/api/hints?sci=${encodeURIComponent(sp.sciName)}&name=${encodeURIComponent(sp.comName)}` +
  (sp.family ? `&family=${encodeURIComponent(sp.family)}` : "");
export const audioUrl = (recId) => `/api/audio?id=${String(recId).replace(/\D/g, "")}`;
