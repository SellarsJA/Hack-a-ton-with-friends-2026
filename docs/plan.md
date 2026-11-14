# Edmonton Transit Web App: Team Plan

_Last updated: 2026-11-14_

## The idea in one paragraph

We are building a mobile-first website for Edmonton transit riders, an alternative to the ETS app. A rider enters a start and a destination and sees a few ways to get there, each with a live departure time, total trip time and fare, drawn on a map. It watches transfers live and warns when a connection is at risk. Riders can browse any route to plan by hand. They can also rate the bus they're on, report problems such as cleanliness, safety or crowding, and tell us how accurate our information was. It runs in a phone browser, so no app store is involved.

## What "done" means for the demo

On a real phone, using live data:

1. Open the site. The start is set to "Your location", and the rider types a destination.
2. See up to five trip options, each showing when to leave, how long the trip takes, the fare, and whether the time is **live** or **scheduled**.
3. See those options as coloured lines on a map.
4. Tap an option to see its steps (walk, ride, transfer, walk) and any service alert affecting it.
5. On a trip with a transfer, see whether the connection is on track, tight, or at risk.
6. *(If time allows)* Tap "I'm on this bus" and fill in the one-page feedback: stars, accuracy sliders, issue report.

If we can show steps 1 to 4 working, the demo is a success. Everything else is extra.

## Priorities and cut lines

We build in this order. We don't start a tier until the one before it works end to end on a phone.

| Tier | What | Why it's here |
|---|---|---|
| **1. Must have** | Search, then **direct** trip options (no transfers) with live times and fare, shown as lines on a map | This is the core product. Without it there is no demo |
| **2. Should have** | Trips with **one transfer**, including LRT. **Transfer watch** on those trips. Service alerts on affected options. Live vehicle dots for the routes shown. **Route browser** | Makes it a real alternative to the ETS app. Transfer watch tackles riders' biggest pain point |
| **3. Nice to have** | **Ride feedback page:** star rating, issue report, and accuracy sliders, all on one page | Our differentiator, but it only works once tiers 1 and 2 do |
| **Stretch** | **Snow and ice warnings** on options. Traffic colouring on the roads a bus option uses | Both are extras. Snow data only changes during declared snow events. Traffic costs a lot of time and API quota, and we can't cache the speeds, so every search pays full price in API calls. Selected option only, buses only |

> **Scope warning:** the four features added from rider feedback (transfer watch, route browser, feedback page, snow warnings) roughly double the weekend's work. The cut lines matter even more now. If Saturday ends without tier 1 working, Sunday's scope shrinks to one-transfer trips and transfer watch. The route browser, feedback page and snow warnings move to "after the hackathon."

**Out of scope this weekend:** accounts and logins, saved places, push notifications, youth, senior and other discounted fares, daily and monthly fare caps, bikes and scooters, trips with more than one transfer, and sending reports to the City.

## Features from rider feedback

### Transfer watch (tier 2)

**The problem:** transfers are unpredictable, and a missed connection can add a long wait.

**What it does:** on an option with a transfer, the card shows how much time the rider has to make the connection, updated live:

- **Connection time** = when the second vehicle leaves the transfer stop (live prediction if available) − when the first vehicle arrives there (live prediction), − the walk between the two stops.
- **The card shows one of three states:**
  - **On track:** more than 3 minutes spare.
  - **Tight:** 0–3 minutes spare.
  - **At risk:** less than 0. Show the *next* departure of the second route from that stop, so the rider knows the fallback and the real arrival time.
- **The second vehicle's live position** shows on the map, so the rider can see it coming.
- **It refreshes every 30 seconds** while the rider has the option open. This uses the same server cache, so it costs nothing extra.

**Limits:**
- LRT legs have no live data, so a transfer to or from a train uses the schedule on that side and says so.
- Roughly 30% of trip updates can't be matched to a trip. Those legs also fall back to the schedule.

**Ranking:** an option whose transfer is "at risk" ranks below a slightly slower one that's "on track."

### Route browser (tier 2)

**The problem:** some riders want to plan by hand, not just get suggestions.

**What it does:** a **Routes** tab lists every route, searchable by number or name, grouped into bus, LRT and regional. Tapping a route shows:
- its path and stops on the map
- the next departures at a chosen stop
- live vehicles on that route
- any alerts.

