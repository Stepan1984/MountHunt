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
