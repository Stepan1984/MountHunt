import { fetchUrl, sleep } from '../lib/http.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  parseCsv,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'

const PAGE_URL = 'https://krasnoeozero.ru/winter/skipass-and-lifts'
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuTEvLg230S45pOu7aSVs--gOtknAPG2vYD6HwVEMcwTHhAd33FlU6aGrWAmQB68F4uDWeYkgzuWbj/pub?gid=1912036084&single=true&output=csv'
const HOURS_PAGE_URL = 'https://krasnoeozero.ru/grafik/'
const HOURS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuTEvLg230S45pOu7aSVs--gOtknAPG2vYD6HwVEMcwTHhAd33FlU6aGrWAmQB68F4uDWeYkgzuWbj/pub?gid=1367114585&single=true&output=csv'
const WEBCAM_URL = 'https://krasnoeozero.ru/cam/'

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
function parseHoursFromCsv(csv) {
  const { header, rows } = parseCsv(csv)
  const dateCol = pickScheduleDateColumn(header)
  if (!dateCol) {
    return {
      hours: hoursSnapshot({
        resortId: 'krasnoe-ozero',
        sourceUrl: HOURS_PAGE_URL,
        summary: 'Колонка даты в CSV графика не найдена',
        status: 'partial',
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

  let summary = bits.slice(0, 4).join('; ') || `График на ${dateCol} без ski-строк`
  if (closedUntilSeason || (allClosed && slopes.length)) {
    summary = `На ${dateCol}: склоны/подъёмники закрыты до сезона (CSV графика)`
  }

  const important = []
  if (closedUntilSeason || (allClosed && slopes.length)) {
    important.push({
      id: 'krasnoe-slopes-closed',
      resortId: 'krasnoe-ozero',
      title: 'Красное озеро: склоны закрыты до сезона',
      body: `По публичному CSV графика на ${dateCol} трассы/подъёмники отмечены как закрытые до сезона.`,
      severity: 'warn',
      updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sourceUrl: HOURS_PAGE_URL,
    })
  }

  return {
    hours: hoursSnapshot({
      resortId: 'krasnoe-ozero',
      sourceUrl: HOURS_PAGE_URL,
      summary,
      periods,
      status: bits.length || closedUntilSeason ? 'ok' : 'partial',
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

/**
 * Build skipass groups from CSV rows (site widget structure).
 * @param {Record<string, string>[]} rows
 */
export function parseKrasnoeSkipassGroups(rows) {
  /** @type {{ name: string, duration?: string, prices: object[], note?: string }[]} */
  const skipassRows = []
  const columns = ['1 ч будни', '1 ч выходные']
  for (const row of rows) {
    const pageKey = cleanText(row['Ключ страницы'] || '')
    const show = cleanText(row['Показывать'] || '').toLowerCase()
    if (pageKey !== 'ski-pass' || show !== 'yes') continue
    const name = cleanText(row['Название'] || '')
    if (!name) continue
    const weekday = parsePrice(row['1 час будни'] ?? row['1 час'] ?? '')
    const weekend = parsePrice(row['1 час выходные'] ?? '')
    if (weekday == null && weekend == null) continue
    skipassRows.push({
      name,
      duration: '1 час',
      prices: [
        { price: weekday, rawText: String(row['1 час будни'] ?? row['1 час'] ?? '') },
        { price: weekend, rawText: String(row['1 час выходные'] ?? '') },
      ],
      note: cleanText(row['Уточнение'] || '') || undefined,
    })
  }
  if (!skipassRows.length) return []
  return [
    {
      category: 'Ски-пасс (часы)',
      columns,
      rows: skipassRows,
      note: 'Стоимость БСК уточняйте на сайте',
    },
  ]
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
            summary: 'CSV графика недоступен',
            status: 'partial',
          }),
          important: [],
        }

    const embeds = camHtml ? extractIvideon(camHtml) : []

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length
          ? 'Источник: публичный CSV виджета цен курорта'
          : 'CSV получен, ski-pass строки не найдены',
      }),
      hours: hoursPack.hours,
      webcamUrl: WEBCAM_URL,
      // ivideon embed stays on splash / no playable video in-page — link-only.
      cameraEmbeds: embeds.filter(() => false),
      important: hoursPack.important,
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
