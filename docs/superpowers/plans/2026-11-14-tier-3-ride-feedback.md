# Tier 3: Ride Feedback and Accuracy Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A rider on a bus taps "I'm on this bus" and fills in one optional feedback page: stars, accuracy sliders and an issue report.
- Option cards show each known bus's public summary.
- We measure our own time-prediction accuracy without asking anyone.

**Architecture:**
- **Profile:** Next.js middleware gives each browser an anonymous HttpOnly profile cookie. The database row is created on the first feedback write.
- **Storage:** feedback lives in Neon, keyed by profile and ride, where a ride is vehicle label + trip + service date. Resubmitting updates the record.
- **Accuracy measurement:**
  1. The plan API records its predicted departure for each option's board stop after responding, via Next's `after()`.
  2. Later live refreshes keep updating the latest feed prediction until the stop drops out of the feed.
  3. That last prediction approximates when the bus actually reached the stop.
- **Stats page:** an unlisted `/stats` page shows slider averages and measured error for the pitch.

**Tech Stack:** as tier 1. No new dependencies, apart from `crypto.randomUUID`, which is built in.

**Spec:** [docs/plan.md](../../plan.md): "Ride feedback page", "Feedback (tier 3)" in Key technical decisions, and the endpoint table. **Prerequisites:** [Tier 1](2026-11-14-tier-1-core-trip-planner.md) is complete. [Tier 2](2026-11-14-tier-2-transfers-and-routes.md) is optional: the transfer slider simply never appears without it.

## Global Constraints

Everything in tier 1's Global Constraints still applies. In addition:

- **Profile cookie:**
  - Named `rid`, holding a random UUID v4.
  - `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days), set again on every page request so it stays fresh.
  - The profile stores only its id, `created_at` and `last_seen_at`: no name, email or location.
- **Ride key:** `${vehicleLabel ?? 'none'}:${tripId}:${serviceDate}`. There's one feedback record per `(profile, rideKey)`, and resubmitting updates it.
- **Stars:** an integer 1–5. Allowed only when `vehicleLabel` isn't null.
- **Sliders:**
  - Keys are `time`, `position`, `crowding`, `transfer` and `alerts`. Each is an integer 1–5, or absent when untouched.
  - `crowding` appears only if the leg had `occupancy`, `transfer` only if the option had a `transfer`, and `alerts` only if it had alerts.
  - Slider labels: `1 = Way off`, `5 = Spot on`.
- **Issue:** one of `cleanliness`, `safety`, `disruption`, `too_full`, or none. **Note:** optional, at most 500 characters, and **never returned by any GET endpoint or shown on any page.**
- **"I'm on this bus" button:** shown on each transit leg of the selected option from 2 minutes before the leg's `departAt` until 10 minutes after its `arriveAt`.
  - With a `vehicleLabel`: `I'm on bus 4393`.
  - Without one: `I'm on this ride`.
- **Public vehicle summary:** average stars over the last 90 days and issue counts over the last 30 days. It's shown only when the label is known and `ratingCount ≥ 1`.
- **The GTFS import must never touch** `profiles`, `feedback` or `predictions`.

## Review Focus

