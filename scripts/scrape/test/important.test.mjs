import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  detectDropParkImportant,
  detectKrasnoeImportantFromFlags,
  detectKrasnoeTelegramImportant,
  detectLazurnyeImportant,
  detectLazurnyeImportantFromPages,
  detectOkhtaImportant,
  detectPuhtolovaImportant,
  detectTuutariImportant,
  detectZoldolImportant,
  extractPublishedAtFromHtml,
  krasnoeTelegramPostRelevant,
  mergeImportantFailSoft,
  mergeImportantFromDailyScrape,
  parseKrasnoeSiteNewsTexts,
} from '../lib/important.mjs'
import { httpDateToIso, ruDateLabelToIso } from '../lib/parse.mjs'
import { parseTelegramChannelHtml } from '../lib/telegram.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const krasnoeTgFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/redlakeclub-tg.html',
)

describe('important detectors', () => {
  it('detects Zoldol closed slopes from hours copy', () => {
    const html = '<html><body><p>Горнолыжные склоны закрыты на летний период</p></body></html>'
    const items = detectZoldolImportant(html, 'https://zoldol.ru/vremya-raboty')
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'zoldol-slopes-closed')
    assert.equal(items[0].severity, 'warn')
  })

  it('clears Zoldol when banner gone', () => {
    const html = '<html><body><p>Склоны открыты ежедневно</p></body></html>'
    assert.equal(detectZoldolImportant(html, 'https://zoldol.ru/vremya-raboty').length, 0)
  })

  it('detects Lazurnye season closed', () => {
    const html = '<html><body><h1>Сезон 2026 закрыт!</h1></body></html>'
    const items = detectLazurnyeImportant(html, 'https://lazoorsnow.ru/')
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'lazurnye-season-closed')
  })

  it('detects Okhta presale', () => {
    const html = '<html><body><p>Открыта предпродажа сезонных ски-пассов</p></body></html>'
    const items = detectOkhtaImportant(html, 'https://winter.ohtapark.ru/')
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'okhta-presale')
    assert.equal(items[0].severity, 'info')
  })

  it('detects Okhta season opening and prefers it over nav presale', () => {
    const trails =
      '<html><body><p>Открыли предпродажу</p><p>Открытие 22 ноября!</p><p>С 22 ноября будет открыт первый склон</p></body></html>'
    const lenta =
      '<html><body><p>Горнолыжный сезон открыт! Сегодня стартует сезон 2026–2027</p><time datetime="2026-11-22T09:05:00+03:00">09:05</time></body></html>'
    const items = detectOkhtaImportant(
      { trailsHtml: trails, lentaHtml: lenta },
      'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/',
      {
        trailsUrl: 'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/',
        lentaUrl: 'https://www.ohtapark.ru/lenta/',
        winterUrl: 'https://winter.ohtapark.ru/',
      },
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'okhta-season-open')
    assert.equal(items[0].severity, 'info')
    assert.match(items[0].title, /сезон открыт/i)
    assert.equal(items[0].sourceUrl, 'https://www.ohtapark.ru/lenta/')
    assert.equal(items[0].publishedAt, '2026-11-22T06:05:00Z')
  })

  it('clears Okhta when neither opening nor presale remain', () => {
    const html = '<html><body><p>Горнолыжные трассы работают ежедневно</p></body></html>'
    assert.equal(detectOkhtaImportant(html, 'https://www.ohtapark.ru/').length, 0)
  })

  it('sets Krasnoe publishedAt from schedule date column', () => {
    const items = detectKrasnoeImportantFromFlags(
      {
        closedUntilSeason: true,
        allClosed: true,
        slopesCount: 2,
        dateCol: '21.11.2026',
      },
      'https://krasnoeozero.ru/grafik/',
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].publishedAt, '2026-11-21T00:00:00Z')
    assert.notEqual(items[0].publishedAt, items[0].updatedAt)
  })

  it('uses Last-Modified as publishedAt fallback for Zoldol', () => {
    const html = '<html><body><p>Горнолыжные склоны закрыты на летний период</p></body></html>'
    const items = detectZoldolImportant(html, 'https://zoldol.ru/vremya-raboty', {
      lastModified: 'Fri, 20 Nov 2026 10:23:54 GMT',
    })
    assert.equal(items[0].publishedAt, '2026-11-20T10:23:54Z')
  })

  it('prefers article:published_time over Last-Modified', () => {
    const html =
      '<html><head><meta property="article:published_time" content="2026-11-10T08:00:00Z"></head><body><p>Горнолыжные склоны закрыты на летний период</p></body></html>'
    const items = detectZoldolImportant(html, 'https://zoldol.ru/vremya-raboty', {
      lastModified: 'Fri, 20 Nov 2026 10:23:54 GMT',
    })
    assert.equal(items[0].publishedAt, '2026-11-10T08:00:00Z')
  })
})

