# Tier 1: Core Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rider on a phone enters a start and a destination and sees up to five direct (no-transfer) transit options. Each shows its leave time, total time, fare, and Live/Scheduled status, drawn on a TomTom map.

**Architecture:**
- Next.js (App Router, TypeScript) on Vercel.
- A rerunnable script loads 7 days of the ETS GTFS schedule into Neon Postgres.
- A per-instance 30-second memory cache decodes the City's three GTFS-Realtime files.
- `/api/plan` finds direct trips with one SQL query, merges in live predictions, prices them from a fare-table config, and returns the JSON contract.
- The browser calls TomTom directly for map tiles and address suggestions, and our server never stores TomTom content.

**Tech Stack:**
- Next.js (latest via `create-next-app`), React, TypeScript
- Vitest and React Testing Library for tests
- zod for the contract
- luxon for time
- `gtfs-realtime-bindings` for the live feeds
- `@neondatabase/serverless` in the app; `postgres`, `csv-parse` and `unzipper` in the import script
- maplibre-gl with TomTom raster tiles

**Spec:** [docs/plan.md](../../plan.md). Read "Key technical decisions", "The contract between frontend and backend", "Facts we checked" and "Fare table" before starting any task.

## Global Constraints

- **Time.** All "now", "today" and schedule-time conversion goes through `src/time/edmonton.ts`. Zone `America/Edmonton`. Never hardcode a UTC offset. GTFS times are seconds from "noon minus 12 hours" on the service date.
- **TomTom content is never stored** by our server, Neon or the snapshot. That covers tiles, search results, coordinates from a search and traffic speeds. The browser calls TomTom directly. No service worker, and no localStorage cache of TomTom responses.
- **Live cache:** 30-second TTL per server instance. Live data counts as stale when `liveDataAgeSeconds > 120`.
- **Planner limits:** at most **5** options; walking radius **800 m** at each end; departures within the next **90 minutes** (5,400 s); walk time = `ceil(distance_m × 1.25 / 80)` minutes.
- **Fleet number** is the vehicle `label`, never `id`.
- **Fares** come only from `config/fares.json`, which holds the spec's Fare table. Don't use the feed's own fare amounts.
- **Footer attribution text, verbatim:** `Contains information licensed under the Open Government Licence – City of Edmonton.` It links to `https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/`. The TomTom copyright must stay visible on the map.
- **Option line colours,** in order: `#2563EB` (blue), `#7C3AED` (violet), `#0891B2` (cyan), `#DB2777` (pink), `#4B5563` (slate). Never green, yellow, orange, red or white.
- **Mobile-first:** every screen works at 360 px width with no horizontal scroll.
- **Environment variables:** `DATABASE_URL`, `NEXT_PUBLIC_TOMTOM_KEY`, `LIVE_SOURCE` (`city` by default, or `snapshot`).
- Every `/api/plan` response is validated against the zod schema in `src/contract/schema.ts` in tests.

## Review Focus

1. **Searching just after midnight** (e.g. 00:30) must find trips from the previous service day whose times are past 24:00. *Test in Task 7.*
2. **No stops within 800 m, or no trips in the next 90 minutes,** returns `options: []` with the right `emptyReason`. The screen shows a message, not an error. *Tests in Tasks 9 and 11.*
3. **City feed down or never loaded:** the plan still returns scheduled options with `liveDataAgeSeconds: null`, and the screen shows the "Live data unavailable" banner. *Tests in Tasks 6, 9 and 11.*
4. **Location permission denied:** the start field clears and asks the rider to type, without crashing. *Test in Task 10.*
5. **A live prediction already in the past** drops that option (you can't catch a bus that's left). **A trip with only an upstream delay** applies that delay to the rider's stops. *Tests in Task 8.*

---

## File Structure

```
app/
  layout.tsx                   # html shell, Footer
  page.tsx                     # search screen (Task 10)
  results/page.tsx             # results list + map (Tasks 11–12)
  api/plan/route.ts            # GET /api/plan (Task 9)
  api/search/route.ts          # GET /api/search (Task 9)
components/
  PlaceField.tsx               # start/destination field with suggestions (Task 10)
  SearchForm.tsx               # two fields + Continue (Task 10)
  OptionList.tsx, OptionCard.tsx, OptionDetail.tsx, LiveBanner.tsx  (Task 11)
  TripMap.tsx                  # maplibre map (Task 12)
  Footer.tsx                   # attribution (Task 13)
config/fares.json              # Fare table (Task 3)
data/snapshot/*.pb             # saved City feeds for tests + demo switch (Task 6)
db/schema.sql                  # Neon tables (Task 5)
fixtures/plan.json             # contract fixture (Task 2)
scripts/import-gtfs/
  transform.ts                 # pure GTFS → rows (Task 5)
  index.ts                     # CLI: download, transform, load (Task 5)
src/
  time/edmonton.ts             # Task 1
  contract/schema.ts           # Task 2
  fares/fare.ts                # Task 3
  geo/geo.ts                   # Task 4
  db/client.ts                 # Task 7
  live/decode.ts, live/cache.ts  # Task 6
  plan/query.ts                # SQL (Task 7)
  plan/realtime.ts             # live merge (Task 8)
  plan/assemble.ts             # candidates → Options (Task 8)
  map/lines.ts                 # GeoJSON for the map (Task 12)
  tomtom/suggest.ts, tomtom/tiles.ts  # browser-only TomTom calls (Tasks 10, 12)
tests/                         # mirrors src/, components/, scripts/
tests/fixtures/gtfs-mini/      # tiny hand-written GTFS (Task 5)
```

