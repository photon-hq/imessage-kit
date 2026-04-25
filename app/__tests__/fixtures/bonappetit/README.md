# Bon Appétit HTML fixtures

Captured on 2026-04-24 against `university-of-pennsylvania.cafebonappetit.com`.

Used by `app/__tests__/scraper.extractBamcoBlob.test.ts` and
`app/__tests__/scraper.gemini.test.ts` as stable input for offline tests.

To refresh, pick a date (YYYY-MM-DD) and re-run from the repo root:

```bash
DATE=2026-04-24
for VENUE in 1920-commons hill-house falk-kosher-dining; do
  OUT=$(echo "$VENUE" | sed 's/-dining//')
  curl -s "https://university-of-pennsylvania.cafebonappetit.com/cafe/$VENUE/?date=$DATE" \
    -o "app/__tests__/fixtures/bonappetit/$OUT-$DATE.html"
done
```

If the HTML structure changes materially, the extractor tests will fail —
update the fixtures and the extractor together.
