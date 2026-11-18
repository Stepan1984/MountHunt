#!/usr/bin/env node
/**
 * Заглушка ежедневного обновления данных.
 * Сейчас копирует seed-каталог курортов в public/data и обновляет meta.json.
 * Позже сюда подключатся парсеры цен/часов (cheerio / playwright).
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
    if (prev) return prev
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
    writeFileSync(
      path,
      `${JSON.stringify(
        [
          {
            id: 'mvp-data-note',
            title: 'Данные в режиме подготовки',
            body: 'Цены и часы работы появятся после запуска ежедневного сбора с официальных сайтов.',
            severity: 'info',
            updatedAt: now,
          },
        ],
        null,
        2,
      )}\n`,
    )
  }
}

writeFileSync(
  join(outDir, 'meta.json'),
  `${JSON.stringify(
    {
      updatedAt: now,
      source: 'seed-refresh',
      note: 'Заглушка CI: seed скопирован в public/data. Парсеры ещё не подключены.',
    },
    null,
    2,
  )}\n`,
)

ensureHours()
ensurePrices()
ensureImportant()

console.log(`Обновлено ${resorts.length} курортов → public/data (meta ${now})`)
