# PennEats v2 — Design Spec

**Date:** 2026-04-23
**Status:** Approved, ready for implementation planning
**Replaces:** current `agent/` directory (Gemini + Google Sheets + `@photon-ai/imessage-kit`)

---

## 1. Goal

Rebuild PennEats as a proactive iMessage agent for Penn students. On first contact it onboards the user (email, name, usual halls, meal schedule, dietary). Then — unprompted — it scouts dining options 20 minutes before each scheduled meal, sends a recommendation, and checks in 10 minutes after the meal started to capture feedback. Publicly useful facts from replies (a dish was great, a station is out, a hall is crowded) are aggregated into a per-day knowledge base that feeds subsequent recommendations.

The agent is a long-running service. The repo is public; the deployment is cloud-hosted.

---

## 2. Stack

| Concern | Choice | Note |
|---|---|---|
| iMessage I/O | `spectrum-ts` (cloud mode) | Photon's unified messaging SDK. Local mode for Mac dev. |
| LLM | Gemini 2.5 Flash via `@google/genai` | Cheap enough for agentic scraping; kept from v1. |
| DB | Google Sheets via `googleapis` service account | Keeps v1's pattern, zero infra to run; schema is PennEats-v2-specific (see §4). |
| Runtime | Node.js ≥ 20, long-running process | Dockerfile. Deployable to Fly / Railway / Render / any VM. |
| Tests | `bun test` (already in root repo) | Fixture-driven for scraper; mocks for Gemini in unit tests; live smoke tests gated behind `DESCRIBE_LIVE=1`. |
| Lint/format | Biome (already configured) | — |
| Package layout | New top-level `app/` directory. Retire `agent/`. | The root `src/` (the SDK itself) is untouched. |

**Removed:** `@photon-ai/imessage-kit` runtime dependency for the agent. The v1 Sheets schema is fully replaced — not merged.

**Kept from v1:** `googleapis`, service-account JSON auth pattern, the `SheetsClient` class shape (but with new tabs/columns).

**Env vars:**
```
# spectrum-ts / Photon
PHOTON_PROJECT_ID=...
PHOTON_PROJECT_SECRET=...
SPECTRUM_MODE=cloud          # "cloud" | "local"

# Gemini
GEMINI_API_KEY=AIza...

# Google Sheets (v2 uses a fresh spreadsheet — don't reuse the v1 one)
GOOGLE_SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_PATH=./service-account.json
# OR inline the JSON for container deploys:
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Optional
TZ=America/New_York
LOG_LEVEL=info
SCHEDULER_TICK_MS=60000
```

---

## 3. Directory layout

```
app/
├── index.ts                        # Spectrum() bootstrap + scheduler start
├── config/
│   ├── venues.ts                   # Penn venue catalog (15 halls, same set as v1)
│   └── env.ts                      # Zod-validated env parsing
├── db/
│   ├── sheets.ts                   # Google Sheets client (singleton), generalized tab reader/writer
│   ├── bootstrap.ts                # Idempotent: creates missing tabs + writes headers on first boot
│   └── repos/
│       ├── users.ts                # profile + onboarding state CRUD (users tab)
│       ├── schedules.ts            # weekly recurring meal plan CRUD (user_schedules tab)
│       ├── events.ts               # meal_events (recommendations + followups) tab
│       └── knowledge.ts            # daily_knowledge tab read/write
├── agent/
│   ├── run.ts                      # Gemini tool-calling loop
│   ├── tools.ts                    # FunctionDeclarations + dispatcher
│   └── prompts/
│       ├── system.ts               # Date-aware system prompt builder
│       └── phrases.ts   # Variant library (greet/askEmail/askName/…)
├── flows/
│   ├── inbound.ts                  # Router: new user? onboarding? open followup? → dispatch
│   ├── onboarding.ts               # Step machine — phrase picker + LLM parse helpers
│   ├── recommend.ts                # 20-min pre-meal scout + send
│   └── followup.ts                 # Send "how was it?" + handle reply
├── scheduler/
│   └── tick.ts                     # 60s loop; fires recommend/followup by clock
├── scraper/
│   ├── fetcher.ts                  # HTTP fetch + fixture caching (deterministic)
│   └── extractor.ts                # Gemini-powered HTML → VenueMenu (structured output)
└── lib/
    ├── rank.ts                     # Merge menu + dietary + daily knowledge → top picks
    ├── time.ts                     # Timezone helpers (America/New_York)
    └── handle.ts                   # Normalize iMessage handle (phone or email)

__tests__/
├── fixtures/
│   └── bonappetit/
│       ├── hill-house-2026-04-09.html         # Weekday: Breakfast+Lunch+Dinner
│       ├── hill-house-2026-04-13.html         # Weekend: Brunch+Dinner
│       ├── 1920-commons-2026-04-09.html
│       ├── falk-dining-commons-2026-04-11.html  # Shabbat variant
│       ├── joes-cafe-2026-04-09.html           # Cafe — continuous hours
│       ├── lauder-college-house-2026-04-09.html # Dinner-only
│       ├── empty-menu-2026-04-09.html          # Published but no items
│       └── extracted/                          # Expected JSON snapshots
│           └── *.json
├── scraper/
│   ├── extractor.test.ts                       # Gemini-mocked unit tests
│   ├── daypart-pick.test.ts
│   └── live.test.ts                            # Gated by DESCRIBE_LIVE=1
├── flows/
│   ├── onboarding.test.ts
│   └── inbound-router.test.ts
├── scheduler/
│   └── tick.test.ts                            # Clock-driven, Sheets-mocked
└── db/
    └── repos.test.ts                           # Against a real test Google Sheet

docker/
└── Dockerfile
```

