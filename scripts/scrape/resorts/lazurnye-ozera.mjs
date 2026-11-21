import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectLazurnyeImportant } from '../lib/important.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'

const PRICES_URL = 'https://lazoorsnow.ru/ceny'
export const LAZURNYE_HOME_URL = 'https://lazoorsnow.ru/'
const HOME_URL = LAZURNYE_HOME_URL

/**
 * @returns {Promise<object>}
 */
export async function scrapeLazurnyeOzera() {
  const resortId = 'lazurnye-ozera'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    const homeHtml = await fetchUrl(HOME_URL)

    const $p = loadHtml(pricesHtml)
    /** @type {{ category: string, columns: string[], rows: object[] }[]} */
    const groups = []
    const tables = $p('table').toArray()
    // First table is typically hourly ski-pass (часы × будни/выходные)
    if (tables[0]) {
      const rows = tableRows($p, $p(tables[0]))
      const header = rows[0] || []
      const colWeekday = header[1] ? cleanText(header[1]) : 'Будни'
      const colWeekend = header[2] ? cleanText(header[2]) : 'Выходные'
      /** @type {{ name: string, duration?: string, prices: object[] }[]} */
      const skipassRows = []
      for (const row of rows.slice(1)) {
        const hours = row[0]
        if (!hours || !/\d/.test(hours)) continue
        const weekday = parsePrice(row[1])
        const weekend = parsePrice(row[2])
        if (weekday == null && weekend == null) continue
        // Cell may already be «1 ч» / «1 час» — avoid «1 ч ч».
        const hoursLabel = cleanText(hours)
        const duration = /час|\bч\b/i.test(hoursLabel) ? hoursLabel : `${hoursLabel} ч`
        skipassRows.push({
          name: 'Ски-пасс',
          duration,
          prices: [
            { price: weekday, rawText: row[1] },
            { price: weekend, rawText: row[2] },
          ],
        })
      }
      if (skipassRows.length) {
        groups.push({
          category: 'Ски-пасс',
          columns: [colWeekday || 'Будни', colWeekend || 'Выходные'],
          rows: skipassRows,
        })
      }
    }

    const $h = loadHtml(homeHtml)
    const text = cleanText($h('body').text())
    const important = detectLazurnyeImportant(homeHtml, HOME_URL)
    const seasonClosed = important.length > 0

    let summary = 'Режим уточняйте на сайте'
    const periods = []
    const hoursMatch = text.match(
      /пн[:\s]*выходной[;\s]*вт[–\-−]?пт[:\s]*([\d.]+)[–\-−]([\d.]+)[;\s]*сб[–\-−]?вс[:\s]*([\d.]+)[–\-−]([\d.]+)/i,
    )
    const norm = (t) => t.replace('.', ':').replace(/^(\d):/, '0$1:').replace(/:(\d)$/, ':$10')
    const footer = text.match(
      /пн:\s*выходной;\s*вт-пт:\s*([\d.]+)-([\d.]+);\s*сб-вс:\s*([\d.]+)-([\d.]+)/i,
    )
    if (footer) {
      const openWd = footer[1].replace('.', ':')
      const closeWd = footer[2].replace('.', ':')
      const openWe = footer[3].replace('.', ':')
      const closeWe = footer[4].replace('.', ':')
      periods.push({ days: 'пн', open: '', close: '' })
      periods.push({ days: 'вт–пт', open: openWd, close: closeWd })
      periods.push({ days: 'сб–вс', open: openWe, close: closeWe })
      summary = `пн: выходной; вт–пт: ${openWd}–${closeWd}; сб–вс: ${openWe}–${closeWe}`
    } else if (hoursMatch) {
      summary = `пн: выходной; вт–пт: ${norm(hoursMatch[1])}–${norm(hoursMatch[2])}; сб–вс: ${norm(hoursMatch[3])}–${norm(hoursMatch[4])}`
    }
    if (seasonClosed) {
      summary = summary && summary !== 'Режим уточняйте на сайте'
        ? `Сезон закрыт. ${summary}`
        : 'Сезон закрыт — уточняйте открытие на сайте'
    }

    const embeds = extractIframeSrcs($h, HOME_URL).filter((u) => /rtsp/i.test(u))

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICES_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length ? undefined : 'Таблицу цен не удалось прочитать',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOME_URL,
        summary,
        periods,
        status: /выходной/.test(summary) ? 'ok' : 'partial',
      }),
      webcamUrl: HOME_URL,
      // rtsp.me: «доступ ограничен» / unpaid — link-only, no empty player.
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
        sourceUrl: HOME_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
