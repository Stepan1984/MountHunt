/**
 * Active resort card list order: open → season-open date → closed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  resortCardSortTier,
  sortByResortCardTiers,
} from '../lib/resort-card-sort.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('resort-card-sort tiers', () => {
  it('ranks open before season-date before closed', () => {
    assert.equal(resortCardSortTier('Склоны открыты', null), 0)
    assert.equal(resortCardSortTier('Склоны открыты', 'Начало сезона 28.11.2026'), 0)
    assert.equal(resortCardSortTier('Склоны закрыты', 'Начало сезона 28.11.2026'), 1)
    assert.equal(resortCardSortTier(null, 'Начало сезона 01.12.2026'), 1)
    assert.equal(resortCardSortTier('Склоны закрыты', null), 2)
    assert.equal(resortCardSortTier(null, null), 2)
  })

  it('sorts open → season badge → closed and stays stable within a tier', () => {
    const items = [
      { id: 'closed-a' },
      { id: 'season-b' },
      { id: 'open-c' },
      { id: 'closed-d' },
      { id: 'season-e' },
      { id: 'open-f' },
    ]
    const badges = {
      'closed-a': { slopesBadge: 'Склоны закрыты', seasonBadge: null },
      'season-b': {
        slopesBadge: 'Склоны закрыты',
        seasonBadge: 'Начало сезона 28.11.2026',
      },
      'open-c': { slopesBadge: 'Склоны открыты', seasonBadge: null },
      'closed-d': { slopesBadge: 'Склоны закрыты', seasonBadge: null },
      'season-e': {
        slopesBadge: 'Склоны закрыты',
        seasonBadge: 'Начало сезона 05.12.2026',
      },
      'open-f': { slopesBadge: 'Склоны открыты', seasonBadge: null },
    }
    const sorted = sortByResortCardTiers(items, (item) => badges[item.id])
    assert.deepEqual(
      sorted.map((r) => r.id),
      ['open-c', 'open-f', 'season-b', 'season-e', 'closed-a', 'closed-d'],
    )
  })

  it('HomePage wires sortResortsForCards for the active grid', () => {
    const home = readFileSync(join(root, 'src/pages/HomePage.tsx'), 'utf8')
    assert.match(home, /sortResortsForCards/)
    assert.match(home, /from ['"]\.\.\/lib\/resort-card-sort['"]/)
    const sortSrc = readFileSync(join(root, 'src/lib/resort-card-sort.ts'), 'utf8')
    assert.match(sortSrc, /slopesBadgeLabel/)
    assert.match(sortSrc, /seasonOpenBadgeLabel/)
    assert.match(sortSrc, /Склоны открыты/)
  })
})
