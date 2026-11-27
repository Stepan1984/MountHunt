/**
 * Sync operating hours from resort news («Важное» / TG / VK) into hours.json.
 *
 * Prefer labeled slope/resort clocks; skip vacancies, elections, café-only ranges.
 * Detail-page caption: short `hoursNote` («из новости»); not shown on home cards.
 */
import { isFreshPublishedAt } from './important.mjs'
import { normalizeCardTime } from './card-hours-format.mjs'
import { cleanText, hoursSnapshot, nowIso } from './parse.mjs'

/** Short muted line under detail «Часы работы» (home cards omit this). */
export const NEWS_HOURS_CARD_NOTE = 'из новости'

/** Do not apply week-old schedule posts to live hours. */
export const NEWS_HOURS_MAX_AGE_DAYS = 14

const CLOCK =
  /(\d{1,2})[.:](\d{2})\s*(?:[-–—]|до)\s*(\d{1,2})[.:](\d{2})/i

const VACANCY_NOISE =
  /ваканси|горничн|дворник|формат\s+работы\s*:|подработка|ищем\s+(?:в\s+)?команд|приглашаем\s+в\s+команд/i

const ELECTION_NOISE = /избирательн|участки\s+открыты|голосуй/i

const CAMP_NOISE = /лагер|lazoorka|спортивно-развлекательн\w*\s+лагер/i

/**
 * @param {string} h1
 * @param {string} m1
 * @param {string} h2
 * @param {string} m2
 */
function normClock(h1, m1, h2, m2) {
  const open = normalizeCardTime(`${h1}:${m1}`)
  const close = normalizeCardTime(`${h2}:${m2}`)
  if (!open || !close) return null
  return { open, close }
}

/**
 * True when a clock match sits next to café / spa / bar copy (not alpine hours).
 * @param {string} text
 * @param {number} index
 */
function isAmenityAdjacent(text, index) {
  const before = text.slice(Math.max(0, index - 48), index)
  return /кафе|ресторан|бар\b|спа\b|бассейн|бан[яи]\b/i.test(before)
}

/**
 * Prefer clocks tied to schedule / slope cues; skip amenity-only ranges.
 * @param {string} text
 * @returns {{ open: string, close: string } | null}
 */
export function extractOperatingClockFromNewsText(text) {
  const t = cleanText(text)
  if (!t) return null

  const labeled =
    t.match(
      /график\s+работы\s*:?\s*(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/i,
    ) ||
    t.match(
      /(?:на\s+склоне|ждём\s+вас.{0,48}склоне|работаем)\s+с\s+(\d{1,2})[.:](\d{2})\s+до\s+(\d{1,2})[.:](\d{2})/i,
    ) ||
    t.match(
      /с\s+(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})/,
    )

  if (labeled) {
    const clock = normClock(labeled[1], labeled[2], labeled[3], labeled[4])
    if (clock) return clock
  }

  const re = new RegExp(CLOCK.source, 'gi')
  let m
  while ((m = re.exec(t))) {
    if (isAmenityAdjacent(t, m.index)) continue
    const clock = normClock(m[1], m[2], m[3], m[4])
    if (clock) return clock
  }
  return null
}

/**
 * Day label for a one-shot news schedule (date / завтра / ежедневно).
 * @param {string} text
 * @param {string | null | undefined} publishedAt
 */
