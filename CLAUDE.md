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
- **API keys never reach GitHub or the browser.** `EBIRD_API_KEY` and
  `XENO_CANTO_API_KEY` are Vercel environment variables. The browser only calls our `/api/*` functions.
  `.env` is git-ignored; `.env.example` documents the variables.
- **Offline trip decks are a core requirement, not an add-on.** Birders often
  have no signal. Every feature must answer: "what happens with no network?"
- Attribute data sources in the UI (eBird is required by its API terms).

## Data sources
| Need | Source | Status / notes |
|---|---|---|
| Place name → coordinates | Open-Meteo geocoding API (free, no key) | In use: `api/places.js` |
| Likely species for a place | eBird API 2.0 | In use: `api/species.js` |
| Bird sounds | Xeno-canto API v3 | In use: `api/sounds.js`, `api/_lib/xc.js`. Key in `XENO_CANTO_API_KEY` (server only; sent as `key=` query param). Query `gen:X sp:y q:A`, then any quality, then `en:"Common Name"`. Picks ≤2 songs + ≤2 calls, ≤90 s, best quality first. Every recording shows XC number, recordist and its CC license (some are NC/ND; playing unmodified is fine while non-commercial). |
| Photos + short description | iNaturalist API (taxon photos; `wikipedia_summary`) | In use: `api/media.js`, `api/_lib/inat.js`. Only CC0/CC-BY/CC-BY-SA/CC-BY-NC/CC-BY-NC-SA photos (`ALLOWED_LICENSES`); NC is allowed only while the app is non-commercial. The attribution string is shown under every photo. Taxon matched by scientific name, then common name (eBird and iNat names sometimes differ). |
| Photos/audio (alt) | Macaulay Library | **Not used in-app.** No public API; Cornell treats all apps as commercial use needing a license (per-item requests via the Help Desk). Don't scrape. The answer side links out to the eBird species page ("More photos and sounds on eBird"), which shows ML media under Cornell's terms. Revisit if a license is obtained (e.g. via High Country Audubon). |

Re-check current key requirements and license terms for each source before any
public release.

### How the species ranking works (`api/species.js`)
1. Nearby eBird hotspots (`/ref/hotspot/geo`) → pick the most common county
   (`subnational2Code`) among the 25 nearest.