**Parallel lanes once Task 2 is merged:**
- **Data:** Tasks 3 → 4 → 5 → 6 → 7 → 8 → 9.
- **Screens:** Tasks 10 → 11.
- **Map:** Task 12.
- **Last:** Task 13, after all lanes.

---

### Task 1: Project scaffold and Edmonton time helper

**Files:**
- Create: the Next.js app at the repo root, `vitest.config.ts`, `.env.example`, `src/time/edmonton.ts`
- Test: `tests/time/edmonton.test.ts`

**Interfaces:**
- Produces:
  - `ZONE = 'America/Edmonton'`
  - `nowInEdmonton(): DateTime`
  - `parseGtfsTime(s: string): number`, e.g. `"25:10:00"` → `90600`
  - `toInstant(serviceDate: string /* YYYY-MM-DD */, seconds: number): DateTime`
  - `activeServiceDays(now: DateTime): { serviceDate: string; nowSeconds: number }[]`, which returns today, then yesterday with `nowSeconds + 86400`
  - `formatClock(dt: DateTime): string`, e.g. `"6:07 PM"`

- [ ] **Step 1: Scaffold.** Run `npx create-next-app@latest . --ts --app --eslint --tailwind --src-dir=false --import-alias "@/*" --use-npm`, then `npm i luxon zod && npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @types/luxon`.
  - Add `"test": "vitest run"` to `package.json`.
  - Configure `vitest.config.ts` with the `@/` alias and the `jsdom` environment for `*.test.tsx`.
  - Add `.env.example` with the three env vars from Global Constraints.
- [ ] **Step 2: Write the failing tests** in `tests/time/edmonton.test.ts`:

```ts
expect(parseGtfsTime('25:10:00')).toBe(90600)
expect(toInstant('2026-11-14', 90600).toISO()).toBe('2026-11-15T01:10:00.000-07:00')
// DST start 2027-03-14: 03:00 service time is 03:00 MDT, not 04:00
expect(toInstant('2027-03-14', 10800).toISO()).toBe('2027-03-14T03:00:00.000-06:00')
const now = DateTime.fromISO('2026-11-15T00:30:00', { zone: ZONE })
expect(activeServiceDays(now)).toEqual([
  { serviceDate: '2026-11-15', nowSeconds: 1800 },
  { serviceDate: '2026-11-14', nowSeconds: 88200 },
])
expect(formatClock(toInstant('2026-11-14', 65220))).toBe('6:07 PM')
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, module not found.
- [ ] **Step 4: Implement `src/time/edmonton.ts`.** `toInstant` = local noon on the service date, minus 12 hours, plus `seconds`. In luxon, `hours` and `seconds` are exact durations.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit:** `git add -A && git commit -m "chore: scaffold Next.js app; feat: Edmonton time helper"`.

### Task 2: Contract schema and fixture

**Files:**
- Create: `src/contract/schema.ts`, `fixtures/plan.json`
- Test: `tests/contract/schema.test.ts`

**Interfaces:**
- Produces zod schemas and their inferred types: `LatLng`, `Fare`, `Leg`, `Transfer`, `Option`, `PlanResponse`, `SearchResponse`.
  - **`LatLng`** is `{ lat: number; lon: number }` and is used everywhere outside GeoJSON.
  - **`Leg`** is a discriminated union on `mode`:
    - `walk`: `{ minutes, path }`
    - `bus | rail`: `{ route, headsign, tripId, serviceDate, departAt, arriveAt, realtime, fromStop, toStop, vehicleLabel: string|null, occupancy: 'not_crowded'|'some_standing'|'full'|null, path }`
  - **`path`** is `[number, number][]` as `[lat, lon]`.
  - **`Fare`** is `{ amount: number, cashAmount: number|null, estimated: boolean, label: string }`.
  - **`Option`** has the fields in spec's JSON example, plus `transfer: Transfer|null` and `snow: string[]` (always `null` and `[]` in tier 1).
  - **`PlanResponse`** is `{ generatedAt, liveDataAgeSeconds: number|null, emptyReason: 'no_stops_near_start'|'no_stops_near_end'|'no_trips_soon'|null, options: Option[] }`.
  - **`SearchResponse`** is `{ stops: {stopId, name, lat, lon}[], routes: {routeId, shortName, longName}[] }`.
- `fixtures/plan.json` holds three realistic options between Churchill Square (53.5444, -113.4909) and Southgate (53.4855, -113.5137):
  - one live,
  - one scheduled,
  - one with an alert and `occupancy: "full"`.

  Paths need 5 or more points. The screens and map lanes build against this file.

- [ ] **Step 1: Write the failing test.** `PlanResponse.parse(fixture)` succeeds. A copy of the fixture with `options[0].fare.amount = "3"` throws.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Write `schema.ts` and `fixtures/plan.json`.** All timestamps are ISO with offset, e.g. `2026-11-14T18:07:00-07:00`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: plan API contract and fixture"`, then announce the fixture to the team.

