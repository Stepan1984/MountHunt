import { fetchUrl, fetchUrlResult, sleep } from '../lib/http.mjs'
import {
  detectKrasnoeImportantFromFlags,
  detectKrasnoeTelegramImportant,
  parseKrasnoeSiteNewsTexts,
} from '../lib/important.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  parseCsv,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'
import {
  appendHoursExtraNote,
  detectKrasnoeSlopeStatus,
} from '../lib/slope-status.mjs'

const PAGE_URL = 'https://krasnoeozero.ru/winter/skipass-and-lifts'
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuTEvLg230S45pOu7aSVs--gOtknAPG2vYD6HwVEMcwTHhAd33FlU6aGrWAmQB68F4uDWeYkgzuWbj/pub?gid=1912036084&single=true&output=csv'
export const KRASNOE_HOURS_PAGE_URL = 'https://krasnoeozero.ru/grafik/'
export const KRASNOE_HOURS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuTEvLg230S45pOu7aSVs--gOtknAPG2vYD6HwVEMcwTHhAd33FlU6aGrWAmQB68F4uDWeYkgzuWbj/pub?gid=1367114585&single=true&output=csv'
/** Public TG preview (no Bot API). Channel @redlakeclub. */
export const KRASNOE_TG_URL = 'https://t.me/s/redlakeclub'
export const KRASNOE_NEWS_PAGE_URL = 'https://krasnoeozero.ru/events/news/'
/** Tilda feed JSON used by the site news listing (for TG↔site dedupe). */
export const KRASNOE_NEWS_FEED_URL =
  'https://feeds.tildacdn.com/api/getfeed/?feeduid=498258978831-727634401901&size=20&slice=1'
const HOURS_PAGE_URL = KRASNOE_HOURS_PAGE_URL
const HOURS_CSV_URL = KRASNOE_HOURS_CSV_URL
const WEBCAM_URL = 'https://krasnoeozero.ru/cam/'

/**
 * Fetch Krasnoe Telegram (+ optional site news texts for dedupe). Fail-soft per source.
 * @returns {Promise<{ items: object[], tgFetched: boolean }>}
 */
export async function fetchKrasnoeTelegramImportant() {
  let siteNewsTexts = []
  try {
    const { body } = await fetchUrlResult(KRASNOE_NEWS_FEED_URL)
    siteNewsTexts = parseKrasnoeSiteNewsTexts(body)
  } catch {
    siteNewsTexts = []
  }

  try {
    await sleep()
    const { body } = await fetchUrlResult(KRASNOE_TG_URL)
    const items = detectKrasnoeTelegramImportant(body, KRASNOE_TG_URL, { siteNewsTexts })
    return { items, tgFetched: true }
  } catch {
    return { items: [], tgFetched: false }
  }
}

/** @param {string} h */
function isDateHeader(h) {
  return /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(cleanText(h))
}

/** @param {string} h */
function parseDateHeader(h) {
  const m = cleanText(h).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  let yyyy = Number(m[3])
  if (yyyy < 100) yyyy += 2000
  return new Date(Date.UTC(yyyy, mm - 1, dd))
}

/**
 * Pick today's date column, else the latest past/equal date, else last date col.
 * @param {string[]} header
 */
function pickScheduleDateColumn(header) {
  const dateCols = header.filter(isDateHeader)
  if (!dateCols.length) return null
  const today = new Date()
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const d = today.getUTCDate()
  const todayUtc = Date.UTC(y, m, d)
  const todayLabel = `${String(d).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}.${y}`
  if (dateCols.includes(todayLabel)) return todayLabel

  let best = null
  let bestTs = -Infinity
  for (const col of dateCols) {
    const dt = parseDateHeader(col)
    if (!dt) continue
    const ts = dt.getTime()
    if (ts <= todayUtc && ts >= bestTs) {
      bestTs = ts
      best = col
    }
  }
  return best || dateCols[dateCols.length - 1]
}

/**
 * @param {string} csv
 */
