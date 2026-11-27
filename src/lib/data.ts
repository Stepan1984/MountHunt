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
 * Also drops condensed card summaries (e.g. Severny «пн–пт (бар)…» from
 * пн–чт + пт rows) that match `formatCardHoursFromPeriods`.
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

  // Condensed card format (пн–чт + пт → «пн–пт») that restates the table.
  const cardFormatted = formatCardHoursFromPeriods(periods)
  if (cardFormatted && normHoursBlob(lead) === normHoursBlob(cardFormatted)) return null
  if (cardFormatted) {
    const looseCard = normHoursBlob(cardFormatted.replace(/:/g, ' '))
    if (looseLead === looseCard) return null
  }

  return lead
}

const WEEKDAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const

const DAY_INDEX: Record<string, number> = {
  пн: 0,
  вт: 1,
  ср: 2,
  чт: 3,
  пт: 4,
  сб: 5,
  вс: 6,
  понедельник: 0,
  вторник: 1,
  среда: 2,
  четверг: 3,
  пятница: 4,
  суббота: 5,
  воскресенье: 6,
}

function normalizeCardTime(raw: string | null | undefined): string {
  const s = (raw || '').trim().replace(/\./g, ':')
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return s
  return `${Number(m[1])}:${m[2]}`
}

function formatDayIndices(indices: number[]): string {
  if (!indices.length) return ''
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const d = sorted[i]
    if (d === prev + 1) {
      prev = d
      continue
    }
    ranges.push(
      start === prev
        ? WEEKDAY_NAMES[start]
        : `${WEEKDAY_NAMES[start]}–${WEEKDAY_NAMES[prev]}`,
    )
    start = prev = d
  }
  return ranges.join(', ')
}

type ParsedCardDays = {
  indices: number[] | null
  label: string
  note: string
  holidayExtra: string
}

/** Parse day labels into weekday indices (Mon=0) when possible. */
function parseCardDaysLabel(raw: string): ParsedCardDays {
  let days = raw
    .trim()
    .replace(/\s*\([^)]*полный[^)]*\)/gi, '')
    .replace(/\s*\([^)]*по\s+прайсу[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  let note = ''
  const noteMatch = days.match(/^(.*?)\s*(\([^)]*\))\s*$/)
  if (noteMatch) {
    days = noteMatch[1].trim()
    note = noteMatch[2].trim()
  }

  const lower = days.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  const holidayExtra = ''

  if (!lower) return { indices: null, label: '', note, holidayExtra }

  if (/^будни$|^будние(?:\s+дни)?$/.test(lower)) {
    return { indices: [0, 1, 2, 3, 4], label: 'пн–пт', note, holidayExtra }
  }
  if (/^выходные и праздники$/.test(lower)) {
    return {
      indices: [5, 6],
      label: 'сб–вс',
      note,
      holidayExtra: ' и праздники',
    }
  }
  if (/^выходные$|^выходные дни$/.test(lower)) {
    return { indices: [5, 6], label: 'сб–вс', note, holidayExtra }
  }
  if (/^ежедневно$/.test(lower)) {
    return { indices: null, label: 'ежедневно', note, holidayExtra }
  }

  const range = lower.match(/^([а-яё]+)\s*[–\-−—]\s*([а-яё]+)$/)
  if (range && DAY_INDEX[range[1]] != null && DAY_INDEX[range[2]] != null) {
    const a = DAY_INDEX[range[1]]
    const b = DAY_INDEX[range[2]]
    if (a <= b) {
      const indices: number[] = []
      for (let i = a; i <= b; i++) indices.push(i)
      return { indices, label: formatDayIndices(indices), note, holidayExtra }
    }
  }

  const parts = lower.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 1 && parts.every((p) => DAY_INDEX[p] != null)) {
    const indices = [...new Set(parts.map((p) => DAY_INDEX[p]))].sort((a, b) => a - b)
    return { indices, label: formatDayIndices(indices), note, holidayExtra }
  }

  return {
    indices: null,
    label: days.replace(/\s*[-−—]\s*/g, '–').replace(/\s+/g, ' ').trim(),
    note,
    holidayExtra,
  }
}

function cardHoursSlotValue(open: string, close: string): string {
  return open && close ? `${open}–${close}` : 'выходной'
}

/**
 * Canonical card schedule from structured periods:
 * «пн–пт: 11:00–22:00\nсб–вс: 9:00–22:30»
 * (line break between groups, no `;`, Mon-first, abbr + consecutive grouping).
 */