2. Checklists in that county, up to 25:
   - **Recent** (default, `month` absent): `/product/lists/{region}`.
   - **Trip month** (`&month=1..12`): `/product/lists/{region}/{y}/{m}/{d}`
     on days 3/10/17/24 of the latest *finished* occurrence of that month and
     the year before (8 dates, `monthDates()`), taken round-robin
     (`interleave()`) so no single day dominates. eBird's API has no
     bar-chart endpoint; this samples the same "share of checklists" metric
     for the right season.
   - **Most species-rich first** (user's choice, for a fuller list):
     `richestFirst()` sorts candidates by the feed's `numSpecies` (no extra
     requests). Recent: richest 25 of up to 200. Month: richest per date,
     then round-robin. Trade-off: percentages run higher than a typical
     outing (UI says so); `sample.considered` = candidates seen.
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
- `/api/health` diagnoses both keys (eBird, xeno-canto) without revealing them.
- Month results are CDN-cached 7 days (past months don't change); in-memory
  cache key is `region|month`.
- UI: "Trip month" picker on the species list (Recent sightings / Jan–Dec),
  remembered in localStorage `bf-trip-month`. Answer side says "Seen on X% of
  May checklists". Decks store `month`; the species response is saved under
  `speciesUrl(place, month)`. Opening a saved trip (or any saved place
  offline) switches the picker to the deck's month; a mismatch shows
  "Saved for July; you're viewing January. Update to save this month."
- Possible refinement: sample more days for sparse counties, or widen to the
  state (`subnational1Code`) when a month has too few checklists.

## Offline design
- `public/sw.js`: app shell precached; `/api/*` network-first with cache
  fallback (any place opened before works offline); Google Fonts cached;
  iNaturalist photos cache-first (`media-v1`, ~400 max), so birds you've
  already studied keep their photos offline.
- **Offline trip decks** (`public/decks.js`, built):
  - "Save for offline use" on a place's species list saves the list being
    viewed (Top 25/50/All): the species response, 2 photos per bird, and
    sounds by choice — none / song only (default) / song and call. Shows an
    estimate first, progress + Cancel while saving; a cancelled or failed
    save deletes the partial deck.
  - One Cache Storage cache per deck, `deck-<lat2>,<lng2>`, holding API JSON
    under the **exact URLs the app requests** (built only via `lib.js`
    `speciesUrl/mediaUrl/soundsUrl/audioUrl`) plus photo and audio files.
    Saved media/sounds JSON is trimmed to what was actually stored, and
    recording URLs are rewritten to `/api/audio?id=N`.
  - `sw.js` checks `deck-*` caches **first** for `/api/*` and iNaturalist
    images (works with no signal and doesn't wait on a weak one), answers
    audio range requests with 206 slices, and never deletes `deck-*` caches
    on update. Consequence: a saved place's list only changes via "Update".
  - `/api/audio?id=N` proxies the xeno-canto file so the browser gets a
    complete same-origin copy (Vercel limit ~4.5 MB; capped at 4 MB).
  - Photos are fetched CORS first (size known), else opaque (`no-cors`);
    opaque entries count heavily against browser quota. QuotaExceeded stops
    the save with a clear message. `navigator.storage.persist()` is requested.
  - Deck metadata (name, birds, bytes, date, sounds choice, birds without
    photos) is in localStorage `bf-decks`; saved trips list on the start
    screen ("✓ Works offline"). Progress stays in localStorage `bf-progress`.
  - Tested end to end in Chromium with mock data: save → offline → reload →
    open saved trip → study with photos, all hints and audio → remove.
- Bump `VERSION` in `sw.js` when shell files change.

## Learning design (confirmed by the user)
Logic lives in `public/learn.js` (no DOM, unit-tested); UI in `public/study.js`.
- **Hint progression:** photo → family → size relative to a familiar bird →
  key field mark → habitat/behavior → song/call → reveal. Fewer hints used =
  stronger recall credit.
  - *Implemented today:* photo → **another photo** of the same species →
    **song or call** (autoplays, xeno-canto) → family → multiple choice
    (look-alikes) → reveal. The user moved song before family. Each hint
    only appears when its data exists. Size, field marks and habitat need a
    data source we don't have yet; slot them into `hintsFor()` after family
    when added (confirm placement with the user).
  - Answer side lists all picked recordings (song/call) with credits.
  - **Each new hint scrolls into view** (user's request) via `bringIntoView()`
    in `study.js`: fully between the sticky header and the sticky button bar
    (top-aligned if taller). Checked at 360×640 and 390×844.
  - **Answer must be visible without scrolling** (user's request): on reveal
    the view gets `.revealed` — photo shrinks to a banner (≤30vh), hints and
    choices hide, the answer card follows the photo, page scrolls to top.
    Checked at 390×844 and 360×640. Choice outcome shows as "✓ Correct" /
    "✗ You chose …" at the top of the answer.
  - **No scientific names in hints** (user's request: they don't use them).
    The genus hint was removed. The scientific name stays on the answer side
    (user confirmed).
- **Confusable-species grouping:** choices come from (a) curated confusion
  pairs (`CONFUSION_PAIRS`, eBird codes), (b) same eBird family on the trip
  list, then (c) taxonomically nearest species, all limited to the place's list.
- **Spaced repetition (Leitner boxes 0–5, per species, shared across trips):**
  known with no hints → box +1; known with hints → no promotion (min 1);
  missed → box 0 and the card returns 3 cards later in the same session.
  Box ≥ 3 = "learned" (dot in the species list). Sessions shuffle the cards
  (user's request), then stable-sort by box, so weaker birds still come first
  but in random order. Progress is in localStorage (`bf-progress`);
  move to IndexedDB with the trip-deck work.
- Photos rotate between reviews so you learn the bird, not one picture.

## Roadmap
1. ✅ Place → ranked species list (eBird, serverless, cached)
2. ✅ Flashcard flow (photo → hints → answer; spaced repetition)
3. ✅ Photos (iNaturalist, licensed + attributed) — pulled forward; cards need them
4. ✅ Audio (Xeno-canto) — song/call hint + recordings on the answer side
5. ✅ Offline trip decks (download, manage, study with no signal)
6. Hint data for size / field marks / habitat (source to be decided)
7. ✅ Month-of-trip frequencies
8. Optional: Play Store wrapper

## Conventions
- Vanilla HTML/CSS/ES modules, no framework or bundler (keep it simple until
  there's a reason not to). Node ≥ 18 for functions.
- Mobile-first: test at ~390 px width; tap targets ≥ 44 px; support dark mode.
- Keep `api/_lib/mock.js` shapes in sync with the real eBird responses used.
