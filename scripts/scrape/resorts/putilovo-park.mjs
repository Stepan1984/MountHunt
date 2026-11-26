/**
 * Спортпарк Путилово — snowpark with rope tow (ЛО, Кировский р-н).
 *
 * Prices are not scraped: the UI links to booking at sportpark.pro/snowrider.
 * Hours / important / slope status use TG (t.me/s/SPORTPARKPUTILOVO) and
 * optionally the Flexbe landing (live or Wayback) for schedule/slope copy.
 * Fail-soft — empty/failed keeps last known hours/important snapshot.
 * No public VK community found (Nov 2026).
 */
import { fetchUrl, fetchUrlResult, sleep } from '../lib/http.mjs'
import {
  detectPutilovoTelegramImportant,
  putilovoOffSeasonMatch,
  putilovoSeasonOpenMatch,
} from '../lib/important.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  priceSnapshot,
} from '../lib/parse.mjs'
import { appendHoursExtraNote } from '../lib/slope-status.mjs'
import { parseTelegramChannelHtml } from '../lib/telegram.mjs'

export const PUTILOVO_HOME_URL = 'https://sportpark.pro/'
export const PUTILOVO_SITE_URL = 'https://sportpark.pro/snowrider'
export const PUTILOVO_TG_URL = 'https://t.me/s/SPORTPARKPUTILOVO'
/** Last known public snapshot of the booking page (live Flexbe often 403). */
export const PUTILOVO_SITE_WAYBACK_URL =
  'https://web.archive.org/web/20260420020716/https://sportpark.pro/snowrider'

const RESORT_ID = 'putilovo-park'

/**
 * Session window from site copy (rare) or TG posts («с 12:00-19:00»).
 * @param {string} text
 * @returns {{ summary: string, periods: object[], status: string } | null}
 */
export function parsePutilovoHoursFromText(text) {
  const t = cleanText(text)
  if (!t) return null

  // «с 12:00-19:00» / «с 12:00 до 19:00» / «12:00–19:00»
  const range =
    t.match(
      /(?:с\s*)?(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})|(?:с\s*)(\d{1,2}:\d{2})\s+до\s+(\d{1,2}:\d{2})/i,
    ) || null
  if (!range) return null
  const open = range[1] || range[3]
  const close = range[2] || range[4]
  if (!open || !close) return null

  // Session snowpark: posts name one calendar day («субботу 14 марта») → «по сеансам».
  let days = 'по сеансам'
  if (/ежедневн/i.test(t)) days = 'ежедневно'
  else if (/\d{1,2}\.\d{1,2}\.\d{2,4}|завтра|послезавтра|\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(t)) {
    days = 'по сеансам'
  } else if (/выходн/i.test(t) && /будн/i.test(t)) days = 'по объявлению'
  else if (/суббот|сб\b/i.test(t) && /сред/i.test(t)) days = 'ср, сб'
  else if (/суббот|сб\b/i.test(t) && !/сред|чт|пятниц|вс\b|воскрес/i.test(t)) days = 'сб'

  return {
    summary: `${days}: ${open}–${close}`,
    periods: [{ days, open, close }],
    status: 'ok',
  }
}

/**
 * Prefer the newest TG post that carries a clock range.
 * @param {string} tgHtml
 */
export function parsePutilovoHoursFromTelegram(tgHtml) {
  const posts = parseTelegramChannelHtml(tgHtml)
  const ordered = [...posts].reverse()
  for (const post of ordered) {
    const parsed = parsePutilovoHoursFromText(post.text)
    if (parsed) {
      return {
        ...parsed,
        sourceUrl: post.url || PUTILOVO_TG_URL,
        publishedAt: post.publishedAt,
      }
    }
  }
  return null
}

/**
 * @param {string} siteHtml
 * @param {string} tgHtml
 */
