// Offline trip decks: save a place's species list, photos and recordings on
// the device so the whole study flow works with no signal.
//
// Storage: one Cache Storage cache per deck ("deck-<lat>,<lng>") holding the
// API responses under the exact URLs the app requests (see lib.js) plus the
// photo and audio files. The service worker answers from deck caches first.
// Deck metadata (name, size, date) is small and lives in localStorage.

import { load, save, speciesUrl, mediaUrl, soundsUrl, hintsUrl, audioUrl, photoContextFor } from "./lib.js";

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

// Asks the service worker to skip saved decks and fetch fresh data, so an
// update never re-saves old copies (see sw.js fromDeck).
const FRESH = { "x-bf-fresh": "1" };

async function getJSON(url, signal) {
  const res = await fetch(url, { signal, headers: FRESH });
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
  const res = await fetch(url, { signal, headers: FRESH });
  if (!res.ok) return null;
  const blob = await res.blob();
  await put(cache, url, new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg", "Content-Length": String(blob.size), "Accept-Ranges": "bytes" } }));
  return { rec: { ...rec, url }, bytes: blob.size };
}

/**
 * Download (or update) a deck. With `refresh`, the species list is fetched
 * fresh and the first `top` birds are saved (0 = all); otherwise `data` and
 * `species` are what the user is viewing.
 * The new copy is written to a new cache; the old copy is removed only once
 * the new one is complete, so a failed or cancelled update keeps the old trip.
 * onProgress(done, total, bytes) is called after each bird.
 */
export async function downloadDeck({ place, month = 0, data, species, top, soundsPerBird, photoWhere = null, refresh = false, onProgress, signal }) {
  const id = deckId(place);
  if (refresh) {
    data = await getJSON(speciesUrl(place, month), signal);
    species = top ? data.species.slice(0, top) : data.species;
    photoWhere = photoContextFor(place, month, data);
  }
  const name = `${cacheName(id)}@${Date.now()}`;
  const cache = await caches.open(name);
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }

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
          const m = await getJSON(mediaUrl(sp, photoWhere), signal);
          const kept = [];
          for (const ph of (m.photos || []).slice(0, PHOTOS_PER_BIRD)) {
            try { bytes += await storePhoto(cache, ph.url, signal); kept.push(ph); }
            catch (e) { if (signal?.aborted || e instanceof DeckError) throw e; }
          }
          await put(cache, mediaUrl(sp, photoWhere), jsonResponse({ ...m, photos: kept }));
          if (!kept.length) missing.push(sp.comName);
          // Size / field-mark / habitat hints: small JSON; saved only once they exist.
          try {
            const hx = await getJSON(hintsUrl(sp), signal);
            if (hx.available) await put(cache, hintsUrl(sp), jsonResponse(hx));
          } catch (e) { if (signal?.aborted || e instanceof DeckError) throw e; }
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
    await caches.delete(name); // don't leave half a deck behind; the old copy stays
    throw e;
  }

  // Swap: drop the previous copy (named in its metadata, or the old fixed name).
  const prev = listDecks().find((d) => d.id === id);
  for (const old of new Set([prev?.cache, cacheName(id)])) if (old && old !== name) await caches.delete(old);
  const meta = {
    id, name: place.name, detail: place.detail || "", lat: place.lat, lng: place.lng, cache: name,
    savedAt: Date.now(), birds: species.length, top, month, soundsPerBird, bytes, missing,
  };
  putMeta(meta);
  return meta;
}

/**
 * Update every saved trip in turn with fresh data, keeping each one's month,
 * list size and sound choice. onProgress({ index, count, name, done, total }).
 * Returns { updated, failed: [{ name, error }] }; a cancel stops after the
 * current trip's partial copy is discarded (its old copy stays).
 */
export async function updateAllDecks({ onProgress, signal } = {}) {
  const decks = listDecks();
  const failed = [];
  let updated = 0;
  for (const [index, d] of decks.entries()) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    try {
      await downloadDeck({
        place: { name: d.name, detail: d.detail, lat: d.lat, lng: d.lng }, month: d.month || 0,
        top: d.top ?? 25, soundsPerBird: d.soundsPerBird ?? 1, refresh: true, signal,
        onProgress: (done, total) => onProgress?.({ index, count: decks.length, name: d.name, done, total }),
      });
      updated++;
    } catch (e) {
      if (signal?.aborted || e?.name === "AbortError") throw e;
      failed.push({ name: d.name, error: e.message });
    }
  }
  return { updated, failed };
}

export async function removeDeck(id) {
  const meta = listDecks().find((d) => d.id === id);
  for (const c of new Set([meta?.cache, cacheName(id)])) if (c) await caches.delete(c);
  save(DECKS_KEY, listDecks().filter((d) => d.id !== id));
}
