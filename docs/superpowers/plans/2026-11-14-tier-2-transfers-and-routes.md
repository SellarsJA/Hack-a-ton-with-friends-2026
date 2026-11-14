# Tier 2: Transfers, Transfer Watch, Vehicles and Route Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Add trips with one transfer, including LRT, to the planner.
- Watch each transfer live and report on track, tight or at risk, with a fallback departure.
- Show live vehicle dots and crowding for the routes in a result.
- Add a Routes tab for planning by hand.

**Architecture:**
- **Data:** builds on the tier 1 modules. The GTFS import gains a `stop_links` table of walkable stop pairs within 250 m. A second SQL query finds two-trip journeys joined through those links.
- **Options:** transfer and direct options are ranked together, with a penalty for risky connections. Each option carries a `liveKey`, a base64url JSON of its legs' trips, stops and scheduled times.
- **Live updates:** `/api/live` recomputes predictions and transfer status from the live cache alone. The results page polls it every 30 s for the selected option.
- **Route browser:** two read-only endpoints and two pages, sharing a map base extracted from `TripMap`.

**Tech Stack:** as tier 1. No new dependencies.

**Spec:** [docs/plan.md](../../plan.md): "Transfer watch", "Route browser", the endpoint table, and "Key technical decisions". **Prerequisite:** [Tier 1 plan](2026-11-14-tier-1-core-trip-planner.md) is complete. This plan uses its interfaces by name.

## Global Constraints

Everything in tier 1's Global Constraints still applies. In addition:

- **Transfers:**
  - At most **one** transfer.
  - The two stops of a transfer are the same stop or within **250 m**.
  - Required gap = walk seconds between the two stops + **60 s**.
  - The second leg must depart within **90 minutes** of the first leg's arrival.
- **Transfer status:** `spare = (depart2 − arrive1 − walkSeconds) / 60`.
  - `on_track` when `spare > 3`
  - `tight` when `0 ≤ spare ≤ 3`
  - `at_risk` when `spare < 0`
  - `basedOn` is `live` only when **both** sides used live data, otherwise `scheduled`.
- **Ranking key:** arrival at the destination (epoch seconds) + `0` for direct and on-track options, `+120` for tight and `+900` for at-risk. Two legs on the same `route_id` are not a transfer option.
- **LRT** (`route_type` 0 or 1) never has live data. Its legs always say `Scheduled`, and transfer copy says `Train side uses the schedule`.
- **Polling:** the results page polls `/api/live` every **30 s** for the selected option only, and pauses while `document.visibilityState === 'hidden'`.
- **Route groups:** `rail` when `route_type` is 0 or 1; `regional` when `agency_id !== '1'`; otherwise `bus`. Routes sort by numeric `short_name`, then alphabetically.
- **Vehicle dot colours:** the option's colour (from `OPTION_COLORS`) for vehicles on the option's trips, and `#374151` for other vehicles on the same routes.

## Review Focus

1. **A rider leaves the results open until the first bus has gone.** `/api/live` marks that option `expired: true`, and the card says `This option has left. Search again.` *Test in Tasks 6 and 8.*
2. **A transfer to or from the LRT** shows `basedOn: 'scheduled'` and the train copy, never a confident "On track". *Test in Tasks 3 and 8.*
3. **A malformed or tampered `liveKey`** gets 400 `{ error: 'bad_key' }`, not a 500 error. *Test in Task 7.*
4. **A route with no more trips today,** or a stop the route doesn't serve, shows `No more trips today from this stop.` *Test in Tasks 5 and 10.*
5. **A two-leg journey on the same route,** e.g. a bus that changes trip number at a terminal, is never offered as a transfer. *Test in Task 4.*

---

## File Structure

