import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectZoldolImportant } from '../lib/important.mjs'
import {
  formatCardHoursFromPeriods,
  groupHoursPeriods,
} from '../lib/card-hours-format.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'
import { detectZoldolSlopeStatus } from '../lib/slope-status.mjs'

const PRICES_URL = 'https://zoldol.ru/price-winter'
export const ZOLDOL_HOURS_URL = 'https://zoldol.ru/vremya-raboty'
const HOURS_URL = ZOLDOL_HOURS_URL
const WEBCAM_URL = 'https://zoldol.ru/webcamera'

const COLUMNS = ['Детский · будни', 'Взрослый · будни', 'Детский · выходные', 'Взрослый · выходные']

/**
 * Tilda t431 tables store semicolon CSV rows (often in display:none).
 * @param {string} html
 */
export function parseZoldolSkipassGroups(html) {
  /** @type {Map<string, { name: string, duration: string, prices: object[] }[]>} */
  const byKind = new Map()
  // Official t431 CSV uses genitive plurals: «5 подъемов», «5 часов», «15 подъемов».
  const rowRe =
    /((?:\d+\s*)?(?:подъём(?:ов|а)?|подъем(?:ов|а)?|час(?:ов|а)?))\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)/gi
  /** @type {Map<string, Set<string>>} */
  const seenByKind = new Map()
  let m
  while ((m = rowRe.exec(html))) {
    const name = cleanText(m[1])
    if (/инвентар|комплект|ботин|палки|куртка|группа|баня/i.test(name)) continue
    const kind = /час/i.test(name) ? 'По часам' : 'По подъёмам'
    const prices = []
    for (let i = 0; i < 4; i++) {
      const price = parsePrice(m[i + 2])
      prices.push({ price, rawText: m[i + 2] })
    }
    if (!prices.some((p) => p.price != null)) continue
    const duration = name.replace(/подъем/gi, 'подъём')
    const seen = seenByKind.get(kind) || new Set()
    if (seen.has(duration)) continue
    seen.add(duration)
    seenByKind.set(kind, seen)
    const rows = byKind.get(kind) || []
    rows.push({
      name: 'Ски-пасс',
      duration,
      prices,
    })
    byKind.set(kind, rows)
  }

  /** @type {{ category: string, columns: string[], rows: object[] }[]} */
  const groups = []
  for (const [category, rows] of byKind) {
    groups.push({ category, columns: [...COLUMNS], rows })
  }
  return groups
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeZolotayaDolina() {
  const resortId = 'zolotaya-dolina'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    const hoursHtml = await fetchUrl(HOURS_URL)
    await sleep()
    const camHtml = await fetchUrl(WEBCAM_URL)

    const groups = parseZoldolSkipassGroups(pricesHtml)

    const $h = loadHtml(hoursHtml)
    const text = cleanText($h('body').text())
    const important = detectZoldolImportant(hoursHtml, HOURS_URL)
    const slopeStatus = detectZoldolSlopeStatus(hoursHtml)
    // Slope closed status → slopesOpen / badge; hours.summary stays schedule-only.
    let summary = 'См. график на сайте'
    /** @type {{ days: string, open: string, close: string }[]} */
    let periods = []

    const dayLines = [...text.matchAll(
      /(Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)\s*;\s*[\d.]+\s*;\s*([^;]+?)(?=(?:Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)|Бургерная|Велопарк|$)/gi,
    )]
    const firstWeek = dayLines.slice(0, 7)
    if (firstWeek.length) {
      const seenDays = new Set()
      /** @type {{ days: string, open: string, close: string }[]} */
      const rawPeriods = []
      for (const m of firstWeek) {
        const days = m[1]
        const dayKey = days.toLowerCase()
        if (seenDays.has(dayKey)) continue
        seenDays.add(dayKey)
        const val = cleanText(m[2])
        const openClose = val.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/)
        if (openClose) {
          rawPeriods.push({ days, open: openClose[1], close: openClose[2] })
        } else if (/закрыт/i.test(val)) {
          rawPeriods.push({ days, open: '', close: '' })
        }
      }
      const formatted = formatCardHoursFromPeriods(rawPeriods)
      if (formatted) summary = formatted
      // Persist abbr + merged day rows (same shape as the detail table).
      periods = groupHoursPeriods(rawPeriods) || rawPeriods
    }

    const embeds = extractIframeSrcs(loadHtml(camHtml), WEBCAM_URL).filter((u) =>
      /rtsp\.(ru|me)|ivideon|webcam/i.test(u),
    )

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICES_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length
          ? undefined
          : 'Не удалось извлечь таблицы ски-пассов',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods,
        status: periods.length ? 'ok' : 'partial',
        slopesOpen: slopeStatus.slopesOpen,
      }),
      webcamUrl: WEBCAM_URL,
      // rtsp.ru embeds load a black player shell with no stream — link-only.
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
