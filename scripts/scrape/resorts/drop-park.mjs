import { fetchUrl } from '../lib/http.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'

const PAGE_URL = 'https://drop-park.ru/snow-park'

/**
 * Pair Tilda tn-elem labels with nearby ₽ amounts by top/left.
 * @param {string} html
 */
function extractPricedItems(html) {
  const items = []
  const elems = []
  const re =
    /<div class='t396__elem tn-elem[^']*'([^>]*)>([\s\S]*?)<\/div>/g
  let m
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const topM = attrs.match(/data-field-top-value=["']?(\d+)/)
    const leftM = attrs.match(/data-field-left-value=["']?(\d+)/)
    if (!topM) continue
    let text = cleanText(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    if (!text || text.length > 160) continue
    if (/t_onFuncLoad|t396_initialScale|function\s*\(/i.test(text)) continue
    elems.push({
      top: Number(topM[1]),
      left: Number(leftM?.[1] || 0),
      text,
    })
  }

  const money = elems.filter((e) => /₽|руб/i.test(e.text) && parsePrice(e.text) != null)
  const labels = elems.filter((e) => !/₽|руб/i.test(e.text))

  for (const priceEl of money) {
    const price = parsePrice(priceEl.text)
    if (price == null) continue
    // nearest label to the left, similar vertical band
    let best = null
    let bestScore = Infinity
    for (const lab of labels) {
      if (lab.left >= priceEl.left - 10) continue
      const dTop = Math.abs(lab.top - priceEl.top)
      if (dTop > 35) continue
      const score = dTop * 3 + (priceEl.left - lab.left) * 0.01
      if (score < bestScore) {
        bestScore = score
        best = lab
      }
    }
    if (!best) continue
    const title = best.text
    // Prefer ski-relevant rows; still keep season/storage snippets
    if (
      !/(полный|час|аренд|школ|групп|индивид|абонемент|ски.?пасс|хранени|комплект|продлен)/i.test(
        title,
      )
    ) {
      continue
    }
    let unit = 'тариф'
    if (/час/i.test(title)) unit = 'час'
    else if (/сезон|абонемент/i.test(title)) unit = 'сезон'
    else if (/полный/i.test(title)) unit = 'день'
    items.push({
      title,
      price,
      unit,
      rawText: priceEl.text,
      _top: priceEl.top,
      _left: priceEl.left,
    })
  }

  // Seasonal pass from prose ("Стоимость - 40.000₽")
  const season = html.match(/Стоимость\s*[-–—]\s*([\d.\s]+)\s*₽/i)
  if (season) {
    const price = parsePrice(season[1].replace(/\./g, ' '))
    if (price != null && !items.some((i) => /сезонн/i.test(i.title) && i.price === price)) {
      items.unshift({
        title: 'Сезонный абонемент сноупарк 2026/27',
        price,
        unit: 'сезон',
        rawText: season[0],
      })
    }
  }

  // Dedup by title+price
  const seen = new Set()
  const out = []
  for (const it of items) {
    const key = `${it.title}|${it.price}`
    if (seen.has(key)) continue
    seen.add(key)
    const { _top, _left, ...rest } = it
    out.push(rest)
  }
  return out
}

/**
 * @param {string} html
 */
function extractHours(html) {
  const periods = []
  const snippets = [...html.matchAll(/Полный с\s*(\d{1,2}:\d{2})\s*до\s*(\d{1,2}:\d{2})/gi)]
  const unique = []
  for (const m of snippets) {
    const open = m[1]
    const close = m[2]
    const key = `${open}-${close}`
    if (unique.includes(key)) continue
    unique.push(key)
    periods.push({ days: 'полный день (по прайсу)', open, close })
  }
  let summary = 'Часы склона уточняйте на сайте'
  if (periods.length) {
    summary = periods.map((p) => `${p.open}–${p.close}`).join('; ')
    summary = `По прайсу сноупарка: ${summary}`
  }
  return { summary, periods, status: periods.length ? 'ok' : 'partial' }
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeDropPark() {
  const resortId = 'drop-park'
  try {
    const html = await fetchUrl(PAGE_URL)
    const items = extractPricedItems(html).slice(0, 30)
    const hours = extractHours(html)
    const $ = loadHtml(html)
    const embeds = [
      ...extractIframeSrcs($, PAGE_URL),
      ...($('[data-iframevideo]')
        .map((_, el) => $(el).attr('data-iframevideo'))
        .get()
        .filter(Boolean)
        .map((u) => {
          try {
            return new URL(u, PAGE_URL).href
          } catch {
            return null
          }
        })
        .filter(Boolean)),
    ].filter((u) => /rtsp\.(ru|me)/i.test(u))
    const uniqueEmbeds = [...new Set(embeds)]

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items,
        status: items.length ? 'ok' : 'partial',
        note: items.length
          ? 'Прайс сноупарка (сезон / школа / прокат); дневной ски-пасс уточняйте на месте'
          : 'Цены на странице сноупарка не распознаны — смотрите сайт курорта',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary: hours.summary,
        periods: hours.periods,
        status: hours.status,
      }),
      webcamUrl: PAGE_URL,
      // rtsp.ru cams deleted / stream failed — avoid empty player boxes.
      cameraEmbeds: uniqueEmbeds.filter(() => false),
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