---

## 4. Data model

Four tabs in a single Google Sheet (ID in `GOOGLE_SHEET_ID`). `app/db/bootstrap.ts` creates any missing tab and writes row-1 headers on first boot — so fresh deployments self-initialize.

All IDs are `randomBytes(8).toString('hex')` — 16-char hex, same pattern as v1 followups. Cheap, collision-resistant enough at this scale, and easy to eyeball in the sheet.

### Tab: `users`

Identity & onboarding state. One row per iMessage handle.

| Column | A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|---|
| Header | `id` | `handle` | `email` | `name` | `dietary` | `timezone` | `onboarding` | `onboarding_ctx` | `created_at` |
| Type | hex16 | str | str | str | csv | str | enum | json | iso |
| Example | `a1b2c3d4e5f60718` | `+12155550101` | `kyle@upenn.edu` | `Kyle` | `halal,peanuts` | `America/New_York` | `done` | `{}` | `2026-04-24T12:30:00Z` |

`dietary` is a comma-separated list (Sheets doesn't have arrays). `onboarding` enum: `awaiting_email | awaiting_name | awaiting_halls | awaiting_schedule | awaiting_dietary | done`. `handle` is plaintext — the proactive rec flow requires being able to message the user back, so hashing (as v1 did) is impossible. Note in the README.

### Tab: `user_schedules`

Recurring weekly meal plan. One row per (user × weekday × meal_period).

| Column | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Header | `id` | `user_id` | `weekday` | `meal_period` | `target_time` | `preferred_halls` |
| Type | hex16 | fk→users.id | 0-6 | enum | `HH:MM` | csv |
| Example | `b2c3d4e5f6071829` | `a1b2c3d4e5f60718` | `1` | `Lunch` | `12:30` | `Hill House,1920 Commons` |

`weekday` is 0 = Sunday … 6 = Saturday. `meal_period` ∈ `Breakfast | Brunch | Lunch | Dinner | Late Night`. Uniqueness `(user_id, weekday, meal_period)` is enforced in code (repo does read-then-write-or-update), not by Sheets.

### Tab: `meal_events`

Every recommendation + followup lifecycle. The `(user_id, date, meal_period)` tuple is the idempotency key — repo helper `upsertByMealKey` gates on it.

| Column | A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Header | `id` | `user_id` | `schedule_id` | `date` | `meal_period` | `target_time_iso` | `rec_sent_at` | `rec_payload_json` | `chosen_hall` | `followup_sent_at` | `followup_reply` | `rating` | `status` |
| Example | `c3d4…` | `a1b2…` | `b2c3…` | `2026-04-24` | `Lunch` | `2026-04-24T16:30:00Z` | `2026-04-24T16:10:02Z` | `{"primaryPick":"Hill House",…}` | `Hill House` | `2026-04-24T16:40:03Z` | `mac was great` | `5` | `done` |

`status` enum: `scheduled | recommended | followup_sent | done | skipped`. Empty cells = null.

### Tab: `daily_knowledge`

Consolidated per-day public-interest facts. Read by every recommendation via `knowledge.getForDate(date, halls)`. **Only written** when Gemini's `save_daily_knowledge` tool judges a fact publicly useful (per the system prompt's filter).

