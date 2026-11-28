import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  alpineSlopesClosedMatch,
  alpineSlopesOpenMatch,
  appendHoursExtraNote,
  detectDropParkSlopeStatus,
  detectKrasnoeSlopeStatus,
  detectLazurnyeSlopeStatus,
  detectOkhtaSlopeStatus,
  detectPuhtolovaSlopeStatus,
  detectSnezhnySlopeStatus,
  detectTuutariSlopeStatus,
  detectZoldolSlopeStatus,
  hasFreshImportantOpen,
  hasPresaleSignal,
  resolveSlopeOpenCollision,
} from '../lib/slope-status.mjs'
import { hoursSnapshot } from '../lib/parse.mjs'
import { detectPutilovoSlopeStatus } from '../resorts/putilovo-park.mjs'

describe('slope-status collision policy', () => {
  it('clear open wins over predprodazh; weak open does not', () => {
    assert.equal(
      resolveSlopeOpenCollision({ clearOpen: true, presale: true }),
      true,
    )
    assert.equal(
      resolveSlopeOpenCollision({ weakOpen: true, presale: true }),
      false,
    )
    assert.equal(resolveSlopeOpenCollision({ presale: true }), false)
  })

  it('explicit closed beats weak open; clear open still needs no closed', () => {
    assert.equal(
      resolveSlopeOpenCollision({ weakOpen: true, closed: true }),
      false,
    )
    assert.equal(
      resolveSlopeOpenCollision({ clearOpen: true, closed: true }),
      false,
    )
    assert.equal(
      resolveSlopeOpenCollision({ clearOpen: true, dayClosed: true }),
      false,
    )
  })

  it('weak open alone → open; empty signals → closed (fail-soft)', () => {
    assert.equal(resolveSlopeOpenCollision({ weakOpen: true }), true)
    assert.equal(resolveSlopeOpenCollision({}), false)
  })

  it('hasPresaleSignal / hasFreshImportantOpen helpers', () => {
    assert.equal(hasPresaleSignal('Открыта предпродажа ски-пассов'), true)
    assert.equal(hasPresaleSignal('Сезон открыт'), false)
    assert.equal(
      hasFreshImportantOpen([{ id: 'tuutari-season-open' }], 'tuutari-season-open'),
      true,
    )
    assert.equal(
      hasFreshImportantOpen([{ id: 'tuutari-season-prep' }], 'tuutari-season-open'),
      false,
    )
  })
})

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

  it('Okhta weak alpine + предпродажа without clear open → slopesOpen false', () => {
    // Generic «склоны открыты» alone is weak — must not beat leftover predprodazh.
    const trails = `<html><body>
      <p>Склоны открыты</p>
      <p>Открыта предпродажа сезонных ски-пассов</p>
    </body></html>`
    assert.equal(detectOkhtaSlopeStatus({ trailsHtml: trails }).slopesOpen, false)
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

  it('Puhtolova ignores stale news-archive alpine phrases', () => {
    const stale =
      '<html><body><p>15.11.2024 Открытие центрального склона. Склоны открыты!</p></body></html>'
    assert.equal(detectPuhtolovaSlopeStatus([], stale).slopesOpen, false)
    assert.equal(
      detectPuhtolovaSlopeStatus([{ id: 'puhtolova-season-open' }], stale).slopesOpen,
      true,
    )
  })

  it('Lazurnye opens only via fresh important; home alpine alone stays closed', () => {
    const home =
      '<html><body><p>Горнолыжный сезон открыт! Старый футер 2023</p></body></html>'
    assert.equal(detectLazurnyeSlopeStatus(home, []).slopesOpen, false)
    assert.equal(
      detectLazurnyeSlopeStatus(home, [{ id: 'lazurnye-season-open' }]).slopesOpen,
      true,
    )
    const closedHome =
      '<html><body><p>Сезон 2026 закрыт!</p><p>Горнолыжный сезон открыт в архиве</p></body></html>'
    assert.equal(detectLazurnyeSlopeStatus(closedHome, []).slopesOpen, false)
  })

  it('Snezhny ignores news-archive open; hours notice may open', () => {
    const archive =
      '<html><body><p>10.03.2024 Горнолыжный сезон открыт. Склоны открыты</p></body></html>'
    assert.equal(
      detectSnezhnySlopeStatus({ newsHtml: archive, hoursNoticeHtml: '' }).slopesOpen,
      false,
    )
    const notice =
      '<html><body><p>Горнолыжный сезон открыт. Режим работы склонов</p></body></html>'
    assert.equal(
      detectSnezhnySlopeStatus({ newsHtml: archive, hoursNoticeHtml: notice }).slopesOpen,
      true,
    )
  })

  it('Putilovo ignores Wayback site HTML for open', () => {
    const archiveOpen =
      '<html><body><p>Горнолыжный сезон открыт. Сноупарк работает</p></body></html>'
    // Stale Wayback snapshot must not invent open when live site is unreachable.
    assert.equal(
      detectPutilovoSlopeStatus(archiveOpen, '', { siteIsArchive: true }).slopesOpen,
      false,
    )
    // Same copy from a live (non-archive) fetch may still open.
    assert.equal(
      detectPutilovoSlopeStatus(archiveOpen, '', { siteIsArchive: false }).slopesOpen,
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
    assert.equal('brushesOpen' in closed, false)

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
    assert.equal(withAirbag.brushesOpen, true)
    assert.match(withAirbag.note || '', /подушка|airbag/i)

    const brushesClosed = detectKrasnoeSlopeStatus(
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
            Наименование: 'Щётки (трасса №9)',
            '25.11.2026': 'закрыто',
          },
        ],
      },
    )
    assert.equal(brushesClosed.brushesOpen, false)
  })

  it('Zoldol closed banner → slopesOpen false', () => {
    const html =
      '<html><body><p>Горнолыжные склоны закрыты на летний период</p></body></html>'
    assert.equal(detectZoldolSlopeStatus(html).slopesOpen, false)
  })

  it('hoursSnapshot writes slopesOpen / brushesOpen only when boolean', () => {
    const withFlag = hoursSnapshot({
      resortId: 'okhta-park',
      summary: 'пн–пт: 11:00–22:30',
      slopesOpen: true,
    })
    assert.equal(withFlag.slopesOpen, true)
    const withBrushes = hoursSnapshot({
      resortId: 'drop-park',
      summary: 'щётки работают',
      slopesOpen: false,
      brushesOpen: true,
    })
    assert.equal(withBrushes.brushesOpen, true)
    const omitted = hoursSnapshot({
      resortId: 'x',
      summary: 'нет данных',
    })
    assert.equal('slopesOpen' in omitted, false)
    assert.equal('brushesOpen' in omitted, false)
  })

  it('appendHoursExtraNote dedupes', () => {
    const note = 'Щётки (Джиб Палас) работают'
    const once = appendHoursExtraNote('По прайсу сноупарка — будни: 11:00–23:00', note)
    assert.match(once, /щётки/i)
    assert.equal(appendHoursExtraNote(once, note), once)
  })
})
