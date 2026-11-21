#!/usr/bin/env node
/**
 * Lightweight «Важное» scrape (every ~2 hours).
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
  detectLazurnyeImportant,
  detectOkhtaImportant,
  detectZoldolImportant,
  importantItem,
  mergeImportantFailSoft,
} from './scrape/lib/important.mjs'
import { nowIso } from './scrape/lib/parse.mjs'
import {
  KRASNOE_HOURS_CSV_URL,
  parseHoursFromCsv,
} from './scrape/resorts/krasnoe-ozero.mjs'
import { LAZURNYE_HOME_URL } from './scrape/resorts/lazurnye-ozera.mjs'
import { OKHTA_TRAILS_URL, OKHTA_WINTER_URL } from './scrape/resorts/okhta-park.mjs'
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
      const { body, lastModified } = await fetchUrlResult(LAZURNYE_HOME_URL)
      return detectLazurnyeImportant(body, LAZURNYE_HOME_URL, { lastModified })
    },
  },
  {
    id: 'krasnoe-ozero',
    async run() {
      const { body } = await fetchUrlResult(KRASNOE_HOURS_CSV_URL)
      // publishedAt comes from the CSV date column inside the detector.
      return parseHoursFromCsv(body).important || []
    },
  },
  {
    id: 'okhta-park',
    async run() {
      const { body, lastModified } = await fetchUrlResult(OKHTA_TRAILS_URL)
      return detectOkhtaImportant(body, OKHTA_WINTER_URL, { lastModified })
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
      const items = await checker.run()
      const ms = Date.now() - started
      console.log(`ok (${ms}ms) items=${items.length}`)
      results.push({ resortId: checker.id, ok: true, items })
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
    body: 'Цены и часы — ежедневно; блок «Важное» — примерно каждые 2 часа с официальных страниц курортов. Это не оферта — перед выездом сверяйте с сайтом курорта.',
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
