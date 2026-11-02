# Bird Flashcards — project notes for Claude Code

A mobile-first **progressive web app (PWA)** for learning to identify the birds
you're likely to see on an upcoming trip. Installed to the Android home screen
from the browser; may later be wrapped for the Play Store (e.g. as a Trusted Web
Activity). This replaced an earlier native Android attempt that never got past
the starter template.

## Deployment workflow
- Code lives in the GitHub repo `bird-flashcards`; Vercel deploys on every push.
  Each branch gets a preview URL. Test on a real phone before merging.
- No build step. `public/` is served as static files; `api/*.js` are Vercel
  Node serverless functions. Files in `api/_lib/` are shared helpers, not routes.
- Local dev: `npm run dev` (real eBird, needs `.env`) or `npm run dev:mock`
  (built-in sample data). Tests: `npm test` (mock data).

## Hard rules
- **API keys never reach GitHub or the browser.** `EBIRD_API_KEY` is a Vercel
  environment variable. The browser only calls our `/api/*` functions.
  `.env` is git-ignored; `.env.example` documents the variables.
- **Offline trip decks are a core requirement, not an add-on.** Birders often
  have no signal. Every feature must answer: "what happens with no network?"
- Attribute data sources in the UI (eBird is required by its API terms).

## Data sources
| Need | Source | Status / notes |
|---|---|---|
| Place name → coordinates | Open-Meteo geocoding API (free, no key) | In use: `api/places.js` |
| Likely species for a place | eBird API 2.0 | In use: `api/species.js` |
| Bird sounds | Xeno-canto API v3 | Planned. v3 needs an API key → serverless function + env var. Recordings have per-recording Creative Commons licenses (some NC/ND); store and show license + recordist. |
| Photos + short description | iNaturalist API (taxon photos; `wikipedia_summary`) | In use: `api/media.js`, `api/_lib/inat.js`. Only CC0/CC-BY/CC-BY-SA/CC-BY-NC/CC-BY-NC-SA photos (`ALLOWED_LICENSES`); NC is allowed only while the app is non-commercial. The attribution string is shown under every photo. Taxon matched by scientific name, then common name (eBird and iNat names sometimes differ). |
| Photos/audio (alt) | Macaulay Library | No open public API; media is generally not licensed for reuse in apps without permission. Check current terms before using. |

Re-check current key requirements and license terms for each source before any
public release.

### How the species ranking works (`api/species.js`)
1. Nearby eBird hotspots (`/ref/hotspot/geo`) → pick the most common county
   (`subnational2Code`) among the 25 nearest.
2. Recent checklists in that county (`/product/lists/{region}`), up to 25.
3. Fetch each checklist (`/product/checklist/view/{subId}`), keep complete ones
   (`allObsReported`), falling back to all if fewer than 8 are complete.
   At most 3 requests in flight.
4. Taxonomy lookup: keep `species`; roll `issf`/`form`/`intergrade` up to their
   species via `reportAs`; drop spuh/slash/hybrid/domestic.
5. `freq` = share of sampled checklists reporting the species (the same idea as
   eBird's bar-chart "frequency"). Sorted by freq, then taxonomic order.
- Responses are CDN-cached for 12 h (`s-maxage`); the client rounds lat/lng to
  2 decimals so nearby searches share a cache entry.
- **eBird rate-limits bursts (HTTP 429).** The first version (40 checklists,
  8 in parallel) hit it. Now: ~30 calls per uncached search, 3 in parallel,
  429s retried with backoff (1s/2s/4s or `Retry-After`), and results cached
  in memory per county for 12 h while the function instance is warm.
  If limits are still a problem, persist results in Vercel KV/Blob keyed by
  region (survives cold starts and is shared by all instances).
- `/api/health` diagnoses the key setup without revealing the key.
- **Known limitation:** "recent" means the current season. For a trip months
  away we'll want month-specific frequency (eBird bar-chart data per month).

## Offline design
- `public/sw.js`: app shell precached; `/api/*` network-first with cache
  fallback (any place opened before works offline); Google Fonts cached;
  iNaturalist photos cache-first (`media-v1`, ~400 max), so birds you've
  already studied keep their photos offline.
- Next: an explicit **"Download trip deck"** action that stores the species
  list, chosen photos and audio for a trip in a dedicated cache (plus deck
  metadata/progress in IndexedDB), shows the download size first, and lets
  the user delete old decks. Bump `VERSION` in `sw.js` when shell files change.

## Learning design (confirmed by the user)
Logic lives in `public/learn.js` (no DOM, unit-tested); UI in `public/study.js`.
- **Hint progression:** photo → family → size relative to a familiar bird →
  key field mark → habitat/behavior → song/call → reveal. Fewer hints used =
  stronger recall credit.
  - *Implemented today:* photo → **another photo** of the same species →
    family → multiple choice (look-alikes) → reveal. Size, field marks,
    habitat and song need a data source we don't have yet; slot them into
    `hintsFor()` when added.
  - **No scientific names in hints** (user's request: they don't use them).
    The genus hint was removed. The scientific name stays on the answer side
    (user confirmed).
- **Confusable-species grouping:** choices come from (a) curated confusion
  pairs (`CONFUSION_PAIRS`, eBird codes), (b) same eBird family on the trip
  list, then (c) taxonomically nearest species, all limited to the place's list.
- **Spaced repetition (Leitner boxes 0–5, per species, shared across trips):**
  known with no hints → box +1; known with hints → no promotion (min 1);
  missed → box 0 and the card returns 3 cards later in the same session.
  Box ≥ 3 = "learned" (dot in the species list). Sessions order cards weakest
  first, then commonest on the trip. Progress is in localStorage (`bf-progress`);
  move to IndexedDB with the trip-deck work.
- Photos rotate between reviews so you learn the bird, not one picture.

## Roadmap
1. ✅ Place → ranked species list (eBird, serverless, cached)
2. ✅ Flashcard flow (photo → hints → answer; spaced repetition)
3. ✅ Photos (iNaturalist, licensed + attributed) — pulled forward; cards need them
4. Audio (Xeno-canto) — also enables the "song/call" hint
5. Offline trip decks (download, manage, study with no signal)
6. Hint data for size / field marks / habitat (source to be decided)
7. Optional: month-of-trip frequencies; Play Store wrapper

## Conventions
- Vanilla HTML/CSS/ES modules, no framework or bundler (keep it simple until
  there's a reason not to). Node ≥ 18 for functions.
- Mobile-first: test at ~390 px width; tap targets ≥ 44 px; support dark mode.
- Keep `api/_lib/mock.js` shapes in sync with the real eBird responses used.
