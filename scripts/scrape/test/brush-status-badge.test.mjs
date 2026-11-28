/**
 * Brush open/closed card/page badges for resorts with щётки features.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('brush status badges', () => {
  const dataSrc = readFileSync(join(root, 'src/lib/data.ts'), 'utf8')
  const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
  const pageSrc = readFileSync(join(root, 'src/pages/ResortPage.tsx'), 'utf8')
  const typesSrc = readFileSync(join(root, 'src/types.ts'), 'utf8')
  const dropSrc = readFileSync(join(root, 'scripts/scrape/resorts/drop-park.mjs'), 'utf8')
  const krasSrc = readFileSync(join(root, 'scripts/scrape/resorts/krasnoe-ozero.mjs'), 'utf8')
  const parseSrc = readFileSync(join(root, 'scripts/scrape/lib/parse.mjs'), 'utf8')
  const resorts = JSON.parse(readFileSync(join(root, 'public/data/resorts.json'), 'utf8'))
  const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))

  it('only Drop Park and Красное озеро seed brush features', () => {
    const withBrushes = resorts.filter((r) =>
      (r.features ?? []).some((f) =>
        /щ[её]тк|джиб|jib\s*palace|brushes/i.test(`${f.id} ${f.title} ${f.summary ?? ''}`),
      ),
    )
    assert.deepEqual(
      withBrushes.map((r) => r.id).sort(),
      ['drop-park', 'krasnoe-ozero'],
    )
  })

  it('UI helpers + card/page wire brush badges', () => {
    assert.match(dataSrc, /export function resortHasBrushes/)
    assert.match(dataSrc, /export function brushesBadgeLabel/)
    assert.match(dataSrc, /Щётки открыты/)
    assert.match(dataSrc, /Щётки закрыты/)
    assert.match(dataSrc, /brushesOpen === true/)
    assert.match(cardSrc, /brushesBadgeLabel/)
    assert.match(cardSrc, /brushBadge/)
    assert.match(pageSrc, /brushesBadgeLabel/)
    assert.match(pageSrc, /resort-detail__badges/)
    assert.match(typesSrc, /brushesOpen\?:/)
  })

  it('scrape persists brushesOpen for Drop Park and Krasnoe', () => {
    assert.match(parseSrc, /partial\.brushesOpen/)
    assert.match(dropSrc, /brushesOpen:\s*slopeStatus\.brushesOpen/)
    assert.match(krasSrc, /brushesOpen:\s*slopeStatus\.brushesOpen/)
  })

  it('public hours: Drop Park brushesOpen true from scrape signal', () => {
    const drop = hours.find((h) => h.resortId === 'drop-park')
    assert.ok(drop)
    assert.equal(drop.brushesOpen, true)
    assert.match(drop.summary || '', /щ[её]тк/i)
  })
})
