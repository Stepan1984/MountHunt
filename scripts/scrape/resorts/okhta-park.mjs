import { fetchUrl, sleep } from '../lib/http.mjs'
import { detectOkhtaImportant } from '../lib/important.mjs'
import { formatCardHoursFromPeriods } from '../lib/card-hours-format.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
} from '../lib/parse.mjs'
import { detectOkhtaSlopeStatus } from '../lib/slope-status.mjs'

export const OKHTA_TRAILS_URL =
  'https://www.ohtapark.ru/services/servisy-kurorta/gornolyzhnye-trassy/'
export const OKHTA_WINTER_URL = 'https://winter.ohtapark.ru/'
export const OKHTA_LENTA_URL = 'https://www.ohtapark.ru/lenta/'
export const OKHTA_HOME_URL = 'https://www.ohtapark.ru/'
const TRAILS_URL = OKHTA_TRAILS_URL
const WINTER_URL = OKHTA_WINTER_URL
const WEBCAM_URL = 'https://www.ohtapark.ru/webcam/'

/**
 * Seasonal skipasses from the Tilda winter landing (often still online during season).
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
      category: 'Сезонные ски-пассы',
      columns: ['Цена'],
      rows: deduped,
    },
  ]
}

/**
 * @param {string} name
 * @returns {{ kind: 'lift' | 'extraHour' | 'combo' | 'comboExtra' | 'comboFine' | 'locker' | 'card' | 'other', duration?: string }}
 */
function classifyOkhtaDayRow(name) {
  const n = cleanText(name)
  if (/смарт-карт|смарт\s*карт/i.test(n)) return { kind: 'card' }
  if (/камер[ыа]\s+хранен/i.test(n)) {
    const hm = n.match(/(\d+)\s*час/i)
    const duration = /4\s*час|и более/i.test(n)
      ? '4 часа и более'
      : hm
        ? `${hm[1]} ${hm[1] === '1' ? 'час' : 'часа'}`
        : undefined
    return { kind: 'locker', duration }
  }
  if (/ски\s*пасс.+бассейн/i.test(n)) {
    if (/штраф|утер/i.test(n)) return { kind: 'comboFine', duration: '2 часа + бассейн' }
    if (/доплат/i.test(n)) return { kind: 'comboExtra', duration: 'каждый следующий час' }
    return { kind: 'combo', duration: '2 часа + 2 часа бассейн' }
  }
  if (/доплат.+подъ[её]мник/i.test(n)) {
    return { kind: 'extraHour', duration: 'каждый следующий час' }
  }
  if (/подъ[её]мник/i.test(n)) {
    const hm = n.match(/(\d+)\s*час/i)
    return { kind: 'lift', duration: hm ? `${hm[1]} ${hm[1] === '1' ? 'час' : 'часа'}` : undefined }
  }
  return { kind: 'other' }
}

/**
 * @param {string} priceText
 * @returns {{ adult: number | null, child: number | null, single: number | null, raw: string }}
 */
function parseAdultChildPrice(priceText) {
  const raw = cleanText(priceText)
  const pair = raw.match(/(\d[\d\s]*)\s*₽\s*\/\s*(\d[\d\s]*)\s*₽/)
  if (pair) {
    return {
      adult: parsePrice(pair[1]),
      child: parsePrice(pair[2]),
      single: null,
      raw,
    }
  }
  const single = raw.match(/(\d[\d\s]*)\s*₽/)
  return {
    adult: null,
    child: null,
    single: single ? parsePrice(single[1]) : null,
    raw,
  }
}

/**
 * Day tariffs from `#service_price` tabs on the trails page (open-season board).
 * @param {string} html
 */