1. **A schedule reimport** (tier 1's `npm run import-gtfs`) leaves every feedback, profile and prediction row intact. *Test in Task 2.*
2. **Submitting twice for the same ride** updates one record. **The same bus on a different trip or day** is a separate ride. *Test in Task 4.*
3. **Untouched sliders** are absent from the stored JSON, not saved as 1 or 3. **An empty submit** (nothing filled in) is rejected client-side with `Add at least one answer.` *Test in Tasks 4 and 6.*
4. **A forged or missing cookie, out-of-range stars (0 or 6), stars on a ride without a label, an unknown issue, or a 501-character note** all get 400 with no database write. *Test in Task 5.*
5. **Notes never leak.** No `/api/vehicles/:label` response and no `/stats` page contains the note text, even when a note holds HTML. *Test in Tasks 5 and 8.*

---

## File Structure

```
src/contract/schema.ts         # modify: FeedbackRequest, VehicleSummary, RideLink (Task 1)
fixtures/vehicle-summary.json  # (Task 1)
db/feedback.sql                # profiles, feedback, predictions (Task 2)
scripts/db-migrate.ts          # applies db/*.sql idempotently (Task 2)
middleware.ts                  # profile cookie (Task 3)
src/profile/profile.ts         # getProfileId, isValidProfileId (Task 3)
src/feedback/store.ts          # upsertFeedback, vehicleSummary (Task 4)
app/api/feedback/route.ts, app/api/vehicles/[label]/route.ts   (Task 5)
src/feedback/rideLink.ts       # encode/decode the ride link (Task 6)
app/ride/page.tsx, components/FeedbackForm.tsx, components/Slider.tsx, components/OnBoardButton.tsx   (Task 6)
components/VehicleSummary.tsx  # (Task 7)
src/accuracy/record.ts, src/accuracy/track.ts   (Task 8)
app/stats/page.tsx, src/accuracy/stats.ts       (Task 8)
```

**Parallel lanes once Task 1 is merged:**
- **Back end:** Tasks 2 → 3 → 4 → 5.
- **Screens:** Tasks 6 → 7, against fixtures.
- **Accuracy:** Task 8, once Task 2 is merged.

Task 9 comes last.

---

### Task 1: Contract v3

**Files:**
- Modify: `src/contract/schema.ts`
- Create: `fixtures/vehicle-summary.json`
- Test: `tests/contract/schema.test.ts`

**Interfaces:**
- Produces:
  - **`Issue`** = `'cleanliness'|'safety'|'disruption'|'too_full'`
  - **`Accuracy`** = `z.object({ time, position, crowding, transfer, alerts })`, each `z.number().int().min(1).max(5).optional()`, `.strict()`
  - **`FeedbackRequest`** = `{ rideKey: string; vehicleLabel: string|null; routeId: string; tripId: string; serviceDate: string /*YYYY-MM-DD*/; stars?: 1–5 int; accuracy: Accuracy; issue?: Issue; note?: string /* ≤500 chars */ }`. It is refined so that `rideKey === `${vehicleLabel ?? 'none'}:${tripId}:${serviceDate}``, `stars` requires `vehicleLabel`, and at least one of `stars`, `issue`, `note` or an `accuracy` key is present.
  - **`VehicleSummary`** = `{ label: string; averageStars: number|null /* 1 decimal */; ratingCount: number; issues: Record<Issue, number> }`
  - **`RideLink`** = `{ rideKey; vehicleLabel; routeId; routeShortName; tripId; serviceDate; departAt; arriveAt; showed: { crowding: boolean; transfer: boolean; alerts: boolean } }`

- [ ] **Step 1: Write the failing tests.**
  - A full valid request parses.
  - The fixture parses.
  - These are each rejected: `stars: 6`; `stars` with `vehicleLabel: null`; `accuracy: { speed: 3 }`, because `strict()` rejects unknown keys; a 501-character note; a mismatched `rideKey`; an empty request with no answers.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: contract v3 for feedback and vehicle summaries"`.

### Task 2: Feedback tables and migrations

**Files:**
- Create: `db/feedback.sql`, `scripts/db-migrate.ts`
- Test: `tests/import/preserve.test.ts`, an integration test gated on `DATABASE_URL_TEST`.

**Interfaces:**
- Consumes: `SCHEDULE_TABLES` (tier 1, Task 5).
- Produces the tables below and `npm run db:migrate`, which runs `db/schema.sql` then `db/feedback.sql`. Every statement is `create ... if not exists`, so the script is safe to rerun.

```sql
create table if not exists profiles (id uuid primary key, created_at timestamptz not null default now(), last_seen_at timestamptz not null default now());
create table if not exists feedback (
  profile_id uuid not null references profiles(id), ride_key text not null,
  vehicle_label text, route_id text not null, trip_id text not null, service_date date not null,
  stars smallint check (stars between 1 and 5), accuracy jsonb not null default '{}'::jsonb,
  issue text check (issue in ('cleanliness','safety','disruption','too_full')), note text check (length(note) <= 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (profile_id, ride_key));
create index if not exists feedback_vehicle on feedback (vehicle_label, updated_at);
create table if not exists predictions (
  trip_id text not null, service_date date not null, stop_id text not null, stop_sequence int not null,
  scheduled_epoch bigint not null, predicted_epoch bigint not null, predicted_at bigint not null, realtime boolean not null,
  latest_epoch bigint, latest_at bigint, final boolean not null default false,
  primary key (trip_id, service_date, stop_sequence, predicted_at));
create index if not exists predictions_open on predictions (final) where not final;
```

- [ ] **Step 1: Write the failing test.**
  1. Run the migration.
  2. Insert one profile, one feedback row and one prediction row.
  3. Run tier 1's import on `gtfs-mini`.
  4. All three rows still exist. *(Review Focus 1)*

  Also assert that `SCHEDULE_TABLES` doesn't include `profiles`, `feedback` or `predictions`.
- [ ] **Step 2: Run.** Expected: FAIL, because the tables don't exist yet.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Run the migration twice on the dev branch; the second run is a no-op.
- [ ] **Step 5: Commit:** `git commit -am "feat: feedback and prediction tables with idempotent migration"`.

### Task 3: Anonymous profile cookie

**Files:**
- Create: `middleware.ts`, `src/profile/profile.ts`
- Test: `tests/profile/middleware.test.ts`

**Interfaces:**
- Produces:
  - `PROFILE_COOKIE = 'rid'`
  - `isValidProfileId(s: string | undefined): s is string`. It accepts UUID v4 only.
  - `getProfileId(req: NextRequest): string | null`. It returns the cookie value when valid, otherwise `null`.
  - The middleware runs on every path except `/_next/*` and static files. It keeps a valid `rid`, or replaces a missing or invalid one with `crypto.randomUUID()`, and sets the cookie on the response with the attributes in Global Constraints.

- [ ] **Step 1: Write the failing tests** by calling the middleware with constructed `NextRequest`s:
  - With no cookie, it sets `rid` to a valid UUID with `HttpOnly`, `Secure`, `SameSite=lax` and `Max-Age=2592000`.
  - With a valid cookie, it sets the same value again.
  - With `rid=not-a-uuid`, it replaces the value.
  - `getProfileId` returns `null` for `rid=../../etc`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: anonymous profile cookie"`.

### Task 4: Feedback store

**Files:**
- Create: `src/feedback/store.ts`
- Test: `tests/feedback/store.test.ts`, an integration test gated on `DATABASE_URL_TEST`.

**Interfaces:**
- Consumes: `sql` (tier 1), `FeedbackRequest`, `VehicleSummary` (Task 1).
- Produces:
  - `upsertFeedback(profileId: string, f: FeedbackRequest): Promise<void>`. It first upserts the profile, setting `last_seen_at = now()`. Then it runs `insert ... on conflict (profile_id, ride_key) do update set` on every answer column and `updated_at = now()`. `accuracy` is stored exactly as parsed, so untouched sliders stay absent.
  - `vehicleSummary(label: string): Promise<VehicleSummary>`. `averageStars` is `round(avg(stars), 1)` over rows from the last 90 days with stars. `ratingCount` is that row count. Issue counts cover the last 30 days, with every key present (default 0). It selects named columns only, never `note`.

- [ ] **Step 1: Write the failing tests.**
  - Submitting twice for the same `rideKey`, with stars 2 then 4, leaves 1 row with stars 4. *(Review Focus 2)*
  - The same label with a different `tripId` gives 2 rows, and the summary has `ratingCount 2`. *(Review Focus 2)*
  - `accuracy: { time: 4 }` is stored as exactly `{"time":4}`. *(Review Focus 3)*
  - An issue from 31 days ago is excluded from `issues`.
  - The summary JSON doesn't contain a stored note's text. *(Review Focus 5)*
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: feedback upsert and vehicle summary"`.

### Task 5: Feedback and vehicle APIs

**Files:**
- Create: `app/api/feedback/route.ts`, `app/api/vehicles/[label]/route.ts`
- Test: `tests/api/feedback.test.ts`

**Interfaces:**
- Consumes: `getProfileId` (Task 3), `upsertFeedback`, `vehicleSummary` (Task 4), `FeedbackRequest` (Task 1).
- Produces:
  - `POST /api/feedback`. The body must be JSON under 4 KB.
    - No valid profile → 400 `{ error: 'no_profile' }`.
    - The body fails `FeedbackRequest` → 400 `{ error: 'invalid', fields: string[] }`.
    - Otherwise it returns 200 `{ ok: true }`.
    - It sends `no-store`.
  - `GET /api/vehicles/:label`. The label must match `^[A-Za-z0-9-]{1,10}$`, otherwise 400. It returns `VehicleSummary` with `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write the failing tests,** with `upsertFeedback` and `vehicleSummary` stubbed, so each test checks whether the stub was called.
  - Missing cookie → 400 `no_profile`, and the stub isn't called. *(Review Focus 4)*
  - `stars: 0`, stars without a label, `issue: 'rude'` and a 501-character note → each 400 `invalid`, and the stub isn't called. *(Review Focus 4)*
  - A valid body → 200, and the stub is called once with the profile id.
  - `/api/vehicles/<script>` → 400.
  - A valid POST with `note: '<b>hi</b>'` returns a body of exactly `{"ok":true}`, with no echo of the note. *(Review Focus 5. The summary query's own leak test is in Task 4.)*
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: feedback and vehicle summary API routes"`.

### Task 6: "I'm on this bus" and the feedback page

**Files:**
- Create: `src/feedback/rideLink.ts`, `components/OnBoardButton.tsx`, `components/FeedbackForm.tsx`, `components/Slider.tsx`, `app/ride/page.tsx`
- Modify: `components/OptionDetail.tsx`
- Test: `tests/feedback/rideLink.test.ts`, `tests/components/feedback.test.tsx`

**Interfaces:**
- Consumes: `RideLink`, `FeedbackRequest` (Task 1); `Option`, `Leg` (tiers 1 and 2); `formatClock` (tier 1).
- Produces:
  - `rideLinkFor(option: Option, legIndex: number): RideLink`. It computes the `rideKey` per Global Constraints and sets `showed` from the leg's `occupancy`, the option's `transfer` and the option's `alerts`.
  - `encodeRideLink(r: RideLink): string` is base64url JSON. `decodeRideLink(s: string): RideLink | null` validates with zod.
  - `<OnBoardButton option legIndex now />`. It renders only inside the time window in Global Constraints and links to `/ride?r=<encoded>`.
  - `<Slider name label value: number|undefined onChange />`. An `<input type="range" min=1 max=5>` that shows `Not rated` until first moved, and has a `Clear` button that sets it back to `undefined`.
  - `<FeedbackForm ride={RideLink} />`, which POSTs `FeedbackRequest` to `/api/feedback`.
- **Page layout, top to bottom:**
  1. Title: `Route 9 · Bus 4393`, or `Route 9 · this ride` without a label.
  2. Stars, only with a label: `How was this bus?`
  3. Sliders, under the heading `How accurate was our information?`, labelled:
     - `Departure and arrival times`
     - `Bus position on the map`
     - `Crowding` (only if `showed.crowding`)
     - `Transfer timing` (only if `showed.transfer`)
     - `Alerts` (only if `showed.alerts`)
  4. Issue radio group, headed `Anything wrong?`: `No issues` (the default), `Cleanliness`, `Safety`, `Disruption`, `Too full`.
  5. Note: a textarea labelled `Anything else? (only our team sees this)` with `maxLength 500`.
  6. Button: `Send feedback`.
- **After a 200 response:** `Thanks! Your feedback is saved. You can change it until the end of the day.`
- **Error copy:** for a 400 response, `Something's not right with that answer. Please check and try again.`; for a network failure, `Couldn't send. Check your connection and try again.`
- **Bad link:** an invalid `r` parameter shows `This ride link isn't valid.`

- [ ] **Step 1: Write the failing tests.**
  - `rideLinkFor` on a leg with `vehicleLabel: null` gives a `rideKey` starting `none:`.
  - `decodeRideLink('bad')` is `null`.
  - The button shows 1 minute before departure and is hidden 11 minutes after arrival.
  - A form with no label hides the stars.
  - The `Crowding` slider is hidden when `showed.crowding` is false.
  - Moving only the time slider to 4 and submitting POSTs `accuracy: { time: 4 }`, with no other keys. *(Review Focus 3)*
  - Pressing `Send feedback` with nothing filled in shows `Add at least one answer.` and makes no request. *(Review Focus 3)*
  - A 200 response shows the thanks copy.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The page must work at 360 px; each slider has a visible label and a 44 px thumb.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: on-board button and one-page ride feedback"`.

### Task 7: Vehicle summary on option cards

**Files:**
- Create: `components/VehicleSummary.tsx`
- Modify: `components/OptionCard.tsx`
- Test: `tests/components/vehicleSummary.test.tsx`

**Interfaces:**
- Consumes: `VehicleSummary` and its fixture (Task 1), `GET /api/vehicles/:label` (Task 5).
- Produces: `<VehicleSummary label={string|null} />`.
  - It renders nothing for a `null` label, a failed fetch, or `ratingCount === 0`.
  - Otherwise it shows `★ 4.2 (12)`, followed by the non-zero issue counts, e.g. ` · 2 cleanliness · 1 too full this month`.
  - A session-level `Map` cache keeps one fetch per label per page load.

- [ ] **Step 1: Write the failing tests.**
  - The fixture renders the stars and the non-zero issues only.
  - `ratingCount 0` renders nothing.
  - Two cards with the same label make one fetch.
  - A `null` label makes no fetch.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: vehicle rating summary on option cards"`.

### Task 8: Measured accuracy and the stats page

**Files:**
- Create: `src/accuracy/record.ts`, `src/accuracy/track.ts`, `src/accuracy/stats.ts`, `app/stats/page.tsx`
- Modify: `app/api/plan/route.ts` (calls `after(() => recordPredictions(...))` and `after(() => trackActuals(...))`)
- Test: `tests/accuracy/track.test.ts`, `tests/accuracy/stats.test.ts`

**Interfaces:**
- Consumes: `Option` (tier 1), `LiveIndex` (tier 1, Task 6), `sql`.
- Produces:
  - `recordPredictions(options: Option[], nowEpoch: number): Promise<void>`. It inserts one `predictions` row per option for its first transit leg's board stop: scheduled epoch, predicted epoch (the leg's `departAt`), `realtime`, `predicted_at = nowEpoch`. Use `on conflict do nothing`.
  - `trackActuals(live: LiveIndex, nowEpoch: number): Promise<void>`. For open rows (`not final`) of trips present in `live`:
    - If the stop is still in the trip's `StopLive` list, set `latest_epoch` / `latest_at` from it.
    - If the trip is present but the stop has dropped out, set `final = true`.
    - Rows older than 6 hours become `final`, with `latest_epoch` left as it is.
    - Each refresh runs one batched `update ... from unnest(...)`.
    - It runs at most once per live refresh: skip when `live.feedTimestamp` matches the last one tracked, held in module memory.
  - `accuracyStats(): Promise<{ sliders: Record<'time'|'position'|'crowding'|'transfer'|'alerts', { average: number|null; count: number }>; measured: { count: number; medianErrorMinutes: number|null; within2MinPct: number|null; byRealtime: { live: number|null; scheduled: number|null } } }>`. Measured error is `|predicted_epoch − latest_epoch| / 60`, over final rows with a `latest_epoch`.
  - **`/stats`** renders those numbers as two simple sections, `What riders told us` and `What we measured`. It's server-rendered with `dynamic = 'force-dynamic'` and isn't linked from the app. Footnote copy: `"Actual" time is the feed's last prediction before the bus reached the stop.`