**How:** the server sends one route at a time. All the shapes together are over 13 MB uncompressed, too much for a phone. This mostly reuses data the planner already needs.

### Ride feedback page (tier 3, replaces the separate rating screen)

**The problem:** riders want to say how accurate the app's information was, not just rate the bus.

**What it does:** one page, reached from a **"I'm on this bus"** button on the chosen option. We can't detect boarding by itself, so the button appears from the planned departure time until the planned arrival time. It has:

- **Star rating** for the vehicle (fleet number = `label`). **Buses only, and only when the live feed has named the vehicle.** Trains and unmatched trips have no `label`, so their page shows just the sliders and the issue report, attached to the route and trip rather than to a vehicle.
- **Accuracy sliders**, one for each piece of information the app showed. Each runs 1 (way off) to 5 (spot on), and riders can leave any slider untouched:
  - departure and arrival time
  - vehicle position on the map
  - crowding level (only if the feed reported it)
  - transfer timing (only if the trip has a transfer)
  - alerts (only if an alert was shown).
- **Issue report**: cleanliness, safety, disruption or too full, plus an optional private note.
- **One submit button.** Every field is optional, and submitting again for the same ride updates the earlier answers.

**What we show publicly:** the vehicle's average stars and recent issue counts, as before. The slider averages are for us, and for the pitch ("riders rate our arrival times 4.2/5").

**Bonus:** we can also *measure* time accuracy without asking anyone. Store what we predicted when the rider searched, and compare it with when the vehicle actually reached the stop according to the feed. That makes a good demo slide next to the slider results.

### Snow and ice warnings (stretch)

**The problem:** snow-covered roads and sidewalks slow buses and make walking to stops harder.

