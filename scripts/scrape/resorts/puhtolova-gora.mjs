import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectPuhtolovaImportant } from '../lib/important.mjs'
import { formatCardHoursFromPeriods } from '../lib/card-hours-format.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'
import { detectPuhtolovaSlopeStatus } from '../lib/slope-status.mjs'

const PRICES_URL = 'https://puhgora.ru/uslugi/ceny-na-podyomniki'
const HOURS_URL = 'https://puhgora.ru/o-kurorte/chasy-raboty'
const WEBCAM_URL = 'https://puhgora.ru/web-camera'
export const PUHT_NEWS_URL = 'https://puhgora.ru/o-kurorte/novosti-i-akcii'
const NEWS_URL = PUHT_NEWS_URL

const WEEKDAY = 'Будние дни'
const WEEKEND = 'Выходные и праздничные дни'

/**
 * Closest preceding h3 (tables may sit inside wrappers — walk parents).
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} $table
 */
function precedingH3($, $table) {
  let $el = $table
  for (let i = 0; i < 8; i++) {
    const $h = $el.prevAll('h3').first()
    if ($h.length) {
      const text = cleanText($h.text())
      if (text) return text
    }
    const parent = $el.parent()
    if (!parent.length || parent.is('body') || parent.is('html')) break
    $el = parent
  }
  return ''
}

/** Soften ALL-CAPS site labels for visitor UI. */
function softenLabel(raw) {
  const t = cleanText(String(raw || ''))
  if (!t) return t
  if (t.length > 4 && t === t.toLocaleUpperCase('ru')) {
    return t.charAt(0) + t.slice(1).toLocaleLowerCase('ru')
  }
  return t
}

/** Strip footnote stars like «3 *» / «3*» from age-band headers. */
function cleanAgeLabel(raw) {
  const t = softenLabel(String(raw || '').replace(/\s*\d+\s*\*+\s*$/g, '').trim())
  if (!t) return t
  return t.charAt(0).toLocaleUpperCase('ru') + t.slice(1)
}

/**
 * Parse one tariff cell: plain RUB, «N руб. в час», «+80 в час», «Бесплатно…».
 * @param {string} cell
 * @returns {{ price: number | null, rawText?: string, note?: string } | null}
 */
function parseTariffCell(cell) {
  const raw = cleanText(cell)
  if (!raw) return { price: null }

  if (/бесплат/i.test(raw)) {
    return { price: null, rawText: raw, note: raw }
  }

  const plusHour = raw.match(/^\+\s*(\d[\d\s]*)\s*(?:руб\.?)?\s*в\s*час/i)
  if (plusHour) {
    const price = parsePrice(plusHour[1])
    return {
      price: price ?? null,
      rawText: raw,
      note: price != null ? `+${price.toLocaleString('ru-RU')} ₽/час после 3 ч` : raw,
    }
  }

  const perHour = raw.match(/^(\d[\d\s]*)\s*руб\.?\s*в\s*час/i)
  if (perHour) {
    const price = parsePrice(perHour[1])
    return price == null
      ? { price: null, rawText: raw }
      : { price, rawText: raw, note: '₽/час' }
  }

  const flatRub = raw.match(/^(\d[\d\s]*)\s*руб\.?\s*$/i)
  if (flatRub) {
    const price = parsePrice(flatRub[1])
    return price == null ? { price: null, rawText: raw } : { price, rawText: raw }
  }

  if (/^\d[\d\s.,]*$/.test(raw.replace(/руб\.?/gi, '').trim())) {
    const price = parsePrice(raw)
    // Keep cheap lift tickets (e.g. учебный 40 ₽); reject noise only.
    if (price == null || price < 1 || price > 200000) return { price: null, rawText: raw }
    return { price, rawText: raw }
  }

  return { price: null, rawText: raw }
}

function isSectionHeaderRow(label) {
  return /^(цены по|сезонные абонементы|бугельн)/i.test(cleanText(label || ''))
}

/**
 * Pad/truncate price cells to column count; colspan-collapsed single values
 * (учебный склон) fill both day columns when only one price cell is present.
 * @param {string[]} cells
 * @param {number} colCount
 */
