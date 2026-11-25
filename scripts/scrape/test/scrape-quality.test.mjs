/**
 * Surgical scrape-quality checks (node:test).
 * Run: npm run test:scrape
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { flattenSkipassGroups, mergeSnapshot, parsePrice } from '../lib/parse.mjs'
import {
  clarifyInstructorLabel,
  localizeIgoraDayLabel,
  mergeIgoraPriceTables,
  parseIgoraHours,
  parseIgoraPrices,
  parseIgoraPriceTables,
  supplementIgoraSkiPassFromSnapshot,
} from '../resorts/igora.mjs'
import { parseDropParkPriceList } from '../resorts/drop-park.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('parsePrice', () => {
  it('parses spaced RUB amounts', () => {
    assert.equal(parsePrice('2 280'), 2280)
    assert.equal(parsePrice('333'), 333)
    assert.equal(parsePrice('—'), null)
  })
})

describe('mergeSnapshot fail-soft', () => {
  it('keeps previous items on failed', () => {
    const prev = {
      resortId: 'x',
      status: 'ok',
      items: [{ title: 'a', price: 1 }],
      scrapedAt: '2026-01-01T00:00:00Z',
      sourceUrl: 'https://example.com',
      currency: 'RUB',
    }
    const next = { status: 'failed', note: 'boom', sourceUrl: 'https://example.com/new' }
    const merged = mergeSnapshot(prev, next, 'x', () => ({ resortId: 'x', status: 'pending', items: [] }))
    assert.equal(merged.status, 'failed')
    assert.equal(merged.items.length, 1)
    assert.equal(merged.items[0].price, 1)
  })

  it('replaces with unavailable (no invent)', () => {
    const prev = { resortId: 'severny-sklon', status: 'pending', items: [] }
    const next = { resortId: 'severny-sklon', status: 'unavailable', items: [], note: 'нет прайса' }
    const merged = mergeSnapshot(prev, next, 'severny-sklon', () => prev)
    assert.equal(merged.status, 'unavailable')
    assert.equal(merged.items.length, 0)
  })
})

describe('parseIgoraHours RU day labels', () => {
  it('localizes EN Mon/Sat/Sun labels', () => {
    assert.equal(localizeIgoraDayLabel('Mon - Fri'), 'пн–пт')
    assert.equal(localizeIgoraDayLabel('Sat'), 'сб')
    assert.equal(localizeIgoraDayLabel('Sunday'), 'вс')
  })

  it('parseIgoraHours emits Russian day labels from EN HTML', () => {
    const html = `<html><body>
      <h2>Working hours</h2>
      <p>Slopes Mon - Fri 11:00–22:00</p>
      <p>Sat 10:00–23:00</p>
      <p>Sun 10:00–21:00</p>
    </body></html>`
    const hours = parseIgoraHours(html)
    assert.ok(hours.periods.length >= 1)
    for (const p of hours.periods) {
      assert.doesNotMatch(p.days, /Mon|Tue|Wed|Thu|Fri|Sat|Sun|day/i)
      assert.match(p.days, /пн|вт|ср|чт|пт|сб|вс|склон|ежедневно/i)
    }
    assert.doesNotMatch(hours.summary, /Mon|Sat|Sun|Friday|Saturday/i)
    assert.match(hours.summary, /пн|сб|вс/)
  })
})

describe('parseIgoraPrices', () => {
  it('labels pass packs clearly and skips orphan BSK stub', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const items = parseIgoraPrices(html)
    assert.ok(items.length > 10)

    const onePass = items.find((i) => /Базовый · 1 проход/i.test(i.title))
    assert.ok(onePass, 'expected «1 проход» label instead of bare «· 1»')
    assert.equal(onePass.price, 333)
    assert.equal(onePass.unit, 'проход')

    const hourly = items.find((i) => /Базовый · 1 час/i.test(i.title) && i.price === 2280)
    assert.ok(hourly, 'expected ONLINE hourly base 2280')

    // Orphan single-cell BSK row must not become a fake tariff
    const noisyBsk = items.filter((i) => /^БСК/i.test(i.title) && i.price === 250 && !/час|проход/i.test(i.title))
    assert.equal(noisyBsk.length, 0)

    // Hourly rows should sort before pass packs / instructor
    const first = items[0]
    assert.match(first.title, /час/i)
  })

  it('collapses instructor cash/ONLINE pairs to ONLINE + в кассе note', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const items = parseIgoraPrices(html)
    const oneHourWeekday = items.filter((i) => /^1 человек · 1 час · будни/i.test(i.title))
    assert.equal(oneHourWeekday.length, 1, 'cash+online must collapse to one row')
    assert.equal(oneHourWeekday[0].price, 2850, 'prefer ONLINE 2850 over cash 3000')
    assert.match(oneHourWeekday[0].note || '', /в кассе 3000/)
    assert.match(oneHourWeekday[0].title, /online/i)

    // No near-duplicate instructor titles with different prices
    const instr = items.filter((i) => / · будни| · выходные/i.test(i.title))
    const byBase = new Map()
    for (const it of instr) {
      const k = it.title.replace(/\s*\([^)]*\)\s*$/u, '').trim()
      byBase.set(k, (byBase.get(k) || 0) + 1)
    }
    for (const [k, n] of byBase) {
      assert.equal(n, 1, `duplicate instructor key after collapse: ${k}`)
    }
  })

  it('rewrites site jargon «с профи» to clear «с тренером»', () => {
    assert.equal(clarifyInstructorLabel('1 человек с профи'), '1 человек с тренером')
    assert.equal(clarifyInstructorLabel('2 человека с профи'), '2 человека с тренером')
    assert.equal(
      clarifyInstructorLabel('3 человека и более с профи'),
      '3 человека и более с тренером',
    )
    assert.equal(clarifyInstructorLabel('1 человек'), '1 человек')

    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { items, groups } = parseIgoraPriceTables(html)
    const withTrainer = items.filter((i) => /с тренером/i.test(i.title))
    assert.ok(withTrainer.length >= 6, 'expected instructor «с тренером» tariffs')
    for (const it of items) {
      assert.doesNotMatch(it.title, /\bпрофи\b/i, `visitor title must not keep «профи»: ${it.title}`)
    }
    const instrGroup = groups.find((g) => /^Занятия с инструктором$/i.test(g.category))
    assert.ok(instrGroup, 'expected «Занятия с инструктором» lesson group')
    for (const row of instrGroup.rows || []) {
      assert.doesNotMatch(row.name || '', /\bпрофи\b/i, `group row must not keep «профи»: ${row.name}`)
    }
    assert.ok(
      (instrGroup.rows || []).some((r) => /1 человек с тренером/i.test(r.name || '')),
      'expected «1 человек с тренером» in instructor table',
    )
  })

  it('merges instructor-only live with snapshot ski-pass (fail-soft)', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const full = parseIgoraPriceTables(html)
    const liveOnly = {
      items: full.items.filter((i) => / · (?:будни|выходные)/i.test(i.title)),
      groups: full.groups.filter((g) => /инструктор/i.test(g.category)),
    }
    // Lessons + optional instructor pack — never a single catch-all «Инструктор» for ski-pass.
    assert.ok(liveOnly.groups.length >= 1)
    assert.ok(liveOnly.groups.every((g) => /инструктор/i.test(g.category)))
    assert.ok(liveOnly.items.length >= 12)

    const merged = mergeIgoraPriceTables(liveOnly, full)
    assert.equal(merged.filledSkiPass, true)
    assert.ok(merged.groups.some((g) => /почасов/i.test(g.category)))
    assert.ok(merged.groups.some((g) => /проход/i.test(g.category)))
    assert.ok(merged.groups.some((g) => /^Занятия с инструктором$/i.test(g.category)))
    assert.ok(merged.items.some((i) => /Базовый · 1 час/i.test(i.title)))
    assert.ok(merged.items.some((i) => /1 человек · 1 час · будни/i.test(i.title)))
    // Prefer live instructor prices over snapshot when both present
    const livePrice = liveOnly.items.find((i) => /^1 человек · 1 час · будни/i.test(i.title))?.price
    const mergedPrice = merged.items.find((i) => /^1 человек · 1 час · будни/i.test(i.title))?.price
    assert.equal(mergedPrice, livePrice)

    const supplemented = supplementIgoraSkiPassFromSnapshot(liveOnly)
    assert.equal(supplemented.filledSkiPass, true)
    assert.ok(supplemented.groups.length >= 3)
  })

  it('marks льготный cash-only cells', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { items, groups } = parseIgoraPriceTables(html)
    const lgot = items.find((i) => /Льготный\* · 1 час/i.test(i.title))
    assert.ok(lgot)
    assert.match(lgot.note || '', /только в кассе/i)
    const hourly = groups.find((g) => /почасов/i.test(g.category))
    const row = hourly?.rows?.find((r) => /льгот/i.test(r.name || ''))
    assert.ok(row)
    assert.match(row.prices?.[0]?.note || '', /только в кассе/i)
  })
})

describe('Igora CI snapshot policy', () => {
  it('workflow and scraper refuse accidental prod snapshots', () => {
    const wf = readFileSync(join(root, '.github/workflows/daily-data-refresh.yml'), 'utf8')
    assert.doesNotMatch(wf, /^\s*IGORA_ALLOW_SNAPSHOT\s*:/m)
    assert.doesNotMatch(wf, /^\s*IGORA_HTML_DIR\s*:/m)
    assert.doesNotMatch(wf, /^\s*SCRAPE_HTML_DIR\s*:/m)
    assert.match(wf, /IGORA_TIMEOUT_MS/)

    const src = readFileSync(join(root, 'scripts/scrape/resorts/igora.mjs'), 'utf8')
    assert.match(src, /function isCiEnv/)
    assert.match(src, /!isCiEnv\(\)/)
  })
})

describe('yukki hours policy (source-level)', () => {
  it('source does not hardcode ok hours before regex', async () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/yukki.mjs'), 'utf8')
    assert.doesNotMatch(
      src,
      /let summary = 'ежедневно 10:00–21:00'/,
      'must not invent default hours as ok',
    )
    assert.match(src, /hoursStatus = 'partial'/)
    assert.match(src, /hoursStatus = 'ok'/)
  })
})

describe('snezhny hours stay partial (no Playwright)', () => {
  it('hours status stays partial without Playwright', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/snezhny.mjs'), 'utf8')
    assert.match(src, /hoursStatus\s*=\s*'partial'|status:\s*hoursStatus|status:\s*'partial'/)
    assert.doesNotMatch(src, /playwright|fetchRenderedHtml/i)
  })

  it('hours summary is plain Russian without JS/виджет jargon', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/snezhny.mjs'), 'utf8')
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const sne = hours.find((h) => h.resortId === 'snezhny')
    assert.match(src, /Режим склонов уточняйте на сайте курорта…/)
    assert.doesNotMatch(src, /виджет|без JS/i)
    assert.ok(sne?.summary)
    assert.doesNotMatch(sne.summary, /виджет|без JS|playwright/i)
    assert.match(sne.summary, /Режим склонов|Важное|новост/i)
  })
})

describe('visitor-facing copy avoids scrape jargon', () => {
  it('committed hours/important/resorts avoid CSV/JS/виджет asides', () => {
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const important = JSON.parse(readFileSync(join(root, 'public/data/important.json'), 'utf8'))
    const resorts = JSON.parse(readFileSync(join(root, 'public/data/resorts.json'), 'utf8'))
    const jargon = /виджет|без JS|\bCSV\b|snow-park|ski-pass|playwright|Tilda|nohref|PDF-прейскурант/i
    for (const h of hours) {
      assert.doesNotMatch(h.summary || '', jargon, h.resortId)
    }
    for (const item of important) {
      assert.doesNotMatch(`${item.title} ${item.body || ''}`, jargon, item.id)
    }
    for (const r of resorts) {
      assert.doesNotMatch(r.notes || '', /CSV виджетов|без JS|виджет|PDF-прейскурант/i, r.id)
    }
    const yukki = resorts.find((r) => r.id === 'yukki')
    assert.match(yukki?.notes || '', /прейскурант на сайте/)
  })

  it('fallback price notes avoid «не распознан» tooling phrasing', () => {
    const files = [
      'scripts/scrape/resorts/drop-park.mjs',
      'scripts/scrape/resorts/igora.mjs',
      'scripts/scrape/resorts/snezhny.mjs',
      'scripts/scrape/resorts/yukki.mjs',
      'scripts/scrape/resorts/lazurnye-ozera.mjs',
      'scripts/scrape/resorts/tuutari-park.mjs',
    ]
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8')
      assert.doesNotMatch(src, /не распознан/i, rel)
    }
  })

  it('Krasnoe important detector uses plain Russian body', () => {
    const src = readFileSync(join(root, 'scripts/scrape/lib/important.mjs'), 'utf8')
    assert.match(src, /трассы и подъёмники отмечены как закрытые до сезона/)
    assert.doesNotMatch(src, /публичному CSV графика/)
  })
})

describe('closed-season card honesty signals', () => {
  it('lazurnye prefixes hours with Сезон закрыт when site says so', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/lazurnye-ozera.mjs'), 'utf8')
    assert.match(src, /Сезон закрыт/)
    assert.match(src, /seasonClosed/)
  })

  it('UI slopesBadgeLabel uses slopesOpen fail-soft (never invent open)', () => {
    const dataSrc = readFileSync(join(root, 'src/lib/data.ts'), 'utf8')
    const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
    assert.match(dataSrc, /сезон закрыт\|склон/)
    assert.match(dataSrc, /slopesBadgeLabel/)
    assert.match(dataSrc, /slopesOpen === true/)
    assert.match(dataSrc, /Склоны открыты/)
    assert.match(dataSrc, /Склоны закрыты/)
    // Active cards: open/closed slope badges from scrape signal; prices on detail.
    assert.match(cardSrc, /slopesBadgeLabel/)
    assert.match(cardSrc, /badge--open/)
    assert.match(cardSrc, /badge--warn/)
    assert.doesNotMatch(cardSrc, /statusLabel/)
    assert.doesNotMatch(cardSrc, /Цены/)
  })

  it('scrape pipeline writes hours.slopesOpen via slope-status detectors', () => {
    const slopeLib = readFileSync(join(root, 'scripts/scrape/lib/slope-status.mjs'), 'utf8')
    assert.match(slopeLib, /detectOkhtaSlopeStatus/)
    assert.match(slopeLib, /detectDropParkSlopeStatus/)
    assert.match(slopeLib, /detectKrasnoeSlopeStatus/)
    const okhta = readFileSync(join(root, 'scripts/scrape/resorts/okhta-park.mjs'), 'utf8')
    const drop = readFileSync(join(root, 'scripts/scrape/resorts/drop-park.mjs'), 'utf8')
    const kras = readFileSync(join(root, 'scripts/scrape/resorts/krasnoe-ozero.mjs'), 'utf8')
    assert.match(okhta, /slopesOpen:\s*slopeStatus\.slopesOpen/)
    assert.match(drop, /slopesOpen:\s*slopeStatus\.slopesOpen/)
    assert.match(kras, /slopesOpen:\s*slopeStatus\.slopesOpen/)
  })

  it('committed data keeps Puhtolova empty / Severny unavailable / Snezhny partial hours', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const puh = prices.find((p) => p.resortId === 'puhtolova-gora')
    const sev = prices.find((p) => p.resortId === 'severny-sklon')
    const sne = hours.find((h) => h.resortId === 'snezhny')
    assert.equal(puh?.status, 'partial')
    assert.equal((puh?.items || []).length, 0)
    assert.equal(sev?.status, 'unavailable')
    assert.equal((sev?.items || []).length, 0)
    assert.equal(sne?.status, 'partial')
  })

  it('Severny price note has no contacts/address; contacts live on resort', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const resorts = JSON.parse(readFileSync(join(root, 'public/data/resorts.json'), 'utf8'))
    const sevPrice = prices.find((p) => p.resortId === 'severny-sklon')
    const sev = resorts.find((r) => r.id === 'severny-sklon')
    assert.ok(sevPrice?.note)
    assert.doesNotMatch(sevPrice.note, /Контакты|924-81-81|@mail\.ru|Офицерская/i)
    assert.match(sevPrice.note, /не опубликованы/i)
    assert.match(sev?.phone || '', /924/)
    assert.match(sev?.email || '', /@mail\.ru/i)
  })
})

describe('resort page block semantics', () => {
  it('Severny scraper keeps contacts off the prices note', () => {
    const src = readFileSync(join(root, 'scripts/scrape/resorts/severny-sklon.mjs'), 'utf8')
    assert.match(src, /contacts:\s*\{/)
    assert.doesNotMatch(src, /Контакты: \$\{contacts\}/)
    assert.match(src, /не опубликованы/)
  })

  it('ResortPage keeps shared order and address only under Локация', () => {
    const src = readFileSync(join(root, 'src/pages/ResortPage.tsx'), 'utf8')
    assert.match(src, /hours → prices if active/)
    assert.match(src, /features → contacts → location/)
    assert.match(src, /city_or_district \|\| resort\.area/)
    assert.match(src, /resort-contacts-title/)
    assert.match(src, /resort-location-title/)
    // Address hyperlink appears once (Location), not also in the header.
    const addressLinks = src.match(/resort-detail__address/g) || []
    assert.equal(addressLinks.length, 1)
  })
})

describe('Igora Playwright waits for attached tables', () => {
  it('browser loader uses state attached (collapsed FAQ)', () => {
    const src = readFileSync(join(root, 'scripts/scrape/lib/browser.mjs'), 'utf8')
    assert.match(src, /state:\s*'attached'/)
  })
})

describe('skipass groups', () => {
  it('flattenSkipassGroups expands matrix cells', () => {
    const items = flattenSkipassGroups([
      {
        category: 'Ски-пасс',
        columns: ['Будни', 'Выходные'],
        rows: [
          {
            name: 'Ски-пасс',
            duration: '1 час',
            prices: [{ price: 1200 }, { price: 1500 }],
          },
        ],
      },
    ])
    assert.equal(items.length, 2)
    assert.match(items[0].title, /1 час/)
    assert.equal(items[0].price, 1200)
    assert.equal(items[0].unit, 'час')
  })

  it('Zolotaya Dolina parses подъёмов/часов genitive plurals', async () => {
    const { parseZoldolSkipassGroups } = await import('../resorts/zolotaya-dolina.mjs')
    const html = `
      1 подъем;200;250;200;250
      5 подъемов;800;1000;900;1200
      15 подъемов;1600;2300;2100;2900
      1 час;1200;1500;1500;1900
      5 часов;2300;3200;3200;4300
      6 часов;2500;3500;3500;4600
    `
    const groups = parseZoldolSkipassGroups(html)
    const lifts = groups.find((g) => /подъём/i.test(g.category))
    const hours = groups.find((g) => /час/i.test(g.category))
    assert.ok(lifts?.rows?.some((r) => r.duration === '5 подъёмов' && r.prices[1]?.price === 1000))
    assert.ok(lifts?.rows?.some((r) => r.duration === '15 подъёмов' && r.prices[3]?.price === 2900))
    assert.ok(hours?.rows?.some((r) => r.duration === '5 часов' && r.prices[0]?.price === 2300))
    assert.ok(hours?.rows?.some((r) => r.duration === '6 часов' && r.prices[1]?.price === 3500))
  })

  it('Yukki OCR keeps morning 1,5ч special separate from general 1,5ч', async () => {
    const { parseYukkiPrices } = await import('../resorts/yukki.mjs')
    const text = `
      Разовое посещение + смарт-карта (Вторник-пятница 1,5 часа 1100,00
      с 9-00до 15-00)
      30 минут 500,00
      1 час 1000,00
      1,5 часа 1300,00
      Разовое посещение + смарт-карта Зимний сезон 2 часа 1700,00
      3 часа 2600,00
      4 часа 3500,00
      Разовое посещение + смарт-карта (льготный тариф 50%) 30 минут 250,00
      1 час 500,00
      1,5 часа 650,00
    `
    const items = parseYukkiPrices(text)
    const morning = items.find((i) => /вт–пт/i.test(i.title))
    const general15 = items.find((i) => /^Разовое посещение 1,5 часа$/i.test(i.title))
    const oneHour = items.find((i) => /1 час$/i.test(i.title) && !/1,5/.test(i.title))
    assert.equal(morning?.price, 1100)
    assert.equal(general15?.price, 1300)
    assert.equal(oneHour?.price, 1000)
    assert.ok(items.some((i) => /2 часа/i.test(i.title) && i.price === 1700))
    assert.ok(!items.some((i) => i.price === 250 || i.price === 650))
  })

  it('Krasnoe Ozero parses 1–6h matrix and pass packs from CSV', async () => {
    const { parseKrasnoeSkipassGroups } = await import('../resorts/krasnoe-ozero.mjs')
    const { parseCsv } = await import('../lib/parse.mjs')
    const csv = [
      'Название,Показывать,Ключ страницы,Уточнение,1 час будни,2 часа будни,3 часа будни,4 часа будни,5 часов будни,6 часов будни,1 час выходные,2 часа выходные,3 часа выходные,4 часа выходные,5 часов выходные,6 часов выходные,1 проход,7 проходов,15 проходов',
      'Взрослый (часы),yes,ski-pass,Стоимость БСК - 300 руб.,1500,2000,2500,2900,3200,3500,1900,2800,3500,3900,4300,4600,,,',
      'Взрослый (проходы),yes,ski-pass,"Стоимость БСК - 300 руб., проходы сохраняются",,,,,,,,,,,,,300,2000,3500',
      '"Дети (до 12 лет), пенсионеры (часы)",yes,ski-pass,,1200,1500,1800,2100,2300,2500,1500,2000,2500,2900,3200,3500,,,',
      '"Дети (до 12 лет), пенсионеры (проходы)",yes,ski-pass,,,,,,,,,,,,,,300,1500,2500',
    ].join('\n')
    const { rows } = parseCsv(csv)
    const groups = parseKrasnoeSkipassGroups(rows)
    const adultHours = groups.find((g) => /Взрослый \(часы\)/i.test(g.category))
    const adultPass = groups.find((g) => /Взрослый \(проходы\)/i.test(g.category))
    assert.equal(adultHours?.rows?.length, 6)
    assert.equal(adultHours.rows[0].prices[0].price, 1500)
    assert.equal(adultHours.rows[5].prices[1].price, 4600)
    assert.equal(adultPass?.rows?.length, 3)
    assert.equal(adultPass.rows[0].prices[0].price, 300)
    assert.equal(adultPass.rows[2].prices[0].price, 3500)
    assert.ok(groups.some((g) => /Дети.*\(часы\)/i.test(g.category) && g.rows.length === 6))
    assert.ok(groups.some((g) => /Дети.*\(проходы\)/i.test(g.category) && g.rows.length === 3))
  })

  it('Igora snapshot yields structured groups with site categories', () => {
    const html = readFileSync(join(root, 'data/snapshots/igora/price.html'), 'utf8')
    const { groups } = parseIgoraPriceTables(html)
    assert.ok(groups.length >= 3)
    assert.ok(groups.some((g) => /почасов/i.test(g.category)))
    assert.ok(groups.some((g) => /проход/i.test(g.category)))
    assert.ok(groups.some((g) => /^Занятия с инструктором$/i.test(g.category)))
    // Catch-all «Инструктор» title is gone — ski-pass rows must not live under it.
    assert.ok(!groups.some((g) => /^Инструктор$/i.test(g.category)))
    const hourly = groups.find((g) => /почасов/i.test(g.category))
    assert.ok(hourly.columns.some((c) => /час/i.test(c)))
    assert.ok(hourly.rows.some((r) => /базов/i.test(r.name)))
    const lessons = groups.find((g) => /^Занятия с инструктором$/i.test(g.category))
    assert.ok(lessons?.rows?.every((r) => /человек|тренер/i.test(r.name || '')))
  })

  it('Drop Park snapshot yields site sections (ски-пасс / инструктор / сезон)', () => {
    const html = readFileSync(join(root, 'data/snapshots/drop-park/snow-park.html'), 'utf8')
    const { groups, hours } = parseDropParkPriceList(html)
    assert.ok(groups.some((g) => /^Ски-пасс$/i.test(g.category)))
    assert.ok(groups.some((g) => /^Инструктор$/i.test(g.category)))
    assert.ok(groups.some((g) => /Сезонный абонемент/i.test(g.category)))
    assert.ok(groups.some((g) => /^Оборудование$/i.test(g.category)))
    // Site has no per-ride («проходы») tariffs — do not invent them.
    assert.ok(!groups.some((g) => /проход|разов|подъ[её]м/i.test(g.category)))
    const ski = groups.find((g) => /^Ски-пасс$/i.test(g.category))
    assert.deepEqual(ski.columns, ['Будни', 'Выходные и праздники'])
    assert.ok(ski.rows.some((r) => /^Дневной$/i.test(r.name) && r.prices[0]?.price === 1700))
    assert.ok(ski.rows.some((r) => /^Полный$/i.test(r.name) && r.prices[1]?.price === 2500))
    assert.match(hours.summary, /будни.*11:00|выходные.*10:00/i)
    assert.equal(hours.status, 'partial')
  })

  it('Okhta day tariff parser reads weekday/weekend lift board', async () => {
    const { parseOkhtaDayTariffGroups } = await import('../resorts/okhta-park.mjs')
    const html = `<html><body><div id="service_price">
      <div class="service_price_tag">Пн - Чт</div>
      <div class="service_price_tag">Пт - Вс и праздничные дни</div>
      <div class="service_price_tag">Для проживающих специально</div>
      <div class="service_price_block">
        <div class="service_price_list_row"><div class="service_price_list_row_caption--name">Услуги подъемников 2 часа</div>
          <div class="service_price_list_row_wrap"><div class="service_price_list_row_caption">800 ₽ / 700 ₽</div></div></div>
        <div class="service_price_list_row"><div class="service_price_list_row_caption--name">Услуги подъемников 3 часа</div>
          <div class="service_price_list_row_wrap"><div class="service_price_list_row_caption">1000 ₽ / 900 ₽</div></div></div>
      </div>
      <div class="service_price_block">
        <div class="service_price_list_row"><div class="service_price_list_row_caption--name">Услуги подъемников 2 часа</div>
          <div class="service_price_list_row_wrap"><div class="service_price_list_row_caption">950 ₽ / 750 ₽</div></div></div>
        <div class="service_price_list_row"><div class="service_price_list_row_caption--name">Услуги подъемников 3 часа</div>
          <div class="service_price_list_row_wrap"><div class="service_price_list_row_caption">1200 ₽ / 1000 ₽</div></div></div>
      </div>
      <div class="service_price_block">
        <div class="service_price_list_row"><div class="service_price_list_row_caption--name">Resort &amp; spa 5* — ски-пасс безлимитный</div>
          <div class="service_price_list_row_wrap"><div class="service_price_list_row_caption">бесплатно</div></div></div>
      </div>
    </div></body></html>`
    const groups = parseOkhtaDayTariffGroups(html)
    assert.ok(groups.some((g) => /Ски-пасс \(подъёмники\)/i.test(g.category)))
    const lift = groups.find((g) => /подъёмники/i.test(g.category))
    assert.deepEqual(lift.columns, ['Пн–чт', 'Пт–вс и праздники'])
    assert.ok(lift.rows.some((r) => r.name === 'Взрослый' && r.duration === '2 часа' && r.prices[0]?.price === 800 && r.prices[1]?.price === 950))
    assert.ok(lift.rows.some((r) => r.name === 'Детский' && r.duration === '2 часа' && r.prices[0]?.price === 700))
    assert.match(lift.note || '', /проживающ/i)
  })

  it('committed prices keep groups for split resorts including drop-park', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const needGroups = [
      'tuutari-park',
      'lazurnye-ozera',
      'zolotaya-dolina',
      'snezhny',
      'krasnoe-ozero',
      'okhta-park',
      'igora',
      'drop-park',
    ]
    for (const id of needGroups) {
      const snap = prices.find((p) => p.resortId === id)
      assert.ok(snap?.groups?.length, `${id} should have skipass groups`)
    }
    const okhta = prices.find((p) => p.resortId === 'okhta-park')
    assert.ok(
      okhta?.groups?.some((g) => /подъёмники|Ски-пасс/i.test(g.category)),
      'okhta-park should keep day lift tariffs, not only seasonal presale',
    )
    assert.match(String(okhta?.sourceUrl || ''), /gornolyzhnye-trassy/)
    const drop = prices.find((p) => p.resortId === 'drop-park')
    assert.ok((drop?.items || []).length > 0)
    assert.ok(drop?.groups?.some((g) => /^Ски-пасс$/i.test(g.category)), 'drop-park ski-pass group')
    assert.ok(drop?.groups?.some((g) => /Сезонный абонемент/i.test(g.category)), 'drop-park season group')
    assert.ok(
      !drop?.groups?.some((g) => /проход|разов/i.test(g.category)),
      'drop-park must not invent ride categories',
    )

    const igora = prices.find((p) => p.resortId === 'igora')
    assert.ok(igora?.groups?.some((g) => /почасов/i.test(g.category)), 'Igora hourly group')
    assert.ok(igora?.groups?.some((g) => /проход/i.test(g.category)), 'Igora passes group')
    assert.ok(
      igora?.groups?.some((g) => /^Занятия с инструктором$/i.test(g.category)),
      'Igora lessons group',
    )
    assert.ok(
      !igora?.groups?.some((g) => /^Инструктор$/i.test(g.category)),
      'Igora must not use catch-all «Инструктор»',
    )
    assert.ok(
      (igora?.items || []).some((i) => /Базовый · 1 час/i.test(i.title || '')),
      'committed Igora items should include ski-pass hourly',
    )
    for (const it of igora?.items || []) {
      assert.doesNotMatch(it.title || '', /\bпрофи\b/i, `committed Igora item: ${it.title}`)
    }
    for (const g of igora?.groups || []) {
      for (const row of g.rows || []) {
        assert.doesNotMatch(row.name || '', /\bпрофи\b/i, `committed Igora row: ${row.name}`)
      }
    }
    assert.ok(
      (igora?.items || []).some((i) => /с тренером/i.test(i.title || '')),
      'committed Igora items should use «с тренером»',
    )
  })

  it('committed Snezhny keeps season and unified groups', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const sne = prices.find((p) => p.resortId === 'snezhny')
    assert.ok(sne?.groups?.some((g) => /^Абонементы$/i.test(g.category)))
    assert.ok(sne?.groups?.some((g) => /Единый ски-пасс/i.test(g.category)))
    const lift = sne?.groups?.find((g) => /часы и проходы/i.test(g.category))
    assert.ok(lift?.rows?.some((r) => r.duration === '1 проход'), 'duration without redundant «Ски-пасс ·»')
    assert.ok(
      (sne?.groups?.find((g) => /^Абонементы$/i.test(g.category))?.rows || []).length >= 3,
    )
  })

  it('lazurnye durations are not doubled «ч ч»', () => {
    const prices = JSON.parse(readFileSync(join(root, 'public/data/prices.json'), 'utf8'))
    const snap = prices.find((p) => p.resortId === 'lazurnye-ozera')
    for (const g of snap?.groups || []) {
      for (const row of g.rows || []) {
        assert.ok(row.duration, 'expected duration')
        assert.doesNotMatch(row.duration, /ч\s+ч/)
        assert.match(row.duration, /^\d+\s*ч/)
      }
    }
    const enrichSrc = readFileSync(join(root, 'scripts/enrich-skipass-groups.mjs'), 'utf8')
    const scrapeSrc = readFileSync(join(root, 'scripts/scrape/resorts/lazurnye-ozera.mjs'), 'utf8')
    assert.match(enrichSrc, /час\|\\bч\\b/)
    assert.match(scrapeSrc, /час\|\\bч\\b/)
  })
})