### Task 3: Fare engine

**Files:**
- Create: `config/fares.json`, `src/fares/fare.ts`
- Test: `tests/fares/fare.test.ts`

**Interfaces:**
- Produces:
  - `ZoneId = '1EDM'|'1AIR'|'2STA'|'4SCT'|'5SGT'|'6FST'|'7BT'|'9LT'`
  - `fareFor(input: { firstZone: ZoneId; lastZone: ZoneId; legs: { agencyId: string; routeShortName: string }[] }): Fare`
- `config/fares.json`: `{ "zones": { "1EDM": "Edmonton", ... }, "arc": { "1EDM|2STA": 4.50, ... }, "estimated": ["1EDM|6FST", ...], "cash": { "edmonton": 3.75, "airport747": 6.00 } }`
  - Keys are the two zone ids, sorted alphabetically and joined with `|`. The table is symmetric.
  - Copy every non-Acheson cell from the spec's Fare table. Italic cells go in `estimated`.
  - Acheson has no feed zone, so it's omitted.
- **Cash rule:**
  - Every leg has `agencyId '1'` and both zones are `1EDM` → `3.75`.
  - Every leg has `agencyId '1'` and either zone is `1AIR` → `6.00` when every leg is route `747`, otherwise `9.75`.
  - Anything else → `null`.
- **Labels:**
  - `"Adult, Arc or tap. Transfers included"`
  - When `estimated`: `"Adult, Arc or tap. Estimated: several transit agencies"`

- [ ] **Step 1: Write the failing tests.**
  - `1EDM→1EDM`, ETS route `9` → `{amount: 3, cashAmount: 3.75, estimated: false}`.
  - `1EDM→2STA` → `4.5`, cash `null`.
  - `2STA→1EDM` → `4.5`, which checks symmetry.
  - `1EDM→1AIR`, only `747` → `6`, cash `6`.
  - `1EDM→1AIR`, legs `9` then `747` → cash `9.75`.
  - `1EDM→6FST` → `9.5` with `estimated: true` and the estimated label.
  - `9LT→1AIR` → `2`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `fareFor`,** reading the JSON with a static import.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: Arc zone fare engine"`.

### Task 4: Geo utilities

**Files:**
- Create: `src/geo/geo.ts`
- Test: `tests/geo/geo.test.ts`

**Interfaces:**
- Produces:
  - `distanceMeters(a: LatLng, b: LatLng): number` (haversine, R = 6,371,000)
  - `walkMinutes(m: number): number` = `Math.ceil(m * 1.25 / 80)`
  - `boundingBox(c: LatLng, radiusM: number): { minLat, maxLat, minLon, maxLon }`
  - `sliceShape(points: [number, number][], from: LatLng, to: LatLng): [number, number][]`. It returns the points between the indexes nearest `from` and `to`, inclusive, starting the search for `to` after `from`'s index.
  - `parseLatLng(s: string): LatLng | null`. It accepts `"53.5444,-113.4909"` and rejects anything outside lat 52–55, lon −115 to −112.

- [ ] **Step 1: Write the failing tests.**
  - Churchill Square → Southgate is within 50 m of 6,720 m.
  - `walkMinutes(800) === 13`.
  - `sliceShape` on a 10-point straight line, with `from` near point 2 and `to` near point 7, returns 6 points.
  - On a loop shape whose first and last points coincide, `to` resolves after `from`.
  - `parseLatLng('abc') === null` and `parseLatLng('0,0') === null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: geo utilities"`.

### Task 5: GTFS import into Neon

**Files:**
- Create: `db/schema.sql`, `scripts/import-gtfs/transform.ts`, `scripts/import-gtfs/index.ts`, `tests/fixtures/gtfs-mini/*.txt`
- Test: `tests/import/transform.test.ts`

