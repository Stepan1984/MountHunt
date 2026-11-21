#!/usr/bin/env node
/**
 * MountHunt daily scrape — wave 1 (P1) + wave 2 (P2) + wave 3 (P3).
 *
 * Usage:
 *   npm run scrape
 *   npm run scrape -- --dry-run          # scrape but do not write files
 *   npm run scrape -- --only=tuutari-park,snezhny
 *   npm run scrape -- --wave=3           # only wave 3 targets
 *   SCRAPE_DELAY_MS=2000 npm run scrape
 *   IGORA_HTML_DIR=data/snapshots/igora npm run scrape -- --only=igora
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELAY_MS, sleep } from './scrape/lib/http.mjs'
import { mergeImportantFromDailyScrape } from './scrape/lib/important.mjs'
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
import { scrapeIgora } from './scrape/resorts/igora.mjs'
import { scrapeSevernySklon } from './scrape/resorts/severny-sklon.mjs'

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
  igora: scrapeIgora,
  'severny-sklon': scrapeSevernySklon,
}

const WAVE1 = ['tuutari-park', 'zolotaya-dolina', 'lazurnye-ozera', 'puhtolova-gora', 'yukki']
const WAVE2 = ['krasnoe-ozero', 'snezhny', 'drop-park', 'okhta-park']
const WAVE3 = ['igora', 'severny-sklon']

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
    igora: {
      prices_format: 'html_js',
      prices_url: 'https://igora.ru/price/',
      webcam_url: 'https://igora.ru/cam/',
      sourcesAdd: [
        'https://igora.ru/price/',
        'https://igora.ru/working-hours/',
        'https://igora.ru/cam/',
        'https://igora.ru/slopes/',
      ],
      notes: 'Всесезонный курорт; ~9–10 трасс до ~1,2 км, перепад до ~118 м.',
    },
    'severny-sklon': {
      website: 'https://severnysklon.ru/',
      prices_format: 'none',
      prices_url: null,
      webcam_url: null,
      sourcesAdd: ['https://severnysklon.ru/'],
      sourcesDrop: [/sev-sklon\.ru/],
      notes: '4 склона у оз. Хепоярви; бугели. Актуальные цены уточняйте на сайте курорта.',
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

function defaultTargets(args) {
  if (args.wave === '1') return [...WAVE1]
  if (args.wave === '2') return [...WAVE2]
  if (args.wave === '3') return [...WAVE3]
  // Default: wave1 + wave2 + wave3. --skip-optional keeps historical meaning (omit krasnoe only in wave1 era);
  // for wave2+ krasnoe is first-class — skip-optional still runs full wave2/3 minus nothing else.
  if (args.skipOptional) return [...WAVE1, ...WAVE2.filter((id) => id !== 'krasnoe-ozero'), ...WAVE3]
  return [...WAVE1, ...WAVE2, ...WAVE3]
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

    if (result.webcamUrl !== undefined) {
      resorts = resorts.map((r) => (r.id === id ? { ...r, webcam_url: result.webcamUrl } : r))
    }
    if (result.cameraEmbeds !== undefined) {
      resorts = resorts.map((r) =>
        r.id === id ? { ...r, webcam_embeds: [...new Set(result.cameraEmbeds.filter(Boolean))] } : r,
      )
    }
    if (result.website) {
      resorts = resorts.map((r) => (r.id === id ? { ...r, website: result.website } : r))
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
  const important = mergeImportantFromDailyScrape(prevImportant, importantAdds, results)

  const success = results.filter(
    (r) => (r.prices && r.prices !== 'failed') || (r.hours && r.hours !== 'failed'),
  )
  const failed = results.filter((r) => r.error || r.prices === 'failed')

  // When --only=…, merge into previous meta.resortsScraped so a partial refresh
  // does not pretend the other resorts were not scraped.
  const prevMeta = readJson(join(outDir, 'meta.json'), null)
  let resortsScraped = results
  if (args.only?.length && prevMeta?.resortsScraped?.length) {
    const byId = new Map(prevMeta.resortsScraped.map((r) => [r.id, r]))
    for (const r of results) byId.set(r.id, r)
    resortsScraped = [...byId.values()]
  }
  const scrapedSuccess = resortsScraped.filter(
    (r) => (r.prices && r.prices !== 'failed') || (r.hours && r.hours !== 'failed'),
  )
  const scrapedFailed = resortsScraped.filter((r) => r.error || r.prices === 'failed')
  const meta = {
    updatedAt: nowIso(),
    source: 'scrape-wave1+wave2+wave3',
    note: `Волны 1–3: ${scrapedSuccess.map((r) => r.id).join(', ') || 'нет успешных'}; failed: ${
      scrapedFailed.map((r) => r.id).join(', ') || 'нет'
    }`,
    resortsScraped,
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