| Column | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|
| Header | `id` | `date` | `hall` | `meal_period` | `item` | `sentiment` | `note` | `source_event_id` |
| Example | `d4e5…` | `2026-04-24` | `Hill House` | `Lunch` | `mac and cheese` | `5` | `mac was great today` | `c3d4…` |

`item`, `meal_period`, `sentiment` are optional. `note` is the only required free-text field.

### Query access patterns

Because Sheets has no indexes, every read is an O(n) scan of the tab. The `SheetsClient` caches each tab's rows for `CACHE_TTL_MS = 15000` (15s) to absorb the scheduler's 60s tick + burst inbound messages without hammering the API. Writes invalidate the cache for the written tab.

Expected sizes at 100 active users after 1 year: `users` ≤ 100 rows, `user_schedules` ≤ ~1,000 rows, `meal_events` ≤ ~100,000 rows, `daily_knowledge` ≤ ~20,000 rows. Sheets handles this comfortably (cell limit is 10M per sheet). If `meal_events` grows past that, archive old months to a separate tab.

### Concurrency

Single Node process = no concurrent writers. The 60s scheduler and inbound message handler run in the same event loop; per-sender message queues (carried over from v1) serialize ops per user. The "claim the window" pattern (insert meal_events row first, then send) prevents duplicate sends even across process restarts, because we check-then-insert and Sheets appends are ordered.

### Handle privacy

v1 hashed phone numbers via SHA-256 and relied on an out-of-band `phoneMap` to restore them on restart — this made the proactive recommendation flow impossible because we can't message a hash. v2 stores handles in plaintext in the `users` tab. Sheet access is restricted by the service-account share permission (you only share it with the service account's email — no one else can read it). The README must call this out: the handle is plaintext because the bot needs to message the user back, and the Sheet must not be shared publicly.

---

## 5. Inbound message flow

`flows/inbound.ts` routes every incoming Spectrum message tuple `[space, message]`:

```
1. Normalize handle from message.sender.id
2. users.getByHandle(handle)
   └─ absent? insert with onboarding='awaiting_email', start onboarding
3. If user.onboarding !== 'done':
   └─ delegate to flows/onboarding.ts
4. If an open meal_event exists (status='followup_sent') for user today:
   └─ delegate to flows/followup.ts handle-reply
5. Else:
   └─ delegate to agent.run (generic Q&A with tools)
```

Every response is sent via `space.responding(async () => space.send(reply))` so the typing indicator appears for the duration.

A per-sender promise queue (carried over from v1) ensures messages from one user are processed in order.

---

## 6. Onboarding flow

Deterministic step machine. Each step:
1. Selects a phrase variant (deterministic per `(userId, step)` via hash) — see `app/agent/prompts/phrases.ts`.
2. Accepts input → parses (regex for email, LLM for free-text halls/schedule/dietary) → writes to `users` / `user_schedules`.
3. Advances `users.onboarding` to the next state.

States and transitions:

| State | Prompt pool key | Expected reply | Parse | Next |
|---|---|---|---|---|
| _(new user, first msg)_ | `greet` + `askEmail` | email | regex | `awaiting_email` → `awaiting_name` |
| `awaiting_email` | `askEmail` | email | regex; if invalid, re-ask once with `askEmailRetry` | `awaiting_name` |
| `awaiting_name` | `askName` | name | trim, store | `awaiting_halls` |
| `awaiting_halls` | `askHalls` | free text | Gemini: map to subset of known venue names | `awaiting_schedule` |
| `awaiting_schedule` | `askSchedule` | free text | Gemini: produce `user_schedules` rows | `awaiting_dietary` |
| `awaiting_dietary` | `askDietary` | free text | Gemini: normalize to tags | `done` (send `done` message) |
| `done` | — | (normal flow) | — | — |