export function parseOkhtaDayTariffGroups(html) {
  const $ = loadHtml(html)
  const root = $('#service_price')
  if (!root.length) return []

  const tabLabels = root
    .find('.service_price_tag')
    .map((_, el) => cleanText($(el).text()))
    .get()
  const blocks = root.find('.service_price_block').toArray()

  /** @type {Map<string, { weekday?: ReturnType<typeof parseAdultChildPrice>, weekend?: ReturnType<typeof parseAdultChildPrice>, name: string }>} */
  const byName = new Map()
  let guestFree = false

  for (let i = 0; i < blocks.length; i++) {
    const label = tabLabels[i] || ''
    const isWeekday = /пн/i.test(label) && /чт/i.test(label)
    const isWeekend = /пт/i.test(label) || /выходн|празднич/i.test(label)
    const isGuest = /проживающ/i.test(label)
    const block = blocks[i]

    $(block)
      .find('.service_price_list_row')
      .each((_, row) => {
        if ($(row).hasClass('service_price_list_row--headline')) return
        const name = cleanText($(row).find('.service_price_list_row_caption--name').first().text())
        if (!name) return
        const priceText = cleanText(
          $(row).find('.service_price_list_row_wrap .service_price_list_row_caption').last().text(),
        )
        if (isGuest) {
          if (/ски-?пасс|безлимит/i.test(name) && /бесплатн/i.test(priceText)) guestFree = true
          return
        }
        if (!isWeekday && !isWeekend) return
        const parsed = parseAdultChildPrice(priceText)
        const prev = byName.get(name) || { name }
        if (isWeekday) prev.weekday = parsed
        if (isWeekend) prev.weekend = parsed
        byName.set(name, prev)
      })
  }

  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const liftRows = []
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const comboRows = []
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const lockerRows = []
  /** @type {{ name: string, duration?: string, prices: object[] }[]} */
  const cardRows = []

  const colWeekday = 'Пн–чт'
  const colWeekend = 'Пт–вс и праздники'

  for (const entry of byName.values()) {
    const info = classifyOkhtaDayRow(entry.name)
    const wd = entry.weekday
    const we = entry.weekend

    const pushAdultChild = (bucket, nameAdult, nameChild, duration) => {
      if (wd?.adult != null || we?.adult != null) {
        bucket.push({
          name: nameAdult,
          duration,
          prices: [
            { price: wd?.adult ?? null, rawText: wd?.raw },
            { price: we?.adult ?? null, rawText: we?.raw },
          ],
        })
      }
      if (wd?.child != null || we?.child != null) {
        bucket.push({
          name: nameChild,
          duration,
          prices: [
            { price: wd?.child ?? null, rawText: wd?.raw },
            { price: we?.child ?? null, rawText: we?.raw },
          ],
        })
      }
    }

    if (info.kind === 'lift') {
      pushAdultChild(liftRows, 'Взрослый', 'Детский', info.duration)
    } else if (info.kind === 'extraHour') {
      pushAdultChild(liftRows, 'Доплата · взрослый', 'Доплата · детский', info.duration)
    } else if (info.kind === 'combo') {
      pushAdultChild(comboRows, 'Входной билет · взрослый', 'Входной билет · детский', info.duration)
    } else if (info.kind === 'comboExtra') {
      pushAdultChild(comboRows, 'Доплата · взрослый', 'Доплата · детский', info.duration)
    } else if (info.kind === 'comboFine') {
      pushAdultChild(comboRows, 'Штраф за утерю · взрослый', 'Штраф за утерю · детский', info.duration)
    } else if (info.kind === 'locker') {
      const priceWd = wd?.single ?? wd?.adult ?? null
      const priceWe = we?.single ?? we?.adult ?? null
      if (priceWd != null || priceWe != null) {
        lockerRows.push({
          name: 'Камера хранения',
          duration: info.duration,
          prices: [
            { price: priceWd, rawText: wd?.raw },
            { price: priceWe, rawText: we?.raw },
          ],
        })
      }
    } else if (info.kind === 'card') {
      const price = wd?.single ?? we?.single ?? wd?.adult ?? we?.adult ?? null
      if (price != null) {
        cardRows.push({
          name: 'Многоразовая смарт-карта',
          prices: [{ price, rawText: wd?.raw || we?.raw }],
        })
      }
    }
  }

  /** @type {{ category: string, columns: string[], rows: object[], note?: string }[]} */
  const groups = []
  if (liftRows.length) {
    groups.push({
      category: 'Ски-пасс (подъёмники)',
      columns: [colWeekday, colWeekend],
      rows: liftRows,
    })
  }
  if (comboRows.length) {
    groups.push({
      category: 'Ски-пасс + бассейн',
      columns: [colWeekday, colWeekend],
      rows: comboRows,
    })
  }
  if (lockerRows.length) {
    groups.push({
      category: 'Камера хранения',
      columns: [colWeekday, colWeekend],
      rows: lockerRows,
    })
  }
  if (cardRows.length) {
    groups.push({
      category: 'Карта доступа',
      columns: ['Цена'],
      rows: cardRows,
    })
  }
  // Guest free ski-pass is documented on the page but has no numeric tariff —
  // surface it via scrape note instead of a 0 ₽ row (would break card hints).
  if (guestFree && groups.length) {
    groups[0] = {
      ...groups[0],
      note: 'Проживающим на курорте — безлимитный ски-пасс бесплатно',
    }
  }
  return groups
}

