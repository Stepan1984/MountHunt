import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectTuutariImportant } from '../lib/important.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'
import { detectTuutariSlopeStatus } from '../lib/slope-status.mjs'

export const TUUTARI_PRICES_URL = 'https://www.2-park.ru/prices/lift/'
export const TUUTARI_PRICES_FALLBACK_URL = 'https://tuutari.ru/price.html'
export const TUUTARI_HOURS_URL = 'https://www.2-park.ru/'
export const TUUTARI_NEWS_URL = 'https://www.2-park.ru/about/news/'
export const TUUTARI_WEBCAM_URL = 'https://www.2-park.ru/about/webcam/'

const PRICES_URL = TUUTARI_PRICES_URL
const HOURS_URL = TUUTARI_HOURS_URL
const WEBCAM_URL = TUUTARI_WEBCAM_URL
const NEWS_URL = TUUTARI_NEWS_URL

/**
 * @param {string} pricesHtml
 */
function parseTuutariPriceGroups(pricesHtml) {
  const $p = loadHtml(pricesHtml)
  /** @type {{ category: string, columns: string[], rows: object[] }[]} */
  const groups = []

  $p('table').each((ti, table) => {
    const rows = tableRows($p, $p(table))
    if (rows.length < 2) return
    const header = rows[0].map((h) => h.toLowerCase())
    if (!header.some((h) => /час|взрослый|детск/.test(h))) return

    const prevText = cleanText($p(table).prevAll().first().text() || $p(table).parent().prev().text())
    let dayLabel = ti === 0 ? 'Выходной/праздник' : 'Будни'
    const section = cleanText(
      $p(table)
        .closest('div')
        .prevAll('h1,h2,h3,h4,p,div')
        .first()
        .text(),
    )
    const blob = `${prevText} ${section} ${$p(table).parent().text().slice(0, 200)}`.toLowerCase()
    if (/будн/.test(blob)) dayLabel = 'Будни'
    if (/выходн|празднич/.test(blob)) dayLabel = 'Выходной/праздник'

    const columns = rows[0].slice(1).map((c) => cleanText(c)).filter(Boolean)
    if (!columns.length) return

    /** @type {{ name: string, duration?: string, prices: object[] }[]} */
    const skipassRows = []
    for (const row of rows.slice(1)) {
      const unit = row[0]
      if (!unit || !/\d/.test(unit)) continue
      const prices = []
      let any = false
      for (let c = 1; c < row.length && c - 1 < columns.length; c++) {
        const price = parsePrice(row[c])
        if (price == null) {
          prices.push({ price: null })
          continue
        }
        any = true
        prices.push({ price, rawText: row[c] })
      }
      if (!any) continue
      skipassRows.push({
        name: 'Ски-пасс',
        duration: cleanText(unit),
        prices,
      })
    }
    if (skipassRows.length) {
      groups.push({
        category: dayLabel,
        columns,
        rows: skipassRows,
      })
    }
  })
  return groups
}

/**
 * @returns {Promise<{resortId: string, prices: object, hours: object, webcamUrl?: string, cameraEmbeds?: string[], important?: object[], error?: string}>}
 */
export async function scrapeTuutari() {
  const resortId = 'tuutari-park'
  try {
    let pricesHtml = ''
    let pricesSource = PRICES_URL
    try {
      pricesHtml = await fetchUrl(PRICES_URL)
    } catch {
      await sleep()
      pricesHtml = await fetchUrl(TUUTARI_PRICES_FALLBACK_URL)
      pricesSource = TUUTARI_PRICES_FALLBACK_URL
    }
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
    let camHtml = ''
    try {
      camHtml = await fetchUrl(WEBCAM_URL)
    } catch {
      camHtml = await fetchUrl('https://tuutari.ru/webcam.html')
    }

    const groups = parseTuutariPriceGroups(pricesHtml)

    const $h = loadHtml(hoursHtml)
    const body = cleanText($h('body').text())
    let summary = 'Нет данных о режиме парка'
    const periods = []
    const weekday = body.match(/Режим работы парка:.*?Будние дни с\s*(\d{1,2})[-.:](\d{2})\s*до\s*(\d{1,2})[-.:](\d{2})/i)
    const weekend = body.match(/Режим работы парка:.*?Выходные дни с\s*(\d{1,2})[-.:](\d{2})\s*до\s*(\d{1,2})[-.:](\d{2})/i)
    const idx = body.toLowerCase().lastIndexOf('режим работы парка')
    const slice = idx >= 0 ? body.slice(idx, idx + 280) : body
    const wd = slice.match(/Будние дни с\s*(\d{1,2})[-.:](\d{2})\s*до\s*(\d{1,2})[-.:](\d{2})/i)
    const we = slice.match(/Выходные дни с\s*(\d{1,2})[-.:](\d{2})\s*до\s*(\d{1,2})[-.:](\d{2})/i)
    const fmt = (m) => `${m[1].padStart(2, '0')}:${m[2]}–${m[3].padStart(2, '0')}:${m[4]}`
    if (wd) {
      periods.push({ days: 'будни', open: `${wd[1].padStart(2, '0')}:${wd[2]}`, close: `${wd[3].padStart(2, '0')}:${wd[4]}` })
    }
    if (we) {
      periods.push({
        days: 'выходные',
        open: `${we[1].padStart(2, '0')}:${we[2]}`,
        close: `${we[3].padStart(2, '0')}:${we[4]}`,
      })
    }
    if (wd && we) {
      summary = `будни: ${fmt(wd)}; выходные: ${fmt(we)}`
    } else if (weekday && weekend) {
      summary = `будни: ${fmt(weekday)}; выходные: ${fmt(weekend)}`
    }

    const $c = loadHtml(camHtml)
    const embeds = extractIframeSrcs($c, WEBCAM_URL)
    const important = newsHtml ? detectTuutariImportant(newsHtml, NEWS_URL) : []
    const slopeStatus = detectTuutariSlopeStatus(important, newsHtml)

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: pricesSource,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length ? undefined : 'Таблицы цен не удалось прочитать',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods,
        status: periods.length || summary.includes('будни') ? 'ok' : 'partial',
        slopesOpen: slopeStatus.slopesOpen,
      }),
      webcamUrl: WEBCAM_URL,
      cameraEmbeds: embeds,
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