export function extractNewsHoursDaysLabel(text, publishedAt) {
  const t = cleanText(text)

  const stripYear = (d) => String(d).replace(/\.\d{4}$/, '')

  const datedTomorrow = t.match(
    /завтра\s*,?\s*(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/i,
  )
  if (datedTomorrow) return stripYear(datedTomorrow[1])

  const bareDate = t.match(
    /(?:^|[^\d])(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)(?:\s|,|$)/,
  )
  // Prefer an explicit calendar day near the top (opening posts).
  if (/завтра|сегодня|открыва/i.test(t) && bareDate) {
    return stripYear(bareDate[1])
  }

  if (/завтра/i.test(t) && publishedAt) {
    const base = Date.parse(publishedAt)
    if (Number.isFinite(base)) {
      const d = new Date(base + 86_400_000)
      // Europe/Moscow ≈ UTC+3 for label (display date of the session day).
      const msk = new Date(d.getTime() + 3 * 3600_000)
      const dd = String(msk.getUTCDate()).padStart(2, '0')
      const mm = String(msk.getUTCMonth() + 1).padStart(2, '0')
      return `${dd}.${mm}`
    }
    return 'завтра'
  }

  if (/ежедневн/i.test(t)) return 'ежедневно'
  if (/по\s+сеансам|сеанс/i.test(t)) return 'по сеансам'

  const weekdays = t.match(
    /(?:пн|вт|ср|чт|пт|сб|вс|будни|выходн\w*)(?:\s*[–\-−—,]\s*(?:пн|вт|ср|чт|пт|сб|вс|будни|выходн\w*))?/i,
  )
  if (weekdays && /график|режим|работаем/i.test(t)) {
    const w = weekdays[0].toLowerCase()
    if (/будн/i.test(w)) return 'пн–пт'
    if (/выходн/i.test(w)) return 'сб–вс'
    return w.replace(/\s*[–\-−—]\s*/g, '–')
  }

  if (bareDate) return stripYear(bareDate[1])
  return 'по новости'
}

/**
 * Parse «DD.MM» / «DD.MM.YYYY» with optional year from publishedAt → UTC midnight.
 * @param {string} label
 * @param {string | null | undefined} publishedAt
 * @returns {number | null} epoch ms at UTC midnight of that calendar day
 */
function newsDayLabelToUtcMs(label, publishedAt) {
  const m = String(label || '').trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  let yyyy = m[3] != null ? Number(m[3]) : NaN
  if (!Number.isFinite(yyyy)) {
    const pub = publishedAt ? Date.parse(publishedAt) : Date.now()
    if (!Number.isFinite(pub)) return null
    yyyy = new Date(pub).getUTCFullYear()
  } else if (yyyy < 100) {
    yyyy += 2000
  }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return Date.UTC(yyyy, mm - 1, dd)
}

/**
 * Skip schedules whose named day is already in the past (MSK calendar).
 * @param {string} daysLabel
 * @param {string | null | undefined} publishedAt
 * @param {number} [nowMs]
 */
export function newsHoursDayIsPast(daysLabel, publishedAt, nowMs = Date.now()) {
  const dayMs = newsDayLabelToUtcMs(daysLabel, publishedAt)
  if (dayMs == null) return false
  const mskNow = new Date(nowMs + 3 * 3600_000)
  const todayMs = Date.UTC(mskNow.getUTCFullYear(), mskNow.getUTCMonth(), mskNow.getUTCDate())
  return dayMs < todayMs
}

/**
 * @param {string} text
 */
export function newsTextHasOperatingHours(text) {
  const t = cleanText(text)
  if (!t || t.length < 12) return false
  if (VACANCY_NOISE.test(t) || ELECTION_NOISE.test(t) || CAMP_NOISE.test(t)) return false
  if (!CLOCK.test(t)) return false

  const scheduleCue =
    /график\s+работ|режим\s+работ|час[ыа]?\s+работ|работаем\s+с\s+\d|на\s+склоне\s+с\s+\d|с\s+\d{1,2}[.:]\d{2}\s*(?:[-–—]|до)\s*\d{1,2}[.:]\d{2}/i.test(
      t,
    )
  const slopeCue = /склон|трасс|подъ[её]мник|сеанс|сноупарк|курорт/i.test(t)
  if (!(scheduleCue || slopeCue)) return false

  // Café-only weekly bulletin without alpine clocks.
  if (/кафе/i.test(t) && !slopeCue && !/график\s+работы\s*:?\s*\d/i.test(t)) return false

  return extractOperatingClockFromNewsText(t) != null
}

/**
 * @param {{ title?: string, body?: string, publishedAt?: string | null, sourceUrl?: string, resortId?: string, id?: string }} item
 * @param {{ nowMs?: number, maxAgeDays?: number }} [opts]
 * @returns {{ summary: string, periods: { days: string, open: string, close: string }[], sourceUrl: string | null, publishedAt: string | null, hoursNote: string } | null}
 */
export function parseHoursFromImportantItem(item, opts = {}) {
  const title = item?.title || ''
  const body = item?.body || ''
  const text = `${title}\n${body}`
  if (!newsTextHasOperatingHours(text)) return null

  const publishedAt = item.publishedAt || null
  const maxAge = opts.maxAgeDays ?? NEWS_HOURS_MAX_AGE_DAYS
  if (publishedAt && !isFreshPublishedAt(publishedAt, maxAge)) return null
  // Managed chrome / undated items: require a parseable clock but allow without date.

  const clock = extractOperatingClockFromNewsText(text)
  if (!clock) return null

  const days = extractNewsHoursDaysLabel(text, publishedAt)
  if (newsHoursDayIsPast(days, publishedAt, opts.nowMs)) return null

  const summary = `${days}: ${clock.open}–${clock.close}`
  return {
    summary,
    periods: [{ days, open: clock.open, close: clock.close }],
    sourceUrl: item.sourceUrl || null,
    publishedAt,
    hoursNote: NEWS_HOURS_CARD_NOTE,
  }
}

/**
 * Newest applicable news-hours pack per resortId.
 * @param {object[]} important
 * @param {{ nowMs?: number, maxAgeDays?: number }} [opts]
 * @returns {Map<string, ReturnType<typeof parseHoursFromImportantItem> & { resortId: string }>}
 */
export function collectNewsHoursByResort(important, opts = {}) {
  /** @type {Map<string, any>} */
  const byResort = new Map()
  const items = Array.isArray(important) ? important : []

  for (const item of items) {
    const resortId = item?.resortId
    if (!resortId || item.id === 'mvp-data-note') continue
    const parsed = parseHoursFromImportantItem(item, opts)
    if (!parsed) continue

    const prev = byResort.get(resortId)
    if (!prev) {
      byResort.set(resortId, { ...parsed, resortId })
      continue
    }
    const prevT = Date.parse(prev.publishedAt || '') || 0
    const nextT = Date.parse(parsed.publishedAt || '') || 0
    if (nextT >= prevT) byResort.set(resortId, { ...parsed, resortId })
  }
  return byResort
}

/**
 * Merge news-derived clocks into an hours snapshot (keep slopesOpen).
 * @param {object | undefined} prev
 * @param {object} newsPack
 * @param {string} resortId
 */
export function applyNewsHoursToSnapshot(prev, newsPack, resortId) {
  const slopesOpen =
    prev && (prev.slopesOpen === true || prev.slopesOpen === false)
      ? prev.slopesOpen
      : undefined
  return hoursSnapshot({
    resortId,
    scrapedAt: nowIso(),
    sourceUrl: newsPack.sourceUrl || prev?.sourceUrl || null,
    summary: newsPack.summary,
    periods: newsPack.periods,
    status: 'ok',
    slopesOpen,
    hoursNote: newsPack.hoursNote || NEWS_HOURS_CARD_NOTE,
  })
}

/**
 * Enrich hours[] from important news items. Fail-soft: untouched resorts stay as-is.
 * @param {object[]} hoursList
 * @param {object[]} important
 * @param {{ nowMs?: number, maxAgeDays?: number }} [opts]
 */
export function enrichHoursFromImportant(hoursList, important, opts = {}) {
  const list = Array.isArray(hoursList) ? hoursList.map((h) => ({ ...h })) : []
  const byId = new Map(list.map((h) => [h.resortId, h]))
  const newsByResort = collectNewsHoursByResort(important, opts)

  for (const [resortId, pack] of newsByResort) {
    const prev = byId.get(resortId)
    const next = applyNewsHoursToSnapshot(prev, pack, resortId)
    byId.set(resortId, next)
  }

  // Preserve original order; append any new resort ids at the end.
  const seen = new Set()
  const out = []
  for (const h of list) {
    out.push(byId.get(h.resortId) || h)
    seen.add(h.resortId)
  }
  for (const [resortId, h] of byId) {
    if (!seen.has(resortId)) out.push(h)
  }
  return out
}
