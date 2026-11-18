/**
 * Surgical scrape-quality checks (node:test).
 * Run: npm run test:scrape
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mergeSnapshot, parsePrice } from '../lib/parse.mjs'
import { parseIgoraPrices } from '../resorts/igora.mjs'

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
