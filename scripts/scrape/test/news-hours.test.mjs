import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  NEWS_HOURS_CARD_NOTE,
  collectNewsHoursByResort,
  enrichHoursFromImportant,
  extractOperatingClockFromNewsText,
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
    assert.equal(pack.hoursNote, NEWS_HOURS_CARD_NOTE)
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
  it('writes news clocks into hours + hoursNote', () => {
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
    assert.equal(h.hoursNote, 'из новости')
    assert.equal(h.slopesOpen, true)
    assert.equal(h.periods[0].open, '12:00')
    assert.equal(h.sourceUrl, 'https://t.me/redlakeclub/1864')
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
    assert.match(cardSrc, /hoursNote/)
    assert.match(cardSrc, /resort-card__hours-note/)
  })
})
