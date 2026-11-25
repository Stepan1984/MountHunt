import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectZoldolImportant } from '../lib/important.mjs'
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
  const rowRe =
    /((?:\d+\s*)?(?:подъем|подъём|подъема|часа?|час))\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)/gi
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
    const rows = byKind.get(kind) || []
    rows.push({
      name: 'Ски-пасс',
      duration: name.replace(/подъем/gi, 'подъём'),
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
    let summary = 'См. график на сайте'
    const periods = []

    if (important.length) {
      summary = 'Горнолыжные склоны закрыты на летний период (уточняйте открытие на сайте)'
    }

    const dayLines = [...text.matchAll(
      /(Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)\s*;\s*[\d.]+\s*;\s*([^;]+?)(?=(?:Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)|Бургерная|Велопарк|$)/gi,
    )]
    const firstWeek = dayLines.slice(0, 7)
    if (firstWeek.length) {
      const bits = []
      for (const m of firstWeek) {
        const days = m[1]
        const val = cleanText(m[2])
        const openClose = val.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/)
        if (openClose) {
          periods.push({ days, open: openClose[1], close: openClose[2] })
          bits.push(`${days}: ${openClose[1]}–${openClose[2]}`)
        } else if (/закрыт/i.test(val)) {
          periods.push({ days, open: '', close: '' })
          bits.push(`${days}: закрыто`)
        }
      }
      if (bits.length && !/закрыты на летний/i.test(summary)) {
        summary = bits.join('; ')
      } else if (bits.length) {
        summary = `${summary}. Ближайший график (прочее): ${bits.slice(0, 3).join('; ')}…`
      }
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
          ? 'Не является публичной офертой — уточняйте на сайте курорта'
          : 'Не удалось извлечь таблицы ски-пассов',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods,
        status: /закрыты на летний/i.test(summary) || periods.length ? 'ok' : 'partial',
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
