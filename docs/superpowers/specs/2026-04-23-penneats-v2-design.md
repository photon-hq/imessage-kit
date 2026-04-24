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
| DB | Supabase (Postgres) | Service-role client from the Node process; RLS on for public readable tables. |
| Runtime | Node.js ≥ 20, long-running process | Dockerfile. Deployable to Fly / Railway / Render / any VM. |
| Tests | `bun test` (already in root repo) | Fixture-driven for scraper; mocks for Gemini in unit tests; live smoke tests gated behind `DESCRIBE_LIVE=1`. |
| Lint/format | Biome (already configured) | — |
| Package layout | New top-level `app/` directory. Retire `agent/`. | The root `src/` (the SDK itself) is untouched. |

**Removed:** `@photon-ai/imessage-kit` runtime dependency for the agent, `googleapis`, Google Sheets, `service-account.json`.

**Env vars:**
```
# spectrum-ts / Photon
PHOTON_PROJECT_ID=...
PHOTON_PROJECT_SECRET=...
SPECTRUM_MODE=cloud          # "cloud" | "local"

# Gemini
GEMINI_API_KEY=AIza...

# Supabase
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

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
│   ├── client.ts                   # Supabase service-role client (singleton)
│   ├── migrations/
│   │   └── 0001_initial.sql        # Tables + indexes + RLS
│   └── repos/
│       ├── users.ts                # profile + onboarding state CRUD
│       ├── schedules.ts            # weekly recurring meal plan CRUD
│       ├── events.ts               # meal_events (recommendations + followups)
│       └── knowledge.ts            # daily_knowledge read/write
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
│   └── tick.test.ts                            # Clock-driven, Supabase-mocked
└── db/
    └── repos.test.ts                           # Against a real local Supabase instance

docker/
└── Dockerfile
```

---

## 4. Data model

All DDL lives in `app/db/migrations/0001_initial.sql`. Applied via Supabase CLI or raw SQL on first deploy.

```sql
-- identity tied to iMessage handle (phone or email) — the only stable user ID
create table users (
  id             uuid primary key default gen_random_uuid(),
  handle         text unique not null,     -- iMessage sender id, normalized
  email          text,
  name           text,
  dietary        text[] not null default '{}',
  timezone       text not null default 'America/New_York',
  onboarding     text not null default 'awaiting_email',
                 -- awaiting_email | awaiting_name | awaiting_halls
                 -- | awaiting_schedule | awaiting_dietary | done
  onboarding_ctx jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on users (handle);

-- recurring weekly meal plan
create table user_schedules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6),
  meal_period     text not null,           -- Breakfast | Brunch | Lunch | Dinner | Late Night
  target_time     time not null,           -- local time the user plans to eat
  preferred_halls text[] not null default '{}',  -- ordered: most preferred first
  unique (user_id, weekday, meal_period)
);
create index on user_schedules (weekday, target_time);

-- every recommendation the bot sent, for idempotency + followup linkage
create table meal_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  schedule_id     uuid references user_schedules(id) on delete set null,
  date            date not null,
  meal_period     text not null,
  target_time     timestamptz not null,    -- absolute instant the user intended to eat
  rec_sent_at     timestamptz,             -- when we sent the pre-meal recommendation
  rec_payload     jsonb,                   -- {halls:[{hall,reason,highlights}], primaryPick}
  chosen_hall     text,                    -- inferred from followup reply
  followup_sent_at timestamptz,            -- when we sent "how was it?"
  followup_reply  text,                    -- the user's raw followup reply
  rating          smallint check (rating between 1 and 5),
  status          text not null default 'scheduled',
                 -- scheduled | recommended | followup_sent | done | skipped
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, date, meal_period)
);
create index on meal_events (status, target_time);
create index on meal_events (user_id, status);

-- consolidated per-day public-interest knowledge base, read by every recommendation
create table daily_knowledge (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  hall            text not null,
  meal_period     text,
  item            text,                    -- specific dish/station if mentioned
  sentiment       smallint check (sentiment between 1 and 5),
  note            text not null,           -- extracted public-interest claim
  source_event_id uuid references meal_events(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index on daily_knowledge (date, hall);
```

