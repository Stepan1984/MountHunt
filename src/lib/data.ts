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
  if (!periods?.length) return lead

  const fromPeriods = periods.map((p) => `${p.days}${p.open}${p.close}`).join('')
  if (normHoursBlob(lead) === normHoursBlob(fromPeriods)) return null

  // Colon/semicolon variants of the same schedule (Okhta-style summary).
  const looseLead = normHoursBlob(lead.replace(/:/g, ' '))
  const loosePeriods = normHoursBlob(fromPeriods.replace(/:/g, ' '))
  if (looseLead === loosePeriods) return null

  return lead
}

export function pricesFor(resortId: string, prices: PriceSnapshot[]): PriceSnapshot | undefined {
  return prices.find((p) => p.resortId === resortId)
}

const SCRAPER_NOTE_MARKERS =
  /playwright|\/ssr\b|\bssr\b|snapshot:|github actions|дождаться успешного|не live|status:\s*unavailable|status unavailable|csv виджета|публичн\w*\s+csv|html-сним|\btilda\b|nohref|sev-sklon|без js|виджет на главной|извлечены\s+ocr/i

/** Strip scrape/tooling clauses; keep visitor-facing blurb. */
function stripScraperClauses(text: string): string {
  return text
    .replace(/\s*цены\s*[—–-]\s*playwright[^.;]*/gi, '')
    .replace(/\s*;?\s*цены и график из публичных csv[^.;]*/gi, '')
    .replace(/:?\s*ski-pass на сайте не опубликован[^.;]*/gi, '')
    .replace(/\s*[—–-]\s*статус unavailable/gi, '')
    .replace(/\s*статус unavailable[^.;]*/gi, '')
    .replace(/\s*часы\s*[—–-]\s*\/working-hours\/\.?/gi, '')
    .replace(/\s*цены\s*[—–-]\s*playwright\/ssr[^.]*\/price\/\.?/gi, '')
    .replace(/\s*на\s*\/price\/\.?/gi, '')
    .replace(/\s*\/working-hours\/\.?/gi, '')
    .replace(/\s*\/price\/\.?/gi, '')
    .replace(/https?:\/\/[^\s.;]+/gi, '')
    .replace(/\s*:\s*;/g, ';')
    .replace(/\s*;\s*;/g, ';')
    .replace(/[;:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Visitor-facing resort blurb — drop scrape/tooling sentences. */
export function publicResortNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null
  // Split on sentence ends only (not `;` — used in normal blurbs).
  const parts = notes
    .split(/(?<=[.!])\s+/)
    .map((p) => stripScraperClauses(p))
    .filter((p) => p.length > 0 && !SCRAPER_NOTE_MARKERS.test(p))

  const cleaned = parts.join(' ').replace(/\s+/g, ' ').trim()
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
  const cleaned = stripContactClausesFromPriceNote(
    note
      .replace(/\bsnow-park\b/gi, 'сноупарка')
      .replace(/\bski-?pass\b/gi, 'ски-пасс')
      .replace(/\s*извлечены\s+ocr\s+из\s+скана\s+pdf[^.;]*/gi, ' со скана прейскуранта')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  return cleaned || null
}

/**
 * Normalize accidental /en/ paths in user-visible Russian copy.
 * Raw URLs are turned into hyperlinks by LinkedText / ExternalLink — not shown as slash text.
 */
export function localizePublicText(text: string): string {
  return text
    .replace(/https?:\/\/igora\.ru\/en\/working-hours\/?/gi, 'https://igora.ru/working-hours/')
    .replace(/\/en\/working-hours/gi, '/working-hours')
    // Drop scrape/tooling asides that must never reach visitors.
    .replace(/\s*\(виджет[^)]*\)/gi, '')
    .replace(/\s*\(CSV[^)]*\)/gi, '')
    .replace(/\s*;?\s*без\s+JS\s+недоступен/gi, '')
    .replace(/\bsnow-park\b/gi, 'сноупарка')
    .replace(/\s+/g, ' ')
    .trim()
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

export function slopesClosedHint(
  resortId: string,
  hours: HoursSnapshot | undefined,
  important: ImportantItem[],
): string | null {
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