- No other page or response uses the `predictions` table.

- [ ] **Step 1: Write the failing tests,** with a stubbed `sql` that records calls.
  - A prediction whose stop is still in the live trip updates `latest_epoch`.
  - When the stop has disappeared, `final` becomes true.
  - Calling twice with the same `feedTimestamp` makes one update.
  - `accuracyStats` on seeded rows (predicted − latest = 0, 1, 3 and 5 min) gives `medianErrorMinutes 2` and `within2MinPct 50`.
  - Rendering `/stats` with a seeded feedback row whose note is `secret-note` doesn't include `secret-note`. *(Review Focus 5)*
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: measured prediction accuracy and stats page"`.

### Task 9: Deploy and phone walkthrough

**Files:** none new.

- [ ] **Step 1: Migrate production:** `DATABASE_URL=<prod> npm run db:migrate`.
- [ ] **Step 2: Deploy.** `npm test` passes, push, and the Vercel deploy succeeds.
- [ ] **Step 3: Walk through on a real phone.**
  1. Plan a trip departing within 2 minutes. `I'm on bus <label>` appears on the selected option.
  2. Submit stars 4, the time slider at 5 and `Too full`. The thanks copy appears.
  3. Reopen the same link, change stars to 3, and resubmit. In Neon, `select count(*) from feedback` is unchanged.
  4. Back on results, the card shows `★ 3.0 (1) · 1 too full this month`.
  5. Clear site data and reload. A new `rid` cookie is set, and the previous rating still counts in the summary.
  6. After 30 minutes, `/stats` shows `count ≥ 1` under `What we measured`.
- [ ] **Step 4: Run** `npm run import-gtfs` against production once more, and confirm the step 4 summary is unchanged. *(Review Focus 1)*
- [ ] **Step 5: Record results** in the PR description.
