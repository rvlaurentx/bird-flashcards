// Offline trip decks: save a place's species list, photos and recordings on
// the device so the whole study flow works with no signal.
//
// Storage: one Cache Storage cache per deck ("deck-<lat>,<lng>") holding the
// API responses under the exact URLs the app requests (see lib.js) plus the
// photo and audio files. The service worker answers from deck caches first.
// Deck metadata (name, size, date) is small and lives in localStorage.

import { load, save, speciesUrl, mediaUrl, soundsUrl, audioUrl } from "./lib.js";

const DECKS_KEY = "bf-decks";
const PHOTOS_PER_BIRD = 2;           // main photo + "another photo" hint
const PHOTO_EST = 150 * 1024;        // when a photo's size can't be read
const AUDIO_EST = 900 * 1024;        // rough size of one short recording

export const SOUND_CHOICES = [
  { id: 0, label: "No sounds", note: "smallest" },
  { id: 1, label: "Song only", note: "recommended" },
  { id: 2, label: "Song and call", note: "largest" },
];

export const deckId = (p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
const cacheName = (id) => `deck-${id}`;

export const listDecks = () => load(DECKS_KEY, []);
export const getDeck = (p) => listDecks().find((d) => d.id === deckId(p)) || null;
function putMeta(meta) { save(DECKS_KEY, [meta, ...listDecks().filter((d) => d.id !== meta.id)]); }

export function estimateBytes(birds, soundsPerBird) {
  return birds * (PHOTOS_PER_BIRD * PHOTO_EST + soundsPerBird * AUDIO_EST);
}

export function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Which recordings to save: the song first (the hint plays it), then a call.
export function pickDeckRecordings(recs, n) {
  if (!n) return [];
  const song = recs.find((r) => r.kind === "song");
  const call = recs.find((r) => r.kind === "call");
  const ordered = [song, call, ...recs].filter(Boolean);
  return [...new Set(ordered)].slice(0, n);
}

export class DeckError extends Error {}

const jsonResponse = (obj) => new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function put(cache, url, res) {
  try { await cache.put(url, res); }
  catch (e) {
    if (e?.name === "QuotaExceededError") throw new DeckError("This device is out of storage space for offline trips. Remove a saved trip or choose fewer sounds.");
    throw e;
  }
}

// Save one photo. Prefer a readable (CORS) copy so its size is known; fall
// back to an opaque copy, which still displays fine offline.
async function storePhoto(cache, url, signal) {
  if (url.startsWith("data:")) return 0; // inline sample images need no storage
  try {
    const res = await fetch(url, { mode: "cors", signal });
    if (res.ok) { const blob = await res.clone().blob(); await put(cache, url, res); return blob.size; }
  } catch (e) { if (signal?.aborted || e instanceof DeckError) throw e; }
  const res = await fetch(url, { mode: "no-cors", signal });
  await put(cache, url, res);
  return PHOTO_EST;
}

async function storeRecording(cache, rec, signal) {
  const url = audioUrl(rec.id);
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  await put(cache, url, new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg", "Content-Length": String(blob.size), "Accept-Ranges": "bytes" } }));
  return { rec: { ...rec, url }, bytes: blob.size };
}

/**
 * Download a deck. `species` is the list to save (what the user is viewing);
 * `data` is the full species response for the place.
 * onProgress(done, total, bytes) is called after each bird.
 */
export async function downloadDeck({ place, month = 0, data, species, top, soundsPerBird, onProgress, signal }) {
  const id = deckId(place);
  const cache = await caches.open(cacheName(id));
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  for (const k of await cache.keys()) await cache.delete(k); // replace an older copy

  let bytes = 0, done = 0;
  const missing = [];
  try {
    await put(cache, speciesUrl(place, month), jsonResponse(data));
    let next = 0;
    const worker = async () => {
      while (next < species.length) {
        const sp = species[next++];
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        try {
          const m = await getJSON(mediaUrl(sp), signal);
          const kept = [];
          for (const ph of (m.photos || []).slice(0, PHOTOS_PER_BIRD)) {
            try { bytes += await storePhoto(cache, ph.url, signal); kept.push(ph); }
            catch (e) { if (signal?.aborted || e instanceof DeckError) throw e; }
          }
          await put(cache, mediaUrl(sp), jsonResponse({ ...m, photos: kept }));
          if (!kept.length) missing.push(sp.comName);
          if (soundsPerBird > 0) {
            const snd = await getJSON(soundsUrl(sp), signal);
            const keptRecs = [];
            for (const r of pickDeckRecordings(snd.recordings || [], soundsPerBird)) {
              try { const got = await storeRecording(cache, r, signal); if (got) { keptRecs.push(got.rec); bytes += got.bytes; } }
              catch (e) { if (signal?.aborted || e instanceof DeckError) throw e; }
            }
            await put(cache, soundsUrl(sp), jsonResponse({ recordings: keptRecs }));
          }
        } catch (e) {
          if (signal?.aborted || e instanceof DeckError) throw e;
          missing.push(sp.comName);
        }
        onProgress?.(++done, species.length, bytes);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    await caches.delete(cacheName(id)); // don't leave half a deck behind
    throw e;
  }

  const meta = {
    id, name: place.name, detail: place.detail || "", lat: place.lat, lng: place.lng,
    savedAt: Date.now(), birds: species.length, top, month, soundsPerBird, bytes, missing,
  };
  putMeta(meta);
  return meta;
}

export async function removeDeck(id) {
  await caches.delete(cacheName(id));
  save(DECKS_KEY, listDecks().filter((d) => d.id !== id));
}