**Interfaces:**
- Consumes: `parseGtfsTime` (Task 1).
- Produces the Neon tables below, plus `transformFeed(open: (name: string) => Promise<NodeJS.ReadableStream | null>, opts: { startDate: string; days: number }): Promise<FeedRows>`.
- `npm run import-gtfs` downloads `https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/GTFS/gtfs.zip`, transforms it with `startDate` = today in Edmonton and `days: 7`, and loads it.

```sql
create table stops (stop_id text primary key, name text not null, lat float8 not null, lon float8 not null, zone text);
create index stops_lat_lon on stops (lat, lon);
create table routes (route_id text primary key, agency_id text not null, short_name text, long_name text, route_type int not null, color text);
create table trips (trip_id text primary key, route_id text not null, service_id text not null, headsign text, shape_id text);
create index trips_service on trips (service_id);
create table service_dates (service_id text not null, date date not null, primary key (service_id, date));
create table stop_times (trip_id text not null, stop_sequence int not null, stop_id text not null, arr int not null, dep int not null, primary key (trip_id, stop_sequence));
create index stop_times_stop_dep on stop_times (stop_id, dep);
create table shapes (shape_id text primary key, points jsonb not null); -- [[lat,lon],...], 5 decimals
create table feed_meta (feed_version text, window_start date, window_end date, imported_at timestamptz default now());
```

- **Service dates:** from `calendar_dates.txt` only. `exception_type` 1 adds a date and 2 removes it. Keep only dates in `[startDate, startDate + days)`.
- **Filtering:** keep trips whose `service_id` has at least one kept date. Keep `stop_times` and shapes only for kept trips.
- **Zones:** `stops.zone` comes from `stop_areas.txt`. When a stop has several areas, take the first.
- **Loading:** in one transaction, `truncate` exactly the schedule tables (`SCHEDULE_TABLES = ['stops','routes','trips','service_dates','stop_times','shapes','feed_meta']`, exported from `index.ts`), then `COPY` each from the transform output. The script is safe to rerun. Never truncate by pattern or with `truncate all`: later tiers add feedback tables that must survive a reimport.

- [ ] **Step 1: Write `tests/fixtures/gtfs-mini/`.** It holds 3 stops in two zones, 2 routes (one `route_type 0`), and 3 trips:
  - trip A runs on 2026-11-14,
  - trip B is removed on that date by `exception_type 2`,
  - trip C runs only on 2026-12-01.

  Include one stop time of `25:10:00`, plus `areas.txt`, `stop_areas.txt` and `shapes.txt`.
- [ ] **Step 2: Write the failing test.** `transformFeed` over the folder with `{startDate: '2026-11-14', days: 7}`:
  - keeps only trip A,
  - stores `25:10:00` as `90600`,
  - assigns zones,
  - rounds shape points to 5 decimals.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement `transform.ts`** with `csv-parse` (`columns: true`, `bom: true`, `trim: true`) and `index.ts` with `unzipper` and `postgres`, using `sql\`copy ... from stdin\`.writable()`. Add the `import-gtfs` script to `package.json`, run via `tsx`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Run the real import** against a Neon dev branch: `DATABASE_URL=... npm run import-gtfs`. Expected: no error. `select count(*) from stop_times` is between 300,000 and 2,900,000. Record the database size from the Neon console in the PR description; it must be under 700 MB.
- [ ] **Step 7: Commit:** `git commit -am "feat: rerunnable GTFS import into Neon"`.

### Task 6: Live feed decoding and cache

**Files:**
- Create: `src/live/decode.ts`, `src/live/cache.ts`, `data/snapshot/VehiclePositions.pb`, `data/snapshot/TripUpdates.pb`, `data/snapshot/Alerts.pb`
- Test: `tests/live/decode.test.ts`, `tests/live/cache.test.ts`

**Interfaces:**
- Produces:
  - `Occupancy = 'not_crowded'|'some_standing'|'full'`
  - `StopLive = { stopSequence: number; stopId: string; arrival: number|null; departure: number|null; delay: number|null }`. Times are epoch seconds.
  - `TripLive = { stops: StopLive[] /* sorted by stopSequence */; vehicle: { label: string; lat: number; lon: number; occupancy: Occupancy|null } | null }`
  - `AlertLive = { headline: string; routeIds: string[]; stopIds: string[]; tripIds: string[] }`
  - `LiveIndex = { feedTimestamp: number; trips: Map<string, TripLive>; alerts: AlertLive[] }`
  - `buildLiveIndex(bufs: { vehicles: Uint8Array; tripUpdates: Uint8Array; alerts: Uint8Array }): LiveIndex`
  - `getLiveIndex(now?: number): Promise<LiveIndex | null>`
