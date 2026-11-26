#!/usr/bin/env node
/**
 * Lightweight «Важное» / news scrape (hourly).
 *
 * Fetches only notice-relevant pages (no Playwright / OCR / full prices).
 * Fail-soft: per-resort errors keep previous managed items; job exits 0 unless
 * it cannot read/write public/data.
 *
 * Usage:
 *   npm run scrape:important
 *   npm run scrape:important -- --dry-run
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELAY_MS, fetchUrlResult, sleep } from './scrape/lib/http.mjs'
import {
  detectDropParkImportant,
  detectLazurnyeImportantFromPages,
  detectOkhtaImportant,
  detectPuhtolovaImportant,
  detectSnezhnyImportant,
  detectTuutariImportant,
  detectZoldolImportant,
  importantItem,
  mergeImportantFailSoft,
} from './scrape/lib/important.mjs'
import { nowIso } from './scrape/lib/parse.mjs'
import {
  KRASNOE_HOURS_CSV_URL,
  fetchKrasnoeTelegramImportant,
  parseHoursFromCsv,
} from './scrape/resorts/krasnoe-ozero.mjs'
import { DROP_PAGE_URL, DROP_TG_URL } from './scrape/resorts/drop-park.mjs'
import { LAZURNYE_HOME_URL, LAZURNYE_NEWS_URL } from './scrape/resorts/lazurnye-ozera.mjs'
import {
  OKHTA_LENTA_URL,
  OKHTA_TRAILS_URL,
  OKHTA_WINTER_URL,
} from './scrape/resorts/okhta-park.mjs'
import { PUHT_NEWS_URL } from './scrape/resorts/puhtolova-gora.mjs'
import { SNEZHNY_NEWS_URL } from './scrape/resorts/snezhny.mjs'
import { TUUTARI_NEWS_URL } from './scrape/resorts/tuutari-park.mjs'
import { ZOLDOL_HOURS_URL } from './scrape/resorts/zolotaya-dolina.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const importantPath = join(outDir, 'important.json')
const metaPath = join(outDir, 'meta.json')

function parseArgs(argv) {
  const args = { dryRun: false }
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true
  }
  return args
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

/** @type {{ id: string, run: () => Promise<object[]> }[]} */
const CHECKERS = [
  {
    id: 'zolotaya-dolina',
    async run() {
      const { body, lastModified } = await fetchUrlResult(ZOLDOL_HOURS_URL)
      return detectZoldolImportant(body, ZOLDOL_HOURS_URL, { lastModified })
    },
  },
  {
    id: 'lazurnye-ozera',
    async run() {
      const home = await fetchUrlResult(LAZURNYE_HOME_URL)
      let newsBody = ''
      try {
        await sleep()
        newsBody = (await fetchUrlResult(LAZURNYE_NEWS_URL)).body
      } catch {
        newsBody = ''
      }
      return detectLazurnyeImportantFromPages(
        { homeHtml: home.body, newsHtml: newsBody },
        LAZURNYE_HOME_URL,
        {
          lastModified: home.lastModified,
          homeUrl: LAZURNYE_HOME_URL,
          newsUrl: LAZURNYE_NEWS_URL,
        },
      )
    },
  },
  {
    id: 'krasnoe-ozero',
    async run() {
      const { body } = await fetchUrlResult(KRASNOE_HOURS_CSV_URL)
      // publishedAt comes from the CSV date column inside the detector.
      const csvItems = parseHoursFromCsv(body).important || []
      let tgItems = []
      let tgFetched = false
      try {
        await sleep()
        const tg = await fetchKrasnoeTelegramImportant()
        tgItems = tg.items
        tgFetched = tg.tgFetched
      } catch {
        tgItems = []
        tgFetched = false
      }
      return { items: [...csvItems, ...tgItems], clearPrefixes: tgFetched }
    },
  },
  {
    id: 'okhta-park',
    async run() {
      const trails = await fetchUrlResult(OKHTA_TRAILS_URL)
      let lentaBody = ''
      let lentaModified = null
      try {
        await sleep()
        const lenta = await fetchUrlResult(OKHTA_LENTA_URL)
        lentaBody = lenta.body
        lentaModified = lenta.lastModified
      } catch {
        // Fail-soft: trails page alone still carries opening banners.
      }
      return detectOkhtaImportant(
        { trailsHtml: trails.body, lentaHtml: lentaBody },
        OKHTA_TRAILS_URL,
        {
          lastModified: trails.lastModified || lentaModified,
          trailsUrl: OKHTA_TRAILS_URL,
          lentaUrl: OKHTA_LENTA_URL,
          winterUrl: OKHTA_WINTER_URL,
        },
      )
    },
  },
  {
    id: 'tuutari-park',
    async run() {
      const { body, lastModified } = await fetchUrlResult(TUUTARI_NEWS_URL)
      return detectTuutariImportant(body, TUUTARI_NEWS_URL, { lastModified })
    },
  },
  {
    id: 'snezhny',
    async run() {
      const { body, lastModified } = await fetchUrlResult(SNEZHNY_NEWS_URL)
      return detectSnezhnyImportant(body, SNEZHNY_NEWS_URL, { lastModified })
    },
  },
  {
    id: 'drop-park',
    async run() {
      let pageBody = ''
      let pageModified = null
      let pageFetched = false
      try {
        const page = await fetchUrlResult(DROP_PAGE_URL)
        pageBody = page.body
        pageModified = page.lastModified
        pageFetched = true
      } catch {
        pageBody = ''
      }
      let tgBody = ''
      let tgFetched = false
      try {
        await sleep()
        tgBody = (await fetchUrlResult(DROP_TG_URL)).body
        tgFetched = true
      } catch {
        tgBody = ''
      }
      const { items, ok } = detectDropParkImportant(
        { pageHtml: pageBody, tgHtml: tgBody },
        DROP_TG_URL,
        {
          pageUrl: DROP_PAGE_URL,
          tgUrl: DROP_TG_URL,
          lastModified: pageModified,
          pageFetched,
          tgFetched,
        },
      )
      // Fail-soft: empty match without TG must not clear drop-off-season.
      if (!ok) {
        throw new Error(
          !pageFetched && !tgFetched
            ? 'Drop Park: page and TG unavailable'
            : 'Drop Park: TG unavailable; keeping previous Important',
        )
      }
      return items
    },
  },
  {
    id: 'puhtolova-gora',
    async run() {
      const { body, lastModified } = await fetchUrlResult(PUHT_NEWS_URL)
      return detectPuhtolovaImportant(body, PUHT_NEWS_URL, { lastModified })
    },
  },
]

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(outDir, { recursive: true })

  const prevImportant = readJson(importantPath, [])
  const prevMeta = readJson(metaPath, {})

  console.log(`MountHunt important scrape · delay ${DELAY_MS}ms · targets: ${CHECKERS.map((c) => c.id).join(', ')}`)

  const results = []
  for (let i = 0; i < CHECKERS.length; i++) {
    const checker = CHECKERS[i]
    process.stdout.write(`→ ${checker.id} … `)
    const started = Date.now()
    try {
      const raw = await checker.run()
      const pack =
        raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.items)
          ? raw
          : { items: Array.isArray(raw) ? raw : [], clearPrefixes: true }
      const ms = Date.now() - started
      console.log(`ok (${ms}ms) items=${pack.items.length}`)
      results.push({
        resortId: checker.id,
        ok: true,
        items: pack.items,
        clearPrefixes: pack.clearPrefixes !== false,
      })
    } catch (err) {
      const ms = Date.now() - started
      const message = String(err?.message || err)
      console.log(`FAIL (${ms}ms) err=${message}`)
      results.push({ resortId: checker.id, ok: false, items: [], error: message })
    }
    if (i < CHECKERS.length - 1) await sleep()
  }

  const chromeNote = importantItem({
    id: 'mvp-data-note',
    title: 'Данные обновляются регулярно',
    body: 'Цены и часы — дважды в день (около 10:00 и 22:00 МСК); блок «Важное» — примерно каждый час с официальных страниц курортов. Это не оферта — перед выездом сверяйте с сайтом курорта.',
    severity: 'info',
  })

  const important = mergeImportantFailSoft(prevImportant, results, { chromeNote })
  const okCount = results.filter((r) => r.ok).length
  const failCount = results.length - okCount
  const scrapedAt = nowIso()

  const baseNote =
    typeof prevMeta.note === 'string'
      ? prevMeta.note.replace(/\s*·\s*Важное\s+\d{4}-\d{2}-\d{2}T[^\s·]*/g, '').trim()
      : ''
  const meta = {
    ...prevMeta,
    importantScrapedAt: scrapedAt,
    importantNote: `Важное: ok ${okCount}, fail ${failCount}`,
    // Keep daily scrape source if present; annotate important refresh.
    source: prevMeta.source?.startsWith('scrape')
      ? prevMeta.source
      : prevMeta.source || 'scrape-important',
    note: baseNote
      ? `${baseNote} · Важное ${scrapedAt}`
      : `Важное обновлено ${scrapedAt}`,
  }

  if (args.dryRun) {
    console.log('\n[dry-run] файлы не записаны')
    console.log(JSON.stringify({ results, important, meta }, null, 2))
    return
  }

  writeJson(importantPath, important)
  writeJson(metaPath, meta)

  console.log(`\nЗаписано ${importantPath} · ${important.length} пунктов · ${scrapedAt}`)
  console.log(
    `Успешно: ${results.filter((r) => r.ok).map((r) => r.resortId).join(', ') || '—'}`,
  )
  console.log(
    `Failed (kept previous): ${results.filter((r) => !r.ok).map((r) => r.resortId).join(', ') || '—'}`,
  )
}

main().catch((err) => {
  console.error(err)
  // Only hard-fail on unexpected orchestration errors (I/O etc.).
  process.exit(1)
})
