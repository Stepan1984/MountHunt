/**
 * Krasnoe card-tags: fixed taxonomy, no season tags, rules/fixture offline.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  buildCardTagsDocument,
  buildResortCardTags,
  classifyImportantItemRules,
  liveCardTagsForResort,
  SEASON_TAG_IDS,
} from '../lib/card-tags.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const fixtureNews = JSON.parse(
  readFileSync(join(root, 'fixtures/krasnoe-card-tags-news.json'), 'utf8'),
)

describe('card-tags (Krasnoe)', () => {
  it('never classifies season.start / season.open for Krasnoe', () => {
    const openItem = fixtureNews.find((i) => i.id === 'krasnoe-tg-1849')
    const ids = classifyImportantItemRules(openItem, 'krasnoe-ozero')
    assert.ok(!ids.some((id) => SEASON_TAG_IDS.has(id)))
    assert.deepEqual(
      ids.filter((id) => id.startsWith('season.')),
      [],
    )
  })

  it('detects closure, weather/partial warning, postponement, holiday event', () => {
    assert.ok(
      classifyImportantItemRules(
        fixtureNews.find((i) => i.id === 'krasnoe-slopes-closed'),
        'krasnoe-ozero',
      ).includes('closure.until_season'),
    )
    const upd = classifyImportantItemRules(
      fixtureNews.find((i) => i.id === 'krasnoe-tg-1864'),
      'krasnoe-ozero',
    )
    assert.ok(upd.includes('warning.weather') || upd.includes('warning.partial'))
    assert.ok(
      classifyImportantItemRules(
        fixtureNews.find((i) => i.id === 'krasnoe-postponed'),
        'krasnoe-ozero',
      ).includes('warning.postponed'),
    )
    assert.ok(
      classifyImportantItemRules(
        fixtureNews.find((i) => i.id === 'krasnoe-ny-event'),
        'krasnoe-ozero',
      ).includes('event.holiday'),
    )
  })

  it('buildResortCardTags omits season tags even if previous had them', () => {
    const tags = buildResortCardTags('krasnoe-ozero', fixtureNews, new Date('2026-11-28T12:00:00+03:00'), {
      previous: [
        {
          id: 'season.start',
          kind: 'season_start',
          label: 'Начало сезона',
          severity: 'info',
          sourceItemIds: ['krasnoe-tg-1849'],
          updatedAt: '2026-11-27T00:00:00Z',
        },
      ],
    })
    assert.ok(!tags.some((t) => SEASON_TAG_IDS.has(t.id)))
    assert.ok(tags.some((t) => t.id === 'warning.postponed'))
    assert.ok(tags.some((t) => t.id === 'closure.until_season'))
    assert.ok(tags.some((t) => t.kind === 'event'))
  })

  it('document + live filter stay CI-safe without API key (rules/fixture)', () => {
    const doc = buildCardTagsDocument(fixtureNews, {
      now: new Date('2026-11-28T12:00:00+03:00'),
      mode: 'fixture',
    })
    assert.equal(doc.mode, 'fixture')
    assert.ok(Array.isArray(doc.resorts['krasnoe-ozero']))
    const live = liveCardTagsForResort(doc, 'krasnoe-ozero', new Date('2026-11-28T12:00:00+03:00'))
    assert.ok(live.every((t) => t.label && !/начало сезона|сезон открыт/i.test(t.label)))
    assert.ok(!live.some((t) => SEASON_TAG_IDS.has(t.id)))
  })

  it('does not invent tags for other resorts', () => {
    const doc = buildCardTagsDocument(fixtureNews, {
      now: new Date('2026-11-28T12:00:00+03:00'),
    })
    assert.equal(doc.resorts['okhta-park'], undefined)
    assert.deepEqual(Object.keys(doc.resorts), ['krasnoe-ozero'])
  })
})
