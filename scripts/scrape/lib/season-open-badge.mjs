/**
 * Season-open badge from scraped news («Важное» / TG·VK feed).
 * Show «Начало сезона DD.MM.YYYY» only when a post announces season opening
 * with a concrete calendar date that is still today or in the future (MSK).
 *
 * Keep in sync with src/lib/season-open-badge.ts.
 */

/**
 * Resorts that must never show «Начало сезона» / season-open date badges.
 * Krasnoe: opening postponed indefinitely («всё переносится на неопределенный срок»).
 */
export const SEASON_START_BADGE_SUPPRESSED_RESORTS = new Set(['krasnoe-ozero'])

const RU_MONTHS = Object.freeze({
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
})

/** Contest / guess posts mention «дату открытия» without announcing it. */
const GUESS_CONTEST_RE =
  /угадай|угадает|напиши\s+в\s+комментари|рос{1,2}ыгрыш.{0,100}дат[уеы]/i

/**
 * True when the post announces a season / slope opening (not a closed-season note).
 * @param {string} text
 */
export function isSeasonOpeningAnnouncement(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return false
  if (GUESS_CONTEST_RE.test(t) && !/\bстартует\b|\bоткрываемс|\bзапускаем\b/i.test(t)) {
    return false
  }
  return (
    /стартует\s+(?:\S+\s+){0,3}сезон/i.test(t) ||
    /сезон\s+стартует/i.test(t) ||
    /открытие\s+сезон/i.test(t) ||
    /открываемс/i.test(t) ||
    /открываем\s+(?:горнолыжн\w+\s+)?сезон/i.test(t) ||
    /запускаем.{0,80}(?:трасс|сезон|склон)/i.test(t) ||
    /с\s+\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+будет\s+открыт/i.test(
      t,
    ) ||
    /открытие\s+\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(
      t,
    ) ||
    /\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s+стартует/i.test(t)
  )
}

/**
 * @param {number} day
 * @param {number} month 1–12
 * @param {number} year
 * @returns {string | null} YYYY-MM-DD
 */
function ymd(day, month, year) {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 2000 || year > 2100) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * @param {string | null | undefined} iso
 * @returns {number} calendar year in Europe/Moscow
 */
export function mskYearFromIso(iso) {
  if (!iso) {
    return Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(
        new Date(),
      ),
    )
  }
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return mskYearFromIso(null)
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(
      new Date(t),
    ),
  )
}

/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in Europe/Moscow
 */
export function mskTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * @param {string} ymdStr YYYY-MM-DD
 * @returns {string} DD.MM.YYYY
 */
export function formatSeasonOpenLabelDate(ymdStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr)
  if (!m) return ymdStr
  return `${m[3]}.${m[2]}.${m[1]}`
}

/**
 * Pull the announced opening calendar day from announcement text.
 * @param {string} text
 * @param {string | null | undefined} refIso publication / scrape stamp for year fallback
 * @returns {string | null} YYYY-MM-DD
 */
export function extractSeasonOpenYmd(text, refIso) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t || !isSeasonOpeningAnnouncement(t)) return null

  const refYear = mskYearFromIso(refIso)

  // «28.11 стартует…» / «стартует … 28.11.2026»
  const dotted = [
    ...t.matchAll(
      /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s*(?:стартует|откро|откры|запуска|начн|сезон)|.{0,40}(?:стартует\s+(?:\S+\s+){0,3}сезон|открытие\s+сезон|открываемс))/gi,
    ),
    ...t.matchAll(
      /(?:стартует|открытие|откроется|открываемс\w*|запускаем|с)\s[^.]{0,60}?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/gi,
    ),
  ]
  for (const m of dotted) {
    const day = Number(m[1])
    const month = Number(m[2])
    let year = m[3] != null ? Number(m[3]) : refYear
    if (year < 100) year += 2000
    const out = ymd(day, month, year)
    if (out) return out
  }

  // «Открытие 22 ноября» / «с 22 ноября будет открыт»
  const named = t.match(
    /(?:открытие|с|стартует|откроется|открываемс\w*|запускаем)\s[^.]{0,40}?(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/i,
  )
  if (named) {
    const day = Number(named[1])
    const month = RU_MONTHS[named[2].toLowerCase()]
    const year = named[3] ? Number(named[3]) : refYear
    const out = ymd(day, month, year)
    if (out) return out
  }

  return null
}

/**
 * @param {{ id?: string, resortId?: string, title?: string, body?: string, publishedAt?: string | null, updatedAt?: string }} item
 * @param {string} resortId
 * @returns {string | null} YYYY-MM-DD
 */
export function seasonOpenYmdFromItem(item, resortId) {
  if (!item || item.resortId !== resortId) return null
  const blob = `${item.title || ''} ${item.body || ''}`
  const ref = item.publishedAt || item.updatedAt || null
  return extractSeasonOpenYmd(blob, ref)
}

/**
 * Newest announcement wins when several news items carry a date.
 * @param {string} resortId
 * @param {{ id?: string, resortId?: string, title?: string, body?: string, publishedAt?: string | null, updatedAt?: string }[]} important
 * @param {Date} [now]
 * @returns {string | null} badge text or null when absent / past
 */
export function seasonOpenBadgeLabel(resortId, important, now = new Date()) {
  if (!resortId || !Array.isArray(important)) return null
  // Indefinite postponement / policy suppress — never advertise a start date.
  if (SEASON_START_BADGE_SUPPRESSED_RESORTS.has(resortId)) return null
  const today = mskTodayYmd(now)
  /** @type {{ ymd: string, sort: number }[]} */
  const hits = []
  for (const item of important) {
    const y = seasonOpenYmdFromItem(item, resortId)
    if (!y) continue
    const sort = Date.parse(item.publishedAt || item.updatedAt || '') || 0
    hits.push({ ymd: y, sort })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.sort - a.sort)
  const chosen = hits[0].ymd
  // Hide once the opening calendar day has passed (MSK).
  if (chosen < today) return null
  return `Начало сезона ${formatSeasonOpenLabelDate(chosen)}`
}
