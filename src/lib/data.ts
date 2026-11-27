import { stripUrlsFromText } from './links'
import type {
  HoursSnapshot,
  ImportantItem,
  Meta,
  PriceSnapshot,
  Resort,
  SiteData,
} from '../types'

const base = import.meta.env.BASE_URL

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path.replace(/^\//, '')}`)
  if (!res.ok) {
    throw new Error(`Не удалось загрузить ${path}: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function loadSiteData(): Promise<SiteData> {
  const [resorts, hours, prices, important, meta] = await Promise.all([
    loadJson<Resort[]>('data/resorts.json'),
    loadJson<HoursSnapshot[]>('data/hours.json'),
    loadJson<PriceSnapshot[]>('data/prices.json'),
    loadJson<ImportantItem[]>('data/important.json'),
    loadJson<Meta>('data/meta.json'),
  ])
  return { resorts, hours, prices, important, meta }
}

export function statusLabel(status: Resort['status']): string {
  switch (status) {
    case 'active':
      return 'Действует'
    case 'unclear':
      return 'Статус неясен'
    case 'closed':
      return 'Закрыт'
  }
}

/** Public URL for a resort hero photo file under `photos/resorts/`. */
export function resortPhotoUrl(file: string): string {
  const name = file.replace(/^\/+/, '')
  return `${base}photos/resorts/${name}`
}

export function scrapeStatusLabel(
  status: HoursSnapshot['status'] | PriceSnapshot['status'] | string | null | undefined,
): string {
  switch (status) {
    case 'ok':
      return 'актуально'
    case 'partial':
      return 'частично'
    case 'failed':
      return 'сбой обновления'
    case 'pending':
      return 'ожидает обновления'
    case 'unavailable':
      return 'на сайте не опубликованы'
    default:
      return 'нет данных'
  }
}

export function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return 'ещё не обновлялись'
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Moscow',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** News/publication date on Important cards — date-only when source had no time. */
export function formatImportantDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const dateOnly = /T00:00:00(\.000)?Z$/.test(iso)
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      ...(dateOnly ? {} : { timeStyle: 'short' }),
      timeZone: 'Europe/Moscow',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Prefer publication date for ordering; fall back to scrape stamp. */
export function importantDateIso(item: { publishedAt?: string | null; updatedAt: string }): string {
  return item.publishedAt || item.updatedAt
}

/**
 * Yandex Maps link for a resort: pin at coordinates when known,
 * otherwise search by address / name query.
 */
export function yandexMapsUrl(input: {
  lat?: number | null
  lon?: number | null
  /** Fallback search text when coords are missing (address and/or name). */
  query?: string | null
}): string | null {
  if (input.lat != null && input.lon != null) {
    return `https://yandex.ru/maps/?pt=${input.lon},${input.lat}&z=14&l=map`
  }
  const query = input.query?.trim()
  if (query) {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(query)}`
  }
  return null
}

/** Human-readable address line used in UI and as maps search fallback. */
export function resortAddressQuery(resort: Pick<Resort, 'name' | 'area'>): string {
  const area = resort.area?.trim()
  if (!area) return resort.name
  // Include name so vague areas (e.g. «ЛО, Токсово») still find the slope.
  if (area.includes(resort.name)) return area
  return `${resort.name}, ${area}`
}

export function hoursFor(resortId: string, hours: HoursSnapshot[]): HoursSnapshot | undefined {
  return hours.find((h) => h.resortId === resortId)
}

type HoursPeriod = NonNullable<HoursSnapshot['periods']>[number]

/** Collapse «10:00–21:00» / «10:00-21:00» noise for equality checks. */
function normHoursBlob(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.:;,/|()[\]«»"'\s–—−-]+/g, '')
    .replace(/выходной|закрыто/g, '')
}

/**
 * Visitor-facing hours lead: omit summary when it only restates `periods`
 * (avoids «ежедневно 10:00–21:00» twice in the same block).
 */
export function hoursLeadText(
  summary: string | null | undefined,
  periods: HoursPeriod[] | undefined,
): string | null {
  const lead = summary?.trim() || null
  if (!lead) return null
  // Date-only «График на …» with no times → let the page show «Нет данных».
  if (isBlankHoursScheduleLabel(lead)) return null
  if (!periods?.length) return lead

  const fromPeriods = periods.map((p) => `${p.days}${p.open}${p.close}`).join('')
  if (normHoursBlob(lead) === normHoursBlob(fromPeriods)) return null

  // Colon/semicolon variants of the same schedule (Okhta-style summary).
  const looseLead = normHoursBlob(lead.replace(/:/g, ' '))
  const loosePeriods = normHoursBlob(fromPeriods.replace(/:/g, ' '))
  if (looseLead === loosePeriods) return null

  return lead
}

const WEEKDAY_ABBR = new Set(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])

/** «ср., чт., пт.» / «пн, вт» → «ср–пт» / «пн–вт»; keep other labels. */
function normalizeCardDaysLabel(raw: string): string {
  let days = raw
    .trim()
    .replace(/\s*\([^)]*полный[^)]*\)/gi, '')
    .replace(/\s*\([^)]*по\s+прайсу[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!days) return ''

  const parts = days.split(/\s*,\s*/).map((p) => p.replace(/\.$/, '').trim().toLowerCase())
  if (parts.length >= 2 && parts.every((p) => WEEKDAY_ABBR.has(p))) {
    return `${parts[0]}–${parts[parts.length - 1]}`
  }

  return days
    .replace(/\s*[-−—]\s*/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCardTime(raw: string | null | undefined): string {
  const s = (raw || '').trim().replace(/\./g, ':')
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return s
  return `${Number(m[1])}:${m[2]}`
}

/**
 * Canonical card schedule line from structured periods:
 * «пн–пт: 11:00–22:00; сб–вс: 9:00–22:30».
 */
export function formatCardHoursFromPeriods(periods: HoursPeriod[] | undefined): string | null {
  if (!periods?.length) return null
  const seen = new Set<string>()
  const parts: string[] = []
  for (const p of periods) {
    const days = normalizeCardDaysLabel(p.days || '')
    if (!days) continue
    const key = days.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const open = normalizeCardTime(p.open)
    const close = normalizeCardTime(p.close)
    if (open && close) {
      parts.push(`${days}: ${open}–${close}`)
    } else {
      parts.push(`${days}: выходной`)
    }
  }
  return parts.length ? parts.join('; ') : null
}

/** Cyrillic-safe letter run (JS `\w` is ASCII-only without the unicode flag). */
const CY = '[а-яёa-z]*'

/**
 * Drop slope open/closed status prose that duplicates card badges
 * («Склоны открыты/закрыты»). Keep real schedule fragments.
 */
export function stripSlopeStatusFromCardHours(text: string): string {
  let t = text.trim()
  if (!t) return ''

  // Whole leading status sentences / dated closed-until-season lines.
  t = t.replace(
    new RegExp(
      `^(?:на\\s+\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?\\s*:\\s*)?(?:горнолыжн${CY}\\s+)?(?:склон(?:ы|ов|а)?|трасс${CY})(?:\\s*\\/\\s*подъ[её]мник${CY})?\\s+(?:открыт${CY}|закрыт${CY})(?:\\s+на\\s+летн${CY}\\s+период)?(?:\\s+до\\s+сезон${CY})?[.!?]?\\s*`,
      'gi',
    ),
    '',
  )
  t = t.replace(new RegExp(`^(?:снежн${CY}\\s+)?сезон\\s+закрыт\\.?\\s*`, 'gi'), '')
  t = t.replace(new RegExp(`^закрыт(?:ы|а|о)?\\s+до\\s+сезон${CY}[.!?]?\\s*`, 'gi'), '')

  // Trailing / mid status clauses after . or —
  t = t.replace(
    new RegExp(`\\s*[.]\\s*(?:снежн${CY}\\s+)?сезон\\s+закрыт(?:\\s*[—–-].*)?$`, 'gi'),
    '',
  )
  t = t.replace(
    new RegExp(
      `\\s*[.]\\s*(?:горнолыжн${CY}\\s+)?склон${CY}\\s+(?:открыт${CY}|закрыт${CY})(?:\\s+на\\s+летн${CY}\\s+период)?(?:\\s+до\\s+сезон${CY})?.*$`,
      'gi',
    ),
    '',
  )
  t = t.replace(
    new RegExp(`\\s*[—–-]\\s*(?:снежн${CY}\\s+)?сезон\\s+закрыт(?:\\s*[—–-].*)?$`, 'gi'),
    '',
  )

  // Scraper glue when status was prepended to a real schedule.
  t = t.replace(/^\s*ближайший\s+график\s*\([^)]*\)\s*:\s*/i, '')
  t = t.replace(new RegExp(`закрыт(?:ы|а|о)?\\s+до\\s+сезон${CY}`, 'gi'), '')

  return t
    .replace(/\s+/g, ' ')
    .replace(/^[,;.\s]+|[,;.\s]+$/g, '')
    .trim()
}

/**
 * True when text has real clock times (not calendar dates like 25.11.2026).
 * Colon times are unambiguous; dotted times only count inside a range.
 */
function hasRealCardHoursTimes(text: string): boolean {
  if (/\d{1,2}:\d{2}/.test(text)) return true
  if (/\d{1,2}\.\d{2}\s*[-−—–]\s*\d{1,2}([:.]\d{2})?/.test(text)) return true
  return false
}

/**
 * Date-only / empty schedule labels with no open–close times
 * (e.g. «График на 25.11.2026» left after status strip).
 */
export function isBlankHoursScheduleLabel(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (hasRealCardHoursTimes(t)) return false
  // «График на 25.11.2026» / «На 25.11.2026»
  if (/^(?:график\s+)?на\s+\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\.?$/i.test(t)) return true
  // «График на 25.11.2026: данные по склонам не найдены»
  if (/^график\s+на\s+\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*:/i.test(t)) return true
  return false
}

/** True when the leftover string is only open/closed status, not a schedule. */
function isPureSlopeStatusHours(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (hasRealCardHoursTimes(t)) return false
  return new RegExp(
    `сезон\\s+закрыт|склон${CY}\\s+(?:открыт|закрыт)|закрыт${CY}\\s+до\\s+сезон|горнолыжн${CY}\\s+склон`,
    'i',
  ).test(t)
}

/**
 * Normalize free-text hours into the same card style as periods formatting.
 */
export function normalizeCardHoursSummary(text: string): string {
  let t = stripSlopeStatusFromCardHours(text)
  if (!t || isPureSlopeStatusHours(t) || isBlankHoursScheduleLabel(t)) return ''

  t = t
    .replace(/\s*[;|]\s*/g, '; ')
    // Convert HH.MM→HH:MM only inside time ranges (do not touch dates like 25.11.2026).
    .replace(/(\d{1,2})\.(\d{2})(?=\s*[-−—–]\s*\d)/g, '$1:$2')
    .replace(/(?<=[-−—–]\s*)(\d{1,2})\.(\d{2})\b/g, '$1:$2')
    .replace(/(\d{1,2}:\d{2})\s*[-−—]\s*(\d{1,2}:\d{2})/g, '$1–$2')
    // «будни 12:00–18:00» / «ежедневно 10:00–21:00» → colon before times
    .replace(
      /(^|;\s*)([^;:]+?)\s+(\d{1,2}:\d{2}\s*–\s*\d{1,2}:\d{2})/g,
      '$1$2: $3',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[,;.\s]+|[,;.\s]+$/g, '')
    .replace(/…\s*$/g, '')
    .trim()

  if (!t || isBlankHoursScheduleLabel(t)) return ''
  return t
}

/**
 * Active-card «Часы» line: unified schedule format, no slope status badge duplicates.
 * Prefer structured `periods`; fall back to cleaned summary.
 */
export function cardHoursText(hours: HoursSnapshot | undefined): string {
  if (!hours) return 'нет данных'

  const fromPeriods = formatCardHoursFromPeriods(hours.periods)
  if (fromPeriods) return fromPeriods

  const raw = (hours.summary || '').trim()
  if (!raw) return 'нет данных'
  const cleaned = normalizeCardHoursSummary(
    stripUrlsFromText(localizePublicText(raw)),
  )
  return cleaned || 'нет данных'
}

export function pricesFor(resortId: string, prices: PriceSnapshot[]): PriceSnapshot | undefined {
  return prices.find((p) => p.resortId === resortId)
}

const SCRAPER_NOTE_MARKERS =
  /playwright|\/ssr\b|\bssr\b|snapshot:|github actions|дождаться успешного|не live|status:\s*unavailable|status unavailable|csv виджета|публичн\w*\s+csv|html-сним|\btilda\b|nohref|sev-sklon|без js|виджет на главной|извлечены\s+ocr/i

/**
 * Drop visitor-facing «уточняйте…» / актуальность-disclaimer captions
 * (hours, notes, important, price footnotes). About/footer copy is hardcoded
 * and does not go through this helper.
 */
export function stripUtochnyayteDisclaimers(text: string): string {
  let t = text
  // Parenthetical asides: (уточняйте открытие на сайте)
  t = t.replace(/\s*\([^)]*уточня(?:йте|ть)[^)]*\)/gi, '')
  // Trailing / mid clauses after dash or semicolon that ask to уточняйте / уточнять…
  t = t.replace(/\s*[—–\-;:]\s*[^.—–;:\n]*уточня(?:йте|ть)[^.\n]*(?=[.]|$)/gi, '')
  // «… — уточнять открытие перед выездом»
  t = t.replace(/\s*[—–-]\s*уточня(?:йте|ть)\s+открытие\s+перед\s+выездом\.?/gi, '')
  // Whole sentences that are уточняйте / «актуальн…» / «перед выездом…» disclaimers.
  t = t
    .split(/(?<=[.!…])\s+/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      if (/уточня(?:йте|ть)/i.test(part) && /сайт|телеграм|telegram|оператор|курорт|режим|открыт/i.test(part)) {
        return false
      }
      if (/^актуальн\w*\s+(?:открытые\s+дни|график|режим|цены)\b/i.test(part)) return false
      if (/перед\s+выездом\s+(?:проверьте|сверьте|сверяйте)/i.test(part)) return false
      if (/это\s+не\s+оферта/i.test(part) && /выезд|сайт/i.test(part)) return false
      return true
    })
    .join(' ')
  return t
    .replace(/\s*…\s*$/g, '')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/^[,;.\s]+/, '')
    .trim()
}

/** Important / news card body without актуальность-disclaimer sentences. */
export function publicImportantBody(body: string | null | undefined): string | null {
  if (!body?.trim()) return null
  const cleaned = stripUtochnyayteDisclaimers(body)
  return cleaned || null
}

/**
 * Drop contact/address sentences that belong in «Контакты» / «Локация»,
 * not under «Цены» (defense if a scraper regresses).
 */
function stripContactClausesFromPriceNote(note: string): string {
  return note
    .split(/(?<=[.!])\s+/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false
      // Whole «Контакты: …» blobs (Severny historically stuffed phone/email/address here).
      if (/^контакты\s*:/i.test(part)) return false
      if (/\bконтакты\s+уточняйте\b/i.test(part)) return false
      // Phone / email / street fragments that are not price copy.
      if (/\+7[\d\s()/-]{8,}/.test(part) && /@|ул\.|улиц|посёл|посел|городск/i.test(part)) {
        return false
      }
      if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(part) && !/цен|тариф|ски|пасс|₽|руб/i.test(part)) {
        return false
      }
      return true
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Hide scrape-internal price footnotes from the public detail page. */
export function publicPriceNote(note: string | null | undefined): string | null {
  if (!note?.trim()) return null
  if (SCRAPER_NOTE_MARKERS.test(note)) return null
  // Soft-rewrite common tooling phrasing that still slipped into committed data.
  const cleaned = stripUtochnyayteDisclaimers(
    stripContactClausesFromPriceNote(
      note
        .replace(/\bsnow-park\b/gi, 'сноупарка')
        .replace(/\bski-?pass\b/gi, 'ски-пасс')
        .replace(/\s*извлечены\s+ocr\s+из\s+скана\s+pdf[^.;]*/gi, ' со скана прейскуранта')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  )
  return cleaned || null
}

/**
 * Normalize accidental /en/ paths in user-visible Russian copy.
 * Raw URLs are turned into hyperlinks by LinkedText / ExternalLink — not shown as slash text.
 */
export function localizePublicText(text: string): string {
  return stripUtochnyayteDisclaimers(
    text
      .replace(/https?:\/\/igora\.ru\/en\/working-hours\/?/gi, 'https://igora.ru/working-hours/')
      .replace(/\/en\/working-hours/gi, '/working-hours')
      // Drop scrape/tooling asides that must never reach visitors.
      .replace(/\s*\(виджет[^)]*\)/gi, '')
      .replace(/\s*\(CSV[^)]*\)/gi, '')
      .replace(/\s*;?\s*без\s+JS\s+недоступен/gi, '')
      .replace(/\bsnow-park\b/gi, 'сноупарка')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

const IMPORTANT_CHROME_IDS = new Set(['mvp-data-note', 'map-note'])

export function operationalImportant(items: ImportantItem[]): ImportantItem[] {
  const deduped: ImportantItem[] = []
  const seenResortWarn = new Set<string>()

  const sorted = [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1
    // Prefer real publication dates over scrape stamps when ordering.
    const aPub = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const bPub = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    if (aPub !== bPub) return bPub - aPub
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  for (const item of sorted) {
    if (IMPORTANT_CHROME_IDS.has(item.id)) continue
    // Prefer a single warn per resort (drops older Lazurnye duplicate).
    if (item.severity === 'warn' && item.resortId) {
      if (seenResortWarn.has(item.resortId)) continue
      seenResortWarn.add(item.resortId)
    }
    deduped.push(item)
  }

  return deduped
}

/**
 * Full news feed for `/news`: all non-chrome Important items, newest first
 * (publication date, else scrape stamp). No severity boost or warn dedupe.
 */
export function allImportantNews(items: ImportantItem[]): ImportantItem[] {
  return [...items]
    .filter((item) => !IMPORTANT_CHROME_IDS.has(item.id))
    .sort((a, b) => {
      const aTime = new Date(importantDateIso(a)).getTime()
      const bTime = new Date(importantDateIso(b)).getTime()
      if (aTime !== bTime) return bTime - aTime
      return a.id.localeCompare(b.id)
    })
}

/** Managed «Важное» ids that mean alpine slopes are open (info severity). */
const SLOPES_OPEN_IMPORTANT_IDS = new Set([
  'okhta-season-open',
  'tuutari-season-open',
  'puhtolova-season-open',
  'lazurnye-season-open',
])

/**
 * Legacy closed signals from warn «Важное» / hours prose.
 * Prefer hours.slopesOpen when the scrape set it.
 */
export function slopesClosedHint(
  resortId: string,
  hours: HoursSnapshot | undefined,
  important: ImportantItem[],
): string | null {
  if (hours?.slopesOpen === false) return 'Склоны закрыты'
  const warn = important.find(
    (i) =>
      i.resortId === resortId &&
      i.severity === 'warn' &&
      /закрыт|сезон закрыт|склоны закрыты/i.test(`${i.title} ${i.body ?? ''}`),
  )
  if (warn) return 'Склоны закрыты'
  if (
    hours?.summary &&
    /сезон закрыт|склон\w*\s+закрыт|закрыты на летний|закрыты до сезона/i.test(hours.summary)
  ) {
    return 'Склоны закрыты'
  }
  return null
}

/**
 * Active-card badge: «Склоны открыты» only with positive scrape/important signal.
 * Fail-soft — unknown / scrape miss → closed (never invent open).
 */
export function slopesBadgeLabel(
  resortId: string,
  hours: HoursSnapshot | undefined,
  important: ImportantItem[],
): 'Склоны открыты' | 'Склоны закрыты' {
  if (hours?.slopesOpen === true) return 'Склоны открыты'
  if (hours?.slopesOpen === false) return 'Склоны закрыты'
  if (slopesClosedHint(resortId, hours, important)) return 'Склоны закрыты'
  const openImportant = important.some(
    (i) => i.resortId === resortId && SLOPES_OPEN_IMPORTANT_IDS.has(i.id),
  )
  if (openImportant) return 'Склоны открыты'
  return 'Склоны закрыты'
}