/**
 * @param {string} html
 */
function parseTrailHours(html) {
  const $ = loadHtml(html)
  const text = cleanText($('body').text())
  const periods = []
  let summary = 'Нет данных о часах трасс'

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
    summary =
      formatCardHoursFromPeriods(periods) ||
      `пн–пт: ${hit[1]}–${hit[2]};\nсб–вс: ${hit[3]}–${hit[4]}`
  } else if (/11:00\s*[-–—]\s*21:00/.test(text) || /с 11:00 до 21:00/.test(text)) {
    periods.push({ days: 'ежедневно', open: '11:00', close: '21:00' })
    summary = formatCardHoursFromPeriods(periods) || 'ежедневно: 11:00–21:00'
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
    const trailsHtml = await fetchUrl(TRAILS_URL)
    await sleep()
    let winterHtml = ''
    try {
      winterHtml = await fetchUrl(WINTER_URL)
    } catch {
      winterHtml = ''
    }
    await sleep()
    let lentaHtml = ''
    try {
      lentaHtml = await fetchUrl(OKHTA_LENTA_URL)
    } catch {
      lentaHtml = ''
    }
    await sleep()
    let camHtml = ''
    try {
      camHtml = await fetchUrl(WEBCAM_URL)
    } catch {
      camHtml = ''
    }

    const dayGroups = parseOkhtaDayTariffGroups(trailsHtml)
    const seasonalGroups = winterHtml ? parseOkhtaSeasonalGroups(winterHtml) : []
    const groups = [...dayGroups, ...seasonalGroups]
    const trailHours = parseTrailHours(trailsHtml)
    const hls = camHtml ? extractHlsRefs(camHtml) : []
    const guestNote = dayGroups.find((g) => g.note)?.note

    const notes = []
    if (!dayGroups.length && trailHours.dayClosed) {
      notes.push('Дневной прейскурант подъёмников часто закрыт до сезона — смотрите страницу трасс')
    }
    if (trailHours.preSale && !dayGroups.length) notes.push('Открыта предпродажа сезонных ски-пассов')
    if (guestNote) notes.push(guestNote)

    const important = detectOkhtaImportant(
      { trailsHtml, lentaHtml },
      TRAILS_URL,
      {
        trailsUrl: TRAILS_URL,
        lentaUrl: OKHTA_LENTA_URL,
        winterUrl: WINTER_URL,
      },
    )
    const slopeStatus = detectOkhtaSlopeStatus(
      { trailsHtml, lentaHtml },
      { dayClosed: trailHours.dayClosed },
    )

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: dayGroups.length ? TRAILS_URL : WINTER_URL,
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
        slopesOpen: slopeStatus.slopesOpen,
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
        sourceUrl: TRAILS_URL,
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