export function detectPutilovoSlopeStatus(siteHtml, tgHtml) {
  const siteText = cleanText(loadHtml(siteHtml || '<body></body>')('body').text())
  const posts = parseTelegramChannelHtml(tgHtml)
  const tgText = posts.map((p) => p.text).join('\n')
  const combined = [siteText, tgText].filter(Boolean).join('\n')

  if (putilovoSeasonOpenMatch(combined) && !putilovoOffSeasonMatch(combined)) {
    return { slopesOpen: true, note: null }
  }
  if (putilovoOffSeasonMatch(combined)) {
    return {
      slopesOpen: false,
      note: 'Снежный сезон закрыт',
    }
  }
  // Booking landing with open-day copy but no off-season → still not alpine-open certainty.
  if (/открыт(?:ые|ые\s+дни)|входной\s+билет/i.test(siteText) && /сноупарк/i.test(siteText)) {
    return { slopesOpen: false, note: null }
  }
  return { slopesOpen: false, note: null }
}

/**
 * Fetch TG important cards. Fail-soft when preview unreachable.
 */
export async function fetchPutilovoTelegramImportant() {
  try {
    const { body } = await fetchUrlResult(PUTILOVO_TG_URL)
    const items = detectPutilovoTelegramImportant(body, PUTILOVO_TG_URL)
    return { items, tgFetched: true, tgHtml: body }
  } catch {
    return { items: [], tgFetched: false, tgHtml: '' }
  }
}

/**
 * Try live landing, then Wayback archive of the same URL (hours/slope copy only).
 * @returns {Promise<{ html: string, sourceUrl: string, fetched: boolean }>}
 */
async function fetchPutilovoSiteHtml() {
  try {
    const html = await fetchUrl(PUTILOVO_SITE_URL)
    return { html, sourceUrl: PUTILOVO_SITE_URL, fetched: true }
  } catch {
    // Live Flexbe often returns 403 when the project is locked.
  }
  try {
    await sleep()
    const html = await fetchUrl(PUTILOVO_SITE_WAYBACK_URL)
    return { html, sourceUrl: PUTILOVO_SITE_WAYBACK_URL, fetched: true }
  } catch {
    return { html: '', sourceUrl: PUTILOVO_SITE_URL, fetched: false }
  }
}

/**
 * Empty price placeholder — MountHunt does not scrape Putilovo tariffs.
 * Scrape runner also forces this for any resort with booking_url.
 */
function putilovoBookingPrices() {
  return priceSnapshot({
    resortId: RESORT_ID,
    sourceUrl: PUTILOVO_SITE_URL,
    items: [],
    status: 'unavailable',
    note: 'Цены на странице не публикуем — бронирование и оплата по ссылке на сайте курорта',
  })
}

/**
 * @returns {Promise<object>}
 */
export async function scrapePutilovoPark() {
  const resortId = RESORT_ID
  try {
    const site = await fetchPutilovoSiteHtml()
    let tgHtml = ''
    let tgFetched = false
    try {
      await sleep()
      tgHtml = await fetchUrl(PUTILOVO_TG_URL)
      tgFetched = true
    } catch {
      tgHtml = ''
      tgFetched = false
    }

    const tgHours = tgFetched ? parsePutilovoHoursFromTelegram(tgHtml) : null
    const siteHours = site.html ? parsePutilovoHoursFromText(loadHtml(site.html)('body').text()) : null
    const hoursPack = tgHours || (siteHours ? { ...siteHours, sourceUrl: site.sourceUrl } : null)

    const important = tgFetched
      ? detectPutilovoTelegramImportant(tgHtml, PUTILOVO_TG_URL)
      : []
    const slopeStatus = detectPutilovoSlopeStatus(site.html, tgHtml)

    const hoursSummary = appendHoursExtraNote(
      hoursPack?.summary ||
        (tgFetched
          ? 'Часы сеансов публикуют в Telegram перед открытыми днями'
          : 'Часы сеансов публикуют в Telegram'),
      slopeStatus.note,
    )

    return {
      resortId,
      prices: putilovoBookingPrices(),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: hoursPack?.sourceUrl || (tgFetched ? PUTILOVO_TG_URL : site.sourceUrl),
        summary: hoursSummary,
        periods: hoursPack?.periods || [],
        status: hoursPack ? 'ok' : tgFetched || site.fetched ? 'partial' : 'failed',
        slopesOpen: slopeStatus.slopesOpen,
      }),
      important,
      // Keep previous putilovo-tg-* when TG preview is down.
      importantInconclusive: !tgFetched,
      clearImportantPrefixes: tgFetched,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: putilovoBookingPrices(),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PUTILOVO_TG_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
