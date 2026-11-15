# Deploy checklist

Run by hand with the team's own Vercel, Neon and TomTom accounts.

Environment variables: `DATABASE_URL`, `NEXT_PUBLIC_TOMTOM_KEY`, `LIVE_SOURCE` (`city` by default, or `snapshot`).

**The scripts (`db:schema`, `import-gtfs`) do not load `.env.local`.** Pass the variable on the command line as shown below, or run the script with Node's env-file flag, e.g. `npx tsx --env-file=.env.local scripts/import-gtfs/index.ts`.

Each command is shown for bash and for PowerShell (the team uses Windows). In the bash examples, paste the full Neon connection string inside the single quotes, because it contains `&` characters that bash would otherwise split on.

## 0. Pre-demo tasks

- [ ] **Confirm TomTom Places Search Suggest.** Address autocomplete currently uses TomTom's older Search API fuzzy search with `typeahead=true`, whose free tier is about 2,500 requests a month. Every 3+ character pause in a place field costs one request, so a weekend of team testing plus the demo can use that up, and past the limit TomTom blocks requests (address search then stops working; stop search keeps working). Once the key exists, check Places Search Suggest (about 10,000 a month) and, if its response fits, switch `src/tomtom/suggest.ts` to it. Watch usage on the key dashboard either way.
- [ ] Re-capture the live-feed snapshot on the same kind of day as the demo (see section 4).

## 1. Deploy

1. Create the Vercel project from the repo (Hobby plan).
2. Add Neon through the Vercel marketplace; this sets `DATABASE_URL`.
3. Set `NEXT_PUBLIC_TOMTOM_KEY` and `LIVE_SOURCE=city`.
4. Apply the schema before the first import. It is safe to rerun (`create … if not exists`).
   - bash: `DATABASE_URL='<prod>' npm run db:schema`
   - PowerShell: `$env:DATABASE_URL="<prod>"; npm run db:schema`
5. Load the schedule:
   - bash: `DATABASE_URL='<prod>' npm run import-gtfs`
   - PowerShell: `$env:DATABASE_URL="<prod>"; npm run import-gtfs`
   - The import truncates and reloads the schedule tables in one transaction, which locks them for the duration (~1.25M `stop_times` rows). Run it at a quiet time.
