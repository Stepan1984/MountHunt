import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  detectLazurnyeImportant,
  detectOkhtaImportant,
  detectZoldolImportant,
  mergeImportantFailSoft,
  mergeImportantFromDailyScrape,
} from '../lib/important.mjs'

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