function cellsToPrices(cells, colCount) {
  /** @type {{ price: number | null, rawText?: string, note?: string }[]} */
  const prices = []
  const values = cells.map((c) => parseTariffCell(c))
  if (colCount === 2 && values.length === 1 && values[0] && (values[0].price != null || values[0].note)) {
    return [values[0], { ...values[0] }]
  }
  for (let i = 0; i < colCount; i++) {
    prices.push(values[i] || { price: null })
  }
  return prices
}

function rowHasPrice(prices) {
  return prices.some((p) => p.price != null || (p.note && /бесплат|\+|₽/i.test(p.note)))
}

/**
 * Main slopes: nested Будние/Выходные × детский/взрослый.
 * @param {string[][]} rows
 * @param {string} category
 */
function parseMainSlopesTable(rows, category) {
  const ageIdx = rows.findIndex(
    (r) =>
      r.filter((c) => /детск/i.test(c)).length >= 1 &&
      r.filter((c) => /взросл/i.test(c)).length >= 1 &&
      r.length >= 5,
  )
  if (ageIdx < 0) return null

  const ageRow = rows[ageIdx]
  const leaf = ageRow.slice(1).map(cleanAgeLabel)
  if (leaf.length < 4) return null
  const columns = leaf.slice(0, 4)
  const columnGroups = [
    { label: WEEKDAY, span: 2 },
    { label: WEEKEND, span: 2 },
  ]

  /** @type {{ name: string, prices: object[], note?: string }[]} */
  const out = []
  for (const row of rows.slice(ageIdx + 1)) {
    const name = cleanText(row[0] || '')
    if (!name || isSectionHeaderRow(name)) continue
    const prices = cellsToPrices(row.slice(1), columns.length)
    if (!rowHasPrice(prices)) continue
    out.push({ name, prices })
  }
  if (!out.length) return null
  return {
    category,
    columns,
    columnGroups,
    rows: out,
    note: 'Оформление бесконтактной карты (ски-пасса) — 150 ₽; карта остаётся у гостя.',
  }
}

/**
 * Simple weekday/weekend table (учебный / ватрушки).
 * @param {string[][]} rows
 * @param {string} category
 */
function parseDayBandTable(rows, category) {
  const headerIdx = rows.findIndex((r) =>
    r.some((c) => /будн/i.test(c)) && r.some((c) => /выходн|празднич/i.test(c)),
  )
  if (headerIdx < 0) return null
  const columns = [WEEKDAY, WEEKEND]
  /** @type {{ name: string, prices: object[] }[]} */
  const out = []
  for (const row of rows.slice(headerIdx + 1)) {
    const name = cleanText(row[0] || '')
    if (!name || isSectionHeaderRow(name)) continue
    // Duration-only labels («3 часа», «Один подъём») stay as the tariff name.
    const prices = cellsToPrices(row.slice(1), columns.length)
    if (!rowHasPrice(prices)) continue
    out.push({ name, prices })
  }
  if (!out.length) return null
  return { category, columns, rows: out }
}

/**
 * Rental: nested Будние/Выходные × duration bands; flat «N руб. в час» rows keep
 * prices in the matching day columns.
 * @param {string[][]} rows
 * @param {string} category
 */
function parseRentalTable(rows, category) {
  const durIdx = rows.findIndex(
    (r) => r.filter((c) => /час/i.test(c)).length >= 3 && !/будн|выходн/i.test(r[0] || ''),
  )
  if (durIdx < 0) return null

  const durations = rows[durIdx].map(cleanText).filter(Boolean)
  // Expect 8 leaf bands (4 weekday + 4 weekend); tolerate slight site quirks.
  const columns = durations.slice(0, 8)
  if (columns.length < 4) return null
  const mid = Math.floor(columns.length / 2)
  const columnGroups = [
    { label: WEEKDAY, span: mid },
    { label: WEEKEND, span: columns.length - mid },
  ]

  /** @type {{ name: string, prices: object[] }[]} */
  const out = []
  for (const row of rows.slice(durIdx + 1)) {
    const name = cleanText(row[0] || '')
    if (!name) continue
    const cells = row.slice(1)
    // Flat «N руб. в час» / single flat RUB — place under weekday (+ weekend if two).
    if (
      cells.length <= 2 &&
      cells.every((c) => /руб/i.test(c) || /^\d/.test(c))
    ) {
      const prices = Array.from({ length: columns.length }, () => ({ price: null }))
      const first = parseTariffCell(cells[0] || '')
      const second = cells[1] ? parseTariffCell(cells[1]) : null
      if (first.price != null || first.note) prices[0] = first
      if (second && (second.price != null || second.note)) {
        prices[mid] = second
      } else if (first.price != null || first.note) {
        // Same flat rate both day bands when site shows one value.
        prices[mid] = { ...first }
      }
      if (!rowHasPrice(prices)) continue
      out.push({ name, prices })
      continue
    }

    const prices = cellsToPrices(cells, columns.length)
    if (!rowHasPrice(prices)) continue
    out.push({ name, prices })
  }
  if (!out.length) return null
  return { category, columns, columnGroups, rows: out }
}

