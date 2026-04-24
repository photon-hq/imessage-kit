# PennEats v2

Penn Dining iMessage agent — account-based, proactive, learns your schedule.

## Develop

```bash
cd app
bun install
cp ../.env.example .env   # fill in Spectrum/Gemini/Sheets creds
bun test                  # offline tests
DESCRIBE_LIVE=1 bun test __tests__/scraper.live.test.ts  # live scraper smoke
bun run dev               # start webhook + scheduler locally
```

## Architecture

- Hono webhook + 60s scheduler `setInterval` in one process
- Google Sheets as durable store (4 tabs: users/schedules/meal_events/knowledge)
- Gemini 2.5 Flash for: menu extraction, tidbit extraction, free-text agent
- spectrum-ts for iMessage send + inbound webhook

See the design doc: [docs/superpowers/specs/2026-04-23-penneats-v2-design.md](../docs/superpowers/specs/2026-04-23-penneats-v2-design.md)