```
src/contract/schema.ts         # modify: liveKey, vehiclePosition, vehicles, LiveResponse, Route schemas (Task 1)
fixtures/plan.json, fixtures/live.json, fixtures/routes.json, fixtures/route-detail.json   (Task 1)
db/schema.sql                  # modify: stop_links (Task 2)
scripts/import-gtfs/transform.ts  # modify: stopLinks() (Task 2)
src/plan/transfer.ts           # status + ranking (Task 3)
src/plan/queryTransfer.ts      # transfer candidate SQL (Task 4)
src/plan/departures.ts         # next departures at a stop (Task 5)
src/plan/liveKey.ts            # encode/decode (Task 6)
src/plan/assemble.ts           # modify: transfer options, merged ranking (Task 6)
src/plan/plan.ts               # modify: run both queries, attach vehicles (Tasks 6–7)
src/plan/vehicles.ts           # vehicles on routes (Task 7)
app/api/live/route.ts          # (Task 7)
components/TransferBadge.tsx, src/hooks/useLiveOption.ts   (Task 8)
src/map/lines.ts               # modify: buildVehicleFeatures (Task 8)
src/map/useMaplibre.ts         # extracted map base (Task 10)
app/api/routes/route.ts, app/api/routes/[id]/route.ts, src/routes/queries.ts   (Task 9)
app/routes/page.tsx, app/routes/[id]/page.tsx, components/TabBar.tsx, components/RouteMap.tsx   (Task 10)
```

**Parallel lanes once Task 1 is merged:**
- **Data:** Tasks 2 → 3 → 4 → 5 → 6 → 7.
- **Screens and map:** Task 8, against `fixtures/live.json`.
- **Routes:** Task 9, then Task 10.

Task 11 comes last.

---

### Task 1: Contract v2 and fixtures

**Files:**
- Modify: `src/contract/schema.ts`, `fixtures/plan.json`
- Create: `fixtures/live.json`, `fixtures/routes.json`, `fixtures/route-detail.json`
- Test: `tests/contract/schema.test.ts`

**Interfaces:**
- Produces:
  - **`Option.liveKey: string`**
  - **Transit legs gain** `vehiclePosition: { lat: number; lon: number } | null` and `transferWalkMinutesBefore: number | null`. The second number is set on the second transit leg of a transfer.
  - **`Transfer`** is `{ stop: string; spareMinutes: number; status: 'on_track'|'tight'|'at_risk'; basedOn: 'live'|'scheduled'; fallbackDepartAt: string|null }`.
  - **`Vehicle`** is `{ label: string; tripId: string; routeShortName: string; lat: number; lon: number; occupancy: Occupancy|null }`, and **`PlanResponse.vehicles: Vehicle[]`**.
  - **`LiveOption`** is `{ liveKey: string; expired: boolean; legs: { tripId; departAt; arriveAt; realtime; vehicleLabel; occupancy; vehiclePosition }[]; transfer: Transfer|null }`.
  - **`LiveResponse`** is `{ liveDataAgeSeconds: number|null; options: LiveOption[]; vehicles: Vehicle[] }`.
  - **`RouteSummary`** is `{ routeId; shortName; longName; group: 'bus'|'rail'|'regional'; color: string|null }`, and **`RoutesResponse`** is `{ routes: RouteSummary[] }`.
  - **`RouteDetail`** is `{ route: RouteSummary; patterns: { headsign; path: [number, number][]; stops: { stopId; name; lat; lon }[] }[]; departures: { tripId; headsign; departAt; realtime: boolean }[]; vehicles: Vehicle[]; alerts: { headline: string }[] }`.
- **Fixtures:**
  - `plan.json` gains a fourth option: route 9 to Valley Line LRT, with `transfer.status: 'tight'` and `basedOn: 'scheduled'`.
  - `live.json` is the same options a few minutes later: option 1 `expired: true`, and option 4 with `status: 'at_risk'` and a `fallbackDepartAt`.

- [ ] **Step 1: Write the failing tests.** All four fixtures parse against their schemas. A `Transfer` with `status: 'late'` throws.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the schemas and fixtures.** Tier 1 code still compiles; set the new fields to `null`, `[]` or a placeholder `liveKey` until Task 6.
- [ ] **Step 4: Run `npm test`.** Expected: PASS, including all tier 1 tests.
- [ ] **Step 5: Commit:** `git commit -am "feat: contract v2 for transfers, live refresh, routes"`.

### Task 2: Walkable stop links in the import