export function formatCardHoursFromPeriods(periods: HoursPeriod[] | undefined): string | null {
  if (!periods?.length) return null

  type DaySlot = {
    open: string
    close: string
    note: string
    holidayExtra: string
  }
  const daySlots: (DaySlot | null)[] = Array.from({ length: 7 }, () => null)
  const extras: { label: string; open: string; close: string }[] = []

  for (const p of periods) {
    const parsed = parseCardDaysLabel(p.days || '')
    if (!parsed.label && !parsed.indices) continue
    const open = normalizeCardTime(p.open)
    const close = normalizeCardTime(p.close)

    if (parsed.indices) {
      for (const idx of parsed.indices) {
        if (daySlots[idx]) continue
        daySlots[idx] = {
          open,
          close,
          note: parsed.note,
          holidayExtra: parsed.holidayExtra,
        }
      }
    } else {
      const label = parsed.note ? `${parsed.label} ${parsed.note}` : parsed.label
      extras.push({ label, open, close })
    }
  }

  const parts: string[] = []
  let i = 0
  while (i < 7) {
    const slot = daySlots[i]
    if (!slot) {
      i++
      continue
    }
    let j = i
    const slotVal = cardHoursSlotValue(slot.open, slot.close)
    while (
      j + 1 < 7 &&
      daySlots[j + 1] &&
      cardHoursSlotValue(daySlots[j + 1]!.open, daySlots[j + 1]!.close) === slotVal
    ) {
      j++
    }
    const indices: number[] = []
    for (let k = i; k <= j; k++) indices.push(k)
    const notes = new Set<string>()
    let holidayExtra = ''
    for (let k = i; k <= j; k++) {
      const s = daySlots[k]!
      if (s.note) notes.add(s.note)
      if (s.holidayExtra) holidayExtra = s.holidayExtra
    }
    const note = notes.size === 1 ? [...notes][0] : ''
    let days = formatDayIndices(indices) + holidayExtra
    if (note) days = `${days} ${note}`
    parts.push(`${days}: ${slotVal}`)
    i = j + 1
  }

  for (const ex of extras) {
    parts.push(
      ex.open && ex.close
        ? `${ex.label}: ${ex.open}–${ex.close}`
        : `${ex.label}: выходной`,
    )
  }

  return parts.length ? parts.join('\n') : null
}

/** Reformat weekday schedule segments; leave opaque labels, join with `\n` (no `;`). */
function reformatCardHoursSummaryText(text: string): string {
  const segments = text
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!segments.length) return ''

  const periods: HoursPeriod[] = []
  const opaque: string[] = []

  for (const seg of segments) {
    const m = seg.match(/^(.+?):\s*(.+)$/)
    if (!m) {
      opaque.push(seg)
      continue
    }
    const days = m[1].trim()
    let rest = m[2].trim()
    rest = rest.replace(
      /^(\d{1,2}:\d{2}\s*[–\-−—]\s*\d{1,2}:\d{2}).*$/,
      '$1',
    )
    const oc = rest.match(/^(\d{1,2}:\d{2})\s*[–\-−—]\s*(\d{1,2}:\d{2})$/)
    const parsed = parseCardDaysLabel(days)
    if (parsed.indices || /^ежедневно$/i.test(parsed.label)) {
      if (oc) {
        periods.push({ days, open: oc[1], close: oc[2] })
      } else if (/выходн|закрыт/i.test(rest)) {
        periods.push({ days, open: '', close: '' })
      } else {
        opaque.push(seg)
      }
    } else {
      opaque.push(oc ? `${days}: ${oc[1]}–${oc[2]}` : `${days}: ${rest}`)
    }
  }

  const formatted = formatCardHoursFromPeriods(periods)
  const parts: string[] = []
  if (formatted) parts.push(...formatted.split(/\n/))
  parts.push(...opaque)
  return parts
    .map((p) => p.trim().replace(/;+\s*$/g, '').trim())
    .filter(Boolean)
    .join('\n')
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
    // Keep `\n` so normalize can turn lift/day lines into `;` then back to `\n`.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
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
    // Newlines and `;`/`|` are segment separators (card lines use `\n`, no `;`).
    .replace(/\n+/g, ';')
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
  return reformatCardHoursSummaryText(t)
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
    // Keep intentional `\n` (card/detail schedule & lift lines); collapse other runs.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
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
      // Keep intentional `\n` (Krasnoe lift lines, card schedules); collapse other runs.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
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

/** Normalize title+body for feed collision checks (RU near-duplicates). */
function normalizeFeedText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„“”']/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFeedUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function feedSourceRank(item: ImportantItem): number {
  const url = item.sourceUrl || ''
  if (/t\.me\//i.test(url)) return 20
  if (/vk\.com\//i.test(url)) return 30
  if (url) return 10
  return 40
}

function feedTextsCollide(a: ImportantItem, b: ImportantItem): boolean {
  const ua = normalizeFeedUrl(a.sourceUrl)
  const ub = normalizeFeedUrl(b.sourceUrl)
  if (ua && ub && ua === ub) return true
  if (a.resortId && b.resortId && a.resortId !== b.resortId) return false
  const ta = normalizeFeedText(`${a.title || ''} ${a.body || ''}`)
  const tb = normalizeFeedText(`${b.title || ''} ${b.body || ''}`)
  if (!ta || !tb || ta.length < 12 || tb.length < 12) return false
  if (ta === tb) return true
  const aTitle = normalizeFeedText(a.title || '')
  const bTitle = normalizeFeedText(b.title || '')
  if (aTitle.length >= 12 && bTitle.length >= 12) {
    if (ta.includes(bTitle) || tb.includes(aTitle)) return true
  }
  return false
}

/**
 * Full news feed for `/news`: all non-chrome Important items, newest first
 * (publication date, else scrape stamp). Drops URL/text collisions across sources.
 */
export function allImportantNews(items: ImportantItem[]): ImportantItem[] {
  const sorted = [...items]
    .filter((item) => !IMPORTANT_CHROME_IDS.has(item.id))
    .sort((a, b) => {
      const rank = feedSourceRank(a) - feedSourceRank(b)
      if (rank !== 0) return rank
      const aTime = new Date(importantDateIso(a)).getTime()
      const bTime = new Date(importantDateIso(b)).getTime()
      if (aTime !== bTime) return bTime - aTime
      return a.id.localeCompare(b.id)
    })

  const deduped: ImportantItem[] = []
  for (const item of sorted) {
    if (deduped.some((k) => feedTextsCollide(k, item))) continue
    deduped.push(item)
  }

  return deduped.sort((a, b) => {
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