- **Occupancy mapping:**
  - `EMPTY`, `MANY_SEATS_AVAILABLE`, `FEW_SEATS_AVAILABLE` → `not_crowded`
  - `STANDING_ROOM_ONLY`, `CRUSHED_STANDING_ROOM_ONLY` → `some_standing`
  - `FULL`, `NOT_ACCEPTING_PASSENGERS` → `full`
  - anything else → `null`
- Entities with an empty `trip_id` are skipped.
- **Cache behaviour:**
  - 30 s TTL.
  - Concurrent calls during a refresh share one promise.
  - A failed refresh keeps the last good index.
  - Returns `null` only if nothing has ever loaded.
  - With `LIVE_SOURCE=snapshot`, it reads `data/snapshot/*.pb` instead of the City URLs in the spec.

- [ ] **Step 1: Save the snapshot.** `curl -o data/snapshot/<File>.pb` each of the three City URLs from the spec, during daytime service.
- [ ] **Step 2: Write the failing decode tests** against the snapshot:
  - `trips.size > 500`.
  - No key is `''`.
  - At least one trip has a `vehicle` with a non-empty `label`.
  - At least one vehicle has non-null occupancy.
  - `alerts.length > 10`, and each alert has `routeIds` or `stopIds`.
- [ ] **Step 3: Write the failing cache tests.** Mock `fetch` with `vi.stubGlobal`:
  - Two concurrent calls → 3 fetches total, not 6.
  - A call 31 s later → refetches.
  - A refetch that rejects → returns the previous index.
  - First load rejects → `null`.
- [ ] **Step 4: Run.** Expected: FAIL.
- [ ] **Step 5: Implement** with `GtfsRealtimeBindings.transit_realtime.FeedMessage.decode`. Use `fetch(url, { cache: 'no-store' })`, so Next's data cache never sees the 1.7 MB body.
- [ ] **Step 6: Run.** Expected: PASS.
- [ ] **Step 7: Commit:** `git commit -am "feat: GTFS-realtime decode and 30s live cache with snapshot mode"`.

### Task 7: Direct-trip query

**Files:**
- Create: `src/db/client.ts`, `src/plan/query.ts`
- Test: `tests/plan/query.test.ts`. This is an integration test, skipped unless `DATABASE_URL_TEST` is set; that database is loaded from `gtfs-mini`.

**Interfaces:**
- Consumes: `boundingBox`, `distanceMeters`, `walkMinutes` (Task 4); `activeServiceDays` (Task 1).
- Produces:
  - `sql` (a neon tagged template) from `src/db/client.ts`
  - `NearbyStop = { stopId: string; name: string; lat: number; lon: number; zone: string|null; distanceM: number; walkSeconds: number }`
  - `findNearbyStops(p: LatLng, radiusM = 800): Promise<NearbyStop[]>`. Bounding box in SQL, haversine filter in TS, nearest 30.
  - `Candidate = { tripId; serviceDate; routeId; agencyId; routeShortName; routeType; headsign; shapeId; board: NearbyStop & { seq: number; dep: number }; alight: NearbyStop & { seq: number; arr: number } }`
  - `findDirectCandidates(origin: NearbyStop[], dest: NearbyStop[], days: { serviceDate: string; nowSeconds: number }[]): Promise<Candidate[]>`

The query: for each trip, pick the board/alight pair with the least door-to-door time, where the rider can walk to the board stop before it leaves.

```sql
with o(stop_id, walk_s) as (select * from unnest($1::text[], $2::int[])),
     d(stop_id, walk_s) as (select * from unnest($3::text[], $4::int[])),
     days(service_date, now_s) as (select * from unnest($5::date[], $6::int[]))
select distinct on (so.trip_id, days.service_date)
  so.trip_id, days.service_date, t.route_id, r.agency_id, r.short_name, r.route_type, t.headsign, t.shape_id,
  so.stop_id board_stop, so.stop_sequence board_seq, so.dep board_dep,
  sd2.stop_id alight_stop, sd2.stop_sequence alight_seq, sd2.arr alight_arr
from days
join service_dates sd on sd.date = days.service_date
join trips t on t.service_id = sd.service_id
join routes r on r.route_id = t.route_id
join stop_times so on so.trip_id = t.trip_id
join o on o.stop_id = so.stop_id and so.dep between days.now_s + o.walk_s and days.now_s + 5400
join stop_times sd2 on sd2.trip_id = t.trip_id and sd2.stop_sequence > so.stop_sequence
join d on d.stop_id = sd2.stop_id
order by so.trip_id, days.service_date, (sd2.arr + d.walk_s) - (so.dep - o.walk_s)
limit 300;
```

