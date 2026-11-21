/**
 * Surgical scrape-quality checks (node:test).
 * Run: npm run test:scrape
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { flattenSkipassGroups, mergeSnapshot, parsePrice } from '../lib/parse.mjs'
import {
  clarifyInstructorLabel,
  mergeIgoraPriceTables,
  parseIgoraPrices,
  parseIgoraPriceTables,
  supplementIgoraSkiPassFromSnapshot,
} from '../resorts/igora.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('parsePrice', () => {
  it('parses spaced RUB amounts', () => {
    assert.equal(parsePrice('2 280'), 2280)
    assert.equal(parsePrice('333'), 333)
    assert.equal(parsePrice('—'), null)
  })
})

describe('mergeSnapshot fail-soft', () => {
  it('keeps previous items on failed', () => {
    const prev = {
      resortId: 'x',
      status: 'ok',
      items: [{ title: 'a', price: 1 }],
      scrapedAt: '2026-01-01T00:00:00Z',
      sourceUrl: 'https://example.com',
      currency: 'RUB',
    }
    const next = { status: 'failed', note: 'boom', sourceUrl: 'https://example.com/new' }
    const merged = mergeSnapshot(prev, next, 'x', () => ({ resortId: 'x', status: 'pending', items: [] }))
    assert.equal(merged.status, 'failed')
    assert.equal(merged.items.length, 1)
    assert.equal(merged.items[0].price, 1)
  })

  it('replaces with unavailable (no invent)', () => {
    const prev = { resortId: 'severny-sklon', status: 'pending', items: [] }
    const next = { resortId: 'severny-sklon', status: 'unavailable', items: [], note: 'нет прайса' }
    const merged = mergeSnapshot(prev, next, 'severny-sklon', () => prev)
    assert.equal(merged.status, 'unavailable')
    assert.equal(merged.items.length, 0)
  })
})

describe('parseIgoraPrices', () => {
  it('labels pass packs clearly and skips orphan BSK stub', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const items = parseIgoraPrices(html)
    assert.ok(items.length > 10)

    const onePass = items.find((i) => /Базовый · 1 проход/i.test(i.title))
    assert.ok(onePass, 'expected «1 проход» label instead of bare «· 1»')
    assert.equal(onePass.price, 333)
    assert.equal(onePass.unit, 'проход')

    const hourly = items.find((i) => /Базовый · 1 час/i.test(i.title) && i.price === 2280)
    assert.ok(hourly, 'expected ONLINE hourly base 2280')

    // Orphan single-cell BSK row must not become a fake tariff
    const noisyBsk = items.filter((i) => /^БСК/i.test(i.title) && i.price === 250 && !/час|проход/i.test(i.title))
    assert.equal(noisyBsk.length, 0)

    // Hourly rows should sort before pass packs / instructor
    const first = items[0]
    assert.match(first.title, /час/i)
  })

  it('collapses instructor cash/ONLINE pairs to ONLINE + в кассе note', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const items = parseIgoraPrices(html)
    const oneHourWeekday = items.filter((i) => /^1 человек · 1 час · будни/i.test(i.title))
    assert.equal(oneHourWeekday.length, 1, 'cash+online must collapse to one row')
    assert.equal(oneHourWeekday[0].price, 2850, 'prefer ONLINE 2850 over cash 3000')
    assert.match(oneHourWeekday[0].note || '', /в кассе 3000/)
    assert.match(oneHourWeekday[0].title, /online/i)

    // No near-duplicate instructor titles with different prices
    const instr = items.filter((i) => / · будни| · выходные/i.test(i.title))
    const byBase = new Map()
    for (const it of instr) {
      const k = it.title.replace(/\s*\([^)]*\)\s*$/u, '').trim()
      byBase.set(k, (byBase.get(k) || 0) + 1)
    }
    for (const [k, n] of byBase) {
      assert.equal(n, 1, `duplicate instructor key after collapse: ${k}`)
    }
  })

  it('rewrites site jargon «с профи» to clear «с тренером»', () => {
    assert.equal(clarifyInstructorLabel('1 человек с профи'), '1 человек с тренером')
    assert.equal(clarifyInstructorLabel('2 человека с профи'), '2 человека с тренером')
    assert.equal(
      clarifyInstructorLabel('3 человека и более с профи'),
      '3 человека и более с тренером',
    )
    assert.equal(clarifyInstructorLabel('1 человек'), '1 человек')

    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { items, groups } = parseIgoraPriceTables(html)
    const withTrainer = items.filter((i) => /с тренером/i.test(i.title))
    assert.ok(withTrainer.length >= 6, 'expected instructor «с тренером» tariffs')
    for (const it of items) {
      assert.doesNotMatch(it.title, /\bпрофи\b/i, `visitor title must not keep «профи»: ${it.title}`)
    }
    const instrGroup = groups.find((g) => /^Занятия с инструктором$/i.test(g.category))
    assert.ok(instrGroup, 'expected «Занятия с инструктором» lesson group')
    for (const row of instrGroup.rows || []) {
      assert.doesNotMatch(row.name || '', /\bпрофи\b/i, `group row must not keep «профи»: ${row.name}`)
    }
    assert.ok(
      (instrGroup.rows || []).some((r) => /1 человек с тренером/i.test(r.name || '')),
      'expected «1 человек с тренером» in instructor table',
    )
  })

  it('merges instructor-only live with snapshot ski-pass (fail-soft)', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const full = parseIgoraPriceTables(html)
    const liveOnly = {
      items: full.items.filter((i) => / · (?:будни|выходные)/i.test(i.title)),
      groups: full.groups.filter((g) => /инструктор/i.test(g.category)),
    }
    // Lessons + optional instructor pack — never a single catch-all «Инструктор» for ski-pass.
    assert.ok(liveOnly.groups.length >= 1)
    assert.ok(liveOnly.groups.every((g) => /инструктор/i.test(g.category)))
    assert.ok(liveOnly.items.length >= 12)

    const merged = mergeIgoraPriceTables(liveOnly, full)
    assert.equal(merged.filledSkiPass, true)
    assert.ok(merged.groups.some((g) => /почасов/i.test(g.category)))
    assert.ok(merged.groups.some((g) => /проход/i.test(g.category)))
    assert.ok(merged.groups.some((g) => /^Занятия с инструктором$/i.test(g.category)))
    assert.ok(merged.items.some((i) => /Базовый · 1 час/i.test(i.title)))
    assert.ok(merged.items.some((i) => /1 человек · 1 час · будни/i.test(i.title)))
    // Prefer live instructor prices over snapshot when both present
    const livePrice = liveOnly.items.find((i) => /^1 человек · 1 час · будни/i.test(i.title))?.price
    const mergedPrice = merged.items.find((i) => /^1 человек · 1 час · будни/i.test(i.title))?.price
    assert.equal(mergedPrice, livePrice)

    const supplemented = supplementIgoraSkiPassFromSnapshot(liveOnly)
    assert.equal(supplemented.filledSkiPass, true)
    assert.ok(supplemented.groups.length >= 3)
  })

  it('marks льготный cash-only cells', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { items, groups } = parseIgoraPriceTables(html)
    const lgot = items.find((i) => /Льготный\* · 1 час/i.test(i.title))
    assert.ok(lgot)
    assert.match(lgot.note || '', /только в кассе/i)
    const hourly = groups.find((g) => /почасов/i.test(g.category))
    const row = hourly?.rows?.find((r) => /льгот/i.test(r.name || ''))
    assert.ok(row)
    assert.match(row.prices?.[0]?.note || '', /только в кассе/i)
  })
})

describe('Igora CI snapshot policy', () => {
  it('workflow and scraper refuse accidental prod snapshots', () => {
    const wf = readFileSync(join(root, '.github/workflows/daily-data-refresh.yml'), 'utf8')
    assert.doesNotMatch(wf, /^\s*IGORA_ALLOW_SNAPSHOT\s*:/m)
    assert.doesNotMatch(wf, /^\s*IGORA_HTML_DIR\s*:/m)
    assert.doesNotMatch(wf, /^\s*SCRAPE_HTML_DIR\s*:/m)
    assert.match(wf, /IGORA_TIMEOUT_MS/)

    const src = readFileSync(join(root, 'scripts/scrape/resorts/igora.mjs'), 'utf8')
    assert.match(src, /function isCiEnv/)
    assert.match(src, /!isCiEnv\(\)/)
  })
})

describe('yukki hours policy (source-level)', () => {
  it('source does not hardcode ok hours before regex', async () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/yukki.mjs'), 'utf8')
    assert.doesNotMatch(
      src,
      /let summary = 'ежедневно 10:00–21:00'/,
      'must not invent default hours as ok',
    )
    assert.match(src, /hoursStatus = 'partial'/)
    assert.match(src, /hoursStatus = 'ok'/)
  })
})

describe('snezhny hours stay partial (no Playwright)', () => {
  it('hours status is hardcoded partial in source', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/snezhny.mjs'), 'utf8')
    assert.match(src, /status:\s*'partial'/)
    assert.doesNotMatch(src, /playwright|fetchRenderedHtml/i)
  })
})

describe('closed-season card honesty signals', () => {
  it('lazurnye prefixes hours with Сезон закрыт when site says so', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/lazurnye-ozera.mjs'), 'utf8')
    assert.match(src, /Сезон закрыт/)
    assert.match(src, /seasonClosed/)
  })

  it('UI slopesClosedHint matches сезон закрыт in hours', () => {
    const dataSrc = readFileSync(join(root, 'src/lib/data.ts'), 'utf8')
    const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
    assert.match(dataSrc, /сезон закрыт\|склон/)
    assert.match(dataSrc, /предпродажа · сезон от/)
    assert.match(cardSrc, /closed \? 'сезон закрыт'/)
  })

  it('committed data keeps Puhtolova empty / Severny unavailable / Snezhny partial hours', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const puh = prices.find((p) => p.resortId === 'puhtolova-gora')
    const sev = prices.find((p) => p.resortId === 'severny-sklon')
    const sne = hours.find((h) => h.resortId === 'snezhny')
    assert.equal(puh?.status, 'partial')
    assert.equal((puh?.items || []).length, 0)
    assert.equal(sev?.status, 'unavailable')
    assert.equal((sev?.items || []).length, 0)
    assert.equal(sne?.status, 'partial')
  })
})

describe('Igora Playwright waits for attached tables', () => {
  it('browser loader uses state attached (collapsed FAQ)', () => {
    const src = readFileSync(join(root, 'scripts/scrape/lib/browser.mjs'), 'utf8')
    assert.match(src, /state:\s*'attached'/)
  })
})

describe('skipass groups', () => {
  it('flattenSkipassGroups expands matrix cells', () => {
    const items = flattenSkipassGroups([
      {
        category: 'Ски-пасс',
        columns: ['Будни', 'Выходные'],
        rows: [
          {
            name: 'Ски-пасс',
            duration: '1 час',
            prices: [{ price: 1200 }, { price: 1500 }],
          },
        ],
      },
    ])
    assert.equal(items.length, 2)
    assert.match(items[0].title, /1 час/)
    assert.equal(items[0].price, 1200)
    assert.equal(items[0].unit, 'час')
  })

  it('Igora snapshot yields structured groups with site categories', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { groups } = parseIgoraPriceTables(html)
    assert.ok(groups.length >= 3)
    assert.ok(groups.some((g) => /почасов/i.test(g.category)))
    assert.ok(groups.some((g) => /проход/i.test(g.category)))
    assert.ok(groups.some((g) => /^Занятия с инструктором$/i.test(g.category)))
    // Catch-all «Инструктор» title is gone — ski-pass rows must not live under it.
    assert.ok(!groups.some((g) => /^Инструктор$/i.test(g.category)))
    const hourly = groups.find((g) => /почасов/i.test(g.category))
    assert.ok(hourly.columns.some((c) => /час/i.test(c)))
    assert.ok(hourly.rows.some((r) => /базов/i.test(r.name)))
    const lessons = groups.find((g) => /^Занятия с инструктором$/i.test(g.category))
    assert.ok(lessons?.rows?.every((r) => /человек|тренер/i.test(r.name || '')))
  })

  it('committed prices keep groups for split resorts and flat for drop-park', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const needGroups = [
      'tuutari-park',
      'lazurnye-ozera',
      'zolotaya-dolina',
      'snezhny',
      'krasnoe-ozero',
      'okhta-park',
      'igora',
    ]
    for (const id of needGroups) {
      const snap = prices.find((p) => p.resortId === id)
      assert.ok(snap?.groups?.length, `${id} should have skipass groups`)
    }
    const drop = prices.find((p) => p.resortId === 'drop-park')
    assert.ok((drop?.items || []).length > 0)
    assert.equal(drop?.groups?.length || 0, 0, 'drop-park stays flat (no invented categories)')

    const igora = prices.find((p) => p.resortId === 'igora')
    assert.ok(igora?.groups?.some((g) => /почасов/i.test(g.category)), 'Igora hourly group')
    assert.ok(igora?.groups?.some((g) => /проход/i.test(g.category)), 'Igora passes group')
    assert.ok(
      igora?.groups?.some((g) => /^Занятия с инструктором$/i.test(g.category)),
      'Igora lessons group',
    )
    assert.ok(
      !igora?.groups?.some((g) => /^Инструктор$/i.test(g.category)),
      'Igora must not use catch-all «Инструктор»',
    )
    assert.ok(
      (igora?.items || []).some((i) => /Базовый · 1 час/i.test(i.title || '')),
      'committed Igora items should include ski-pass hourly',
    )
    for (const it of igora?.items || []) {
      assert.doesNotMatch(it.title || '', /\bпрофи\b/i, `committed Igora item: ${it.title}`)
    }
    for (const g of igora?.groups || []) {
      for (const row of g.rows || []) {
        assert.doesNotMatch(row.name || '', /\bпрофи\b/i, `committed Igora row: ${row.name}`)
      }
    }
    assert.ok(
      (igora?.items || []).some((i) => /с тренером/i.test(i.title || '')),
      'committed Igora items should use «с тренером»',
    )
  })

  it('committed Snezhny keeps season and unified groups', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const sne = prices.find((p) => p.resortId === 'snezhny')
    assert.ok(sne?.groups?.some((g) => /^Абонементы$/i.test(g.category)))
    assert.ok(sne?.groups?.some((g) => /Единый ски-пасс/i.test(g.category)))
    const lift = sne?.groups?.find((g) => /часы и проходы/i.test(g.category))
    assert.ok(lift?.rows?.some((r) => r.duration === '1 проход'), 'duration without redundant «Ски-пасс ·»')
    assert.ok(
      (sne?.groups?.find((g) => /^Абонементы$/i.test(g.category))?.rows || []).length >= 3,
    )
  })

  it('lazurnye durations are not doubled «ч ч»', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const snap = prices.find((p) => p.resortId === 'lazurnye-ozera')
    for (const g of snap?.groups || []) {
      for (const row of g.rows || []) {
        assert.ok(row.duration, 'expected duration')
        assert.doesNotMatch(row.duration, /ч\s+ч/)
        assert.match(row.duration, /^\d+\s*ч/)
      }
    }
    const enrichSrc = readFileSync(join(root, 'scripts/enrich-skipass-groups.mjs'), 'utf8')
    const scrapeSrc = readFileSync(join(root, 'scripts/scrape/resorts/lazurnye-ozera.mjs'), 'utf8')
    assert.match(enrichSrc, /час\|\\bч\\b/)
    assert.match(scrapeSrc, /час\|\\bч\\b/)
  })
})