Phrase pool example (`phrases.ts`):
```ts
export const phrases = {
  greet:        [ "yo 👋 I'm PennEats — your new dining buddy.",
                  "hey! PennEats here — let's find you good food on campus.",
                  "hi there! I'm PennEats, here to save you from bad dining hall decisions." ],
  askEmail:     [ "what's your penn email? (just so I know who you are)",
                  "drop your penn email so I can set you up 📬",
                  "first things first — what's your penn email?" ],
  askEmailRetry:[ "hmm that didn't look like an email — try again?",
                  "couldn't parse that, mind sending just the email?" ],
  askName:      [ "and what should I call you?",
                  "what's your name?",
                  "how should I call you?" ],
  askHalls:     [ "which dining halls do you usually hit? (1920, Hill, English, Falk, Lauder, Houston, Accenture, Joe's…)",
                  "where do you usually eat on campus?",
                  "which halls are in your rotation?" ],
  askSchedule:  [ "when do you usually eat? e.g. 'mon-fri lunch at 12:30, dinner at 7; weekend brunch at 11'",
                  "walk me through a typical week — days, times, and where.",
                  "tell me your usual meal schedule — days/times and where you go." ],
  askDietary:   [ "any dietary restrictions or preferences? (halal, kosher, vegan, GF, allergies, none…)",
                  "anything I should keep in mind food-wise? (veggie, halal, allergies…)",
                  "dietary restrictions? (halal, kosher, vegan, gluten-free, none works too)" ],
  done:         [ "you're all set ✅ I'll ping you 20 min before each meal with the best picks, and check in after. text me anytime too.",
                  "nice — you're in. I'll scout halls 20 min before meals and check in after. text me anything dining-related." ],
} as const
```

Selection:
```ts
function pickPhrase(pool: readonly string[], userId: string, step: string): string {
  const h = hash(`${userId}:${step}`) % pool.length
  return pool[h]!
}
```

---

## 7. Scheduler

One `setInterval(SCHEDULER_TICK_MS)` loop (60s default) in `scheduler/tick.ts`. Each tick runs three passes. With Sheets as the DB, the queries are just in-memory filters on freshly-fetched rows (one read per tab per tick, served by the 15s cache).

All weekday / time math is computed in `America/New_York` (the canonical user timezone for v2).

### 7a. Due recommendations

```ts
// Pseudocode
const now = nowNY()
const weekday = now.getDay()
const windowStart = addMinutes(now, 19)
const windowEnd = addMinutes(now, 21)
const today = dateString(now)  // "2026-04-24"

const users = await users.all()
const schedules = await schedules.all()
const events = await events.forDate(today)

const due = schedules
  .filter(s => s.weekday === weekday)
  .filter(s => timeInWindow(s.target_time, now, windowStart, windowEnd))
  .map(s => ({
    schedule: s,
    user: users.find(u => u.id === s.user_id && u.onboarding === 'done'),
    existing: events.find(e => e.user_id === s.user_id && e.meal_period === s.meal_period),
  }))
  .filter(row => row.user && (
    !row.existing
    || (row.existing.status === 'scheduled' && !row.existing.rec_sent_at)
  ))
```

For each due row:
1. If `existing` is `null`: append a new `meal_events` row with `status='scheduled'`, `target_time` = today + `schedule.target_time` in NY tz.
2. Call `flows/recommend.ts`. On success it updates the row to `status='recommended'`, `rec_sent_at=now()`, `rec_payload=…`. On failure it leaves the row at `status='scheduled', rec_sent_at=null` — a subsequent tick picks it up again via the second branch of the filter.
3. Retry limit: section 7c handles stale rows.

The append happens *before* the send, so a crash mid-send leaves a row behind that the next tick will pick up. Because Sheets appends are strictly ordered and we have a single process, the "claim the window" semantics hold without a real unique constraint — the filter's `!row.existing` check is enough.

### 7b. Due followups

```ts
const followupDue = events.filter(e =>
  e.status === 'recommended'
  && !e.followup_sent_at
  && minutesSince(e.target_time_iso) >= 10
  && minutesSince(e.target_time_iso) <= 30
)
```

For each: `flows/followup.ts` sends the "how was it?" probe → `status='followup_sent'`, `followup_sent_at=now()`.

### 7c. Stale-row cleanup

```ts
const stale = events.filter(e =>
  e.status === 'scheduled'
  && !e.rec_sent_at
  && minutesSince(e.target_time_iso) > 5
)
for (const e of stale) await events.updateStatus(e.id, 'skipped')
```

