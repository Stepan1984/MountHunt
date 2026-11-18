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

const PRICES_URL = 'https://snegny.ru/%d1%81%d0%ba%d0%b8-%d0%bf%d0%b0%d1%81%d1%81%d1%8b/'
const TWOCAM_URL = 'https://snegny.ru/wp-content/themes/snegny/twocam.php'
const HOME_URL = 'https://snegny.ru/'

const DAY_LABELS = [
  'будни, льготный',
  'будни, взрослый',
  'выходные, льготный',
  'выходные, взрослый',
]

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} table
 */
function parseLiftTable($, table) {
  const items = []
  const rows = tableRows($, $(table))
  for (const row of rows) {
    if (row.length < 5) continue
    const name = cleanText(row[0])
    if (!name || /будни|суббота|дети|взрослые|количество|почасов/i.test(name)) continue
    if (!/\d/.test(name)) continue
    const unit = /проход/i.test(name) ? 'проход' : /час/i.test(name) ? 'час' : 'тариф'
    for (let i = 0; i < 4; i++) {
      const price = parsePrice(row[i + 1])
      if (price == null) continue
      items.push({
        title: `${name} (${DAY_LABELS[i]})`,
        price,
        unit,
        rawText: row[i + 1],
      })
    }
  }
  return items
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} table
 * @param {string} prefix
 */
function parseNamePriceTable($, table, prefix) {
  const items = []
  for (const row of tableRows($, $(table))) {
    if (row.length < 2) continue
    const name = cleanText(row[0])
    const price = parsePrice(row[1])
    if (!name || price == null) continue
    items.push({
      title: prefix ? `${prefix}: ${name}` : name,
      price,
      unit: 'сезон',
      rawText: row[1],
    })
  }
  return items
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeSnezhny() {
  const resortId = 'snezhny'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    let camHtml = ''
    try {
      camHtml = await fetchUrl(TWOCAM_URL)
    } catch {
      camHtml = ''
    }

    const $ = loadHtml(pricesHtml)
    const tables = $('table').toArray()
    const items = []
    if (tables[0]) items.push(...parseLiftTable($, tables[0]))
    if (tables[1]) items.push(...parseNamePriceTable($, tables[1], 'Абонемент'))
    if (tables[2]) {
      items.push(...parseNamePriceTable($, tables[2], 'Единый ски-пасс Снежный/Золотая Долина'))
    }

    const embeds = []
    if (camHtml) {
      const $c = loadHtml(camHtml)
      embeds.push(...extractIframeSrcs($c, TWOCAM_URL))
      $c('[data-cam]').each((_, el) => {
        const cam = $c(el).attr('data-cam')
        if (cam) {
          try {
            embeds.push(new URL(cam, TWOCAM_URL).href)
          } catch {
            /* ignore */
          }
        }
      })
    }
    const uniqueEmbeds = [...new Set(embeds)].filter((u) => /exdesign|webcam/i.test(u))

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: decodeURI(PRICES_URL),
        items: items.slice(0, 50),
        status: items.length ? 'ok' : 'partial',
        note: items.length
          ? 'Сезонные/подъёмные тарифы со страницы ски-пассов; уточняйте на сайте'
          : 'Таблицы ски-пассов не распознаны',
      }),
      // Homepage hours are JS-rendered; cheerio-only → partial link note
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOME_URL,
        summary: 'Режим склонов уточняйте на главной snegny.ru (виджет; HTML без JS недоступен)',
        periods: [],
        status: 'partial',
      }),
      webcamUrl: uniqueEmbeds[0] || HOME_URL,
      cameraEmbeds: uniqueEmbeds,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: decodeURI(PRICES_URL),
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
