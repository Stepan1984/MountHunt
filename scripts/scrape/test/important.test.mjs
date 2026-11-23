import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  detectKrasnoeImportantFromFlags,
  detectLazurnyeImportant,
  detectOkhtaImportant,
  detectZoldolImportant,
  extractPublishedAtFromHtml,
  mergeImportantFailSoft,
  mergeImportantFromDailyScrape,
} from '../lib/important.mjs'
import { httpDateToIso, ruDateLabelToIso } from '../lib/parse.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

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
  it('package + workflow expose scrape:important every 2h', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['scrape:important'], 'node scripts/scrape-important.mjs')

    const wf = readFileSync(join(root, '.github/workflows/important-refresh.yml'), 'utf8')
    assert.match(wf, /cron:\s*'0 \*\/2 \* \* \*'/)
    assert.match(wf, /npm run scrape:important/)
    assert.match(wf, /important\.json/)
    assert.doesNotMatch(wf, /playwright|tesseract|IGORA_/i)
  })
})