- [ ] **Step 1: Write the failing tests** on `gtfs-mini`:
  - At `2026-11-14 18:00`, a search between two stops on trip A returns 1 candidate with the right board and alight sequence numbers.
  - At `2026-11-15 00:30`, the trip with the `25:10:00` stop is returned with `serviceDate '2026-11-14'`. *(Review Focus 1)*
  - A destination with no stops in range → `findNearbyStops` returns `[]`.
- [ ] **Step 2: Run** with `DATABASE_URL_TEST` set. Expected: FAIL.
- [ ] **Step 3: Implement.** Join each candidate's stop rows back to the `NearbyStop` objects in TS.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: direct-trip candidate query"`.

### Task 8: Realtime merge and option assembly

**Files:**
- Create: `src/plan/realtime.ts`, `src/plan/assemble.ts`
- Test: `tests/plan/realtime.test.ts`, `tests/plan/assemble.test.ts`

**Interfaces:**
- Consumes: `Candidate` (Task 7), `LiveIndex` (Task 6), `fareFor` (Task 3), `sliceShape` / `walkMinutes` (Task 4), `toInstant` (Task 1), `Option` (Task 2).
- Produces:
  - `applyRealtime(c: Candidate, live: LiveIndex | null): { departEpoch: number; arriveEpoch: number; realtime: boolean; vehicleLabel: string|null; occupancy: Occupancy|null }`
  - `assembleDirectOptions(cands: Candidate[], ctx: { from: LatLng; to: LatLng; live: LiveIndex|null; nowEpoch: number; shapes: Map<string, [number, number][]> }): Option[]`
- **Realtime rule, for each of the board and alight stops:**
  1. If the trip has a `StopLive` with that `stopSequence` or `stopId`, use its departure (board) or arrival (alight), falling back to the other field.
  2. Otherwise, take the last `StopLive` with a lower `stopSequence` that has a `delay`, and use schedule + delay.
  3. Otherwise, use the schedule.

  `realtime` is true if step 1 or 2 applied to the board stop.
- **Assembly:**
  1. Drop options where `departEpoch < nowEpoch`.
  2. `leaveAt = departEpoch − board.walkSeconds`.
  3. Rank by `arriveEpoch + alight.walkSeconds`.
  4. Keep the best option per `routeId + headsign`.
  5. Return the first 5, ids `opt-1` to `opt-5`.
  6. Each option's legs are walk (straight line from → board stop), transit (sliced shape), walk (alight stop → to).
  7. Alerts are those whose `routeIds` include the route, or whose `stopIds` include either stop.
  8. `mode` is `'rail'` when `routeType` is 0 or 1, otherwise `'bus'`.
  9. Fares use the board and alight zones.

- [ ] **Step 1: Write the failing realtime tests.**
  - An exact stop prediction is used.
  - Only an upstream stop with `delay: 120` → schedule + 120, `realtime: true`. *(Review Focus 5)*
  - The trip is absent from the index → schedule, `realtime: false`.
  - `live: null` → schedule.
- [ ] **Step 2: Write the failing assembly tests.**
  - A candidate whose live departure is 60 s before now is dropped. *(Review Focus 5)*
  - Seven candidates on 3 routes → 3 options, best first.
  - Ten distinct routes → 5 options.
  - Output passes `Option.parse`.
  - `routeType 0` → leg mode `rail`.
  - An alert on the route attaches.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit:** `git commit -am "feat: realtime merge and direct option assembly"`.

### Task 9: `/api/plan` and `/api/search`

