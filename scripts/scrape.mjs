#!/usr/bin/env node
/**
 * MountHunt daily scrape — wave 1 (P1) + wave 2 (P2).
 *
 * Usage:
 *   npm run scrape
 *   npm run scrape -- --dry-run          # scrape but do not write files
 *   npm run scrape -- --only=tuutari-park,snezhny
 *   npm run scrape -- --wave=2           # only wave 2 targets
 *   SCRAPE_DELAY_MS=2000 npm run scrape
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELAY_MS, sleep } from './scrape/lib/http.mjs'
import { mergeSnapshot, nowIso } from './scrape/lib/parse.mjs'
import { scrapeTuutari } from './scrape/resorts/tuutari-park.mjs'
import { scrapeZolotayaDolina } from './scrape/resorts/zolotaya-dolina.mjs'
import { scrapeLazurnyeOzera } from './scrape/resorts/lazurnye-ozera.mjs'
import { scrapePuhtolovaGora } from './scrape/resorts/puhtolova-gora.mjs'
import { scrapeYukki } from './scrape/resorts/yukki.mjs'
import { scrapeKrasnoeOzero } from './scrape/resorts/krasnoe-ozero.mjs'
import { scrapeSnezhny } from './scrape/resorts/snezhny.mjs'
import { scrapeDropPark } from './scrape/resorts/drop-park.mjs'
import { scrapeOkhtaPark } from './scrape/resorts/okhta-park.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'data')
const seedPath = join(root, 'data', 'seed', 'resorts.json')

const PARSERS = {
  'tuutari-park': scrapeTuutari,
  'zolotaya-dolina': scrapeZolotayaDolina,
  'lazurnye-ozera': scrapeLazurnyeOzera,
  'puhtolova-gora': scrapePuhtolovaGora,
  yukki: scrapeYukki,
  'krasnoe-ozero': scrapeKrasnoeOzero,
  snezhny: scrapeSnezhny,
  'drop-park': scrapeDropPark,
  'okhta-park': scrapeOkhtaPark,
}

const WAVE1 = ['tuutari-park', 'zolotaya-dolina', 'lazurnye-ozera', 'puhtolova-gora', 'yukki']
const WAVE2 = ['krasnoe-ozero', 'snezhny', 'drop-park', 'okhta-park']

function parseArgs(argv) {
  const args = { dryRun: false, only: null, skipOptional: false, wave: null }
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--skip-optional') args.skipOptional = true
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean)
    else if (a.startsWith('--wave=')) args.wave = a.slice(7).trim()
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

function blankPrice(resortId, resorts) {
  const r = resorts.find((x) => x.id === resortId)
  return {
    resortId,
    scrapedAt: null,
    sourceUrl: r?.prices_url || r?.website || null,
    currency: 'RUB',
    items: [],
    status: 'pending',
    note: 'Цены пока не собраны — смотрите на официальном сайте курорта',
  }
}

function blankHours(resortId, resorts) {
  const r = resorts.find((x) => x.id === resortId)
  return {
    resortId,
    scrapedAt: null,
    sourceUrl: r?.website ?? null,
    summary: 'Часы работы появятся после ежедневного обновления данных',
    periods: [],
    status: 'pending',
  }
}

function applySeedFixes(resorts) {
  const patches = {
    'krasnoe-ozero': {
      webcam_url: 'https://krasnoeozero.ru/cam/',
      prices_format: 'csv',
      sourcesAdd: ['https://krasnoeozero.ru/', 'https://krasnoeozero.ru/cam/', 'https://krasnoeozero.ru/grafik/'],
      sourcesDrop: [/cam\.html/],
      notes:
        'Крупнейший курорт кластера Коробицыно; ~13–18 трасс; цены и график из публичных CSV виджетов.',
    },
    'lazurnye-ozera': {
      webcam_url: 'https://lazoorsnow.ru/',
      prices_format: 'html',
      prices_url: 'https://lazoorsnow.ru/ceny',
      sourcesAdd: ['https://lazoorsnow.ru/ceny'],
    },
    'puhtolova-gora': {
      prices_format: 'html',
      prices_url: 'https://puhgora.ru/uslugi/ceny-na-podyomniki',
      sourcesAdd: ['https://puhgora.ru/uslugi/ceny-na-podyomniki'],
    },
    yukki: {
      prices_format: 'pdf',
      notes:
        'ГАУ ЛО СТЦ; учебный и основные склоны; VK https://vk.com/skyukki. Координаты приблизительные. Цены — PDF-прейскурант.',
    },
    snezhny: {
      prices_format: 'html',
      prices_url: 'https://snegny.ru/ски-пассы/',
      webcam_url: 'https://snegny.ru/',
      sourcesAdd: [
        'https://snegny.ru/ски-пассы/',
        'https://snegny.ru/wp-content/themes/snegny/twocam.php',
      ],
    },
    'drop-park': {
      prices_format: 'html',
      prices_url: 'https://drop-park.ru/snow-park',
      webcam_url: 'https://drop-park.ru/snow-park',
      sourcesAdd: ['https://drop-park.ru/snow-park'],
    },
    'okhta-park': {
      prices_format: 'html_mixed',
      prices_url: 'https://winter.ohtapark.ru/',
      webcam_url: 'https://www.ohtapark.ru/webcam/',
      sourcesAdd: [
        'https://winter.ohtapark.ru/',
        'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/',
        'https://www.ohtapark.ru/webcam/',
      ],
    },
  }
  return resorts.map((r) => {
    const p = patches[r.id]
    if (!p) return r
    const fixed = { ...r, ...Object.fromEntries(Object.entries(p).filter(([k]) => !['sourcesAdd', 'sourcesDrop'].includes(k))) }
    let sources = Array.isArray(r.sources) ? [...r.sources] : []
    if (p.sourcesDrop) sources = sources.filter((s) => !p.sourcesDrop.some((re) => re.test(s)))
    if (p.sourcesAdd) sources = [...sources, ...p.sourcesAdd]
    fixed.sources = [...new Set(sources)]
    return fixed
  })
}

function upsertImportant(list, items) {
  const byId = new Map(list.map((i) => [i.id, i]))
  for (const item of items) {
    byId.set(item.id, item)
  }
  byId.set('mvp-data-note', {
    id: 'mvp-data-note',
    title: 'Данные обновляются ежедневно',
    body: 'Цены и часы для части курортов собираются с официальных публичных страниц (волны 1–2). Это не оферта — перед выездом сверяйте с сайтом курорта.',
    severity: 'info',
    updatedAt: nowIso(),
  })
  return [...byId.values()]
}

function defaultTargets(args) {
  if (args.wave === '1') return [...WAVE1]
  if (args.wave === '2') return [...WAVE2]
  // Default: wave1 + wave2. --skip-optional keeps historical meaning (omit krasnoe only in wave1 era);
  // for wave2 krasnoe is first-class — skip-optional still runs full wave2 minus nothing else.
  if (args.skipOptional) return [...WAVE1, ...WAVE2.filter((id) => id !== 'krasnoe-ozero')]
  return [...WAVE1, ...WAVE2]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(outDir, { recursive: true })

  if (!existsSync(seedPath)) {
    console.error('Не найден data/seed/resorts.json')
    process.exit(1)
  }

  const seedResorts = applySeedFixes(JSON.parse(readFileSync(seedPath, 'utf8')))
  let resorts = seedResorts.map((r) => ({ ...r }))

  const prevPrices = readJson(join(outDir, 'prices.json'), [])
  const prevHours = readJson(join(outDir, 'hours.json'), [])
  const prevImportant = readJson(join(outDir, 'important.json'), [])

  const pricesById = new Map(prevPrices.map((p) => [p.resortId, p]))
  const hoursById = new Map(prevHours.map((h) => [h.resortId, h]))

  for (const r of resorts) {
    if (!pricesById.has(r.id)) pricesById.set(r.id, blankPrice(r.id, resorts))
    if (!hoursById.has(r.id)) hoursById.set(r.id, blankHours(r.id, resorts))
  }

  const targets = args.only?.length ? args.only : defaultTargets(args)

  const results = []
  const importantAdds = []

  console.log(`MountHunt scrape · delay ${DELAY_MS}ms · targets: ${targets.join(', ')}`)

  for (let i = 0; i < targets.length; i++) {
    const id = targets[i]
    const fn = PARSERS[id]
    if (!fn) {
      console.warn(`Нет парсера для ${id}, пропуск`)
      continue
    }
    process.stdout.write(`→ ${id} … `)
    const started = Date.now()
    let result
    try {
      result = await fn()
    } catch (err) {
      result = { resortId: id, error: String(err?.message || err) }
    }
    const ms = Date.now() - started
    const priceStatus = result.prices?.status
    const hoursStatus = result.hours?.status
    const okish =
      (priceStatus && priceStatus !== 'failed') || (hoursStatus && hoursStatus !== 'failed')
    console.log(
      `${okish ? 'ok' : 'FAIL'} (${ms}ms)` +
        (result.error ? ` err=${result.error}` : '') +
        ` prices=${priceStatus ?? '—'} hours=${hoursStatus ?? '—'} items=${result.prices?.items?.length ?? 0}`,
    )

    if (result.prices) {
      const merged = mergeSnapshot(pricesById.get(id), result.prices, id, (rid) =>
        blankPrice(rid, resorts),
      )
      pricesById.set(id, merged)
    } else if (result.error) {
      pricesById.set(
        id,
        mergeSnapshot(pricesById.get(id), { status: 'failed', note: result.error }, id, (rid) =>
          blankPrice(rid, resorts),
        ),
      )
    }

    if (result.hours) {
      hoursById.set(
        id,
        mergeSnapshot(hoursById.get(id), result.hours, id, (rid) => blankHours(rid, resorts)),
      )
    }

    if (result.webcamUrl) {
      resorts = resorts.map((r) => (r.id === id ? { ...r, webcam_url: result.webcamUrl } : r))
    }
    if (result.important?.length) importantAdds.push(...result.important)

    results.push({
      id,
      error: result.error || null,
      prices: priceStatus || null,
      hours: hoursStatus || null,
      itemCount: result.prices?.items?.length ?? 0,
      summary: result.hours?.summary || null,
    })

    if (i < targets.length - 1) await sleep()
  }

  const prices = resorts.map((r) => pricesById.get(r.id) || blankPrice(r.id, resorts))
  const hours = resorts.map((r) => hoursById.get(r.id) || blankHours(r.id, resorts))
  const important = upsertImportant(prevImportant, importantAdds)

  const success = results.filter(
    (r) => (r.prices && r.prices !== 'failed') || (r.hours && r.hours !== 'failed'),
  )
  const failed = results.filter((r) => r.error || r.prices === 'failed')

  const meta = {
    updatedAt: nowIso(),
    source: 'scrape-wave1+wave2',
    note: `Волны 1–2: ${success.map((r) => r.id).join(', ') || 'нет успешных'}; failed: ${
      failed.map((r) => r.id).join(', ') || 'нет'
    }`,
    resortsScraped: results,
  }

  if (args.dryRun) {
    console.log('\n[dry-run] файлы не записаны')
    console.log(JSON.stringify({ meta, results }, null, 2))
    return
  }

  writeJson(seedPath, seedResorts)
  writeJson(join(outDir, 'resorts.json'), resorts)
  writeJson(join(outDir, 'prices.json'), prices)
  writeJson(join(outDir, 'hours.json'), hours)
  writeJson(join(outDir, 'important.json'), important)
  writeJson(join(outDir, 'meta.json'), meta)

  console.log(`\nЗаписано public/data · meta ${meta.updatedAt}`)
  console.log(
    `Успешно (не failed): ${success.map((r) => r.id).join(', ') || '—'}\nFailed: ${
      failed.map((r) => r.id).join(', ') || '—'
    }`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