**The data:** the City publishes [Snow and Ice Clearing Route Status](https://data.edmonton.ca/d/8pdx-hfxi). It covers about 2,240 road segments, each with its geometry, clearing priority, segment status, hours since last cleared, and whether the service level was achieved. The live source is the City's ArcGIS service behind [the snow clearing map](https://gis.edmonton.ca/SnowAndIceControl), which is fresher than the open-data copy.

**What it does:** if an option's bus path or walking leg runs along a segment that's not yet cleared during an active snow event, the option gets a "⚠️ Snow clearing in progress on 63 Ave" note.

**Limits to say out loud:**
- **The data only updates when the City declares a snow event.** On a normal day every segment reads "NA" (it did when checked on 2026-11-14). After minor snowfall the roads may be cleared without the data changing. Between events the feature shows nothing, which is correct but makes it hard to demo. **Keep a saved sample from a past snow event for the demo.**
- **It covers roads, not sidewalks or bus stops.** The City's 311 snow-on-walk complaints are also open data and could feed walking-leg warnings later.
- **Matching paths to road segments is real spatial work.** Use a simple "within ~20 m of the line" check, and only on the selected option.

## How it fits together

```
Phone browser  ──►  Our server (Next.js on Vercel)  ──►  ETS schedule + live feeds
                                                    ──►  City snow clearing data (stretch)
                                                    ──►  Neon Postgres (schedule index, feedback)
Phone browser  ──►  TomTom map tiles + address search (direct, key restricted to our domain)
```

- **Frontend:** React through Next.js, mobile-first.
- **Hosting:** Vercel Hobby (free). Database: Neon Free (free) through the Vercel marketplace.
- **Map and address search:** TomTom with a single developer key. Use Map Display for tiles and Places Search (Suggest) for address autocomplete. Add Traffic only if we reach the stretch tier.
- **Transit data:** City of Edmonton open data. That covers the GTFS schedule zip and three live GTFS-Realtime files (vehicle positions, trip updates and alerts). Buses and LRT are in the same files.

### Key technical decisions

- **The browser only talks to our server** for transit data. The server reads the City's feeds and sends back only what a given search needs.
- **No caching of TomTom content.** TomTom's terms allow only temporary client-side caching, and only within the response's Cache-Control headers. So:
  - The browser calls TomTom directly for map tiles and address search, and the browser's normal HTTP cache follows TomTom's headers. The search box also lists matching stops and routes from our own index. Those cost nothing, so they appear first. "Your location" comes from the phone's geolocation, not from TomTom. We don't add a service worker or local-storage cache for TomTom responses.
  - Our server, Neon and the demo snapshot never store TomTom responses. That covers tiles, search results, coordinates from a search, and traffic speeds. The plan request sends the coordinates the rider picked, and we use them for that search only.
  - If the server ever has to call TomTom (stretch tier traffic only), it uses `fetch(..., { cache: "no-store" })` and passes TomTom's Cache-Control headers through unchanged. Next.js caches `fetch` calls by default, so this is easy to get wrong.
- **Live feeds are cached for 30 seconds in each server instance's memory**, decoded once per refresh. When several requests arrive during a refresh, they share one download. We don't use Next.js's data cache: it refuses items over 2 MB, and trip updates is already 1.7 MB. Vercel runs several short-lived copies of the server, so each copy keeps its own cache. That means a few extra downloads a minute at most, which the City's feed handles easily. If a refresh fails, we keep serving the last good copy and show its age.
- **The schedule is preprocessed by a script**, not at request time. The script downloads `gtfs.zip`, records each stop's fare zone, trims it to the next 7 service days and the columns we need, and loads it into Neon. ETS republishes the zip every few weeks, so the script must be safe to rerun.
- **Time:** all "now" and "today" logic goes through one helper using the `America/Edmonton` timezone. Never hardcode a UTC offset. **Alberta does observe daylight saving time** (UTC−7 in winter, UTC−6 in summer). GTFS times can go past 24:00 (for example, `25:10:00` is 1:10 a.m. on the next calendar day but belongs to the previous service day). Store them as a service date plus seconds since midnight. Strictly, GTFS counts from "noon minus 12 hours", which differs from midnight only on the two daylight-saving changeover days. Use a date library that handles the timezone, and never add seconds to a UTC midnight.
- **Live versus scheduled:** if the trip-updates feed has a prediction, show it and label it **Live**. Otherwise show the schedule and label it **Scheduled**. If the live data is more than a couple of minutes old, say so on screen.
- **Fares:** show the standard adult Arc and tap fare, looked up in the zone table below by the trip's first boarding stop and last alighting stop. Transfers within 90 minutes are included. Trips entirely within Edmonton also show the $3.75 cash fare. The amounts come from our fare table config file, and each stop's zone comes from `stop_areas.txt` in `gtfs.zip`. Don't use the feed's fare amounts, which are out of date for regional trips.
- **Crowding:** when a bus reports `occupancy_status`, its leg shows "Not crowded", "Some standing" or "Full". This costs nothing extra and comes with the vehicle dots in tier 2.
- **Trains:** LRT has no live data in the City's feeds, so train legs always show Scheduled.
- **Route line colours** should be clearly distinguishable from each other and visible on the basemap. Avoid white on a light map. If we do traffic colouring, also avoid green, yellow, orange and red.
- **Feedback (tier 3):** no login. The first visit sets an HttpOnly cookie holding a random ID. A ride is a vehicle `label`, a trip and a service day. One feedback record per ride per rider, and resubmitting updates it. Public cards show the average stars and counts per issue category. Free-text notes and slider scores are stored but never shown publicly.

## The contract between frontend and backend

**We agree this first, in hour one.** Then the frontend builds against a fake (fixture) response while the backend builds the real one. Nobody waits on anybody.

`GET /api/plan?from=lat,lng&to=lat,lng` returns:

```json
{
  "generatedAt": "2026-11-14T18:02:00-07:00",
  "liveDataAgeSeconds": 25,
  "options": [
    {
      "id": "opt-1",
      "leaveAt": "2026-11-14T18:07:00-07:00",
      "arriveAt": "2026-11-14T18:41:00-07:00",
      "durationMinutes": 34,
      "fare": { "amount": 3.00, "cashAmount": 3.75, "estimated": false, "label": "Adult, Arc or tap. Transfers included" },
      "alerts": [{ "headline": "Detour on 82 St" }],
      "transfer": {
        "stop": "Stop 5678", "spareMinutes": 2, "status": "tight",
        "basedOn": "live", "fallbackDepartAt": "2026-11-14T18:27:00-07:00"
      },
      "snow": [],
      "legs": [
        { "mode": "walk", "minutes": 5, "path": [[53.54, -113.49], ["..."]] },
        {
          "mode": "bus", "route": "9", "headsign": "Downtown",
          "tripId": "33560745", "serviceDate": "2026-11-14",
          "departAt": "2026-11-14T18:12:00-07:00", "arriveAt": "2026-11-14T18:30:00-07:00",
          "realtime": true, "fromStop": "Stop 1234", "toStop": "Stop 5678",
          "vehicleLabel": "4393", "occupancy": "some_standing", "path": [["..."]]
        },
        { "mode": "walk", "minutes": 3, "path": [["..."]] }
      ]
    }
  ]
}
```

Notes on the fields:
- `liveDataAgeSeconds` is `null` when no live data has ever loaded.
- When `options` is empty, a top-level `emptyReason` says why: `no_stops_near_start`, `no_stops_near_end` or `no_trips_soon`. Otherwise it's `null`.
- `transfer` is `null` on direct trips. `status` is one of `on_track`, `tight` or `at_risk`, and `basedOn` is `live` or `scheduled`.
- `vehicleLabel` and `occupancy` are `null` when the feed hasn't named the vehicle. For train legs, `mode` is `"rail"`.

The other endpoints. Their shapes go in the fixture file too:

| Endpoint | Tier | Returns |
|---|---|---|
| `GET /api/search?q=` | 1 | Up to 5 stops and 5 routes from our own index whose name or number matches. Shown before TomTom's address suggestions |
| `GET /api/live?keys=liveKey,liveKey` | 2 | Fresh predictions, positions and transfer status for the options the rider has open. Each option carries a `liveKey` that encodes its trips, stops and scheduled times, so this endpoint needs no database. Transfer watch polls it every 30 seconds instead of re-planning |
| `GET /api/routes` | 2 | Every route: id, number, name, type (bus, rail or regional), colour |
| `GET /api/routes/:id` | 2 | One route's path, stops, next departures, live vehicles and alerts |
| `POST /api/feedback` | 3 | Saves stars, sliders, issue and note for one ride. Updates an existing record for the same rider and ride |
| `GET /api/vehicles/:label` | 3 | Public summary: average stars and recent issue counts |

Fields can change, but change them in the fixture file first and tell the team.

## Who does what

Assign a name to each workstream at kickoff. Database and feedback can wait until someone frees up.

| Workstream | Owns | First deliverable |
|---|---|---|
| **Data and planner** | GTFS preprocessing, live feed decoding, fares, `/api/plan`, then transfers, transfer watch (`/api/live`) and snow matching | Direct-route options for one real pair of places |
| **Screens** | Search screen, results list, option detail, mobile layout, then the Routes tab and the feedback page | Screens working against the fixture |
| **Map** | TomTom map, route lines, vehicle dots, fitting the view to the options, then route browser maps | Fixture options drawn on the map |
| **Database and feedback** (whoever finishes tier 1 work first) | Neon setup, cookie profile, `/api/feedback`, `/api/vehicles/:label`, storing predictions for the accuracy measurement | Feedback saved and read back from Neon |
| **Product and demo** (great fit for a non-technical teammate) | Checking fares and facts, picking demo trips, writing on-screen text, testing on real phones, the pitch and slides, recording the backup demo | A list of 3 demo trips with what the ETS app shows for each |

## Schedule

| When | Goal |
|---|---|
| **Kickoff (first 2 hours)** | Repo and Vercel project set up. TomTom key created (enable Map Display, Places Search, and Traffic only if we reach the stretch tier). API contract and fixture committed. Owners assigned |
| **Saturday** | Tier 1 working end to end, deployed, and tested on a phone |
| **Sunday morning** | Tier 2, then tier 3 if tier 2 is solid |
| **Sunday, 3 hours before judging** | **Feature freeze.** Only fixes, polish, and demo rehearsal from here |

## Demo safety net

- **Save a snapshot** of the City's live feeds during a busy time and add a hidden switch that serves the snapshot instead. The snapshot holds City data only, never TomTom responses. The map and search still need TomTom to be reachable. If the City's feed is down or slow during judging, we flip it.
- **Record a screen capture** of the full demo working as a last resort.
- Rehearse on the actual phone and network we'll demo on.

## Facts we checked (2026-11-14)

Checked by downloading the City's feeds directly, plus official pricing pages. The product teammate should re-check anything still marked open.

- [x] **ETS fares.** From the [City fares page](https://www.edmonton.ca/ets/fares-passes), rates as of February 1, 2026:
  - Adult fare is **$3.00** with an Arc card or a tapped credit or debit card, and **$3.75** cash or with a 90-minute Arc ticket.
  - Transfers between buses and LRT are free within **90 minutes**, cash included.
  - Daily cap **$10.50** and monthly cap **$102**. We don't show these.
  - Route 747 (airport) is **$6.00**.
- [x] **Regional and commuter fares.** These come from the [Arc fare rates table](https://www.myarc.ca/features/fare-rates). Arc charges a flat fare based on the zone where the rider taps on and the zone where they tap off, **including transfers within 90 minutes**. See "Fare table" below.
  - **Use this table, not the feed's fare files.** The feed's regional amounts are out of date. For example, the feed has St. Albert commuter at $4.25 against Arc's $4.50, and Spruce Grove local at $3.00 against $3.50.
  - **Each stop's zone comes from the feed.** `stop_areas.txt` assigns every stop to a zone: Edmonton, Airport, St. Albert, Strathcona, Spruce Grove, Fort Saskatchewan, Beaumont or Leduc. **Acheson isn't a zone in the feed**, so its stops fall under Spruce Grove. Its Arc fares are the same except to Fort Saskatchewan, Beaumont and Leduc.
  - **The 747 sources disagree.** The City page says the 747 fare "does not include transfers", but Arc's table charges $6.00 for Edmonton ↔ Airport *including* transfers. We show the Arc amount for Arc and tap. A cash trip using the 747 shows $6.00 plus $3.75 for any other ETS leg.
  - **Cash** is shown only for trips entirely within Edmonton ($3.75). For anything else, the card shows the Arc and tap fare only.
- [x] **LRT is not in the live feeds.** All three lines (Capital, Metro, Valley) are in the schedule, but a Saturday-afternoon snapshot had **zero** trains in vehicle positions or trip updates. Trains will always show **Scheduled** times and no moving dot.
- [x] **The feeds include regional transit.** The zip and live feeds include St. Albert, Strathcona County, Spruce Grove, Fort Saskatchewan, Beaumont and Leduc. We keep them all, since the Arc fare table prices regional trips. Tier 1 can still be tested on Edmonton-only trips first.
- [x] **Feed sizes.**
  - Vehicle positions: 29 KB, about 300 vehicles.
  - Alerts: 39 KB, 69 alerts, with the routes and stops they affect.
  - **Trip updates: 1.7 MB**, about 1,400 trips, around 39 stop predictions each. Decode it on the server only, once per cache refresh.
  - About 30% of trip updates have no trip ID and can't be matched. Treat those trips as Scheduled.
- [x] **Schedule zip.** 17.7 MB zipped, 189 MB unzipped.
  - `stop_times.txt` is **2.9 million rows** (165 MB).
  - It has **no `calendar.txt`**. Service days come from `calendar_dates.txt` only.
  - **The zip is valid 2026-10-23 to 2026-12-12**, so ETS replaces it every few weeks. The preprocessing script must be rerunnable.
- [x] **Neon Free.** 1 GB storage per project and 100 compute-hours a month. Going over blocks writes rather than charging. The full `stop_times` table plus indexes would likely use a large share of that 1 GB, so **load only the needed columns and only the next 7 days of service**.
- [x] **TomTom free tier is monthly, per API**, with no credit card required.
  - Map tiles: 200,000/month.
  - **Places Search Suggest** ("as users type"): 10,000/month. Use this, not the older Search API, which allows only 2,500.
  - Traffic Flow Segment Data: 20,000/month.
  - **Past the free limit, requests are blocked, not billed.** There's no surprise bill, but the map or search stops working. Watch usage on the key dashboard during the weekend.
- [x] **Bonus: crowding data exists.** About 40% of buses in the live feed report how full they are (`occupancy_status`). We could show "Not crowded / Standing room / Full" on an option for free, next to rider reports.
- [x] **Fleet number.** The public-facing fleet number is the vehicle **`label`** (e.g. 4393), not the `id`. Ratings and reports are keyed on `label`, and the card shows `label`.
- [x] **Attribution.** For now, the footer reads: *"Contains information licensed under the Open Government Licence – City of Edmonton."* It links to the [Open Data Terms of Use](https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/) and must not imply the City runs the site. TomTom's map shows its own copyright.
- [x] **TomTom terms.** Read 2026-11-14 from [TomTom's terms and conditions](https://docs.tomtom.com/legal/terms-and-conditions):
  - **Caching (11.4).** Storing Results is prohibited, except caching "in clients" when Cache-Control headers are present, and no longer than their max-age. "Nothing under Clause 11.4 entitles any form of caching for the purpose of scaling results to serve multiple clients or users." "Results" explicitly includes geocodes and map tiles. See "No caching of TomTom content" under Key technical decisions.
  - **Proxying.** No clause addresses a server forwarding requests without storing them. Calling TomTom from the browser avoids the question, which is why the plan does that.
  - **No derived database (11.6.1).** We can't build a database populated with TomTom content. That's another reason never to save search results or coordinates in Neon.
  - **Attribution (17.3).** Never remove, cover or change the TomTom logo or copyright notice the map draws. The Search API has no built-in notice, so the footer's TomTom attribution should come from TomTom's Copyright API.
  - ⚠️ **The free tier is for "Evaluation Use" only (2.2),** defined as "internal evaluation and testing by you." A hackathon demo fits that. **A public site real riders use after the weekend does not.** That needs a TomTom Subscription Plan (2.1), and real users must accept an end-user licence at least as restrictive as [TomTom's end-user terms](http://tomtom.com/en_gb/thirdpartyproductterms/) (clause 12). This is fine for the weekend. Before launching for real, either sign up for a TomTom plan or switch to a map provider whose free tier allows public use.

### Fare table

Arc and tap adult fare, in CAD, by the zones where the rider taps on and off. **Arc's own table lists one amount per pair of zones, the same in either direction.** Amounts in *italics* are Arc's estimates for trips that use several regional agencies, so the real fare depends on the route. Source: [myarc.ca](https://www.myarc.ca/features/fare-rates), checked 2026-11-14.

| From \ To | Edmonton | Airport | St. Albert | Strathcona | Spruce Grove | Acheson | Fort Sask. | Beaumont | Leduc |
|---|---|---|---|---|---|---|---|---|---|
| **Edmonton** | 3.00 | 6.00 | 4.50 | 5.00 | 6.50 | 6.50 | *9.50* | 6.00 | 5.00 |
| **Airport** | 6.00 | 6.00 | *10.50* | *11.00* | *15.50* | *15.50* | *18.50* | *15.00* | 2.00 |
| **St. Albert** | 4.50 | *10.50* | 3.00 | *9.50* | *11.00* | *11.00* | *14.00* | *10.50* | *9.50* |
| **Strathcona** | 5.00 | *11.00* | *9.50* | 2.75 | *11.50* | *11.50* | 4.50 | *11.00* | *10.00* |
| **Spruce Grove** | 6.50 | *15.50* | *11.00* | *11.50* | 3.50 | 3.50 | *18.75* | *15.25* | *14.25* |
| **Acheson** | 6.50 | *15.50* | *11.00* | *11.50* | 3.50 | 3.50 | *18.10* | *14.60* | *13.60* |
| **Fort Sask.** | *9.50* | *18.50* | *14.00* | 4.50 | *18.75* | *18.10* | 2.50 | *18.50* | *17.50* |
| **Beaumont** | 6.00 | *15.00* | *10.50* | *11.00* | *15.25* | *14.60* | *18.50* | 6.00 | *14.00* |
| **Leduc** | 5.00 | 2.00 | *9.50* | *10.00* | *14.25* | *13.60* | *17.50* | *14.00* | 2.00 |

The card labels italic amounts as **"estimated"**. Store the table as a config file, so the next fare change needs a data edit, not a code change. (A rider who forgets to tap off pays a separate "missing tap" fare. We don't model that.)

## Risks

| Risk | What we do about it |
|---|---|
| The trip planner takes longer than expected | Ship direct routes first. Transfers are tier 2 |
| The schedule data is too big for free hosting | Measure it early. Keep only the next 7 days |
| Snow warnings can't be shown on a clear day | Demo from a saved snow-event sample, labelled as such |
| The City's live feed is down during the demo | Snapshot switch, plus "Scheduled" labels still work |
| TomTom's free licence is evaluation-only | Fine for the demo. Before a public launch, take a TomTom plan or switch map provider |
| TomTom quota runs out (requests get blocked) | Address suggestions only after the rider pauses typing. Watch the dashboard. Traffic stays a stretch goal |
| Too many features, nothing finished | Cut lines above. Feature freeze on Sunday |
