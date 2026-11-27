import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alpineSlopesClosedMatch,
  alpineSlopesOpenMatch,
  appendHoursExtraNote,
  detectDropParkSlopeStatus,
  detectKrasnoeSlopeStatus,
  detectOkhtaSlopeStatus,
  detectTuutariSlopeStatus,
  detectZoldolSlopeStatus,
} from '../lib/slope-status.mjs'
import { hoursSnapshot } from '../lib/parse.mjs'

describe('slope-status detectors', () => {
  it('matches alpine open / closed phrases', () => {
    assert.equal(alpineSlopesOpenMatch('Горнолыжный сезон открыт! Стартует сезон'), true)
    assert.equal(alpineSlopesClosedMatch('Горнолыжные склоны закрыты на летний период'), true)
    assert.equal(alpineSlopesOpenMatch('Щётки открыты в Джиб Палас'), false)
  })

  it('Okhta opening → slopesOpen true', () => {
    const trails =
      '<html><body><p>Открытие 22 ноября! С 22 ноября будет открыт первый склон</p></body></html>'
    const lenta =
      '<html><body><p>Горнолыжный сезон открыт! Сегодня стартует сезон 2026–2027</p></body></html>'
    assert.equal(
      detectOkhtaSlopeStatus({ trailsHtml: trails, lentaHtml: lenta }).slopesOpen,
      true,
    )
  })

  it('Okhta trails widget Открыто / «будут работать» → slopesOpen true over предпродажа', () => {
    const trails = `<html><body>
      <p class="service_widget_cost_caption">Горнолыжные трассы</p>
      <div class="service_widget_status service_widget_status--open"><p>Открыто</p></div>
      <p>Уважаемые гости С 28 ноября будут работать первый и второй склоны</p>
      <p>Открыта предпродажа сезонных ски-пассов</p>
    </body></html>`
    const lenta =
      '<html><body><p>подготовка к завтрашнему открытию второго горнолыжного склона. Ждем вас уже завтра на склоне</p><p>Открыли предпродажу</p></body></html>'
    assert.equal(
      detectOkhtaSlopeStatus({ trailsHtml: trails, lentaHtml: lenta }).slopesOpen,
      true,
    )
  })

  it('Okhta day-closed / no open → slopesOpen false', () => {
    const trails = '<html><body><p>Открыта предпродажа сезонных ски-пассов</p></body></html>'
    assert.equal(
      detectOkhtaSlopeStatus({ trailsHtml: trails }, { dayClosed: true }).slopesOpen,
      false,
    )
  })

  it('Tuutari ignores stale news-archive alpine phrases', () => {
    const stale =
      '<html><body><p>01.12.2025 Открытие сезона 03 декабря 2021 Для вас открыты детский-учебный и центральный склоны.</p></body></html>'
    assert.equal(detectTuutariSlopeStatus([], stale).slopesOpen, false)
    assert.equal(
      detectTuutariSlopeStatus([{ id: 'tuutari-season-open' }], stale).slopesOpen,
      true,
    )
  })

  it('Drop Park: season finished → alpine closed; brushes note when Jib Palace open', () => {
    const page = '<html><body><p>Сноупарк прайс 11:00–23:00</p></body></html>'
    const tg =
      '<html><body><p>Сезон 2025/26 закончен, всех благодарим</p>' +
      '<p>ВТОРАЯ ЛИНИЯ В ДЖИБ ПАЛАС: мы открыли вторую линию! тренеру на щетках</p></body></html>'
    const st = detectDropParkSlopeStatus(page, tg)
    assert.equal(st.slopesOpen, false)
    assert.equal(st.brushesOpen, true)
    assert.match(st.note || '', /щётки/i)
  })

  it('Drop Park: alpine open only with season-open copy (not brushes)', () => {
    const page =
      '<html><body><p>Горнолыжный сезон открыт. Сноупарк работает ежедневно</p></body></html>'
    const tg = '<html><body><p>Сезон 2026/27 открыт</p></body></html>'
    const st = detectDropParkSlopeStatus(page, tg)
    assert.equal(st.slopesOpen, true)
  })

  it('Krasnoe closed-until-season → slopesOpen false; airbag note when open', () => {
    const closed = detectKrasnoeSlopeStatus({
      closedUntilSeason: true,
      allClosed: true,
      slopesCount: 10,
      dateCol: '25.11.2026',
    })
    assert.equal(closed.slopesOpen, false)

    const withAirbag = detectKrasnoeSlopeStatus(
      {
        closedUntilSeason: true,
        allClosed: true,
        slopesCount: 10,
        dateCol: '25.11.2026',
      },
      {
        dateCol: '25.11.2026',
        rows: [
          {
            Наименование: 'Воздушная подушка (airbag)',
            '25.11.2026': '10:00-18:00',
          },
        ],
      },
    )
    assert.equal(withAirbag.slopesOpen, false)
    assert.match(withAirbag.note || '', /подушка|airbag/i)
  })

  it('Zoldol closed banner → slopesOpen false', () => {
    const html =
      '<html><body><p>Горнолыжные склоны закрыты на летний период</p></body></html>'
    assert.equal(detectZoldolSlopeStatus(html).slopesOpen, false)
  })

  it('hoursSnapshot writes slopesOpen only when boolean', () => {
    const withFlag = hoursSnapshot({
      resortId: 'okhta-park',
      summary: 'пн–пт: 11:00–22:30',
      slopesOpen: true,
    })
    assert.equal(withFlag.slopesOpen, true)
    const omitted = hoursSnapshot({
      resortId: 'x',
      summary: 'нет данных',
    })
    assert.equal('slopesOpen' in omitted, false)
  })

  it('appendHoursExtraNote dedupes', () => {
    const note = 'Щётки (Джиб Палас) работают — это не горнолыжные склоны'
    const once = appendHoursExtraNote('По прайсу сноупарка — будни: 11:00–23:00', note)
    assert.match(once, /щётки/i)
    assert.equal(appendHoursExtraNote(once, note), once)
  })
})