export function parseHoursFromCsv(csv) {
  const { header, rows } = parseCsv(csv)
  const dateCol = pickScheduleDateColumn(header)
  if (!dateCol) {
    return {
      hours: hoursSnapshot({
        resortId: 'krasnoe-ozero',
        sourceUrl: HOURS_PAGE_URL,
        summary: 'Нет данных о режиме склонов',
        status: 'partial',
        // Unknown schedule → fail-soft closed for badges.
        slopesOpen: false,
      }),
      important: [],
    }
  }

  const skiRows = rows.filter((r) => {
    const name = cleanText(r['Наименование'] || '')
    const cat = cleanText(r['Категория'] || '')
    return (
      /подъем|подъём|трасс/i.test(name) ||
      (/инфраструктура/i.test(cat) && /трасс/i.test(name))
    )
  })

  const lifts = []
  const slopes = []
  for (const r of skiRows) {
    const name = cleanText(r['Наименование'] || '')
    const val = cleanText(r[dateCol] || '')
    const entry = { name, val }
    if (/подъем|подъём/i.test(name)) lifts.push(entry)
    else slopes.push(entry)
  }

  const periods = []
  const bits = []
  const closedUntilSeason = [...lifts, ...slopes].some((e) => /закрыт.*сезон/i.test(e.val))
  const allClosed = [...lifts, ...slopes].every(
    (e) => !e.val || /закрыт|выход/i.test(e.val),
  )

  for (const e of lifts.slice(0, 6)) {
    const oc = e.val.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/)
    if (oc) {
      const open = oc[1].replace('.', ':')
      const close = oc[2].replace('.', ':')
      periods.push({ days: `${e.name} (${dateCol})`, open, close })
      bits.push(`${e.name}: ${open}–${close}`)
    } else if (e.val) {
      bits.push(`${e.name}: ${e.val}`)
    }
  }

  if (!bits.length && slopes.length) {
    const sample = slopes[0]
    bits.push(`Трассы: ${sample.val || 'нет данных'} (${dateCol})`)
  }

  // Closed-until-season → slopesOpen / badge; keep schedule bits in summary when present.
  // No real times → plain «нет данных» phrasing (never bare «График на DATE»).
  let summary = bits.slice(0, 4).join('; ') || 'Нет данных о режиме склонов'

  const pack = {
    closedUntilSeason,
    allClosed,
    slopesCount: slopes.length,
    dateCol,
  }
  const important = detectKrasnoeImportantFromFlags(pack, HOURS_PAGE_URL)
  const slopeStatus = detectKrasnoeSlopeStatus(pack, { header, rows, dateCol })
  summary = appendHoursExtraNote(summary, slopeStatus.note)

  return {
    hours: hoursSnapshot({
      resortId: 'krasnoe-ozero',
      sourceUrl: HOURS_PAGE_URL,
      summary,
      periods,
      status: bits.length || closedUntilSeason ? 'ok' : 'partial',
      slopesOpen: slopeStatus.slopesOpen,
    }),
    important,
  }
}

/**
 * @param {string} html
 */
function extractIvideon(html) {
  const $ = loadHtml(html)
  const urls = []
  $('[data-videolazy-id]').each((_, el) => {
    const id = $(el).attr('data-videolazy-id')
    if (id) urls.push(id)
  })
  return [...new Set(urls)].filter((u) => /ivideon/i.test(u))
}

/** Hourly columns on the ski-pass sheet (будни / выходные). */
const KRASNOE_HOUR_SLOTS = [
  { duration: '1 час', weekday: '1 час будни', weekend: '1 час выходные', weekdayAlt: '1 час' },
  { duration: '2 часа', weekday: '2 часа будни', weekend: '2 часа выходные', weekdayAlt: '2 часа' },
  { duration: '3 часа', weekday: '3 часа будни', weekend: '3 часа выходные' },
  { duration: '4 часа', weekday: '4 часа будни', weekend: '4 часа выходные' },
  { duration: '5 часов', weekday: '5 часов будни', weekend: '5 часов выходные' },
  { duration: '6 часов', weekday: '6 часов будни', weekend: '6 часов выходные' },
]

/** Pass-pack columns on the same sheet. */
const KRASNOE_PASS_SLOTS = [
  { duration: '1 проход', key: '1 проход' },
  { duration: '7 проходов', key: '7 проходов' },
  { duration: '15 проходов', key: '15 проходов' },
]

/**
 * Build skipass groups from CSV rows (site widget structure).
 * Official sheet publishes 1–6 hour weekday/weekend cells and pass packs —
 * not only the 1-hour columns.
 * @param {Record<string, string>[]} rows
 */
