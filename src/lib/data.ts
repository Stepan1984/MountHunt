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

export function yandexMapsUrl(lat: number, lon: number): string {
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=14&l=map`
}

export function hoursFor(resortId: string, hours: HoursSnapshot[]): HoursSnapshot | undefined {
  return hours.find((h) => h.resortId === resortId)
}

export function pricesFor(resortId: string, prices: PriceSnapshot[]): PriceSnapshot | undefined {
  return prices.find((p) => p.resortId === resortId)
}

function itemBlob(title: string, unit?: string, note?: string): string {
  return `${title} ${unit ?? ''} ${note ?? ''}`.toLowerCase()
}

/** Ancillary / misleading for a compact «от N ₽» ski-pass hint. */
function isExcludedFromFromPrice(title: string, unit?: string, note?: string): boolean {
  const t = itemBlob(title, unit, note)
  return (
    /сезон/.test(t) ||
    unit === 'сезон' ||
    // JS \b is ASCII-only — match Cyrillic tokens by substring.
    /бск/.test(t) ||
    /аренда|прокат|продлен|хранен|шлем|ботин|групп|школ|индивидуальн|инструктор|занят|комплект|сноуборд|полный с /.test(
      t,
    )
  )
}

function isSeasonalItem(title: string, unit?: string): boolean {
  const t = itemBlob(title, unit)
  return /сезон/.test(t) || unit === 'сезон'
}

/** Discount / junior lines — prefer adult/base when both exist in the pool. */
function isDiscountedFromPrice(title: string, unit?: string, note?: string): boolean {
  return /льготн|детск|ребен|ребён|junior|child|студент|пенсион|школьник/.test(
    itemBlob(title, unit, note),
  )
}

function minPriceLabel(items: { price: number | null }[]): number {
  return Math.min(...items.map((i) => i.price as number))
}

/**
 * Honest compact price hint for cards.
 * Prefers day/hour ski-pass-like items; skips seasonal, BSK, rental, lessons.
 * Prefers adult/base over льготный when both are in the pool.
 */
export function priceHintFor(snapshot: PriceSnapshot | undefined): string {
  if (!snapshot) return 'цены уточняйте'
  if (snapshot.status === 'unavailable') return 'на сайте не опубликованы'
  if (snapshot.status === 'failed' && (!snapshot.items || snapshot.items.length === 0)) {
    return 'обновление не удалось'
  }

  const withPrice = snapshot.items.filter((i) => i.price != null)
  if (withPrice.length === 0) {
    return snapshot.status === 'failed' ? 'обновление не удалось' : 'цены уточняйте'
  }

  const usable = withPrice.filter((i) => !isExcludedFromFromPrice(i.title, i.unit, i.note))
  // Prefer timed day/hour tickets over single-ride «проход» when both exist.
  const timed = usable.filter((i) => {
    const u = (i.unit ?? '').toLowerCase()
    return u === 'час' || u === 'день' || /час|день/.test(i.title.toLowerCase())
  })
  const pool = timed.length > 0 ? timed : usable
  if (pool.length > 0) {
    const adult = pool.filter((i) => !isDiscountedFromPrice(i.title, i.unit, i.note))
    const pick = adult.length > 0 ? adult : pool
    return `от ${minPriceLabel(pick).toLocaleString('ru-RU')} ₽`
  }

  const seasonal = withPrice.filter((i) => isSeasonalItem(i.title, i.unit))
  if (seasonal.length === withPrice.length) {
    const adult = seasonal.filter((i) => !isDiscountedFromPrice(i.title, i.unit, i.note))
    const pick = adult.length > 0 ? adult : seasonal
    const dayClosed = /дневн[^.]*закрыт|закрыт до сезона|прейскурант[^.]*закрыт/i.test(
      snapshot.note ?? '',
    )
    // Okhta-style: only seasonal presale while day tariffs are closed — never bare «от N ₽».
    if (dayClosed) {
      return `предпродажа · сезон от ${minPriceLabel(pick).toLocaleString('ru-RU')} ₽`
    }
    return `сезон от ${minPriceLabel(pick).toLocaleString('ru-RU')} ₽`
  }

  return 'цены уточняйте'
}

const SCRAPER_NOTE_MARKERS =
  /playwright|\/ssr\b|\bssr\b|snapshot:|github actions|дождаться успешного|не live|status:\s*unavailable|status unavailable/i

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

/** Hide scrape-internal price footnotes from the public detail page. */
export function publicPriceNote(note: string | null | undefined): string | null {
  if (!note?.trim()) return null
  if (SCRAPER_NOTE_MARKERS.test(note)) return null
  return note.trim()
}

export function truncateText(text: string, max = 96): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

/**
 * Normalize accidental /en/ paths in user-visible Russian copy.
 * Raw URLs are turned into hyperlinks by LinkedText / ExternalLink — not shown as slash text.
 */
export function localizePublicText(text: string): string {
  return text
    .replace(/https?:\/\/igora\.ru\/en\/working-hours\/?/gi, 'https://igora.ru/working-hours/')
    .replace(/\/en\/working-hours/gi, '/working-hours')
}

const IMPORTANT_CHROME_IDS = new Set(['mvp-data-note', 'map-note'])

export function operationalImportant(items: ImportantItem[]): ImportantItem[] {
  const deduped: ImportantItem[] = []
  const seenResortWarn = new Set<string>()

  const sorted = [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1
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
