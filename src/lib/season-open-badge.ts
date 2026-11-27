/**
 * Season-open badge from scraped news («Важное» / TG·VK feed).
 * Show «Начало сезона DD.MM.YYYY» only when a post announces season opening
 * with a concrete calendar date that is still today or in the future (MSK).
 *
 * Keep in sync with scripts/scrape/lib/season-open-badge.mjs.
 */

import type { ImportantItem } from '../types'

const RU_MONTHS: Record<string, number> = {
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
}

/** Contest / guess posts mention «дату открытия» without announcing it. */
const GUESS_CONTEST_RE =
  /угадай|угадает|напиши\s+в\s+комментари|рос{1,2}ыгрыш.{0,100}дат[уеы]/i

/** True when the post announces a season / slope opening (not a closed-season note). */
export function isSeasonOpeningAnnouncement(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
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

function ymd(day: number, month: number, year: number): string | null {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 2000 || year > 2100) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Calendar year in Europe/Moscow from an ISO stamp (or now). */
export function mskYearFromIso(iso: string | null | undefined): number {
  const when = iso && Number.isFinite(Date.parse(iso)) ? new Date(iso) : new Date()
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric' }).format(when),
  )
}

/** YYYY-MM-DD in Europe/Moscow. */
export function mskTodayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** YYYY-MM-DD → DD.MM.YYYY */
export function formatSeasonOpenLabelDate(ymdStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr)
  if (!m) return ymdStr
  return `${m[3]}.${m[2]}.${m[1]}`
}

/**
 * Pull the announced opening calendar day from announcement text.
 * @returns YYYY-MM-DD or null
 */
export function extractSeasonOpenYmd(
  text: string,
  refIso: string | null | undefined,
): string | null {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || !isSeasonOpeningAnnouncement(t)) return null

  const refYear = mskYearFromIso(refIso)

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

export function seasonOpenYmdFromItem(
  item: Pick<ImportantItem, 'resortId' | 'title' | 'body' | 'publishedAt' | 'updatedAt'>,
  resortId: string,
): string | null {
  if (!item || item.resortId !== resortId) return null
  const blob = `${item.title || ''} ${item.body || ''}`
  const ref = item.publishedAt || item.updatedAt || null
  return extractSeasonOpenYmd(blob, ref)
}

/**
 * Newest announcement wins when several news items carry a date.
 * Returns badge text or null when absent / past.
 */
export function seasonOpenBadgeLabel(
  resortId: string,
  important: ImportantItem[],
  now: Date = new Date(),
): string | null {
  if (!resortId || !Array.isArray(important)) return null
  const today = mskTodayYmd(now)
  const hits: { ymd: string; sort: number }[] = []
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