**Files:**
- Modify: `db/schema.sql`, `scripts/import-gtfs/transform.ts`, `scripts/import-gtfs/index.ts`, `tests/fixtures/gtfs-mini/stops.txt`
- Test: `tests/import/transform.test.ts`

**Interfaces:**
- Consumes: `distanceMeters`, `walkMinutes` (tier 1, Task 4).
- Produces:
  - Table `stop_links (from_stop text, to_stop text, walk_s int, primary key (from_stop, to_stop))`.
  - It includes every stop linked to itself with `walk_s 0`, and both directions of each pair within 250 m, with `walk_s = walkMinutes(d) * 60`.
  - `stopLinks(stops: { stopId; lat; lon }[], radiusM = 250): { fromStop; toStop; walkS }[]`. Bucket stops into a grid of about 250 m cells and compare neighbouring cells only, not every pair.
- Add `'stop_links'` to `SCHEDULE_TABLES` (tier 1, Task 5).

- [ ] **Step 1: Extend `gtfs-mini`.** Add a stop 150 m from an existing stop, and one 400 m away.
- [ ] **Step 2: Write the failing tests.**
  - The 150 m pair appears in both directions, with `walkS` = 180.
  - The 400 m pair is absent.
  - Every stop links to itself with `walkS 0`.
  - 5,000 random stops in Edmonton's bounding box finish in under 2 s.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS. Then re-run the real import on the dev branch. `select count(*) from stop_links` is between 6,000 and 200,000.
- [ ] **Step 6: Commit:** `git commit -am "feat: walkable stop links for transfers"`.

### Task 3: Transfer status and ranking

**Files:**
- Create: `src/plan/transfer.ts`
- Test: `tests/plan/transfer.test.ts`

**Interfaces:**
- Produces:
  - `transferStatus(arrive1Epoch: number, depart2Epoch: number, walkSeconds: number, bothLive: boolean): Omit<Transfer, 'stop'|'fallbackDepartAt'>`. `spareMinutes` is rounded down to a whole minute.
  - `rankKey(arriveAtDestEpoch: number, transfer: Pick<Transfer, 'status'> | null): number`
  - `TRAIN_SIDE_NOTE = 'Train side uses the schedule'`

- [ ] **Step 1: Write the failing tests.**
  - Spare 240 s → `on_track`, `spareMinutes 4`.
  - Spare 180 s → `tight`.
  - Spare 0 → `tight`.
  - Spare −30 s → `at_risk`, `spareMinutes -1`.
  - `bothLive: false` → `basedOn: 'scheduled'`. *(Review Focus 2)*
  - `rankKey(1000, null) === 1000`, `rankKey(1000, {status:'tight'}) === 1120`, `rankKey(1000, {status:'at_risk'}) === 1900`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: transfer status and ranking key"`.

### Task 4: Transfer candidate query

**Files:**
- Create: `src/plan/queryTransfer.ts`
- Modify: `tests/fixtures/gtfs-mini/*`. Add a second route crossing trip A's route at a shared stop, and an LRT route with `route_type 0` meeting it via a linked stop.
- Test: `tests/plan/queryTransfer.test.ts`, an integration test gated on `DATABASE_URL_TEST` like tier 1's Task 7.

**Interfaces:**
- Consumes: `sql`, `NearbyStop` (tier 1, Task 7).
- Produces:
  - `TransferCandidate = { first: Candidate; second: Candidate; transferWalkSeconds: number }`. Here `first.alight` is the transfer stop on trip 1 and `second.board` is the transfer stop on trip 2. Both reuse tier 1's `Candidate` shape, with `distanceM`/`walkSeconds` 0 on the transfer-side stops.
  - `findTransferCandidates(origin: NearbyStop[], dest: NearbyStop[], days: { serviceDate: string; nowSeconds: number }[]): Promise<TransferCandidate[]>`

The query, which needs both legs on the same service date:

