import { fetchUrl, sleep } from '../lib/http.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'

const PRICES_URL = 'https://zoldol.ru/price-winter'
const HOURS_URL = 'https://zoldol.ru/vremya-raboty'
const WEBCAM_URL = 'https://zoldol.ru/webcamera'

/**
 * Tilda t431 tables store semicolon CSV rows (often in display:none).
 * @param {string} html
 */
function parseLiftItemsFromHtml(html) {
  const items = []
  const labels = ['детский будни', 'взрослый будни', 'детский выходные', 'взрослый выходные']
  const rowRe =
    /((?:\d+\s*)?(?:подъем|подъём|подъема|часа?|час))\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)\s*;\s*(\d+)/gi
  let m
  while ((m = rowRe.exec(html))) {
    const name = cleanText(m[1])
    if (/инвентар|комплект|ботин|палки|куртка|группа|баня/i.test(name)) continue
    for (let i = 0; i < 4; i++) {
      const price = parsePrice(m[i + 2])
      if (price == null) continue
      items.push({
        title: `${name} (${labels[i]})`,
        price,
        unit: /час/i.test(name) ? 'час' : 'подъём',
        rawText: m[i + 2],
      })
    }
  }
  return items
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

    let items = parseLiftItemsFromHtml(pricesHtml).slice(0, 40)

    const $h = loadHtml(hoursHtml)
    const text = cleanText($h('body').text())
    const important = []
    let summary = 'См. график на сайте'
    const periods = []

    if (/Горнолыжные склоны закрыты/i.test(text)) {
      summary = 'Горнолыжные склоны закрыты на летний период (уточняйте открытие на сайте)'
      important.push({
        id: 'zoldol-slopes-closed',
        resortId,
        title: 'Золотая Долина: склоны закрыты',
        body: 'На странице часов работы указано, что горнолыжные склоны закрыты на летний период.',
        severity: 'warn',
        updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        sourceUrl: HOURS_URL,
      })
    }

    // Weekly dated lines: «Среда; 18.11.2026 ; 12:00 - 22:00»
    const dayLines = [...text.matchAll(
      /(Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)\s*;\s*[\d.]+\s*;\s*([^;]+?)(?=(?:Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье)|Бургерная|Велопарк|$)/gi,
    )]
    // Take first week of slope-ish schedule (first 7 matches)
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
        items,
        status: items.length ? 'ok' : 'partial',
        note: items.length
          ? 'Не является публичной офертой — уточняйте на сайте курорта'
          : 'Не удалось извлечь таблицы ски-пассов',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods,
        status: /закрыты на летний/i.test(summary) || periods.length ? 'ok' : 'partial',
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
