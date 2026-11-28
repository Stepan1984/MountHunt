import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  collectNewsHoursByResort,
  enrichHoursFromImportant,
  extractOperatingClockFromNewsText,
  isLegacyNewsWipedSnapshot,
  newsHoursDayIsPast,
  newsTextHasOperatingHours,
  parseHoursFromImportantItem,
} from '../lib/news-hours.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('news → hours extractors', () => {
  it('parses Krasnoe TG slope schedule clocks', () => {
    const text =
      'Завтра, 28.11 открывается УЧЕБНЫЙ СКЛОН №10 и ленточный подъемник! График работы: 12.00 - 21.45 Мы очень хотели вас порадовать'
    assert.equal(newsTextHasOperatingHours(text), true)
    assert.deepEqual(extractOperatingClockFromNewsText(text), {
      open: '12:00',
      close: '21:45',
    })
    const pack = parseHoursFromImportantItem(
      {
        id: 'krasnoe-tg-1864',
        resortId: 'krasnoe-ozero',
        title: 'Красное озеро: UPD:',
        body: text,
        publishedAt: '2026-11-27T12:00:00Z',
        sourceUrl: 'https://t.me/redlakeclub/1864',
      },
      { nowMs: Date.parse('2026-11-28T10:00:00Z') },
    )
    assert.ok(pack)
    assert.equal(pack.periods[0].open, '12:00')
    assert.equal(pack.periods[0].close, '21:45')
    assert.equal(pack.periods[0].days, '28.11')
    assert.equal(pack.hoursNote, undefined)
  })

  it('parses Okhta TG «на склоне с … до …»', () => {
    const body =
      'Отвечаем – полным ходом идет подготовка к завтрашнему открытию второго горнолыжного склона. Ждем вас уже завтра на склоне с 09:00 до 22:30!'
    const pack = parseHoursFromImportantItem(
      {
        id: 'okhta-tg-10554',
        resortId: 'okhta-park',
        title: 'Охта-Парк: А что это у нас здесь происходит?',
        body,
        publishedAt: '2026-11-27T15:00:00Z',
      },
      { nowMs: Date.parse('2026-11-28T10:00:00Z') },
    )
    assert.ok(pack)
    assert.equal(pack.periods[0].open, '9:00')
    assert.equal(pack.periods[0].close, '22:30')
    assert.match(pack.periods[0].days, /28\.11|завтра/)
  })

  it('rejects vacancy / election / camp noise', () => {
    assert.equal(
      newsTextHasOperatingHours(
        'Приглашаем в команду курорта Снежный! Горничная • Формат работы: постоянная • График: с 9:00 до 18:00',
      ),
      false,
    )
    assert.equal(
      newsTextHasOperatingHours(
        'Избирательные участки открыты с 8:00 до 20:00. Приходите и сделайте свой выбор!',
      ),
      false,
    )
    assert.equal(
      newsTextHasOperatingHours(
        'Детский спортивно-развлекательный лагерь Lazoorka Пн–пт, 10:00–17:00',
      ),
      false,
    )
  })

  it('skips café-adjacent clocks in weekly Krasnoe bulletin', () => {
    const text =
      'График работы "Красного Озера" с 9 по 15 ноября. Кафе (коттеджный поселок): ежедневно, с 10:00 до 18:00 Кресельный подъемник №10: закрыт'
    // No alpine clock range — only café.
    assert.equal(extractOperatingClockFromNewsText(text), null)
  })

  it('marks past named days as stale', () => {
    assert.equal(
      newsHoursDayIsPast('20.11', '2026-11-19T12:00:00Z', Date.parse('2026-11-28T10:00:00Z')),
      true,
    )
    assert.equal(
      newsHoursDayIsPast('28.11', '2026-11-27T12:00:00Z', Date.parse('2026-11-28T10:00:00Z')),
      false,
    )
  })
})