**Files:**
- Create: `app/api/plan/route.ts`, `app/api/search/route.ts`, `src/plan/plan.ts`
- Test: `tests/api/plan.test.ts`, `tests/api/search.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
  - `planTrip(from: LatLng, to: LatLng, deps = defaultDeps): Promise<PlanResponse>`. `deps` holds `findNearbyStops`, `findDirectCandidates`, `loadShapes(ids: string[])`, `getLiveIndex` and `now`, so tests can swap them.
  - `GET /api/plan?from=lat,lng&to=lat,lng`:
    - returns 400 `{ error: 'bad_coordinates' }` when `parseLatLng` fails;
    - returns `fixtures/plan.json` when `fixture=1`;
    - sends `Cache-Control: no-store`.
  - `GET /api/search?q=`:
    - returns `{stops: [], routes: []}` for `q` shorter than 2 characters;
    - otherwise matches `name ILIKE %q%` for stops and `short_name = q OR long_name ILIKE %q%` for routes, limit 5 each.
- **`emptyReason`:** no origin stops → `no_stops_near_start`; no destination stops → `no_stops_near_end`; no options → `no_trips_soon`.
- **`liveDataAgeSeconds`** = `now − feedTimestamp`, or `null` when there's no live index.

- [ ] **Step 1: Write the failing tests** with stubbed `deps`:
  - Happy path passes `PlanResponse.parse`.
  - No destination stops → `emptyReason: 'no_stops_near_end'`. *(Review Focus 2)*
  - `getLiveIndex` resolves `null` → options are still returned, all `realtime: false`, with `liveDataAgeSeconds: null`. *(Review Focus 3)*
  - The route handler returns 400 for `from=abc`.
  - The search route returns empty for `q=a`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Smoke test.** Run `npm run dev`. `curl "localhost:3000/api/plan?from=53.5444,-113.4909&to=53.4855,-113.5137"` returns 1–5 options.
- [ ] **Step 6: Commit:** `git commit -am "feat: plan and search API routes"`.

### Task 10: Search screen

**Files:**
- Create: `app/page.tsx`, `components/SearchForm.tsx`, `components/PlaceField.tsx`, `src/tomtom/suggest.ts`
- Test: `tests/components/SearchForm.test.tsx`

**Interfaces:**
- Consumes: `SearchResponse` (Task 2), `/api/search` (Task 9; tests mock `fetch`).
- Produces:
  - `Place = { kind: 'current'|'stop'|'address'; label: string; lat: number; lon: number }`
  - `suggestAddresses(q: string, signal: AbortSignal): Promise<Place[]>`. This is a browser-only call to TomTom Places Search Suggest, with the endpoint and params taken from TomTom's current docs. It uses `NEXT_PUBLIC_TOMTOM_KEY`, biases to `53.5461,-113.4938`, uses country `CA`, and returns at most 5 results.
  - `<PlaceField label value onChange allowCurrentLocation />`
  - `<SearchForm />`, which navigates to `/results?from=lat,lng&to=lat,lng&fromLabel=…&toLabel=…`
- **Behaviour:**
  - The start defaults to `{kind:'current', label:'Your location'}`, resolved with `navigator.geolocation.getCurrentPosition`.
  - Typing waits 300 ms after the last keystroke.
  - Our `/api/search` results come first. TomTom is asked only when `q.length >= 3`.
  - Continue is disabled until both places have coordinates.
- **Copy:**
  - Placeholders: `Start` and `Where to?`
  - Button: `See options`
  - Location denied: `Location unavailable. Type a start.`

- [ ] **Step 1: Write the failing tests** with mocked `fetch`, `suggestAddresses` and geolocation:
  - Typing `chur` in 4 quick keystrokes → `suggestAddresses` is called once.
  - Stop results render above address results.
  - Geolocation error → the start field is empty and the denied message is shown. *(Review Focus 4)*
  - Choosing both places and pressing `See options` → `router.push` is called with the right query.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Mobile layout: full-width fields, a 48 px touch target on the button, no map on this screen.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: search screen with own-index and TomTom suggestions"`.

### Task 11: Results list and option detail

**Files:**
- Create: `app/results/page.tsx`, `components/OptionList.tsx`, `components/OptionCard.tsx`, `components/OptionDetail.tsx`, `components/LiveBanner.tsx`
- Test: `tests/components/results.test.tsx`

**Interfaces:**
- Consumes: `PlanResponse` and the fixture (Task 2); `formatClock` (Task 1); `TripMap` (Task 12). Mount it if present; until then use a placeholder `<div data-testid="map" />`.
- Produces:
  - `<OptionList options selectedId onSelect />`
  - `<OptionCard option selected />`
  - `<OptionDetail option />`
  - `<LiveBanner ageSeconds />`
  - The results page holds `selectedId` and `showWalking` state and passes them to `TripMap`.
- **Copy:**
  - Card header: `Leave 6:07 PM · 34 min · $3.00`, with ` (estimated)` after the fare when `estimated`, and a `Cash $3.75` line when `cashAmount` is set.
  - Badge per transit leg: `Live` or `Scheduled`.
  - Occupancy text: `Not crowded`, `Some standing`, `Full`.
  - Banner when `ageSeconds === null`: `Live data unavailable. Showing scheduled times.`
  - Banner when `ageSeconds > 120`: `Live data is N min old.`
  - Empty states:
    - `no_stops_near_start` → `No stops within walking distance of your start.`
    - `no_stops_near_end` → `No stops within walking distance of your destination.`
    - `no_trips_soon` → `No direct trips in the next 90 minutes.`
  - Walking toggle: `Show walking`.
  - Each alert headline appears on its card, prefixed with `⚠️`.

- [ ] **Step 1: Write the failing tests** with the fixture:
  - It renders 3 cards in order.
  - The first card shows `Live`; the scheduled option shows `Scheduled`.
  - Tapping card 2 expands its steps and sets it as selected.
  - `liveDataAgeSeconds: null` shows the unavailable banner. *(Review Focus 3)*
  - `emptyReason: 'no_trips_soon'` with no options shows that message. *(Review Focus 2)*
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The page fetches `/api/plan` with the query params. Add `&fixture=1` when `NEXT_PUBLIC_USE_FIXTURE=1`, so this lane can run before Task 9 lands. Layout: map in the top 45% of the viewport, list scrolling below.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: results list, option detail, live banner"`.

