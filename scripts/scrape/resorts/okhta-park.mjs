import { fetchUrl, sleep } from '../lib/http.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'

const TRAILS_URL =
  'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/'
const WINTER_URL = 'https://winter.ohtapark.ru/'
const WEBCAM_URL = 'https://www.ohtapark.ru/webcam/'

/**
 * @param {string} html
 */
export function parseOkhtaSeasonalGroups(html) {
  const $ = loadHtml(html)
  const text = cleanText($('body').text())
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const rows = []

  // «ВЗРОСЛЫЙ Сезонный ски-пасс [2 часа] … 45 000 р. 56 250 р.»
  const re =
    /(ВЗРОСЛЫЙ|ДЕТСКИЙ)\s+сезонный\s+ски-пасс\s*\[([^\]]+)\]\s*Любой день\s*([\d\s]+)\s*р\.?\s*([\d\s]+)\s*р\.?/gi
  let m
  while ((m = re.exec(text))) {
    const kind = cleanText(m[1])
    const window = cleanText(m[2])
    const sale = parsePrice(m[3])
    const full = parsePrice(m[4])
    if (sale == null) continue
    rows.push({
      name: `Сезонный ски-пасс ${kind.toLowerCase()}`,
      duration: window,
      prices: [
        {
          price: sale,
          note: full != null ? `Цена без скидки ~${full} ₽` : undefined,
          rawText: m[0],
        },
      ],
    })
  }

  const seen = new Set()
  const deduped = rows.filter((it) => {
    const key = `${it.name}|${it.duration}|${it.prices[0]?.price}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!deduped.length) return []
  return [
    {
      category: 'Сезонные ски-пассы (предпродажа)',
      columns: ['Цена'],
      rows: deduped,
    },
  ]
}

/**
 * @param {string} html
 */
function parseTrailHours(html) {
  const $ = loadHtml(html)
  const text = cleanText($('body').text())
  const periods = []
  let summary = 'Часы трасс уточняйте на сайте'

  const compact = text.match(
    /Время работы\s*Пн[–\-]?Пт:\s*([\d:]+)[–\-]([\d:]+)\s*Сб[–\-]?Вс:\s*([\d:]+)[–\-]([\d:]+)/i,
  )
  const prose = text.match(
    /понедельник[–\-]?пятница\s+с\s+([\d:]+)\s+до\s+([\d:]+)[,\s]+суббота и воскресенье\s+с\s+([\d:]+)\s+до\s+([\d:]+)/i,
  )
  const hit = compact || prose
  if (hit) {
    periods.push({ days: 'пн–пт', open: hit[1], close: hit[2] })
    periods.push({ days: 'сб–вс', open: hit[3], close: hit[4] })
    summary = `пн–пт: ${hit[1]}–${hit[2]}; сб–вс: ${hit[3]}–${hit[4]}`
  } else if (/11:00\s*[-–—]\s*21:00/.test(text) || /с 11:00 до 21:00/.test(text)) {
    periods.push({ days: 'ежедневно', open: '11:00', close: '21:00' })
    summary = 'ежедневно: 11:00–21:00'
  }

  const dayClosed =
    /дневн[^\.]{0,40}закрыт|прейскурант[^\.]{0,40}закрыт|закрыто до сезона/i.test(text)

  return {
    summary,
    periods,
    status: periods.length ? 'ok' : 'partial',
    dayClosed,
    preSale: /предпродаж/i.test(text),
  }
}

/**
 * @param {string} html
 */
function extractHlsRefs(html) {
  const $ = loadHtml(html)
  const refs = []
  $('.web-camera_card[data-url]').each((_, el) => {
    const url = $(el).attr('data-url')
    const name = cleanText($(el).find('.web-camera_card_name').text()) || 'камера'
    if (url) refs.push({ name, hlsUrl: url })
  })
  if (!refs.length) {
    $('[data-url]').each((_, el) => {
      const url = $(el).attr('data-url')
      if (url && /\.m3u8/i.test(url)) refs.push({ name: 'камера', hlsUrl: url })
    })
  }
  return refs
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeOkhtaPark() {
  const resortId = 'okhta-park'
  try {
    const winterHtml = await fetchUrl(WINTER_URL)
    await sleep()
    const trailsHtml = await fetchUrl(TRAILS_URL)
    await sleep()
    let camHtml = ''
    try {
      camHtml = await fetchUrl(WEBCAM_URL)
    } catch {
      camHtml = ''
    }

    const groups = parseOkhtaSeasonalGroups(winterHtml)
    const trailHours = parseTrailHours(trailsHtml)
    const hls = camHtml ? extractHlsRefs(camHtml) : []

    const notes = []
    if (trailHours.preSale) notes.push('Открыта предпродажа сезонных ски-пассов')
    if (trailHours.dayClosed || groups.length) {
      notes.push('Дневной прейскурант подъёмников часто закрыт до сезона — смотрите страницу трасс')
    }

    const important = []
    if (trailHours.preSale) {
      important.push({
        id: 'okhta-presale',
        resortId,
        title: 'Охта-Парк: предпродажа ски-пассов',
        body: 'На сайте курорта открыта предпродажа сезонных ски-пассов. Дневные тарифы уточняйте ближе к сезону.',
        severity: 'info',
        updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        sourceUrl: WINTER_URL,
      })
    }

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: WINTER_URL,
        groups,
        status: groups.length ? 'ok' : 'partial',
        note: notes.join('. ') || undefined,
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: TRAILS_URL,
        summary: trailHours.summary,
        periods: trailHours.periods,
        status: trailHours.status,
      }),
      webcamUrl: WEBCAM_URL,
      cameraEmbeds: hls.slice(0, 12).map((c) => c.hlsUrl),
      important,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: WINTER_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: TRAILS_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
      webcamUrl: WEBCAM_URL,
    }
  }
}