```sql
with o(stop_id, walk_s) as (select * from unnest($1::text[], $2::int[])),
     d(stop_id, walk_s) as (select * from unnest($3::text[], $4::int[])),
     days(service_date, now_s) as (select * from unnest($5::date[], $6::int[])),
leg1 as (
  select t.trip_id, t.route_id, days.service_date, so.stop_id b_stop, so.stop_sequence b_seq, so.dep b_dep, o.walk_s b_walk,
         sx.stop_id x_stop, sx.stop_sequence x_seq, sx.arr x_arr
  from days join service_dates sd on sd.date = days.service_date
  join trips t on t.service_id = sd.service_id
  join stop_times so on so.trip_id = t.trip_id
  join o on o.stop_id = so.stop_id and so.dep between days.now_s + o.walk_s and days.now_s + 5400
  join stop_times sx on sx.trip_id = t.trip_id and sx.stop_sequence > so.stop_sequence),
leg2 as (
  select t.trip_id, t.route_id, days.service_date, sy.stop_id y_stop, sy.stop_sequence y_seq, sy.dep y_dep,
         sa.stop_id a_stop, sa.stop_sequence a_seq, sa.arr a_arr, d.walk_s a_walk
  from days join service_dates sd on sd.date = days.service_date
  join trips t on t.service_id = sd.service_id
  join stop_times sa on sa.trip_id = t.trip_id
  join d on d.stop_id = sa.stop_id and sa.arr between days.now_s and days.now_s + 10800
  join stop_times sy on sy.trip_id = t.trip_id and sy.stop_sequence < sa.stop_sequence)
select distinct on (leg1.trip_id, leg2.trip_id) leg1.*, leg2.*, l.walk_s x_walk
from leg1
join stop_links l on l.from_stop = leg1.x_stop
join leg2 on leg2.y_stop = l.to_stop and leg2.service_date = leg1.service_date
  and leg2.route_id <> leg1.route_id
  and leg2.y_dep between leg1.x_arr + l.walk_s + 60 and leg1.x_arr + 5400
order by leg1.trip_id, leg2.trip_id, (leg2.a_arr + leg2.a_walk) - (leg1.b_dep - leg1.b_walk)
limit 300;
```

Join the result back to route, trip and stop details in a second query, keyed by the trip and stop ids returned.

- [ ] **Step 1: Write the failing tests** on the extended `gtfs-mini`:
  - A trip from route A's origin to the second route's destination returns one candidate through the shared stop, with `transferWalkSeconds 0`.
  - The LRT connection via the linked stop returns `transferWalkSeconds 180`.
  - Two trips of the same `route_id` meeting at a terminal return no candidate. *(Review Focus 5)*
  - A second leg leaving 30 s after the first arrives is excluded, because of the 60 s buffer.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then on the real dev data, time the query for Churchill Square → Mill Woods Town Centre (53.4570, -113.4280). It must take under 1.5 s; record the timing in the PR. If it's slower, add `create index stop_times_trip_seq_stop on stop_times (trip_id, stop_sequence, stop_id)` and re-time.
- [ ] **Step 5: Commit:** `git commit -am "feat: one-transfer candidate query"`.

### Task 5: Next departures at a stop

**Files:**
- Create: `src/plan/departures.ts`
- Test: `tests/plan/departures.test.ts`, an integration test on `gtfs-mini`.

**Interfaces:**
- Consumes: `sql`, `activeServiceDays`, `toInstant` (tier 1); `applyRealtime` (tier 1, Task 8), whose parameter type widens to `RealtimeLegInput = { tripId; serviceDate; board: { stopId; seq; dep }; alight: { stopId; seq; arr } }`. `Candidate` already satisfies it. For a departure, pass the same stop as both board and alight.
- Produces:
  - `Departure = { tripId; serviceDate; routeId; headsign; departEpoch: number; realtime: boolean }`
  - `nextDepartures(args: { stopId: string; routeId?: string; afterEpoch: number; limit: number; live: LiveIndex|null }): Promise<Departure[]>`. It covers the active service days, within 3 hours after `afterEpoch`, with live times applied, sorted by departure.

- [ ] **Step 1: Write the failing tests.**
  - The stop on trip A, asked 10 min before it departs, returns trip A first.
  - Asking after the last trip returns `[]`. *(Review Focus 4)*
  - With `routeId` set, other routes are filtered out.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: next departures with live times"`.