6. Verify the import (Neon SQL editor or `psql`):
   - `select count(*) from stop_times;` and check that the database size is under 700 MB.
   - `select zone, count(*) from stops group by zone;` expect the zones `1EDM`, `1AIR`, `2STA`, `4SCT`, `5SGT`, `6FST`, `7BT`, `9LT` (plus some `null` for unzoned stops).
   - `select distinct agency_id from routes;` expect `'1'` for ETS.
   - `select count(*) from stop_links;` expect 6,000–200,000 (a run on today's feed gave about 39,500). A count outside that range means the transfer links did not build; check the import output before going on.
7. In the TomTom dashboard, restrict the key to the Vercel domain and `localhost`.
8. On first load with the real key, verify the TomTom raster tile URL and the `copyrightsCaption` field (both were confirmed from docs only). The caption should appear on the map and in the footer.
9. Run `npm run build` and confirm it succeeds (bash, PowerShell or cmd all work).

## 2. Phone walkthrough on mobile data

1. Allow location, pick a destination, and see 1-5 options with Live or Scheduled badges.
2. Tap a card: its steps are visible without scrolling.
3. See three coloured lines and the TomTom copyright on the map.
4. Tap a line and confirm its card is selected.
5. Deny location and type a start address instead.
6. Set `LIVE_SOURCE=snapshot`, redeploy, and confirm the app still works. This is the demo fallback: it replays the saved City feeds in `data/snapshot/` as if they were captured today at the same time of day (see section 4).

## 3. Rerun the import

**Tier 2 production update.** Run these once against the existing production database. The schema step is safe to rerun.

**Run step 1 (`npm run db:schema`) against production *before* the tier 2 code deploys.** Tier 2 queries the new `stop_links` table for transfers and relies on the new `stop_times (stop_id, arr)` index. If the code goes out first, every transfer query fails because `stop_links` does not exist: plans still return direct options only, and the failure is logged once as a warning. The index keeps the transfer query from scanning `stop_times`. Then run the import (step 2) so `stop_links` is filled; until it is, no transfers are offered.

1. Apply the schema. This creates `stop_links` and the `stop_times (stop_id, arr)` index:
   - bash: `DATABASE_URL='<prod>' npm run db:schema`
   - PowerShell: `$env:DATABASE_URL="<prod>"; npm run db:schema`
2. Reload the schedule. The import now also fills `stop_links`:
   - bash: `DATABASE_URL='<prod>' npm run import-gtfs`
   - PowerShell: `$env:DATABASE_URL="<prod>"; npm run import-gtfs`
3. Check `stop_links` with the query in section 1, step 6.

- Rerun the import (section 1, step 5) whenever ETS publishes a new `gtfs.zip`.
- The current zip covers 2026-10-23 to 2026-12-12. The import keeps 8 service days, starting yesterday (so trips from yesterday's service that run past midnight survive), which means today plus the next 6 days. Rerun it at least weekly.

## 4. Re-capture the live-feed snapshot

Snapshot mode shifts the saved feeds by whole days onto today, but the trip IDs in them still belong to the day they were captured. Capture them **on the same kind of day as the demo** (weekday, Saturday or Sunday) and at about the time of day the demo will run, so the trip IDs match that day's schedule. Then commit the three files.

bash:

```sh
BASE=https://gtfs.edmonton.ca/TMGTFSRealTimeWebService
curl -fsSL -o data/snapshot/VehiclePositions.pb "$BASE/Vehicle/VehiclePositions.pb"
curl -fsSL -o data/snapshot/TripUpdates.pb "$BASE/TripUpdate/TripUpdates.pb"
curl -fsSL -o data/snapshot/Alerts.pb "$BASE/Alert/Alerts.pb"
```

PowerShell (use `curl.exe`, not the `curl` alias):

```powershell
$BASE = "https://gtfs.edmonton.ca/TMGTFSRealTimeWebService"
curl.exe -fsSL -o data/snapshot/VehiclePositions.pb "$BASE/Vehicle/VehiclePositions.pb"
curl.exe -fsSL -o data/snapshot/TripUpdates.pb "$BASE/TripUpdate/TripUpdates.pb"
curl.exe -fsSL -o data/snapshot/Alerts.pb "$BASE/Alert/Alerts.pb"
```

Run `npm test` afterwards: the snapshot tests check that the files decode.

## 5. Tier 2 phone walkthrough

Tick each item on a phone, on mobile data, against the deployed site.

- [ ] **1. Plan a transfer.** Allow location, enter Churchill Square as the start and Mill Woods Town Centre as the destination. A transfer option appears with a badge and the train note.
- [ ] **2. Wait a minute.** Leave the page open for 1 minute. The badge updates without a reload.
- [ ] **3. Lock and unlock.** Lock the phone for 1 minute, then unlock it. The page refreshes straight away.
- [ ] **4. Check a route.** Open Routes, tap `9`, then tap a stop. Departures and vehicle dots appear.
- [ ] **5. Snapshot mode.** If the site runs with `LIVE_SOURCE=snapshot`, everything still renders.
- [ ] **6. Tab bar, trip results.** On the trip results, scroll to the last option. The bottom tab bar doesn't cover it.
- [ ] **7. Tab bar, map.** On the results map, the TomTom copyright at the bottom is fully visible above the tab bar.
- [ ] **8. Tab bar, footer.** Scroll to the very bottom of any page. The footer's licence text is visible above the tab bar.
- [ ] **9. Transfer card.** On a transfer option, tap the card. The badge shows On track, Tight or At risk, and an LRT transfer shows "Train side uses the schedule".
- [ ] **10. Bus popup.** Tap a bus dot on the map. A popup shows the bus number and crowding when it's known.

## Notes

- TomTom's free tier is "Evaluation Use" only (internal testing): fine for the demo; a public launch needs a TomTom plan or another map provider.
- Watch TomTom usage on the key dashboard during the weekend. Past the free limit, requests are blocked, not billed.
- Local dev: `cp .env.example .env.local` (PowerShell: `Copy-Item .env.example .env.local`), fill in the values, then `npm run dev`. `NEXT_PUBLIC_USE_FIXTURE=1` makes the results page use `fixtures/plan.json`.
- The footer attribution (Open Government Licence – City of Edmonton) must stay; the site is not run by the City.