describe('enrichHoursFromImportant', () => {
  it('keeps primary periods and adds news overlay', () => {
    const important = [
      {
        id: 'krasnoe-tg-1864',
        resortId: 'krasnoe-ozero',
        title: 'Красное озеро: UPD:',
        body: 'Завтра, 28.11 открывается УЧЕБНЫЙ СКЛОН №10! График работы: 12.00 - 21.45',
        publishedAt: '2026-11-27T12:00:00Z',
        sourceUrl: 'https://t.me/redlakeclub/1864',
      },
    ]
    const prev = [
      {
        resortId: 'krasnoe-ozero',
        scrapedAt: '2026-11-27T07:00:00Z',
        sourceUrl: 'https://krasnoeozero.ru/grafik/',
        summary: 'Подъемник кресельный №10: закрыт',
        periods: [],
        status: 'ok',
        slopesOpen: true,
      },
    ]
    const next = enrichHoursFromImportant(prev, important, {
      nowMs: Date.parse('2026-11-28T10:00:00Z'),
    })
    const h = next.find((x) => x.resortId === 'krasnoe-ozero')
    assert.ok(h)
    assert.equal(h.hoursNote, undefined)
    assert.equal(h.slopesOpen, true)
    assert.equal(h.sourceUrl, 'https://krasnoeozero.ru/grafik/')
    assert.equal(h.summary, 'Подъемник кресельный №10: закрыт')
    assert.deepEqual(h.periods, [])
    assert.equal(h.newsSummary, '28.11: 12:00–21:45')
    assert.equal(h.newsPeriods[0].open, '12:00')
    assert.equal(h.newsSourceUrl, 'https://t.me/redlakeclub/1864')
  })

  it('does not wipe Okhta weekday primary when news applies', () => {
    const important = [
      {
        id: 'okhta-tg-10554',
        resortId: 'okhta-park',
        title: 'Охта',
        body: 'Ждем вас уже завтра на склоне с 09:00 до 22:30!',
        publishedAt: '2026-11-27T15:00:00Z',
        sourceUrl: 'https://t.me/OhtaPark/10554',
      },
    ]
    const prev = [
      {
        resortId: 'okhta-park',
        scrapedAt: '2026-11-28T01:47:00Z',
        sourceUrl: 'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/',
        summary: 'пн–пт: 11:00–22:30\nсб–вс: 9:00–22:30',
        periods: [
          { days: 'пн–пт', open: '11:00', close: '22:30' },
          { days: 'сб–вс', open: '9:00', close: '22:30' },
        ],
        status: 'ok',
        slopesOpen: true,
      },
    ]
    const next = enrichHoursFromImportant(prev, important, {
      nowMs: Date.parse('2026-11-28T10:00:00Z'),
    })
    const h = next.find((x) => x.resortId === 'okhta-park')
    assert.ok(h)
    assert.equal(h.periods.length, 2)
    assert.equal(h.periods[0].days, 'пн–пт')
    assert.equal(h.newsPeriods[0].open, '9:00')
    assert.equal(h.hoursNote, undefined)
  })

  it('detects legacy wiped snapshots via hoursNote only', () => {
    assert.equal(
      isLegacyNewsWipedSnapshot({
        hoursNote: 'из новости',
        periods: [{ days: '28.11', open: '9:00', close: '22:30' }],
        sourceUrl: 'https://t.me/OhtaPark/10554',
      }),
      true,
    )
    assert.equal(
      isLegacyNewsWipedSnapshot({
        periods: [
          { days: 'пн–пт', open: '11:00', close: '22:30' },
        ],
        sourceUrl: 'https://www.ohtapark.ru/',
      }),
      false,
    )
    // Putilovo: TG is the legitimate primary source, not a news wipe.
    assert.equal(
      isLegacyNewsWipedSnapshot({
        periods: [{ days: 'по сеансам', open: '12:00', close: '19:00' }],
        sourceUrl: 'https://t.me/SPORTPARKPUTILOVO/23',
      }),
      false,
    )
  })

  it('picks newest applicable post per resort', () => {
    const map = collectNewsHoursByResort(
      [
        {
          id: 'a',
          resortId: 'okhta-park',
          title: 'old',
          body: 'на склоне с 10:00 до 20:00',
          publishedAt: '2026-11-20T12:00:00Z',
        },
        {
          id: 'b',
          resortId: 'okhta-park',
          title: 'new',
          body: 'Ждем вас уже завтра на склоне с 09:00 до 22:30!',
          publishedAt: '2026-11-27T12:00:00Z',
        },
      ],
      { nowMs: Date.parse('2026-11-28T10:00:00Z') },
    )
    assert.equal(map.get('okhta-park').periods[0].open, '9:00')
  })
})

describe('news-hours wiring', () => {
  it('hourly important scrape writes hours.json and workflow commits it', () => {
    const importantSrc = readFileSync(join(root, 'scripts/scrape-important.mjs'), 'utf8')
    assert.match(importantSrc, /enrichHoursFromImportant/)
    assert.match(importantSrc, /hours\.json/)

    const dailySrc = readFileSync(join(root, 'scripts/scrape.mjs'), 'utf8')
    assert.match(dailySrc, /enrichHoursFromImportant/)

    const wf = readFileSync(join(root, '.github/workflows/important-refresh.yml'), 'utf8')
    assert.match(wf, /hours\.json/)

    const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
    // Home cards never show «из новости»; news hours use highlighted extra line.
    assert.doesNotMatch(cardSrc, /resort-card__hours-note/)
    assert.doesNotMatch(cardSrc, /h\?\.hoursNote|hours\.hoursNote/)
    assert.match(cardSrc, /cardNewsHoursText/)
    assert.match(cardSrc, /resort-card__hours--extra/)
    const pageSrc = readFileSync(join(root, 'src/pages/ResortPage.tsx'), 'utf8')
    assert.doesNotMatch(pageSrc, /hours\?\.hoursNote/)
    assert.match(pageSrc, /detail-hours-extra/)
    assert.match(pageSrc, /cardNewsHoursText/)
  })

  it('no active resort has news wiping primary (hoursNote / TG-only periods)', () => {
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const resorts = JSON.parse(readFileSync(join(root, 'public/data/resorts.json'), 'utf8'))
    const active = new Set(resorts.filter((r) => r.status === 'active').map((r) => r.id))
    for (const h of hours) {
      if (!active.has(h.resortId)) continue
      assert.equal(h.hoursNote, undefined, h.resortId)
      assert.equal(isLegacyNewsWipedSnapshot(h), false, h.resortId)
      // News overlay never lives in primary periods.
      if (h.newsPeriods?.length) {
        assert.ok(
          Array.isArray(h.periods),
          `${h.resortId}: primary periods array required when news overlay present`,
        )
      }
    }
    const okhta = hours.find((h) => h.resortId === 'okhta-park')
    const kras = hours.find((h) => h.resortId === 'krasnoe-ozero')
    assert.ok(okhta?.newsPeriods?.length)
    assert.ok(okhta.periods?.length >= 2)
    assert.match(okhta.sourceUrl || '', /ohtapark\.ru/i)
    assert.ok(kras?.newsPeriods?.length)
    assert.match(kras.sourceUrl || '', /krasnoeozero\.ru/i)
    assert.match(kras.summary || '', /подъемник|подъёмник/i)
  })
})