### Task 6: Transfer options, live keys and merged ranking

**Files:**
- Create: `src/plan/liveKey.ts`
- Modify: `src/plan/assemble.ts`, `src/plan/plan.ts`
- Test: `tests/plan/liveKey.test.ts`, `tests/plan/assembleTransfer.test.ts`, `tests/api/plan.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5; tier 1 `applyRealtime`, `fareFor`, `sliceShape`.
- Produces:
  - `LiveKeyLeg = { t: string /*tripId*/; d: string /*serviceDate*/; bs: string; bq: number; bt: number /*sched dep s*/; as: string; aq: number; at: number /*sched arr s*/; r: string /*routeId*/; rail: boolean }`
  - `LiveKeyPayload = { legs: LiveKeyLeg[]; tw: number|null /*transfer walk s*/ }`
  - `encodeLiveKey(p: LiveKeyPayload): string` is base64url JSON. `decodeLiveKey(s: string): LiveKeyPayload | null` validates with zod, returns `null` on any failure, and is limited to 2 legs.
  - `assembleTransferOptions(cands: TransferCandidate[], ctx): Option[]`. Legs are walk, transit, walk-between (omitted when `tw === 0`), transit, walk.
    - `transfer` comes from `transferStatus`, with `bothLive` = both transit legs `realtime` and neither leg rail.
    - `fallbackDepartAt` is set only when `at_risk`: `nextDepartures({ stopId: second.board.stopId, routeId: second.routeId, afterEpoch: arrive1 + tw, limit: 1 })`.
    - The fare comes from the first board zone to the last alight zone, across both legs.
  - `mergeAndRank(direct: Option[], transfer: Option[]): Option[]`. Sort by `rankKey`, keep the best per route-number sequence (e.g. `9`, `9+Valley`), take the first 5, and re-id them `opt-1` to `opt-5`.
  - `planTrip` runs `findDirectCandidates` and `findTransferCandidates` in parallel, and sets `liveKey` on every option.

- [ ] **Step 1: Write the failing tests.**
  - `decodeLiveKey(encodeLiveKey(p))` deep-equals `p`.
  - `decodeLiveKey('xyz')`, a 3-leg payload and a payload with `bq: "1"` all return `null`.
  - An at-risk candidate gets `fallbackDepartAt` from a stubbed `nextDepartures`.
  - A rail leg forces `basedOn: 'scheduled'`. *(Review Focus 2)*
  - A tight transfer arriving 60 s earlier than a direct option ranks after it, because 60 < 120.
  - The output passes `PlanResponse.parse`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: transfer options, live keys, merged ranking"`.

### Task 7: Vehicles and `/api/live`

**Files:**
- Create: `src/plan/vehicles.ts`, `app/api/live/route.ts`, `src/plan/live.ts`
- Modify: `src/live/decode.ts` (vehicles carry `routeId` from `vehicle.trip.route_id` when present), `src/plan/plan.ts`
- Test: `tests/plan/vehicles.test.ts`, `tests/api/live.test.ts`

**Interfaces:**
- Consumes: `LiveIndex`, `decodeLiveKey`, `applyRealtime`, `transferStatus`, `nextDepartures`.
- Produces:
  - `vehiclesForRoutes(routeIds: string[], live: LiveIndex, tripRoute: (tripIds: string[]) => Promise<Map<string, string>>): Promise<Vehicle[]>`. It uses the vehicle's own `routeId`, falling back to `tripRoute`, which looks the trip up in the `trips` table.
  - `refreshOptions(keys: string[], live: LiveIndex|null, nowEpoch: number): Promise<LiveOption[]>`. `expired` is true when the first transit leg's live or scheduled departure is before now. *(Review Focus 1)*
  - `GET /api/live?keys=k1,k2`:
    - at most 5 keys, otherwise 400 `{ error: 'too_many_keys' }`;
    - any key that won't decode → 400 `{ error: 'bad_key' }`;
    - sends `Cache-Control: no-store`;
    - `vehicles` covers the routes in the given keys.
  - `planTrip` sets `PlanResponse.vehicles` for the routes in its options, and each transit leg's `vehiclePosition`.