export function parseKrasnoeSkipassGroups(rows) {
  /** @type {{ category: string, columns: string[], rows: object[], note?: string }[]} */
  const groups = []
  const dayColumns = ['Будни', 'Выходные']

  for (const row of rows) {
    const pageKey = cleanText(row['Ключ страницы'] || '')
    const show = cleanText(row['Показывать'] || '').toLowerCase()
    if (pageKey !== 'ski-pass' || show !== 'yes') continue
    const name = cleanText(row['Название'] || '')
    if (!name) continue
    const note = cleanText(row['Уточнение'] || '') || undefined

    /** @type {{ name: string, duration?: string, prices: object[], note?: string }[]} */
    const hourRows = []
    for (const slot of KRASNOE_HOUR_SLOTS) {
      const wdRaw = row[slot.weekday] ?? (slot.weekdayAlt ? row[slot.weekdayAlt] : '') ?? ''
      const weRaw = row[slot.weekend] ?? ''
      const weekday = parsePrice(wdRaw)
      const weekend = parsePrice(weRaw)
      if (weekday == null && weekend == null) continue
      hourRows.push({
        name: 'Ски-пасс',
        duration: slot.duration,
        prices: [
          { price: weekday, rawText: String(wdRaw) },
          { price: weekend, rawText: String(weRaw) },
        ],
        note,
      })
    }
    if (hourRows.length) {
      const hourName = /проход/i.test(name)
        ? name
        : /час/i.test(name)
          ? name
          : `${name} (часы)`
      groups.push({
        category: hourName,
        columns: [...dayColumns],
        rows: hourRows,
        note: undefined,
      })
    }

    /** @type {{ name: string, duration?: string, prices: object[], note?: string }[]} */
    const passRows = []
    for (const slot of KRASNOE_PASS_SLOTS) {
      const raw = row[slot.key] ?? ''
      const price = parsePrice(raw)
      if (price == null) continue
      passRows.push({
        name: 'Ски-пасс',
        duration: slot.duration,
        prices: [{ price, rawText: String(raw) }],
        note,
      })
    }
    if (passRows.length) {
      const passName = /\(проходы\)/i.test(name)
        ? name
        : /час/i.test(name)
          ? name.replace(/\(часы\)/i, '(проходы)').replace(/часы/i, 'проходы')
          : `${name} (проходы)`
      groups.push({
        category: passName,
        columns: ['Цена'],
        rows: passRows,
        note: note || 'Проходы сохраняются до конца сезона',
      })
    }
  }

  return groups
}

/**
 * Prices via public Google Sheets CSV; hours via schedule CSV (same workbook).
 * @returns {Promise<object>}
 */
export async function scrapeKrasnoeOzero() {
  const resortId = 'krasnoe-ozero'
  try {
    const csv = await fetchUrl(CSV_URL)
    await sleep()
    let hoursCsv = ''
    try {
      hoursCsv = await fetchUrl(HOURS_CSV_URL)
    } catch {
      hoursCsv = ''
    }
    await sleep()
    let camHtml = ''
    try {
      camHtml = await fetchUrl(WEBCAM_URL)
    } catch {
      camHtml = ''
    }

    const { header, rows } = parseCsv(csv)
    if (!header.length) throw new Error('CSV пустой')
    const groups = parseKrasnoeSkipassGroups(rows)

    const hoursPack = hoursCsv
      ? parseHoursFromCsv(hoursCsv)
      : {
          hours: hoursSnapshot({
            resortId,
            sourceUrl: HOURS_PAGE_URL,
            summary: 'Нет данных о режиме склонов',
            status: 'partial',
          }),
          important: [],
        }

    const embeds = camHtml ? extractIvideon(camHtml) : []

    let tgItems = []
    let tgFetched = false
    try {
      await sleep()
      const tg = await fetchKrasnoeTelegramImportant()
      tgItems = tg.items
      tgFetched = tg.tgFetched
    } catch {
      tgItems = []
      tgFetched = false
    }

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length
          ? undefined
          : 'Цены на ски-пассы на сайте не найдены',
      }),
      hours: hoursPack.hours,
      webcamUrl: WEBCAM_URL,
      // ivideon embed stays on splash / no playable video in-page — link-only.
      cameraEmbeds: embeds.filter(() => false),
      important: [...(hoursPack.important || []), ...tgItems],
      // Keep previous krasnoe-tg-* cards when the public TG preview is unreachable.
      clearImportantPrefixes: tgFetched,
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
        sourceUrl: HOURS_PAGE_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
      webcamUrl: WEBCAM_URL,
    }
  }
}