Runs at the end of each tick. Prevents stale `scheduled` rows from accumulating and stops the scheduler from sending "heading to lunch in 20 min" after lunch has already started.

### Idempotency & crash recovery

- `unique (user_id, date, meal_period)` on `meal_events` prevents duplicate recs.
- Window is 2 min wide, tick is 60s → every eligible user hits at least one tick. If a tick is missed (process restart), the next tick still catches users whose `target_time` is within the 21-min-ahead window.
- If process dies mid-send, the row is already inserted — on restart, the scheduler sees `status='scheduled'` with `rec_sent_at IS NULL` and re-sends. A `status IN ('scheduled','recommended')` check before send prevents double-sends via a "claim" column if needed (v2.1).
- `status='skipped'` set manually if a meal has passed without action.

---

## 8. Recommendation flow (`flows/recommend.ts`)

```
Input: meal_events row (has user_id, meal_period, target_time, schedule)
Step 1: Load user.dietary, schedule.preferred_halls
Step 2: For each preferred_hall in parallel:
        scraper.getMenu(hall, date=today, mealPeriod=meal_period)
Step 3: knowledge.getForDate(today, halls=preferred_halls)
Step 4: lib/rank.ts — Gemini call:
        input = {user: {name, dietary}, halls: [{name, menu, knowledge}], mealPeriod}
        output (structured) = {primaryPick: string, alternates: [{hall, reason}], summary: string}
Step 5: send(space, summary) — a short, iMessage-shaped message
Step 6: update meal_events: rec_sent_at=now(), rec_payload=output, status='recommended'
```

Example send:
> "20 min till lunch 🍽️ Hill House has lemon chicken + their mac today (someone said the mac is 🔥 this week). Falk has salmon bowls if you want halal. My pick: Hill House."

The `rec_payload` is stored for debugging and for the followup flow's context.

---

## 9. Followup flow (`flows/followup.ts`)

### Sending the probe

Phrase variants live in `app/agent/prompts/phrases.ts` under a `followup` key (the file is the shared home for all variant pools — onboarding steps, follow-up probes, and any other phrasing where we want variation without full LLM generation). Selection uses the same deterministic `pickPhrase(pool, userId, step='followup:<eventId>')` helper so retries are stable.

```ts
followup: [
  "how's {hall}? what'd you get?",
  "hey! how was {hall}?",
  "how'd {hall} turn out?",
  "what did you end up eating at {hall}?",
]
```

```
Input: meal_events where target_time is 10-30 min ago and followup_sent_at is null
{hall} = rec_payload.primaryPick (fallback to "dinner"/"lunch"/"breakfast" if no pick was stored)
Send: pickPhrase(followup, userId, `followup:${eventId}`)
Update: followup_sent_at=now(), status='followup_sent'
```

### Handling the reply

When a user replies and `inbound.ts` detects an open `meal_events` row with `status='followup_sent'`, the agent runs with the event context loaded into the system prompt. The agent has four tools:

1. `save_feedback(chosen_hall, rating, notes)` — always called; closes the event.
2. `save_daily_knowledge(hall, meal_period, item?, sentiment, note)` — called **only when** the user surfaces a public-interest fact (dish quality, station status, crowdedness, out-of-stock, new item). **Not** called for pure personal reactions.
3. `reply(text)` — sends a short ack.

The system prompt explicitly defines public-interest:
> A fact is public-interest if another Penn student deciding where to eat today would find it useful. "Mongolian chicken was fire" → YES. "The mac was out at 7pm" → YES. "It was busy" → YES. "I liked it" → NO. "I'm full" → NO.

On save, `meal_events` → `status='done'`, `chosen_hall`, `rating`, `followup_reply` set.

---

## 10. Bon Appétit scraper (agent-driven)

Two modules:

### 10a. `scraper/fetcher.ts`

Pure HTTP. No LLM.

```ts
export async function fetchVenueHtml(slug: string, date: string): Promise<string> {
  const url = `https://university-of-pennsylvania.cafebonappetit.com/cafe/${slug}/?date=${date}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new FetchError(`bonappetit fetch failed: ${res.status}`)
  return res.text()
}

