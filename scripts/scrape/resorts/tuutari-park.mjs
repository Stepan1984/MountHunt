import { fetchUrl, sleep } from '../lib/http.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'

const PRICES_URL = 'http://www.2-park.ru/prices/lift/'
const HOURS_URL = 'https://www.2-park.ru/'
const WEBCAM_URL = 'https://tuutari.ru/webcam.html'

/**
 * @returns {Promise<{resortId: string, prices: object, hours: object, webcamUrl?: string, cameraEmbeds?: string[], error?: string}>}
 */
export async function scrapeTuutari() {
  const resortId = 'tuutari-park'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    const hoursHtml = await fetchUrl(HOURS_URL)
    await sleep()
    const camHtml = await fetchUrl(WEBCAM_URL)

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

    const $h = loadHtml(hoursHtml)
    const body = cleanText($h('body').text())
    let summary = 'Режим парка уточняйте на сайте'
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
      summary = `будни ${fmt(wd)}; выходные ${fmt(we)}`
    } else if (weekday && weekend) {
      summary = `будни ${fmt(weekday)}; выходные ${fmt(weekend)}`
    }

    const $c = loadHtml(camHtml)
    const embeds = extractIframeSrcs($c, WEBCAM_URL)

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICES_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length ? undefined : 'Таблицы цен не распознаны',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary,
        periods,
        status: periods.length || summary.includes('будни') ? 'ok' : 'partial',
      }),
      webcamUrl: WEBCAM_URL,
      cameraEmbeds: embeds,
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