- [ ] **Step 1: Write the failing tests** with the tier 1 snapshot `LiveIndex`:
  - `vehiclesForRoutes` for a route seen in the snapshot returns at least one vehicle with a non-empty `label`.
  - `refreshOptions` on a key whose scheduled departure is an hour ago returns `expired: true`.
  - The route returns 400 `bad_key` for `keys=%%%`. *(Review Focus 3)*
  - The route returns 400 `too_many_keys` for 6 keys.
  - The happy path passes `LiveResponse.parse`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: live refresh endpoint and route vehicles"`.

### Task 8: Transfer watch UI and vehicle dots

**Files:**
- Create: `components/TransferBadge.tsx`, `src/hooks/useLiveOption.ts`
- Modify: `components/OptionCard.tsx`, `components/OptionDetail.tsx`, `app/results/page.tsx`, `src/map/lines.ts`, `components/TripMap.tsx`
- Test: `tests/components/transfer.test.tsx`, `tests/hooks/useLiveOption.test.ts`, `tests/map/vehicles.test.ts`

**Interfaces:**
- Consumes: `LiveResponse`, `fixtures/live.json` (Task 1).
- Produces:
  - `useLiveOption(liveKey: string | null): { data: LiveOption | null; vehicles: Vehicle[]; ageSeconds: number | null }`. It fetches `/api/live?keys=…` at once, then every 30 s, pauses while the page is hidden, and resumes with an immediate fetch when the page becomes visible.
  - `<TransferBadge transfer={Transfer} trainSide={boolean} />`
  - `buildVehicleFeatures(vehicles: Vehicle[], optionTrips: Map<string /*tripId*/, string /*colour*/>): GeoJSON.FeatureCollection`. Points with properties `{ label, color, occupancy }`.
- The selected option's card and detail show `useLiveOption` data when present, falling back to the plan response.
- **Copy:**
  - On track: `On track · 5 min to transfer`
  - Tight: `Tight · 2 min to transfer`
  - At risk: `At risk · next one 6:27 PM`
  - When `basedOn === 'scheduled'`, add ` (scheduled)`.
  - When `trainSide`, add a second line with `TRAIN_SIDE_NOTE`.
  - When expired: `This option has left. Search again.`, plus a `Search again` button that re-runs the same search.
- **Map:** vehicle dots are circle layers with radius 6 and a white 2 px stroke. Tapping one shows `Bus 4393 · Some standing`, or just `Bus 4393` when occupancy is `null`.

- [ ] **Step 1: Write the failing tests.**
  - Each status renders its copy.
  - A rail transfer shows the train note. *(Review Focus 2)*
  - `expired: true` shows the expired copy and button. *(Review Focus 1)*
  - With fake timers, the hook fetches at t = 0 and t = 30 s, does not fetch while `visibilityState` is mocked to `'hidden'`, and fetches at once when it turns visible.
  - `buildVehicleFeatures` colours an option trip's vehicle with that option's colour and other vehicles `#374151`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Check by hand** with `NEXT_PUBLIC_USE_FIXTURE=1`: a tight badge on option 4, vehicle dots on the map. When fixture mode is on, `/api/live` serves `fixtures/live.json`.
- [ ] **Step 6: Commit:** `git commit -am "feat: transfer watch UI and live vehicle dots"`.

### Task 9: Routes API

**Files:**
- Create: `src/routes/queries.ts`, `app/api/routes/route.ts`, `app/api/routes/[id]/route.ts`
- Test: `tests/routes/queries.test.ts` (integration, `gtfs-mini`), `tests/api/routes.test.ts`

