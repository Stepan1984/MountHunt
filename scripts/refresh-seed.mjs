#!/usr/bin/env node
/**
 * Подготовка public/data перед сборкой Pages:
 * - копирует/чинит seed-каталог курортов;
 * - дополняет hours/prices/important заглушками только для новых id;
 * - НЕ затирает meta.json от scrape job (source scrape-*).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const seedCandidates = [
  join(root, 'data', 'seed', 'resorts.json'),
  join(root, 'public', 'data', 'resorts.json'),
]

mkdirSync(outDir, { recursive: true })

const seedPath = seedCandidates.find((p) => existsSync(p))
if (!seedPath) {
  console.error('Не найден seed resorts.json')
  process.exit(1)
}

/** Seed corrections that should always land in public/data. */
function applySeedFixes(resorts) {
  return resorts.map((r) => {
    if (r.id === 'igora') {
      return {
        ...r,
        sources: [...new Set((r.sources || []).map((s) => s.replace('/en/working-hours/', '/working-hours/')))],
      }
    }
    if (r.id !== 'krasnoe-ozero') return r
    return {
      ...r,
      webcam_url: 'https://krasnoeozero.ru/cam/',
      prices_format: 'csv',
      sources: [...new Set(['https://krasnoeozero.ru/', 'https://krasnoeozero.ru/cam/', ...(r.sources || [])])].filter(
        (s) => !/cam\.html/.test(s),
      ),
    }
  })
}

const resorts = applySeedFixes(JSON.parse(readFileSync(seedPath, 'utf8')))
writeFileSync(join(outDir, 'resorts.json'), `${JSON.stringify(resorts, null, 2)}\n`)
writeFileSync(seedPath, `${JSON.stringify(resorts, null, 2)}\n`)

const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

function ensureHours() {
  const path = join(outDir, 'hours.json')
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const byId = new Map(existing.map((h) => [h.resortId, h]))
  const next = resorts.map((r) => {
    const prev = byId.get(r.id)
    if (prev) {
      let summary = prev.summary
      let sourceUrl = prev.sourceUrl
      // Keep scrape data; scrub raw URLs / EN paths from visitor-facing summary.
      if (typeof summary === 'string') {
        summary = summary
          .replaceAll('https://igora.ru/en/working-hours/', 'https://igora.ru/working-hours/')
          .replace(
            /Часы склонов уточняйте на https?:\/\/igora\.ru\/(?:en\/)?working-hours\/?/gi,
            'Нет данных о часах склонов',
          )
          .replace(
            /Режим склонов уточняйте на главной snegny\.ru[^.!]*/gi,
            'Нет данных о режиме склонов',
          )
          .replace(/\s*[—–\-;:]?\s*[^.—–;:\n]*уточняйте[^.\n]*/gi, '')
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/\s+([.,;:!?])/g, '$1')
          .trim()
        if (!summary) summary = 'Нет данных о часах'
      }
      if (typeof sourceUrl === 'string') {
        sourceUrl = sourceUrl.replace('/en/working-hours/', '/working-hours/')
      }
      if (summary !== prev.summary || sourceUrl !== prev.sourceUrl) {
        return { ...prev, summary, sourceUrl }
      }
      return prev
    }
    return {
      resortId: r.id,
      scrapedAt: null,
      sourceUrl: r.website ?? null,
      summary: 'Часы работы появятся после ежедневного обновления данных',
      periods: [],
      status: 'pending',
    }
  })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
}

function ensurePrices() {
  const path = join(outDir, 'prices.json')
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const byId = new Map(existing.map((p) => [p.resortId, p]))
  const next = resorts.map((r) => {
    if (r.booking_url) {
      return {
        resortId: r.id,
        scrapedAt: null,
        sourceUrl: r.booking_url,
        currency: 'RUB',
        items: [],
        status: 'unavailable',
        note: 'Цены на странице не публикуем — бронирование и оплата по ссылке на сайте курорта',
      }
    }
    const prev = byId.get(r.id)
    if (prev) return prev
    return {
      resortId: r.id,
      scrapedAt: null,
      sourceUrl: r.prices_url || r.website || null,
      currency: 'RUB',
      items: [],
      status: 'pending',
      note: 'Цены пока не собраны — смотрите на официальном сайте курорта',
    }
  })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
}

function ensureImportant() {
  const path = join(outDir, 'important.json')
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify([], null, 2)}\n`)
    return
  }
  // Do not invent chrome notes on every deploy; leave file as committed.
}

function writeMeta() {
  const path = join(outDir, 'meta.json')
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, 'utf8'))
    const source = String(existing.source || '')
    // Preserve scrape job metadata (and any non-seed snapshot).
    if (source.startsWith('scrape') || source === 'manual' || existing.resortsScraped) {
      console.log(`meta.json сохранён (source=${source})`)
      return
    }
  }

  writeFileSync(
    path,
    `${JSON.stringify(
      {
        updatedAt: now,
        source: 'seed-refresh',
        note: 'Каталог курортов из seed. Цены и часы — из последнего scrape в public/data (если есть).',
      },
      null,
      2,
    )}\n`,
  )
}

ensureHours()
ensurePrices()
ensureImportant()
writeMeta()

console.log(`Обновлено ${resorts.length} курортов → public/data`)
