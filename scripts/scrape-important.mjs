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
import {
  detectChannelNewsFromTelegram,
  fetchResortChannelNews,
  RESORT_CHANNEL_SOURCES,
} from './scrape/lib/channel-news.mjs'
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
import { enrichHoursFromImportant } from './scrape/lib/news-hours.mjs'
import { nowIso } from './scrape/lib/parse.mjs'
import {
  KRASNOE_HOURS_CSV_URL,
  fetchKrasnoeTelegramImportant,
  parseHoursFromCsv,
} from './scrape/resorts/krasnoe-ozero.mjs'
import { DROP_PAGE_URL, DROP_TG_URL } from './scrape/resorts/drop-park.mjs'
import {
  PUTILOVO_TG_URL,
  fetchPutilovoTelegramImportant,
} from './scrape/resorts/putilovo-park.mjs'
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

/** @param {string} resortId */
function channelSource(resortId) {
  return RESORT_CHANNEL_SOURCES.find((s) => s.resortId === resortId) || null
}

/**
 * Append TG/VK channel cards; fail-soft. Site texts help dedupe against lenta/news.
 * @param {string} resortId
 * @param {object[]} siteItems
 * @param {string[]} [siteNewsTexts]
 */
async function withChannelNews(resortId, siteItems, siteNewsTexts = []) {
  const src = channelSource(resortId)
  if (!src) return { items: siteItems, clearPrefixes: true }
  await sleep()
  const ch = await fetchResortChannelNews(src, { siteNewsTexts })
  return {
    items: [...siteItems, ...ch.items],
    clearPrefixes: ch.clearPrefixes,
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const importantPath = join(outDir, 'important.json')
const hoursPath = join(outDir, 'hours.json')
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

/** @type {{ id: string, run: () => Promise<object[] | { items: object[], clearPrefixes?: boolean }> }[]} */
const CHECKERS = [
  {
    id: 'zolotaya-dolina',
    async run() {
      const { body, lastModified } = await fetchUrlResult(ZOLDOL_HOURS_URL)
      const site = detectZoldolImportant(body, ZOLDOL_HOURS_URL, { lastModified })
      return withChannelNews('zolotaya-dolina', site)
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
      const site = detectLazurnyeImportantFromPages(
        { homeHtml: home.body, newsHtml: newsBody },
        LAZURNYE_HOME_URL,
        {
          lastModified: home.lastModified,
          homeUrl: LAZURNYE_HOME_URL,
          newsUrl: LAZURNYE_NEWS_URL,
        },
      )
      const siteTexts = site.map((i) => `${i.title || ''} ${i.body || ''}`)
      return withChannelNews('lazurnye-ozera', site, siteTexts)
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
      const siteTexts = [...csvItems, ...tgItems].map((i) => `${i.title || ''} ${i.body || ''}`)
      // Specialized TG already ran; channel helper adds VK only (skipTelegram).
      const packed = await withChannelNews(
        'krasnoe-ozero',
        [...csvItems, ...tgItems],
        siteTexts,
      )
      return {
        items: packed.items,
        clearPrefixes: tgFetched && packed.clearPrefixes,
      }
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
      const site = detectOkhtaImportant(
        { trailsHtml: trails.body, lentaHtml: lentaBody },
        OKHTA_TRAILS_URL,
        {
          lastModified: trails.lastModified || lentaModified,
          trailsUrl: OKHTA_TRAILS_URL,
          lentaUrl: OKHTA_LENTA_URL,
          winterUrl: OKHTA_WINTER_URL,
        },
      )
      const siteTexts = site.map((i) => `${i.title || ''} ${i.body || ''}`)
      return withChannelNews('okhta-park', site, siteTexts)
    },
  },
  {
    id: 'tuutari-park',
    async run() {
      const { body, lastModified } = await fetchUrlResult(TUUTARI_NEWS_URL)
      const site = detectTuutariImportant(body, TUUTARI_NEWS_URL, { lastModified })
      const siteTexts = site.map((i) => `${i.title || ''} ${i.body || ''}`)
      return withChannelNews('tuutari-park', site, siteTexts)
    },
  },
  {
    id: 'snezhny',
    async run() {
      const { body, lastModified } = await fetchUrlResult(SNEZHNY_NEWS_URL)
      const site = detectSnezhnyImportant(body, SNEZHNY_NEWS_URL, { lastModified })
      const siteTexts = site.map((i) => `${i.title || ''} ${i.body || ''}`)
      return withChannelNews('snezhny', site, siteTexts)
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
      // Fail-soft only when detector has no authored/live open signal.
      if (!ok) {
        throw new Error(
          !pageFetched && !tgFetched
            ? 'Drop Park: page and TG unavailable'
            : 'Drop Park: TG unavailable; keeping previous Important',
        )
      }
      const dropSrc = channelSource('drop-park')
      const channelItems =
        tgFetched && dropSrc
          ? detectChannelNewsFromTelegram(tgBody, {
              resortId: dropSrc.resortId,
              resortName: dropSrc.name,
              idPrefix: dropSrc.idPrefix,
              siteNewsTexts: items.map((i) => `${i.title || ''} ${i.body || ''}`),
            })
          : []
      return {
        items: [...items, ...channelItems],
        clearPrefixes: tgFetched,
      }
    },
  },
  {
    id: 'puhtolova-gora',
    async run() {
      const { body, lastModified } = await fetchUrlResult(PUHT_NEWS_URL)
      const site = detectPuhtolovaImportant(body, PUHT_NEWS_URL, { lastModified })
      const siteTexts = site.map((i) => `${i.title || ''} ${i.body || ''}`)
      return withChannelNews('puhtolova-gora', site, siteTexts)
    },
  },
  {
    id: 'putilovo-park',
    async run() {
      const tg = await fetchPutilovoTelegramImportant()
      if (!tg.tgFetched) {
        throw new Error(`Putilovo: TG preview unavailable (${PUTILOVO_TG_URL})`)
      }
      return { items: tg.items, clearPrefixes: true }
    },
  },
  {
    id: 'igora',
    async run() {
      const src = channelSource('igora')
      if (!src) return []
      const ch = await fetchResortChannelNews(src)
      return { items: ch.items, clearPrefixes: ch.clearPrefixes }
    },
  },
  {
    id: 'severny-sklon',
    async run() {
      const src = channelSource('severny-sklon')
      if (!src) return []
      const ch = await fetchResortChannelNews(src)
      return { items: ch.items, clearPrefixes: ch.clearPrefixes }
    },
  },
  {
    id: 'yukki',
    async run() {
      const src = channelSource('yukki')
      if (!src) return []
      const ch = await fetchResortChannelNews(src)
      return { items: ch.items, clearPrefixes: ch.clearPrefixes }
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
    body: 'Цены и часы — дважды в день (около 10:00 и 22:00 МСК); блок «Важное» — примерно каждый час с официальных страниц курортов.',
    severity: 'info',
  })

  const important = mergeImportantFailSoft(prevImportant, results, { chromeNote })
  const prevHours = readJson(hoursPath, [])
  const hours = enrichHoursFromImportant(prevHours, important)
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
    console.log(
      JSON.stringify(
        {
          results,
          important,
          hoursNewsSynced: hours.filter((h) => h.hoursNote).map((h) => h.resortId),
          meta,
        },
        null,
        2,
      ),
    )
    return
  }

  writeJson(importantPath, important)
  writeJson(hoursPath, hours)
  writeJson(metaPath, meta)

  console.log(`\nЗаписано ${importantPath} · ${important.length} пунктов · ${scrapedAt}`)
  console.log(`Часы из новостей: обновлено курортов ${hours.filter((h) => h.hoursNote).length}`)
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
