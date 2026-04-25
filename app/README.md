# PennEats v2

Penn Dining iMessage agent — account-based, proactive, learns your schedule.

## Develop

```bash
cd app
bun install
cp .env.example .env      # fill in Photon/Gemini/Sheets creds
bun test                  # offline tests
DESCRIBE_LIVE=1 bun test __tests__/scraper.live.test.ts  # live scraper smoke
bun run dev               # start webhook + scheduler locally
```

## Architecture

- Hono HTTP server + 60s scheduler `setInterval` in one Bun process.
- Google Sheets as durable store (5 tabs: `users`, `schedules`, `meal_events`, `knowledge`, `messages`).
- Bon Appétit menu pages parsed deterministically (no LLM round-trip on the scraper path).
- Gemini 2.5 Flash for the user-facing agent (function-calling) and post-meal tidbit extraction.
- `spectrum-ts` for iMessage send + inbound stream.

## Layout

```
src/
  agent/        # router, runAgent loop, prompts, tools, onboarding/followup flows
  config/       # env loader, venue catalog
  db/           # bootstrap + repos for each tab
  lib/          # handle normalization, time helpers, ranking
  messaging/    # MessageAdapter interface + spectrum/memory implementations
  scheduler/    # 60s tick: pre-meal nudge + post-meal followup
  scraper/      # fetch + Bamco JSON extraction + VenueMenu builder
  index.ts      # entrypoint: HTTP + tick + inbound consumer
```

## Operational notes

- Sheets is read-cached for 15s; writes invalidate per-tab. The scheduler runs in a single
  process — multi-instance deployment would need real locking, not the in-process tick guard.
- The inbound consumer exits on stream failure; Fly's restart policy reconnects.