describe('publication date helpers', () => {
  it('parses RU date labels and HTTP dates', () => {
    assert.equal(ruDateLabelToIso('21.11.2026'), '2026-11-21T00:00:00Z')
    assert.equal(httpDateToIso('Fri, 20 Nov 2026 10:23:54 GMT'), '2026-11-20T10:23:54Z')
  })

  it('extracts published_time from HTML', () => {
    const html =
      '<html><head><meta property="article:published_time" content="2026-03-01T12:00:00+03:00"></head><body></body></html>'
    assert.equal(extractPublishedAtFromHtml(html), '2026-03-01T09:00:00Z')
  })
})

describe('mergeImportantFailSoft', () => {
  const prev = [
    {
      id: 'zoldol-slopes-closed',
      resortId: 'zolotaya-dolina',
      title: 'old zoldol',
      severity: 'warn',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'okhta-presale',
      resortId: 'okhta-park',
      title: 'old okhta',
      severity: 'info',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'manual-keep',
      title: 'ручная заметка',
      severity: 'info',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]

  it('clears managed id when check succeeds with empty items', () => {
    const next = mergeImportantFailSoft(prev, [
      { resortId: 'zolotaya-dolina', ok: true, items: [] },
      { resortId: 'okhta-park', ok: false, error: 'timeout' },
    ])
    const ids = next.map((i) => i.id).sort()
    assert.deepEqual(ids, ['manual-keep', 'okhta-presale'])
  })

  it('updates managed id on success', () => {
    const next = mergeImportantFailSoft(prev, [
      {
        resortId: 'okhta-park',
        ok: true,
        items: [
          {
            id: 'okhta-presale',
            resortId: 'okhta-park',
            title: 'new okhta',
            severity: 'info',
            updatedAt: '2026-11-21T12:00:00Z',
          },
        ],
      },
    ])
    assert.equal(next.find((i) => i.id === 'okhta-presale')?.title, 'new okhta')
    assert.ok(next.find((i) => i.id === 'zoldol-slopes-closed'), 'untouched resort kept')
  })

  it('preserves publishedAt when re-scrape omits it', () => {
    const withPub = [
      {
        id: 'okhta-presale',
        resortId: 'okhta-park',
        title: 'old okhta',
        severity: 'info',
        updatedAt: '2026-01-01T00:00:00Z',
        publishedAt: '2026-11-19T13:14:57Z',
      },
    ]
    const next = mergeImportantFailSoft(withPub, [
      {
        resortId: 'okhta-park',
        ok: true,
        items: [
          {
            id: 'okhta-presale',
            resortId: 'okhta-park',
            title: 'new okhta',
            severity: 'info',
            updatedAt: '2026-11-21T18:00:00Z',
          },
        ],
      },
    ])
    assert.equal(next.find((i) => i.id === 'okhta-presale')?.publishedAt, '2026-11-19T13:14:57Z')
    assert.equal(next.find((i) => i.id === 'okhta-presale')?.updatedAt, '2026-11-21T18:00:00Z')
  })
})

describe('mergeImportantFromDailyScrape', () => {
  it('clears stale managed items when daily scrape succeeds without them', () => {
    const prev = [
      {
        id: 'lazurnye-season-closed',
        resortId: 'lazurnye-ozera',
        title: 'old',
        severity: 'warn',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const next = mergeImportantFromDailyScrape(prev, [], [
      { id: 'lazurnye-ozera', error: null, prices: 'ok', hours: 'ok' },
    ])
    assert.equal(
      next.filter((i) => i.id === 'lazurnye-season-closed').length,
      0,
    )
    assert.ok(next.find((i) => i.id === 'mvp-data-note'))
  })

  it('keeps previous on hard fail', () => {
    const prev = [
      {
        id: 'lazurnye-season-closed',
        resortId: 'lazurnye-ozera',
        title: 'old',
        severity: 'warn',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const next = mergeImportantFromDailyScrape(prev, [], [
      { id: 'lazurnye-ozera', error: 'boom', prices: 'failed', hours: null },
    ])
    assert.ok(next.find((i) => i.id === 'lazurnye-season-closed'))
  })
})

describe('important workflow wiring', () => {
  it('package + workflow expose scrape:important hourly', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['scrape:important'], 'node scripts/scrape-important.mjs')

    const wf = readFileSync(join(root, '.github/workflows/important-refresh.yml'), 'utf8')
    assert.match(wf, /cron:\s*'0 \* \* \* \*'/)
    assert.match(wf, /npm run scrape:important/)
    assert.match(wf, /important\.json/)
    assert.doesNotMatch(wf, /playwright|tesseract|IGORA_/i)
  })
})

describe('catalog source detectors', () => {
  it('detects Tuutari season prep from dated news', () => {
    const html =
      '<html><body><p>20.11.2026 Набор в детские группы</p><p>18.11.2026 Сезон 2026-2027 Ждем первых морозов и в бой !</p><p>15.11.2026 Горнолыжная школа</p></body></html>'
    const items = detectTuutariImportant(html, 'https://www.2-park.ru/about/news/')
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'tuutari-season-prep')
    assert.equal(items[0].publishedAt, '2026-11-18T00:00:00Z')
  })

  it('detects Tuutari season open over prep when fresh', () => {
    const html =
      '<html><body><p>20.11.2026 Открытие сезона — центральный склон</p><p>18.11.2026 Сезон 2026-2027 Ждем первых морозов</p></body></html>'
    const items = detectTuutariImportant(html, 'https://www.2-park.ru/about/news/')
    assert.equal(items[0].id, 'tuutari-season-open')
  })

  it('ignores stale Puhtolova season open news', () => {
    const html =
      '<html><body><p>17.12.2025 Открытие сезона 20 декабря!</p><p>08.03.2026 SUPER четверг</p></body></html>'
    assert.equal(detectPuhtolovaImportant(html, 'https://puhgora.ru/o-kurorte/novosti-i-akcii').length, 0)
  })

  it('detects Drop Park off-season from TG about', () => {
    const tg =
      '<html><body><div class="tgme_page_description">Сезон 2025/26 закончен, всех благодарим</div></body></html>'
    const { items, ok } = detectDropParkImportant(
      { pageHtml: '<html><body><p>Сезонный абонемент 2026/27</p></body></html>', tgHtml: tg },
      'https://t.me/s/dropsnowpark',
      { tgUrl: 'https://t.me/s/dropsnowpark', pageFetched: true, tgFetched: true },
    )
    assert.equal(ok, true)
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'drop-off-season')
  })

  it('clears Drop Park off-season when opening announced', () => {
    const page = '<html><body><p>Горнолыжный сезон открыт на сноупарке</p></body></html>'
    const tg = '<html><body><p>Сезон 2025/26 закончен</p></body></html>'
    const { items, ok } = detectDropParkImportant(
      { pageHtml: page, tgHtml: tg },
      'https://drop-park.ru/snow-park',
      { pageFetched: true, tgFetched: true },
    )
    assert.equal(ok, true)
    assert.equal(items.length, 0)
  })

  it('does not clear Drop Park off-season when page+TG empty (non-authoritative)', () => {
    const { items, ok } = detectDropParkImportant(
      { pageHtml: '', tgHtml: '' },
      'https://t.me/s/dropsnowpark',
      { pageFetched: false, tgFetched: false },
    )
    assert.equal(ok, false)
    assert.equal(items.length, 0)
    const prev = [
      {
        id: 'drop-off-season',
        resortId: 'drop-park',
        title: 'old drop',
        severity: 'info',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const next = mergeImportantFailSoft(prev, [{ resortId: 'drop-park', ok: false, items: [] }])
    assert.ok(next.find((i) => i.id === 'drop-off-season'))
  })

  it('does not clear Drop Park when TG down and page has no season signal', () => {
    const { items, ok } = detectDropParkImportant(
      { pageHtml: '<html><body><p>Сезонный абонемент 2026/27</p></body></html>', tgHtml: '' },
      'https://drop-park.ru/snow-park',
      { pageFetched: true, tgFetched: false },
    )
    assert.equal(ok, false)
    assert.equal(items.length, 0)
    const prev = [
      {
        id: 'drop-off-season',
        resortId: 'drop-park',
        title: 'old drop',
        severity: 'info',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const next = mergeImportantFromDailyScrape(prev, [], [
      { id: 'drop-park', error: null, prices: 'ok', hours: 'partial', importantInconclusive: true },
    ])
    assert.ok(next.find((i) => i.id === 'drop-off-season'))
  })

  it('detects Lazurnye open from fresh news over home closed banner', () => {
    const home = '<html><body><h1>Сезон 2026 закрыт!</h1></body></html>'
    const news =
      '<html><body><p>20.11.2026 Lazoorka открывает сезон: 3 трассы и новый режим</p></body></html>'
    const items = detectLazurnyeImportantFromPages(
      { homeHtml: home, newsHtml: news },
      'https://lazoorsnow.ru/',
      { homeUrl: 'https://lazoorsnow.ru/', newsUrl: 'https://lazoorsnow.ru/news' },
    )
    assert.equal(items[0].id, 'lazurnye-season-open')
  })
})

describe('Krasnoe Telegram (@redlakeclub)', () => {
  it('parses posts from t.me/s HTML fixture', () => {
    const html = readFileSync(krasnoeTgFixture, 'utf8')
    const posts = parseTelegramChannelHtml(html)
    assert.ok(posts.length >= 6)
    const schedule = posts.find((p) => p.postId === '1839')
    assert.ok(schedule)
    assert.match(schedule.text, /График работы курорта/i)
    assert.equal(schedule.url, 'https://t.me/redlakeclub/1839')
    assert.equal(schedule.publishedAt, '2026-11-16T10:10:37Z')
  })

  it('includes schedule and giveaway; skips booking/partner fluff', () => {
    assert.equal(
      krasnoeTelegramPostRelevant(
        'График работы курорта «Красное Озеро» с 16 по 22 ноября. Кресельный подъёмник №10: закрыт',
      ),
      true,
    )
    assert.equal(
      krasnoeTelegramPostRelevant('🎉 РОЗЫГРЫШ СКИ‑ПАССОВ на курорте «Красное Озеро»!'),
      true,
    )
    assert.equal(
      krasnoeTelegramPostRelevant(
        'УСПЕЙ ЗАБРОНИРОВАТЬ коттедж на Новый год на горнолыжном курорте «Красное Озеро»!',
      ),
      false,
    )
    assert.equal(
      krasnoeTelegramPostRelevant('Pet-friendly: ищем партнёров по товарам для питомцев'),
      false,
    )
  })

  it('includes colloquial season-open posts (redlakeclub/1849 style)', () => {
    const open1849 = `МЫ ОТКРЫВАЕМСЯ
Друзья, в эту субботу, 28.11 стартует зимний сезон!
Снежная магия уже в процессе: пушки трудятся, склоны становятся идеальными!
Запускаем
Основную трассу №4
Учебную трассу №10
Кресельный подъемник №1
Ленточный подъемник №6
Так же будет работать прокат горнолыжного оборудования и служба инструкторов!`
    assert.equal(krasnoeTelegramPostRelevant(open1849), true)
    assert.equal(krasnoeTelegramPostRelevant('МЫ ОТКРЫВАЕМСЯ — ждём всех на склонах'), true)
    assert.equal(krasnoeTelegramPostRelevant('Друзья, 28.11 стартует зимний сезон!'), true)
    assert.equal(
      krasnoeTelegramPostRelevant('ЗАПУСТИЛИ ПУШКИ. Сезон совсем скоро'),
      false,
      'snow guns / soon ≠ open announcement',
    )
    const items = detectKrasnoeTelegramImportant(
      `<div class="tgme_widget_message" data-post="redlakeclub/1849">
        <div class="tgme_widget_message_text">${open1849.replace(/\n/g, '<br/>')}</div>
        <a class="tgme_widget_message_date" href="https://t.me/redlakeclub/1849">
          <time datetime="2026-11-25T17:10:56+00:00"></time>
        </a>
      </div>`,
      'https://t.me/s/redlakeclub',
    )
    assert.ok(items.some((i) => i.id === 'krasnoe-tg-1849'), `got ${items.map((i) => i.id)}`)
    const card = items.find((i) => i.id === 'krasnoe-tg-1849')
    assert.equal(card.severity, 'info')
    assert.match(card.title, /открываемся/i)
  })

  it('detects matching posts from fixture HTML', () => {
    const html = readFileSync(krasnoeTgFixture, 'utf8')
    const items = detectKrasnoeTelegramImportant(html, 'https://t.me/s/redlakeclub')
    const ids = items.map((i) => i.id)
    assert.ok(ids.includes('krasnoe-tg-1839'), `expected schedule card, got ${ids.join(',')}`)
    assert.ok(ids.includes('krasnoe-tg-1841'), `expected giveaway card, got ${ids.join(',')}`)
    assert.ok(!ids.includes('krasnoe-tg-1840'), 'booking promo must be skipped')
    assert.ok(!ids.includes('krasnoe-tg-1838'), 'partner ad must be skipped')
    const schedule = items.find((i) => i.id === 'krasnoe-tg-1839')
    assert.match(schedule.title, /Красное озеро/i)
    assert.match(schedule.body || schedule.title, /график|подъёмник|подъемник/i)
    assert.equal(schedule.sourceUrl, 'https://t.me/redlakeclub/1839')
    assert.equal(schedule.publishedAt, '2026-11-16T10:10:37Z')
  })

  it('dedupes Telegram posts against site news titles', () => {
    const html = readFileSync(krasnoeTgFixture, 'utf8')
    const items = detectKrasnoeTelegramImportant(html, 'https://t.me/s/redlakeclub', {
      siteNewsTexts: [
        'График работы курорта Красное Озеро с 16 по 22 ноября',
        'Новый формат проживания - гостиница 3*',
      ],
    })
    assert.ok(!items.some((i) => i.id === 'krasnoe-tg-1839'), 'schedule duplicated on site')
    assert.ok(items.some((i) => i.id === 'krasnoe-tg-1841'), 'giveaway kept')
  })

  it('parses Tilda feed JSON titles for dedupe', () => {
    const texts = parseKrasnoeSiteNewsTexts(
      JSON.stringify({
        posts: [
          { title: 'График работы курорта с 16 по 22 марта', descr: 'Часы работы' },
          { title: 'Скидка -15%', descr: '' },
        ],
      }),
    )
    assert.ok(texts.includes('График работы курорта с 16 по 22 марта'))
    assert.ok(texts.includes('Часы работы'))
  })

  it('keeps previous krasnoe-tg cards when clearPrefixes is false', () => {
    const prev = [
      {
        id: 'krasnoe-slopes-closed',
        resortId: 'krasnoe-ozero',
        title: 'old closed',
        severity: 'warn',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'krasnoe-tg-1839',
        resortId: 'krasnoe-ozero',
        title: 'old tg schedule',
        severity: 'warn',
        updatedAt: '2026-01-01T00:00:00Z',
        publishedAt: '2026-11-16T10:10:37Z',
      },
    ]
    const next = mergeImportantFailSoft(prev, [
      {
        resortId: 'krasnoe-ozero',
        ok: true,
        clearPrefixes: false,
        items: [
          {
            id: 'krasnoe-slopes-closed',
            resortId: 'krasnoe-ozero',
            title: 'new closed',
            severity: 'warn',
            updatedAt: '2026-11-26T12:00:00Z',
          },
        ],
      },
    ])
    assert.equal(next.find((i) => i.id === 'krasnoe-slopes-closed')?.title, 'new closed')
    assert.ok(next.find((i) => i.id === 'krasnoe-tg-1839'), 'TG card kept while TG fetch soft-failed')
  })

  it('clears stale krasnoe-tg cards when TG scrape succeeds', () => {
    const prev = [
      {
        id: 'krasnoe-tg-1000',
        resortId: 'krasnoe-ozero',
        title: 'stale',
        severity: 'info',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]
    const next = mergeImportantFailSoft(prev, [
      {
        resortId: 'krasnoe-ozero',
        ok: true,
        clearPrefixes: true,
        items: [
          {
            id: 'krasnoe-tg-1841',
            resortId: 'krasnoe-ozero',
            title: 'розыгрыш',
            severity: 'info',
            updatedAt: '2026-11-26T12:00:00Z',
          },
        ],
      },
    ])
    assert.ok(!next.find((i) => i.id === 'krasnoe-tg-1000'))
    assert.ok(next.find((i) => i.id === 'krasnoe-tg-1841'))
  })
})
