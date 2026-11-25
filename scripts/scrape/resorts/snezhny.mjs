import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectSnezhnyImportant } from '../lib/important.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'
import { detectGenericSlopeStatus } from '../lib/slope-status.mjs'

const PRICES_URL = 'https://snegny.ru/%d1%81%d0%ba%d0%b8-%d0%bf%d0%b0%d1%81%d1%81%d1%8b/'
const TWOCAM_URL = 'https://snegny.ru/wp-content/themes/snegny/twocam.php'
const HOME_URL = 'https://snegny.ru/'
export const SNEZHNY_NEWS_URL = 'https://snegny.ru/category/news/'
export const SNEZHNY_HOURS_URL = 'https://snegny.ru/режим-работы/'
const NEWS_URL = SNEZHNY_NEWS_URL
const HOURS_NOTICE_URL = SNEZHNY_HOURS_URL

const DAY_COLUMNS = [
  'Будни, льготный',
  'Будни, взрослый',
  'Выходные, льготный',
  'Выходные, взрослый',
]

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} table
 */
function parseLiftGroup($, table) {
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const rowsOut = []
  const rows = tableRows($, $(table))
  for (const row of rows) {
    if (row.length < 5) continue
    const name = cleanText(row[0])
    if (!name || /будни|суббота|дети|взрослые|количество|почасов/i.test(name)) continue
    if (!/\d/.test(name)) continue
    const prices = []
    let any = false
    for (let i = 0; i < 4; i++) {
      const price = parsePrice(row[i + 1])
      if (price != null) any = true
      prices.push({ price, rawText: row[i + 1] })
    }
    if (!any) continue
    rowsOut.push({
      name: 'Ски-пасс',
      duration: name,
      prices,
    })
  }
  if (!rowsOut.length) return null
  return {
    category: 'Ски-пассы (часы и проходы)',
    columns: [...DAY_COLUMNS],
    rows: rowsOut,
  }
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Element} table
 * @param {string} category
 */
function parseNamePriceGroup($, table, category) {
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const rowsOut = []
  for (const row of tableRows($, $(table))) {
    if (row.length < 2) continue
    const name = cleanText(row[0])
    const price = parsePrice(row[1])
    if (!name || price == null) continue
    rowsOut.push({
      name,
      duration: 'сезон',
      prices: [{ price, rawText: row[1] }],
    })
  }
  if (!rowsOut.length) return null
  return {
    category,
    columns: ['Цена'],
    rows: rowsOut,
  }
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeSnezhny() {
  const resortId = 'snezhny'
  try {
    const pricesHtml = await fetchUrl(PRICES_URL)
    await sleep()
    let newsHtml = ''
    try {
      newsHtml = await fetchUrl(NEWS_URL)
    } catch {
      newsHtml = ''
    }
    await sleep()
    let hoursNoticeHtml = ''
    try {
      hoursNoticeHtml = await fetchUrl(HOURS_NOTICE_URL)
    } catch {
      hoursNoticeHtml = ''
    }
    await sleep()
    let camHtml = ''
    try {
      camHtml = await fetchUrl(TWOCAM_URL)
    } catch {
      camHtml = ''
    }

    const $ = loadHtml(pricesHtml)
    const tables = $('table').toArray()
    /** @type {object[]} */
    const groups = []
    if (tables[0]) {
      const g = parseLiftGroup($, tables[0])
      if (g) groups.push(g)
    }
    if (tables[1]) {
      const g = parseNamePriceGroup($, tables[1], 'Абонементы')
      if (g) groups.push(g)
    }
    if (tables[2]) {
      const g = parseNamePriceGroup($, tables[2], 'Единый ски-пасс Снежный/Золотая Долина')
      if (g) groups.push(g)
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

    const importantFromNews = newsHtml ? detectSnezhnyImportant(newsHtml, NEWS_URL) : []
    const importantFromHours = hoursNoticeHtml
      ? detectSnezhnyImportant(hoursNoticeHtml, HOURS_NOTICE_URL)
      : []
    const important = importantFromNews.length ? importantFromNews : importantFromHours

    let hoursSummary = 'Режим склонов уточняйте на сайте курорта…'
    let hoursSource = HOME_URL
    let hoursStatus = 'partial'
    if (important.length) {
      hoursSummary =
        'Есть актуальное сообщение о режиме склонов — см. «Важное» и новости на сайте курорта'
      hoursSource = important[0].sourceUrl || NEWS_URL
      hoursStatus = 'partial'
    }
    const slopeProbe = [newsHtml, hoursNoticeHtml].filter(Boolean).join('\n')
    const slopeStatus = detectGenericSlopeStatus(slopeProbe)

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: decodeURI(PRICES_URL),
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: groups.length
          ? 'Сезонные/подъёмные тарифы со страницы ски-пассов; уточняйте на сайте'
          : 'Таблицы ски-пассов не удалось прочитать',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: hoursSource,
        summary: hoursSummary,
        periods: [],
        status: hoursStatus,
        slopesOpen: slopeStatus.slopesOpen,
      }),
      webcamUrl: HOME_URL,
      // exdesign iframes render empty black boxes on MountHunt — link-only.
      cameraEmbeds: uniqueEmbeds.filter(() => false),
      important,
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
