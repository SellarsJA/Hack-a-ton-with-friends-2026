# Deploy checklist

Run by hand with the team's own Vercel, Neon and TomTom accounts.

Environment variables: `DATABASE_URL`, `NEXT_PUBLIC_TOMTOM_KEY`, `LIVE_SOURCE` (`city` by default, or `snapshot`).

## 1. Deploy

1. Create the Vercel project from the repo (Hobby plan).
2. Add Neon through the Vercel marketplace; this sets `DATABASE_URL`.
3. Set `NEXT_PUBLIC_TOMTOM_KEY` and `LIVE_SOURCE=city`.
4. Apply the schema before the first import: `DATABASE_URL=<prod> npm run db:schema`.
5. Load the schedule: `DATABASE_URL=<prod> npm run import-gtfs`.
   - The import truncates and reloads the schedule tables in one transaction, which locks them for the duration (~1.25M `stop_times` rows). Run it at a quiet time.
   - Check `select count(*) from stop_times` and that the database size is under 700 MB.
6. In the TomTom dashboard, restrict the key to the Vercel domain and `localhost`.
7. On first load with the real key, verify the TomTom raster tile URL and the `copyrightsCaption` field (both were confirmed from docs only).
8. Run `npm run build` and confirm it succeeds.

## 2. Phone walkthrough on mobile data

1. Allow location, pick a destination, and see 1-5 options with Live or Scheduled badges.
2. See three coloured lines and the TomTom copyright on the map.
3. Tap a line and confirm its card is selected.
4. Deny location and type a start address instead.
5. Set `LIVE_SOURCE=snapshot`, redeploy, and confirm the app still works. This is the demo fallback: it serves the saved City feeds in `data/snapshot/` (captured 2026-11-14 evening).

## 3. Rerun the import

- Rerun `DATABASE_URL=<prod> npm run import-gtfs` whenever ETS publishes a new `gtfs.zip`.
- The current zip covers 2026-10-23 to 2026-12-12 and the import keeps the next 7 days, so rerun it at least weekly.

## Notes

- Address autocomplete uses TomTom's older Search API fuzzy search with `typeahead=true` (free tier ~2,500 requests/month). Once a key exists, check TomTom's Places Search Suggest (~10,000/month) and switch `src/tomtom/suggest.ts` to it if its response fits.
- TomTom's free tier is "Evaluation Use" only (internal testing): fine for the demo; a public launch needs a TomTom plan or another map provider.
- Watch TomTom usage on the key dashboard during the weekend. Past the free limit, requests are blocked, not billed.
- Local dev: `cp .env.example .env.local`, fill in the values, then `npm run dev`. `NEXT_PUBLIC_USE_FIXTURE=1` makes the results page use `fixtures/plan.json`.
- The footer attribution (Open Government Licence – City of Edmonton) must stay; the site is not run by the City.
