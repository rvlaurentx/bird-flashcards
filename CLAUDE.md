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
| Photos | iNaturalist API (observation photos) | Planned. License varies per photo; filter to CC0/CC-BY/CC-BY-SA (CC-BY-NC only if the app stays non-commercial) and always show attribution. |
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
  fallback (any place opened before works offline); Google Fonts cached.
- Next: an explicit **"Download trip deck"** action that stores the species
  list, chosen photos and audio for a trip in a dedicated cache (plus deck
  metadata/progress in IndexedDB), shows the download size first, and lets
  the user delete old decks. Bump `VERSION` in `sw.js` when shell files change.

## Learning design (to confirm with the user)
These were discussed in earlier planning but details weren't written down.
Record the agreed version here.
- **Hint progression** (proposed): photo → family → size relative to a
  familiar bird → key field mark → habitat/behavior → song/call → reveal.
  Fewer hints used = stronger recall credit for spaced repetition.
- **Confusable-species grouping** (proposed): quiz distractors and "compare"
  cards come from (a) the same eBird family in the trip list, plus (b) a
  curated list of classic confusion pairs (e.g. Downy vs Hairy Woodpecker,
  House vs Purple Finch, Cooper's vs Sharp-shinned Hawk), limited to species
  actually on the trip list.
- Prioritize study by trip frequency: learn the commonest birds first.

## Roadmap
1. ✅ Place → ranked species list (eBird, serverless, cached)
2. Flashcard flow (photo → hints → answer; spaced repetition)
3. Audio (Xeno-canto)
4. Photos (iNaturalist, licensed + attributed)
5. Offline trip decks (download, manage, study with no signal)
6. Optional: month-of-trip frequencies; Play Store wrapper

## Conventions
- Vanilla HTML/CSS/ES modules, no framework or bundler (keep it simple until
  there's a reason not to). Node ≥ 18 for functions.
- Mobile-first: test at ~390 px width; tap targets ≥ 44 px; support dark mode.
- Keep `api/_lib/mock.js` shapes in sync with the real eBird responses used.
