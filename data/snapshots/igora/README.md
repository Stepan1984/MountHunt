# Igora HTML snapshots

Offline / fail-soft fallback for the Igora scraper when live Playwright cannot complete
(e.g. truncated TCP from some networks). Captured from public pages / Wayback `id_` copies.

Use:

```bash
IGORA_HTML_DIR=data/snapshots/igora npm run scrape -- --only=igora --dry-run
```

Daily Actions prefers live Playwright (`npx playwright install chromium`); snapshots are not
used unless `IGORA_HTML_DIR` is set.