/**
 * Parse all price tables from the Puhtolova lifts/rental page HTML.
 * @param {string} html
 * @returns {{ groups: object[] }}
 */
export function parsePuhtolovaPriceGroups(html) {
  const $ = loadHtml(html)
  /** @type {object[]} */
  const groups = []

  $('table').each((_, table) => {
    const $table = $(table)
    const rows = tableRows($, $table)
    if (rows.length < 2) return

    const heading =
      precedingH3($, $table) ||
      (groups.length === 0 ? 'Подъёмники основные склоны' : '')
    const category = softenLabel(heading) || 'Тарифы'

    let parsed = null
    if (/прокат/i.test(category)) {
      parsed = parseRentalTable(rows, category)
    } else if (
      rows.some(
        (r) =>
          r.filter((c) => /детск/i.test(c)).length &&
          r.filter((c) => /взросл/i.test(c)).length,
      )
    ) {
      parsed = parseMainSlopesTable(rows, category)
    } else {
      parsed = parseDayBandTable(rows, category)
    }

    if (parsed?.rows?.length) groups.push(parsed)
  })

  return { groups }
}

/**
 * @returns {Promise<object>}
 */
export async function scrapePuhtolovaGora() {
  const resortId = 'puhtolova-gora'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    const hoursHtml = await fetchUrl(HOURS_URL)
    await sleep()
    let newsHtml = ''
    try {
      newsHtml = await fetchUrl(NEWS_URL)
    } catch {
      newsHtml = ''
    }
    await sleep()
    const camHtml = await fetchUrl(WEBCAM_URL)

    const { groups } = parsePuhtolovaPriceGroups(pricesHtml)

    const $h = loadHtml(hoursHtml)
    const periods = []
    $h('table').each((ti, table) => {
      const rows = tableRows($h, $h(table))
      // Schedule table usually has day names
      const looksLikeSchedule = rows.some((r) => /пн|вт|ср|чт|пт|сб|вс|будн|выходн/i.test(r.join(' ')))
      if (!looksLikeSchedule) return
      for (const row of rows) {
        const days = row[0]
        const hours = row[1] || ''
        if (!days) continue
        if (/25-26\.12|праздничн|каникулы/i.test(days)) continue // skip dated holiday archive noise if mixed
        const oc = hours.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/)
        if (oc) {
          periods.push({ days: cleanText(days), open: oc[1], close: oc[2] })
        } else if (/выходн/i.test(hours) || /выходн/i.test(days)) {
          periods.push({ days: cleanText(days), open: '', close: '' })
        }
      }
    })

    // Prefer winter schedule rows (ср/чт/пт, сб/вс, пн/вт)
    const trimmed = periods.length > 6 ? periods.slice(0, 3) : periods
    const summary =
      formatCardHoursFromPeriods(trimmed) || 'Часто пн–вт выходной'

    const embeds = extractIframeSrcs(loadHtml(camHtml), WEBCAM_URL)
    const important = newsHtml ? detectPuhtolovaImportant(newsHtml, NEWS_URL) : []
    const slopeStatus = detectPuhtolovaSlopeStatus(important, newsHtml)

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICES_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length
          ? undefined
          : 'Таблица подъёмников на сайте без числовых тарифов (вне сезона?) — смотрите официальную страницу',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods: trimmed.slice(0, 12),
        status: trimmed.length ? 'ok' : 'partial',
        slopesOpen: slopeStatus.slopesOpen,
      }),
      webcamUrl: WEBCAM_URL,
      // ipeye iframe: codec unsupported / no playable stream — link-only.
      cameraEmbeds: embeds.filter(() => false),
      important,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICES_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
