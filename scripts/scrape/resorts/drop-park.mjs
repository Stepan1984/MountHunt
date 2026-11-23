import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectDropParkImportant } from '../lib/important.mjs'
import {
  cleanText,
  extractIframeSrcs,
  flattenSkipassGroups,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'

export const DROP_PAGE_URL = 'https://drop-park.ru/snow-park'
export const DROP_TG_URL = 'https://t.me/s/dropsnowpark'
const PAGE_URL = DROP_PAGE_URL
const TG_URL = DROP_TG_URL

/** @typedef {{ top: number, left: number, text: string }} TildaElem */
/** @typedef {{ title: string, price: number, unit?: string, rawText?: string, note?: string, _top?: number, _left?: number }} FlatItem */

/**
 * Tilda freeform board: tn-elem labels + ₽ amounts with data-field-top/left.
 * @param {string} html
 * @returns {TildaElem[]}
 */
export function extractTildaElems(html) {
  /** @type {TildaElem[]} */
  const elems = []
  const re = /<div class='t396__elem tn-elem[^']*'([^>]*)>([\s\S]*?)<\/div>/g
  let m
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const topM = attrs.match(/data-field-top-value=["']?(\d+)/)
    const leftM = attrs.match(/data-field-left-value=["']?(\d+)/)
    if (!topM) continue
    let text = cleanText(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    text = text.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 220) continue
    if (/t_onFuncLoad|t396_initialScale|function\s*\(/i.test(text)) continue
    elems.push({
      top: Number(topM[1]),
      left: Number(leftM?.[1] || 0),
      text,
    })
  }
  return elems
}

const SECTION_HEADERS =
  /^(Cки-пасс|Ски-пасс|Инструктор|Оборудование|Прайс-лист|Будни:?|Выходные и праздники:?|Дополнительный сервис|Сезонное хранение инвентаря:?|Ремонт и обслуживание оборудования:?)$/i

/** Short board cell like «2 600₽» / «от 2 000₽» — not prose with a year + ₽. */
function isPriceCell(text) {
  const t = cleanText(text)
  if (!t || t.length > 28) return false
  if (!/₽|руб/i.test(t)) return false
  return parsePrice(t) != null
}

/**
 * Pair label elems with nearby ₽ amounts (label left of price, same vertical band).
 * @param {TildaElem[]} elems
 * @returns {FlatItem[]}
 */
function pairLabelPrices(elems) {
  const money = elems.filter((e) => isPriceCell(e.text))
  const labels = elems.filter(
    (e) =>
      !isPriceCell(e.text) &&
      !SECTION_HEADERS.test(e.text) &&
      !/Абонемент дает возможность|Откатай сезон|подробнее|Купить абонемент/i.test(e.text),
  )

  /** @type {FlatItem[]} */
  const items = []
  for (const priceEl of money) {
    const price = parsePrice(priceEl.text)
    if (price == null) continue
    let best = null
    let bestScore = Infinity
    for (const lab of labels) {
      if (lab.left >= priceEl.left - 10) continue
      const dTop = Math.abs(lab.top - priceEl.top)
      if (dTop > 40) continue
      const dLeft = priceEl.left - lab.left
      if (dLeft > 450) continue
      const score = dTop * 3 + dLeft * 0.01
      if (score < bestScore) {
        bestScore = score
        best = lab
      }
    }
    if (!best) continue
    items.push({
      title: best.text,
      price,
      rawText: priceEl.text,
      _top: best.top,
      _left: best.left,
    })
  }
  return items
}

/**
 * @param {string} title
 * @returns {string | undefined}
 */
function inferUnit(title) {
  if (/сезон/i.test(title)) return 'сезон'
  if (/30\s*мин/i.test(title)) return 'тариф'
  if (/час/i.test(title)) return 'час'
  if (/дневн|вечерн|полный/i.test(title)) return 'день'
  return 'тариф'
}

/**
 * Normalize ski-pass window labels from the price board.
 * @param {string} title
 */
function parseSkiPassRow(title) {
  const t = cleanText(title)
  const day = t.match(/^Дневной\s+с\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/i)
  if (day) return { name: 'Дневной', duration: `${day[1]}–${day[2]}`, kind: 'day' }
  const eve = t.match(/^Вечерний\s+с\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/i)
  if (eve) return { name: 'Вечерний', duration: `${eve[1]}–${eve[2]}`, kind: 'evening' }
  const full = t.match(/^Полный\s+с\s*(\d{1,2}:\d{2})\s*до\s*(\d{1,2}:\d{2})/i)
  if (full) return { name: 'Полный', duration: `${full[1]}–${full[2]}`, kind: 'full' }
  return null
}

/**
 * Build site-derived skipass groups from the snow-park price board.
 * Sections on site: Ски-пасс (будни / выходные), Инструктор, Оборудование,
 * сезонный абонемент, дополнительный сервис. No per-ride («проходы») tariffs.
 *
 * @param {string} html
 * @returns {{ groups: object[], items: FlatItem[], hours: { summary: string, periods: object[], status: string }, kidsNote?: string }}
 */
export function parseDropParkPriceList(html) {
  const elems = extractTildaElems(html)
  const paired = pairLabelPrices(elems)

  /** @type {FlatItem[]} */
  const skiPass = []
  /** @type {FlatItem[]} */
  const instructor = []
  /** @type {FlatItem[]} */
  const equipment = []
  /** @type {FlatItem[]} */
  const extras = []

  for (const it of paired) {
    const title = it.title
    const left = it._left ?? 0
    const top = it._top ?? 0

    // Right column: Оборудование / доп. сервис (left ≈ 650)
    if (left >= 600) {
      if (
        /хранени|парафин|заточк|стачиван|ремонт|консервац|расконсерв/i.test(title)
      ) {
        extras.push(it)
      } else if (/аренд|комплект|продлен/i.test(title)) {
        equipment.push(it)
      } else {
        extras.push(it)
      }
      continue
    }

    // Left column price board (left ≈ 188)
    if (parseSkiPassRow(title)) {
      skiPass.push(it)
      continue
    }
    if (
      /индивидуальн|групп|продлен/i.test(title) &&
      !/аренд|комплект|хранени/i.test(title)
    ) {
      instructor.push(it)
      continue
    }
    // Stray left-column rental-ish labels still go to equipment
    if (/аренд|комплект/i.test(title)) {
      equipment.push(it)
      continue
    }
    // Unknown left labels near ski-pass / instructor band
    if (top < 750) skiPass.push(it)
    else instructor.push(it)
  }

  // Season pass from prose («Стоимость - 40.000₽»)
  /** @type {FlatItem | null} */
  let seasonItem = null
  const season = html.match(/Стоимость\s*[-–—]\s*([\d.\s]+)\s*₽/i)
  if (season) {
    const price = parsePrice(season[1].replace(/\./g, ' '))
    if (price != null) {
      seasonItem = {
        title: 'Сезонный абонемент сноупарк 2026/27',
        price,
        unit: 'сезон',
        rawText: cleanText(season[0]),
      }
    }
  }
  // Fallback: year in paired text near «сезон»
  if (!seasonItem) {
    const hit = paired.find((p) => /сезонн.*абонемент|абонемент.*сезон/i.test(p.title))
    if (hit) {
      seasonItem = {
        title: 'Сезонный абонемент сноупарк 2026/27',
        price: hit.price,
        unit: 'сезон',
        rawText: hit.rawText,
      }
    }
  }

  const kidsNote = elems.some((e) => /Дети до 14 лет/i.test(e.text))
    ? 'Дети до 14 лет – скидка 10%'
    : undefined

  // Site: будни = дневной/вечерний/полный(11:00–23:00); выходные = полный(10:00–21:00)
  /** @type {{ name: string, duration: string, weekday: object | null, weekend: object | null }[]} */
  const skipassMatrix = []
  const day = skiPass.find((s) => parseSkiPassRow(s.title)?.kind === 'day')
  const evening = skiPass.find((s) => parseSkiPassRow(s.title)?.kind === 'evening')
  const fullWd = skiPass.find((s) => {
    const p = parseSkiPassRow(s.title)
    return p?.kind === 'full' && /^11:00/.test(p.duration)
  })
  const fullWe = skiPass.find((s) => {
    const p = parseSkiPassRow(s.title)
    return p?.kind === 'full' && /^10:00/.test(p.duration)
  })
  // Fallback: any «Полный» if open-time heuristics miss
  const fullAny = skiPass.filter((s) => parseSkiPassRow(s.title)?.kind === 'full')

  function cellOf(it) {
    return it ? { price: it.price, rawText: it.rawText } : { price: null }
  }

  if (day) {
    const p = parseSkiPassRow(day.title)
    skipassMatrix.push({
      name: 'Дневной',
      duration: p?.duration || '11:00–17:00',
      weekday: cellOf(day),
      weekend: { price: null },
    })
  }
  if (evening) {
    const p = parseSkiPassRow(evening.title)
    skipassMatrix.push({
      name: 'Вечерний',
      duration: p?.duration || '17:00–23:00',
      weekday: cellOf(evening),
      weekend: { price: null },
    })
  }
  const wd = fullWd || (fullAny.length === 1 ? fullAny[0] : fullAny.find((s) => !/^10:00/.test(parseSkiPassRow(s.title)?.duration || '')))
  const we = fullWe || fullAny.find((s) => s !== wd)
  if (wd || we) {
    const wdParsed = wd ? parseSkiPassRow(wd.title) : null
    const weParsed = we ? parseSkiPassRow(we.title) : null
    skipassMatrix.push({
      name: 'Полный',
      duration: wdParsed?.duration || weParsed?.duration || 'полный день',
      weekday: cellOf(wd),
      weekend: we
        ? {
            ...cellOf(we),
            ...(weParsed?.duration && weParsed.duration !== wdParsed?.duration
              ? { note: weParsed.duration }
              : {}),
          }
        : { price: null },
    })
  }

  /** @type {object[]} */
  const groups = []

  if (skipassMatrix.length) {
    groups.push({
      category: 'Ски-пасс',
      columns: ['Будни', 'Выходные и праздники'],
      ...(kidsNote ? { note: kidsNote } : {}),
      rows: skipassMatrix.map((r) => ({
        name: r.name,
        duration: r.duration,
        prices: [r.weekday, r.weekend],
      })),
    })
  }

  if (instructor.length) {
    groups.push({
      category: 'Инструктор',
      columns: ['Цена'],
      rows: sortByTop(dedupeFlat(instructor)).map((it) => rowFromFlat(it)),
    })
  }

  if (equipment.length) {
    groups.push({
      category: 'Оборудование',
      columns: ['Цена'],
      rows: sortByTop(dedupeFlat(equipment)).map((it) => rowFromFlat(it)),
    })
  }

  if (seasonItem) {
    groups.push({
      category: 'Сезонный абонемент',
      columns: ['Цена'],
      rows: [
        {
          name: seasonItem.title,
          duration: 'сезон',
          prices: [{ price: seasonItem.price, rawText: seasonItem.rawText }],
        },
      ],
    })
  }

  if (extras.length) {
    groups.push({
      category: 'Дополнительный сервис',
      columns: ['Цена'],
      rows: sortByTop(dedupeFlat(extras)).map((it) => rowFromFlat(it)),
    })
  }

  const flatItems = flattenSkipassGroups(groups)
  // Keep a few unit hints for cards when flatten omits them
  for (const it of flatItems) {
    if (!it.unit) it.unit = inferUnit(it.title || '')
  }

  // Hours: only from «Полный» windows on the price board — not inventing schedule.
  // Label by day type from the site subsections.
  const periods = []
  if (wdFull()) {
    const p = wdFull()
    periods.push({ days: 'будни (полный по прайсу)', open: p.open, close: p.close })
  }
  if (weFull()) {
    const p = weFull()
    periods.push({ days: 'выходные и праздники (полный по прайсу)', open: p.open, close: p.close })
  }

  function wdFull() {
    const hit = skiPass.find((s) => {
      const p = parseSkiPassRow(s.title)
      return p?.kind === 'full' && /^11:00/.test(p.duration)
    })
    if (!hit) return null
    const p = parseSkiPassRow(hit.title)
    if (!p) return null
    const [open, close] = p.duration.split('–')
    return { open, close }
  }
  function weFull() {
    const hit = skiPass.find((s) => {
      const p = parseSkiPassRow(s.title)
      return p?.kind === 'full' && /^10:00/.test(p.duration)
    })
    if (!hit) return null
    const p = parseSkiPassRow(hit.title)
    if (!p) return null
    const [open, close] = p.duration.split('–')
    return { open, close }
  }

  let summary = 'Часы работы уточняйте на сайте'
  let hoursStatus = 'partial'
  if (periods.length) {
    summary = periods.map((p) => `${p.days.replace(/\s*\(.*\)/, '')}: ${p.open}–${p.close}`).join('; ')
    summary = `По прайсу сноупарка — ${summary}`
    hoursStatus = 'partial'
  }

  return {
    groups,
    items: flatItems.length ? flatItems : dedupeFlat([...skiPass, ...instructor, ...equipment, ...extras, ...(seasonItem ? [seasonItem] : [])]),
    hours: { summary, periods, status: hoursStatus },
    kidsNote,
  }
}

/**
 * @param {FlatItem[]} items
 */
function dedupeFlat(items) {
  const seen = new Set()
  /** @type {FlatItem[]} */
  const out = []
  for (const it of items) {
    const key = `${cleanText(it.title)}|${it.price}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ...it,
      title: cleanText(it.title),
      unit: it.unit || inferUnit(it.title),
    })
  }
  return out
}

/**
 * @param {FlatItem[]} items
 */
function sortByTop(items) {
  return [...items].sort((a, b) => (a._top ?? 0) - (b._top ?? 0) || (a._left ?? 0) - (b._left ?? 0))
}

/**
 * @param {FlatItem} it
 */
function rowFromFlat(it) {
  const title = cleanText(it.title)
  let name = title
  let duration

  // «Группа 2-4 чел. /1 час (на человека)» · «Продление / 30 мин.» · «Индивидуально 1 час»
  const withSlash = title.match(/^(.*?)\s*\/\s*(\d+\s*час(?:а)?|30\s*мин\.?)\s*(?:\(([^)]+)\))?$/i)
  const trailing = title.match(/^(.*?)(?<![/\d])\s+(\d+\s*час(?:а)?|30\s*мин\.?|\d+\s*сезон(?:а)?)$/i)
  if (withSlash) {
    name = cleanText([withSlash[1], withSlash[3] ? `(${withSlash[3]})` : ''].filter(Boolean).join(' '))
    duration = normalizeDuration(withSlash[2])
  } else if (trailing) {
    name = cleanText(trailing[1]).replace(/\s+на$/i, '')
    duration = normalizeDuration(trailing[2])
  }
  if (!name) name = title
  const raw = it.rawText || ''
  const fromPrice = /^от\b/i.test(cleanText(raw))
  return {
    name,
    ...(duration ? { duration } : {}),
    prices: [
      {
        price: it.price,
        rawText: it.rawText,
        ...(fromPrice ? { note: 'от' } : {}),
      },
    ],
  }
}

/** @param {string} raw */
function normalizeDuration(raw) {
  let d = cleanText(raw)
  if (/^30\s*мин\.?$/i.test(d)) return '30 мин.'
  return d
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeDropPark() {
  const resortId = 'drop-park'
  try {
    const html = await fetchUrl(PAGE_URL)
    let tgHtml = ''
    let tgFetched = false
    try {
      await sleep()
      tgHtml = await fetchUrl(TG_URL)
      tgFetched = true
    } catch {
      tgHtml = ''
      tgFetched = false
    }
    const parsed = parseDropParkPriceList(html)
    const $ = loadHtml(html)
    const embeds = [
      ...extractIframeSrcs($, PAGE_URL),
      ...($('[data-iframevideo]')
        .map((_, el) => $(el).attr('data-iframevideo'))
        .get()
        .filter(Boolean)
        .map((u) => {
          try {
            return new URL(u, PAGE_URL).href
          } catch {
            return null
          }
        })
        .filter(Boolean)),
    ].filter((u) => /rtsp\.(ru|me)/i.test(u))
    const uniqueEmbeds = [...new Set(embeds)]

    const hasGroups = parsed.groups.length > 0
    const hasItems = parsed.items.length > 0
    const dropImportant = detectDropParkImportant(
      { pageHtml: html, tgHtml },
      TG_URL,
      { pageUrl: PAGE_URL, tgUrl: TG_URL, pageFetched: true, tgFetched },
    )

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items: parsed.items,
        groups: hasGroups ? parsed.groups : undefined,
        status: hasItems || hasGroups ? 'ok' : 'partial',
        note: hasItems || hasGroups
          ? 'Прайс сноупарка: ски-пасс (будни / выходные), инструктор, оборудование, сезонный абонемент'
          : 'Цены на странице сноупарка не удалось прочитать — смотрите сайт курорта',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary: parsed.hours.summary,
        periods: parsed.hours.periods,
        status: parsed.hours.status,
      }),
      webcamUrl: PAGE_URL,
      // rtsp.ru cams deleted / stream failed — avoid empty player boxes.
      cameraEmbeds: uniqueEmbeds.filter(() => false),
      important: dropImportant.ok ? dropImportant.items : [],
      // When TG is down and the page has no open/off-season signal, keep previous card.
      importantInconclusive: !dropImportant.ok,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