**Interfaces:**
- Consumes: `sql`, `nextDepartures`, `vehiclesForRoutes`, `getLiveIndex`, `activeServiceDays`.
- Produces:
  - `listRoutes(): Promise<RouteSummary[]>`, grouped and sorted per Global Constraints.
  - `routeDetail(routeId: string, stopId: string | null, nowEpoch: number): Promise<RouteDetail | null>`.
    - **Patterns:** for each distinct `headsign`, the trip with the most stops among trips running on today's service date. Its shape is the path; its stops are in sequence order.
    - **Departures:** `nextDepartures(stopId, routeId, limit 5)` when `stopId` is given, otherwise `[]`.
    - **Alerts:** those whose `routeIds` include the route.
  - `GET /api/routes` caches for 1 hour (`Cache-Control: public, max-age=3600`).
  - `GET /api/routes/:id?stop=` returns 404 `{ error: 'unknown_route' }` for an unknown route, and sends `no-store`.

- [ ] **Step 1: Write the failing tests.**
  - `listRoutes` puts the LRT route in `rail` and a regional `agency_id 2` route in `regional`, and sorts `2` before `10`.
  - `routeDetail` for trip A's route returns one pattern with its stops in sequence.
  - With a stop after the last trip, `departures` is `[]`. *(Review Focus 4)*
  - An unknown id → `null` → 404.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: routes list and route detail APIs"`.

### Task 10: Route browser screens

**Files:**
- Create: `src/map/useMaplibre.ts`, `components/RouteMap.tsx`, `components/TabBar.tsx`, `app/routes/page.tsx`, `app/routes/[id]/page.tsx`
- Modify: `components/TripMap.tsx` (use `useMaplibre`), `app/layout.tsx` (add `TabBar`)
- Test: `tests/components/routes.test.tsx`

**Interfaces:**
- Consumes: `RoutesResponse`, `RouteDetail`, and their fixtures (Task 1).
- Produces:
  - `useMaplibre(container: RefObject<HTMLDivElement>): maplibregl.Map | null`. It contains the TomTom tiles, attribution and teardown from `TripMap`, unchanged.
  - `<RouteMap detail={RouteDetail} selectedStopId onSelectStop />`. It draws each pattern's line in the route `color`, falling back to `#2563EB`, with stops as circles and vehicles as dots.
  - `<TabBar />` with two tabs, `Plan` (`/`) and `Routes` (`/routes`), fixed to the bottom with 48 px targets.
- **`/routes`:**
  - A filter box (`Search routes`) that filters client-side by number or name.
  - Section headers `Bus`, `LRT` and `Regional`.
  - Each row reads `9 · Southgate – Downtown`.
- **`/routes/[id]`:**
  - Map on top.
  - A headsign switcher when there are several patterns.
  - The stop list; tapping a stop selects it and loads `?stop=`.
  - Departures listed as `6:12 PM · Live` or `6:12 PM · Scheduled`.
  - When the list is empty: `No more trips today from this stop.`
  - Alerts at the top, prefixed with `⚠️`.

- [ ] **Step 1: Write the failing tests** with the fixtures:
  - Filtering `val` leaves only the Valley Line.
  - The three section headers render.
  - Tapping a stop requests `/api/routes/<id>?stop=<stopId>`.
  - Empty departures show the empty copy. *(Review Focus 4)*
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Refactor `TripMap` onto `useMaplibre` first, re-run tier 1's map tests, then build the new screens.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: route browser screens and shared map base"`.

### Task 11: Deploy and phone walkthrough

**Files:** none new.

- [ ] **Step 1: Re-run the import against production:** `DATABASE_URL=<prod> npm run import-gtfs`. It now builds `stop_links`.
- [ ] **Step 2: Deploy.** Run `npm test`, push, and confirm the Vercel deploy succeeds.
- [ ] **Step 3: Walk through on a real phone.**
  1. Plan Churchill Square → a Valley Line destination (e.g. Mill Woods Town Centre). A transfer option appears with a badge and the train note.
  2. Leave the page open for 1 minute. The badge updates without a reload.
  3. Lock the phone for 1 minute, then unlock it. A refresh happens at once.
  4. Open Routes → `9` → tap a stop. Departures and vehicle dots appear.
  5. With `LIVE_SOURCE=snapshot`, everything still renders.
- [ ] **Step 4: Record results** in the PR description, then commit any fixes with their own tests.
