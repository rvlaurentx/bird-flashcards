# Bird Flashcards

Learn the birds you're most likely to see on your next trip. Enter a place and
get the species reported most often on recent eBird checklists nearby, ranked by
how often they're seen. Flashcards, audio, photos and offline trip decks are
next (see `CLAUDE.md`).

It's a progressive web app: open it on your phone and use **Add to Home screen**.

## Run locally
```bash
npm run dev:mock        # sample data, no key needed → http://localhost:3000
cp .env.example .env    # then paste your eBird key into .env
npm run dev             # real eBird data
npm test
```

## Deploy (Vercel)
1. Push this folder to the GitHub repo `bird-flashcards`.
2. In Vercel: **Add New → Project**, import the repo. Framework preset: **Other**.
   No build command is needed (`vercel.json` serves `public/`).
3. **Settings → Environment Variables**: add `EBIRD_API_KEY` (Production and
   Preview). Get a key at https://ebird.org/api/keygen. Redeploy afterwards.

Bird data: eBird, Cornell Lab of Ornithology. Place search: Open-Meteo.