### Task 12: Results map

**Files:**
- Create: `components/TripMap.tsx`, `src/map/lines.ts`, `src/tomtom/tiles.ts`
- Test: `tests/map/lines.test.ts`

**Interfaces:**
- Consumes: `Option` (Task 2).
- Produces:
  - `OPTION_COLORS` (from Global Constraints).
  - `buildLineFeatures(options: Option[], selectedId: string|null, showWalking: boolean): GeoJSON.FeatureCollection`. Each feature has properties `{ optionId, color, width, dashed }`. Transit legs get their option's colour, width `7` if selected and `4` otherwise. Walk legs are `#9CA3AF`, dashed, width `3`, and only included when `showWalking`. GeoJSON coordinates are `[lon, lat]`.
  - `labelPoints(options): { optionId, lngLat: [number, number], text: string }[]`. The text is route numbers joined with `+`, then ` · N min`. The point is the middle point of the option's first transit leg.
  - `boundsFor(options): [[minLon, minLat], [maxLon, maxLat]]`
  - `<TripMap options selectedId showWalking onSelect />`. It's a client component loaded with `next/dynamic` and `ssr: false`.
- **Tiles:** `tomtomRasterUrl(key)` builds the TomTom Map Display raster tile template (`.../map/1/tile/basic/main/{z}/{x}/{y}.png?key=…&tileSize=256`; confirm against current TomTom docs).
- **Copyright:** fetch TomTom's copyright caption from the Copyright API in the browser and pass it to maplibre's `AttributionControl` as `customAttribution`.
- **Labels:** route labels are maplibre HTML `Marker`s, because the raster base has no glyphs. Tapping a line or label calls `onSelect(optionId)`.
- **Framing:** `fitBounds` with 40 px padding on load.

- [ ] **Step 1: Write the failing tests** with the fixture:
  - Option 1 gets `#2563EB` and option 2 gets `#7C3AED`.
  - The selected option's width is 7.
  - With `showWalking: false`, no feature has `dashed: true`.
  - Coordinates are `[lon, lat]`, e.g. the first coordinate is near `-113.49`.
  - `labelPoints` text for a route 9 option reads `9 · 34 min`.
  - `boundsFor` contains every path point.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `npm i maplibre-gl`, then build `TripMap` with one GeoJSON source and line layers using data-driven `line-color`, `line-width` and `line-dasharray`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Check by hand.** With `NEXT_PUBLIC_USE_FIXTURE=1 npm run dev`, open `/results?...` at 360 px width in browser devtools. Three coloured lines, the TomTom copyright visible, and tapping a line selects its card.
- [ ] **Step 6: Commit:** `git commit -am "feat: TomTom results map with option lines"`.

### Task 13: Footer, deploy, phone walkthrough

**Files:**
- Create: `components/Footer.tsx`
- Modify: `app/layout.tsx`
- Test: `tests/components/Footer.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: the deployed site on Vercel Hobby.

- [ ] **Step 1: Write the failing test.** The footer renders the exact attribution text from Global Constraints, with a link to the Terms of Use URL, and contains no "City of Edmonton" logo or the word "official".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `Footer`** and add it to `layout.tsx`.
- [ ] **Step 4: Run `npm test`.** Expected: the whole suite passes.
- [ ] **Step 5: Deploy.**
  1. Create the Vercel project from the repo.
  2. Add Neon through the Vercel marketplace.
  3. Set `NEXT_PUBLIC_TOMTOM_KEY`, and set `LIVE_SOURCE=city`.
  4. Run `DATABASE_URL=<prod> npm run import-gtfs`.
  5. In the TomTom dashboard, restrict the key to the Vercel domain and `localhost`.
- [ ] **Step 6: Walk through on a real phone** on mobile data:
  1. Allow location, pick a destination, see 1–5 options with Live or Scheduled badges, and see lines on the map.
  2. Deny location and type a start instead.
  3. Set `LIVE_SOURCE=snapshot`, redeploy, and confirm the app still works.

  Expected: all pass. Record any failures as issues.
- [ ] **Step 7: Commit:** `git commit -am "feat: attribution footer; deploy"`.

---

**Next plans, after tier 1 runs end to end:**
- *Tier 2:* one-transfer trips, transfer watch and `/api/live`, vehicle dots and crowding, route browser.
- *Tier 3:* the feedback page and accuracy measurement.
- *Stretch:* snow warnings and traffic colouring.

Each one builds on the interfaces above.