### RLS

- `users`, `user_schedules`, `meal_events`: **service-role only** (the Node process is the only client).
- `daily_knowledge`: service-role write; **public read** allowed (so the knowledge DB is browsable; repo is public anyway). No PII in this table.

### Handle privacy

v1 hashed phone numbers via SHA-256 and relied on an out-of-band `phoneMap` to restore them on restart — this made the proactive recommendation flow impossible because we can't message a hash. v2 stores handles in plaintext, under RLS, with service-role-only access. A note in the README calls this out: the handle is plaintext because the bot needs to message you back.

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

One `setInterval(SCHEDULER_TICK_MS)` loop (60s default) in `scheduler/tick.ts`. Each tick does two queries in parallel:

### 7a. Due recommendations

`$today_weekday` and `$now_*` are computed in `America/New_York` (the canonical user timezone for v2).

```sql
-- Users whose next scheduled meal starts in 19–21 minutes from now
-- AND either no meal_events row exists yet, OR a prior tick inserted a row but
-- the send crashed before completion (status='scheduled' AND rec_sent_at IS NULL)
select u.id, u.handle, u.dietary, s.id as schedule_id,
       s.meal_period, s.preferred_halls, s.target_time,
       e.id as existing_event_id
from user_schedules s
join users u on u.id = s.user_id
left join meal_events e
  on e.user_id = u.id and e.date = $today and e.meal_period = s.meal_period
where u.onboarding = 'done'
  and s.weekday = $today_weekday
  and s.target_time between $now_plus_19min_local and $now_plus_21min_local
  and (
    e.id is null
    or (e.status = 'scheduled' and e.rec_sent_at is null)
  );
```

For each row:
1. If `existing_event_id IS NULL`: insert `meal_events (user_id, schedule_id, date, meal_period, target_time, status='scheduled')` — the `unique (user_id, date, meal_period)` constraint makes the insert racelessly atomic.
2. Call `flows/recommend.ts`. On success it updates the row to `status='recommended'`, `rec_sent_at=now()`, `rec_payload=…`. On failure it leaves the row at `status='scheduled', rec_sent_at=NULL` — a subsequent tick picks it up again via the second `OR` branch above.
3. Retry limit: if `target_time` has passed and the row is still `scheduled`, the scheduler sets `status='skipped'` rather than sending a now-stale rec.

### 7b. Due followups

```sql
-- Events where meal started 10-30 min ago and followup not yet sent
select * from meal_events
where status = 'recommended'
  and target_time between now() - interval '30 min' and now() - interval '10 min'
  and followup_sent_at is null;
```

For each: `flows/followup.ts` sends the "how was it?" probe → `status='followup_sent'`, `followup_sent_at=now()`.

### 7c. Stale-row cleanup

```sql
-- Recommendations that never went out because the pre-meal window passed
update meal_events
set status = 'skipped', updated_at = now()
where status = 'scheduled'
  and rec_sent_at is null
  and target_time < now() - interval '5 min';
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

`docker/Dockerfile`:
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app
COPY app/ /app/
RUN bun install --production
CMD ["bun", "run", "index.ts"]
```

Platforms: Fly.io (recommended — long-running processes, simple Dockerfile deploy), Railway, Render, or any VM. `README.md` for `app/` lists Fly setup steps.

Supabase migrations applied via `supabase db push` or manual SQL once.

**NOT Vercel.** Vercel serverless functions can't hold a long-running message stream or a `setInterval` scheduler.

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
- `README.md` — rewrite the "Example: PennEats" section to reflect v2 (new architecture, Supabase, spectrum-ts, deploy instructions).
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
3. A fresh user can text the bot, complete onboarding in ≤ 5 messages, and see their row in `users` + `user_schedules`.
4. A scheduled user receives an unsolicited recommendation 20±1 min before a configured meal.
5. Ten minutes after `target_time`, the bot sends a follow-up; the reply is saved to `meal_events` and `daily_knowledge` when public-interest content is present.
6. The Dockerfile builds and runs locally with all env vars set.
7. `README.md` PennEats section reflects the new architecture.
