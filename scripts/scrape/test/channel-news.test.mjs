import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  channelTitleBody,
  dedupeImportantNewsItems,
  detectChannelNewsFromTelegram,
  detectChannelNewsFromVk,
  isNewsCollision,
  RESORT_CHANNEL_SOURCES,
  resortChannelPostRelevant,
} from '../lib/channel-news.mjs'
import { mergeImportantFailSoft } from '../lib/important.mjs'
import { parseVkCommunityHtml } from '../lib/vk.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const tgFixture = join(root, 'fixtures/ohtapark-tg.html')
const vkFixture = join(root, 'fixtures/ohtapark-vk.html')

describe('channel-news', () => {
  it('lists TG/VK for every active resort with community channels in seed', () => {
    const byId = Object.fromEntries(RESORT_CHANNEL_SOURCES.map((s) => [s.resortId, s]))
    assert.ok(byId['okhta-park']?.telegram && byId['okhta-park']?.vk)
    assert.ok(byId.igora?.telegram && byId.igora?.vk)
    assert.ok(byId['tuutari-park']?.vk && !byId['tuutari-park']?.telegram)
    assert.ok(byId['krasnoe-ozero']?.skipTelegram && byId['krasnoe-ozero']?.vk)
    assert.ok(byId['putilovo-park']?.skipTelegram)
    assert.ok(byId['drop-park']?.telegram)
    assert.equal(RESORT_CHANNEL_SOURCES.length, 12)
  })

  it('filters relevant resort channel posts', () => {
    assert.equal(resortChannelPostRelevant('Горнолыжный сезон открыт! Склон ждёт гостей.'), true)
    assert.equal(resortChannelPostRelevant('График работы курорта с 16 по 22 ноября'), true)
    assert.equal(resortChannelPostRelevant('Доброе утро! Зимняя сказка и спа.'), false)
  })

  it('parses Telegram fixture into Important cards', () => {
    const html = readFileSync(tgFixture, 'utf8')
    const items = detectChannelNewsFromTelegram(html, {
      resortId: 'okhta-park',
      resortName: 'Охта-Парк',
      idPrefix: 'okhta',
    })
    const ids = items.map((i) => i.id)
    assert.ok(ids.includes('okhta-tg-9001'), `got ${ids}`)
    assert.ok(ids.includes('okhta-tg-9003'), `got ${ids}`)
    assert.ok(!ids.includes('okhta-tg-9002'), 'promo morning post skipped')
    assert.match(items.find((i) => i.id === 'okhta-tg-9001').title, /Охта|сезон/i)
  })

  it('parses VK fixture posts', () => {
    const html = readFileSync(vkFixture, 'utf8')
    const posts = parseVkCommunityHtml(html)
    assert.ok(posts.length >= 2)
    assert.equal(posts[0].url, 'https://vk.com/wall-80896849_31546')
    assert.ok(posts[0].publishedAt?.startsWith('2026-11-20'))
  })

  it('detects VK channel news and prefixes resort name', () => {
    const html = readFileSync(vkFixture, 'utf8')
    const items = detectChannelNewsFromVk(html, {
      resortId: 'okhta-park',
      resortName: 'Охта-Парк',
      idPrefix: 'okhta',
    })
    assert.ok(items.some((i) => i.id.startsWith('okhta-vk-')))
    assert.ok(items.every((i) => /vk\.com\/wall/i.test(i.sourceUrl)))
  })

  it('dedupes TG against site news texts', () => {
    const html = readFileSync(tgFixture, 'utf8')
    const items = detectChannelNewsFromTelegram(html, {
      resortId: 'okhta-park',
      resortName: 'Охта-Парк',
      idPrefix: 'okhta',
      siteNewsTexts: ['Горнолыжный сезон открыт! Сегодня стартует сезон'],
    })
    assert.ok(!items.some((i) => i.id === 'okhta-tg-9001'))
    assert.ok(items.some((i) => i.id === 'okhta-tg-9003'))
  })

  it('dedupes near-duplicate cards across TG and VK in the feed', () => {
    const tg = detectChannelNewsFromTelegram(readFileSync(tgFixture, 'utf8'), {
      resortId: 'okhta-park',
      resortName: 'Охта-Парк',
      idPrefix: 'okhta',
    })
    const vk = detectChannelNewsFromVk(readFileSync(vkFixture, 'utf8'), {
      resortId: 'okhta-park',
      resortName: 'Охта-Парк',
      idPrefix: 'okhta',
    })
    const merged = dedupeImportantNewsItems([...tg, ...vk])
    const seasonCards = merged.filter((i) => /сезон открыт/i.test(`${i.title} ${i.body || ''}`))
    assert.equal(seasonCards.length, 1, 'season open once across TG+VK')
    assert.ok(/t\.me\//i.test(seasonCards[0].sourceUrl), 'prefer Telegram over VK')
  })

  it('isNewsCollision matches same URL', () => {
    assert.equal(
      isNewsCollision(
        { id: 'a', resortId: 'x', title: 'One', sourceUrl: 'https://t.me/ch/1?x=1' },
        { id: 'b', resortId: 'x', title: 'Two', sourceUrl: 'https://t.me/ch/1#frag' },
      ),
      true,
    )
  })

  it('channelTitleBody prefixes resort name', () => {
    const { title } = channelTitleBody('Сезон открыт\nПодробности на сайте', 'Игора')
    assert.match(title, /^Игора:/)
  })

  it('mergeImportantFailSoft applies feed dedupe', () => {
    const next = mergeImportantFailSoft(
      [],
      [
        {
          resortId: 'okhta-park',
          ok: true,
          items: [
            {
              id: 'okhta-tg-1',
              resortId: 'okhta-park',
              title: 'Охта-Парк: Горнолыжный сезон открыт',
              body: 'Склон ждёт гостей на первые спуски',
              severity: 'info',
              sourceUrl: 'https://t.me/OhtaPark/1',
              updatedAt: '2026-11-20T10:00:00Z',
              publishedAt: '2026-11-20T10:00:00Z',
            },
            {
              id: 'okhta-vk-2',
              resortId: 'okhta-park',
              title: 'Охта-Парк: Горнолыжный сезон открыт',
              body: 'Склон ждёт гостей на первые спуски',
              severity: 'info',
              sourceUrl: 'https://vk.com/wall-1_2',
              updatedAt: '2026-11-20T10:00:00Z',
              publishedAt: '2026-11-20T10:00:00Z',
            },
          ],
        },
      ],
    )
    assert.equal(next.filter((i) => i.resortId === 'okhta-park').length, 1)
  })
})