// In tests: if BONAPPETIT_FIXTURE_DIR is set, read from disk instead of network.
```

### 10b. `scraper/extractor.ts`

Gemini with `responseSchema` enforces structured output. One call per menu. Input: the full HTML (~30-80KB, well within Flash's input limit). Output: a `VenueMenu` object.

```ts
interface VenueMenu {
  venue: string
  date: string
  status: 'open' | 'closed' | 'unknown'
  dayparts: Array<{
    label: string            // normalized — "Breakfast" | "Brunch" | "Lunch" | "Dinner" | "Late Night" | original
    startIso: string
    endIso: string
    stations: Array<{
      label: string          // "Grill", "Vegan", "Mongolian Expo"
      items: Array<{
        name: string
        dietary: string[]    // ["vegan","halal","gluten-free","jain","kosher"]
        calories: number | null
      }>
    }>
  }>
}
```

Gemini is instructed to:
- Parse `Bamco.dayparts['…']` and `Bamco.menu_items = {…}` from the embedded JS.
- Normalize daypart labels to the canonical set.
- Infer dietary tags from `labels.{vegan,vegetarian,halal,kosher,jain,gluten}`.
- Combine `date + starttime/endtime` into ISO strings using America/New_York tz.
- Return `{status:'unknown', dayparts:[]}` if the HTML has no Bamco vars.

**Daypart picking** (`lib/pickDaypart.ts`, pure function):
```ts
export function pickDaypart(
  menu: VenueMenu,
  mealPeriod?: string,
  now: Date = new Date()
): VenueMenu['dayparts'][number] | null {
  // priority: exact label match → currently active → next upcoming → first
}
```

### 10c. Test strategy

**Unit (fast, no network):** `__tests__/scraper/extractor.test.ts`
- Load HTML fixtures, stub `GoogleGenAI.models.generateContent` with pre-recorded responses, assert the extractor returns the expected `VenueMenu` JSON (snapshot).
- Fixtures in `__tests__/fixtures/bonappetit/*.html`, snapshots in `__tests__/fixtures/bonappetit/extracted/*.json`.

**Unit (daypart picking):** `__tests__/scraper/daypart-pick.test.ts`
- Pure function, table-driven:
  - Hill weekday → `pickDaypart(m, 'Lunch')` returns Lunch.
  - Hill weekend → `pickDaypart(m, 'Lunch')` returns Brunch (fuzzy fallback).
  - `pickDaypart(m, undefined, 12:30pm)` → returns currently-active.
  - Dinner-only hall asked for breakfast → returns `null`.

**Integration smoke (gated):** `__tests__/scraper/live.test.ts`
- Runs only when `DESCRIBE_LIVE=1`.
- Hits three real Bon Appétit pages (1920, Hill, Joe's) and asserts each returns ≥1 daypart with ≥3 items and `status` in `open|closed`.
- Pre-commit CI skips these; nightly cron runs them.

**Running tests:**
```
bun test                    # unit only
DESCRIBE_LIVE=1 bun test    # unit + live smoke
bun test __tests__/scraper  # scraper subset
```

TDD order: write the `pickDaypart` tests + implementation, then the extractor tests with fixtures, then the extractor implementation. **Scraper is merged and green before the rest of the system is wired.**

---

## 11. System prompt (main agent loop)

`app/agent/prompts/system.ts` — same shape as v1's `buildSystemPrompt`, rebuilt per request so date/time are fresh. Key changes from v1:

- Drops the Google Sheets-specific review flow.
- Adds guidance for the new tools (`save_feedback`, `save_daily_knowledge`, meal-event-context awareness).
- Documents the "public interest filter" rule for `save_daily_knowledge`.
- Includes the user's dietary + preferred halls in the loaded context when the user is mid-followup.

---

## 12. Deployment

### Prereqs

**Photon iMessage provisioning** (API-only, no dashboard button exists):
```bash
# Base URL: https://spectrum.photon.codes (hard-coded in spectrum-ts; override with SPECTRUM_CLOUD_URL).

# 1. Enable iMessage platform (note the trailing slash — the path is /platforms/)
curl -X PATCH "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/platforms/" \
  -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"platform":"imessage","enabled":true}'
# → {"succeed":true,"data":{}}

# 2. Verify it's enabled
curl -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" \
  "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/platforms/"

# 3. Fetch iMessage info (shared vs dedicated, line details)
curl -u "$PHOTON_PROJECT_ID:$PHOTON_PROJECT_SECRET" \
  "https://spectrum.photon.codes/projects/$PHOTON_PROJECT_ID/imessage/"
```

If the project is `shared`, spectrum-ts cloud mode uses Photon's shared line — ready to go. If `dedicated`, email `hello@photon.codes` to get lines assigned.

Quota to watch: **50 new conversations initiated per line per day** (from advanced-kits docs). Replies within existing conversations don't count, so the proactive rec flow is fine as long as users text in first.

**Google Sheets bootstrap**:
1. Create a new Google Sheet. Copy its ID from the URL.
2. Create a Google Cloud project → enable the **Google Sheets API** → IAM → Service Accounts → create → Keys → JSON → download.
3. Share the sheet with the service account's `client_email` as **Editor**.
4. On first boot, `app/db/bootstrap.ts` creates the 4 tabs (`users`, `user_schedules`, `meal_events`, `daily_knowledge`) and writes row-1 headers if they don't exist. No manual schema work.

**Note:** v1's spreadsheet has a different schema — do NOT reuse it. Create a fresh Sheet for v2.

### Dockerfile

`docker/Dockerfile`:
```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY app/package.json app/bun.lockb ./
RUN bun install --production --frozen-lockfile
COPY app/ ./
CMD ["bun", "run", "index.ts"]
```

### Fly.io (recommended)

```toml
# fly.toml
app = "penneats"
primary_region = "iad"
[build]
  dockerfile = "docker/Dockerfile"
[http_service]
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

```bash
fly apps create penneats
fly secrets set \
  PHOTON_PROJECT_ID=... \
  PHOTON_PROJECT_SECRET=... \
  GEMINI_API_KEY=... \
  GOOGLE_SHEET_ID=... \
  GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
  TZ=America/New_York
fly deploy
fly logs
```

Using `GOOGLE_SERVICE_ACCOUNT_JSON` (full JSON inlined as an env var) avoids baking the service-account file into the image. `app/db/sheets.ts` prefers this env over `GOOGLE_SERVICE_ACCOUNT_PATH` when both are set.

**Alternatives:** Railway, Render, any VPS with Docker. **NOT Vercel / Lambda / Cloudflare Workers** — the scheduler and Spectrum message stream both need persistent compute.

---

## 13. Open questions / v2.1+

Out of scope for v2:
- Multi-timezone users (hard-code `America/New_York`).
- Push notifications other than iMessage (WhatsApp follow-up or email digests).
- Group-chat behavior (DMs only; group messages ignored).
- Re-onboarding / schedule changes via natural language after `done`. (v2.1 — add a "reschedule" intent to the agent.)
- Daily knowledge decay — facts persist until the next day. Older days are retained for history but excluded from the recommendation context.
- User deletion / GDPR flow. (v2.1 — add a `delete_account` keyword.)

---

## 14. Migration / repo cleanup

**Delete from repo** (as part of the implementation plan):
- `agent/` (entire current directory, including `service-account.json` — already gitignored).

**Keep:**
- Root `src/` — the SDK itself stays as-is; still published as `@photon-ai/imessage-kit`.
- `README.md` — rewrite the "Example: PennEats" section to reflect v2 (new architecture, Google Sheets v2 schema, spectrum-ts, deploy instructions).
- `examples/`, `__tests__/` for the root SDK — untouched.

**Add:**
- `app/` (new directory structure above).
- `docker/Dockerfile`.
- `__tests__/fixtures/bonappetit/` + `__tests__/scraper/` + `__tests__/flows/` + `__tests__/scheduler/`.

---

## 15. Acceptance criteria

The implementation is complete when:

1. `bun test` passes — all scraper, flow, and repo tests green.
2. `DESCRIBE_LIVE=1 bun test __tests__/scraper/live.test.ts` passes against live Bon Appétit pages.
3. A fresh Google Sheet, shared with the service account, auto-populates all four tabs with headers on first run.
4. A fresh user can text the bot, complete onboarding in ≤ 5 messages, and see their row in the `users` + `user_schedules` tabs.
5. A scheduled user receives an unsolicited recommendation 20±1 min before a configured meal.
6. Ten minutes after `target_time`, the bot sends a follow-up; the reply is saved to `meal_events` and `daily_knowledge` when public-interest content is present.
7. The Dockerfile builds and runs locally with all env vars set, and a `fly deploy` to a fresh Fly app succeeds.
8. `README.md` PennEats section reflects the new architecture, including the Photon `PATCH /platforms` provisioning step.
