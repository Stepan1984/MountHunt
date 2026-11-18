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

const PRICES_URL = 'https://puhgora.ru/uslugi/ceny-na-podyomniki'
const HOURS_URL = 'https://puhgora.ru/o-kurorte/chasy-raboty'
const WEBCAM_URL = 'https://puhgora.ru/web-camera'

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
    const camHtml = await fetchUrl(WEBCAM_URL)

    const $p = loadHtml(pricesHtml)
    /** @type {{ category: string, columns: string[], rows: object[] }[]} */
    const groups = []
    $p('table').each((ti, table) => {
      const rows = tableRows($p, $p(table))
      if (rows.length < 2) return
      const header = rows[0]
      const columns = header.slice(1).map((c) => cleanText(c)).filter(Boolean)
      if (!columns.length) return
      /** @type {{ name: string, duration?: string, prices: object[] }[]} */
      const skipassRows = []
      for (const row of rows.slice(1)) {
        const titleBase = row[0]
        if (!titleBase || /цены по/i.test(titleBase)) continue
        const prices = []
        let any = false
        for (let c = 1; c < row.length && c - 1 < columns.length; c++) {
          const cell = row[c]
          if (!cell || /час|подъ[её]м|бесплат/i.test(cell)) {
            prices.push({ price: null })
            continue
          }
          if (!/^\d[\d\s.,]*$/.test(cell.replace(/руб\.?/gi, '').trim())) {
            prices.push({ price: null })
            continue
          }
          const price = parsePrice(cell)
          if (price == null || price < 50) {
            prices.push({ price: null })
            continue
          }
          any = true
          prices.push({ price, rawText: cell })
        }
        if (!any) continue
        // Row label may already be a duration («1 час») or a tariff name.
        const label = cleanText(titleBase)
        const isDuration = /\d/.test(label) && /час|подъ[её]м|проход/i.test(label)
        skipassRows.push({
          name: isDuration ? 'Ски-пасс' : label,
          duration: isDuration ? label : undefined,
          prices,
        })
      }
      if (!skipassRows.length) return
      const heading = cleanText(
        $p(table).prevAll('h1,h2,h3,h4').first().text() ||
          (ti === 0 ? 'Подъёмники' : `Тарифы ${ti + 1}`),
      )
      groups.push({
        category: heading || 'Подъёмники',
        columns,
        rows: skipassRows,
      })
    })

    const $h = loadHtml(hoursHtml)
    const periods = []
    let summaryParts = []
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
          summaryParts.push(`${cleanText(days)} ${oc[1]}–${oc[2]}`)
        } else if (/выходн/i.test(hours) || /выходн/i.test(days)) {
          periods.push({ days: cleanText(days), open: '', close: '' })
          summaryParts.push(`${cleanText(days)}: выходной`)
        }
      }
    })

    // Prefer winter schedule rows (ср/чт/пт, сб/вс, пн/вт)
    if (summaryParts.length > 6) {
      summaryParts = summaryParts.slice(0, 3)
    }
    const summary = summaryParts.length
      ? summaryParts.join('; ')
      : 'Часы работы уточняйте на сайте (часто пн–вт выходной)'

    const embeds = extractIframeSrcs(loadHtml(camHtml), WEBCAM_URL)

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
        periods: periods.slice(0, 12),
        status: periods.length ? 'ok' : 'partial',
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
