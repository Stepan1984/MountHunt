#!/usr/bin/env node
/**
 * Заглушка ежедневного обновления данных.
 * Сейчас копирует seed-каталог курортов в public/data и обновляет meta.json.
 * Позже сюда подключатся парсеры цен/часов (cheerio / playwright).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

const resorts = JSON.parse(readFileSync(seedPath, 'utf8'))
copyFileSync(seedPath, join(outDir, 'resorts.json'))

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
