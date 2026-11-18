# Igora HTML snapshots

Offline / fail-soft fallback for the Igora scraper when live Playwright cannot complete
(e.g. truncated TCP from some networks). Captured from public pages / Wayback `id_` copies.

## Usage (opt-in only)

```bash
# Explicit snapshot dir (local dry-run / debugging)
IGORA_HTML_DIR=data/snapshots/igora npm run scrape -- --only=igora --dry-run

# Or allow bundled fallback after live Playwright/fetch fail
IGORA_ALLOW_SNAPSHOT=1 npm run scrape -- --only=igora --dry-run
```

## CI policy

Daily Actions **must not** set `IGORA_HTML_DIR` or `IGORA_ALLOW_SNAPSHOT`.
Live Playwright is the only production refresh path; snapshot-sourced prices stay
`status: partial` with an explicit note when used locally.

Refresh these HTML files periodically (manual) when the live `/price/` / `/cam/`
DOM structure changes — they are not auto-updated by the scrape job.
