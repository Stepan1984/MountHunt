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

const PRICES_URL = 'https://lazoorsnow.ru/ceny'
const HOME_URL = 'https://lazoorsnow.ru/'

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
    const items = []
    const tables = $p('table').toArray()
    // First table is typically hourly ski-pass
    if (tables[0]) {
      const rows = tableRows($p, $p(tables[0]))
      for (const row of rows.slice(1)) {
        const hours = row[0]
        if (!hours || !/\d/.test(hours)) continue
        const weekday = parsePrice(row[1])
        const weekend = parsePrice(row[2])
        if (weekday != null) {
          items.push({
            title: `Ски-пасс ${hours} ч (будни)`,
            price: weekday,
            unit: 'час',
            rawText: row[1],
          })
        }
        if (weekend != null) {
          items.push({
            title: `Ски-пасс ${hours} ч (выходные)`,
            price: weekend,
            unit: 'час',
            rawText: row[2],
          })
        }
      }
    }

    const $h = loadHtml(homeHtml)
    const text = cleanText($h('body').text())
    const important = []
    const seasonClosed =
      /Сезон\s*20\d{2}\s*закрыт/i.test(text) || /сезон.*закрыт/i.test(text)
    if (seasonClosed) {
      important.push({
        id: 'lazurnye-season-closed',
        resortId,
        title: 'Лазурные озёра: сезон закрыт',
        body: 'На сайте курорта есть сообщение о закрытии сезона. Перед выездом проверьте актуальность.',
        severity: 'warn',
        updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        sourceUrl: HOME_URL,
      })
    }

    let summary = 'Режим уточняйте на сайте'
    const periods = []
    // пн: выходной; вт–пт: 11.00–22.00; сб–вс: 10.00–22.00
    const hoursMatch = text.match(
      /пн[:\s]*выходной[;\s]*вт[–\-−]?пт[:\s]*([\d.]+)[–\-−]([\d.]+)[;\s]*сб[–\-−]?вс[:\s]*([\d.]+)[–\-−]([\d.]+)/i,
    )
    const norm = (t) => t.replace('.', ':').replace(/^(\d):/, '0$1:').replace(/:(\d)$/, ':$10')
    // simpler: look for "вт-пт" pattern
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
    // Surface closed-season in hours so cards hide «от N ₽» even if Important is filtered.
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
        items,
        status: items.length ? 'ok' : 'partial',
        note: items.length ? undefined : 'Таблица цен не распознана',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOME_URL,
        summary,
        periods,
        status: /выходной/.test(summary) ? 'ok' : 'partial',
      }),
      webcamUrl: HOME_URL,
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
        sourceUrl: HOME_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
