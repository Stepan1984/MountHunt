export type ResortStatus = 'active' | 'unclear' | 'closed'

export type Resort = {
  id: string
  name: string
  area: string
  city_or_district: string
  lat: number | null
  lon: number | null
  coords_precision?: string
  website: string | null
  webcam_url: string | null
  /** Direct player URLs (iframe/HLS/MJPEG). Page links stay in webcam_url. */
  webcam_embeds?: string[]
  community_links?: string[]
  prices_format: string
  prices_url?: string
  status: ResortStatus
  notes: string
  sources: string[]
}

export type HoursSnapshot = {
  resortId: string
  scrapedAt: string | null
  sourceUrl: string | null
  summary: string
  periods?: { days: string; open: string; close: string }[]
  status: 'ok' | 'partial' | 'failed' | 'pending'
}

export type PriceItem = {
  title: string
  price: number | null
  unit?: string
  note?: string
  rawText?: string
}

/** One cell in a structured skipass table. */
export type SkipassPriceCell = {
  price: number | null
  note?: string
  rawText?: string
}

/**
 * One row in a skipass group: name + optional duration/rides + prices
 * aligned with the parent group's columns.
 */
export type SkipassRow = {
  name: string
  /** Hours / rides / season window, e.g. «2 часа», «10 проходов». */
  duration?: string
  prices: SkipassPriceCell[]
  note?: string
}

/**
 * Site-derived skipass block (hourly / per-ride / season).
 * Prefer real section titles from the resort site — do not invent categories.
 */
export type SkipassGroup = {
  category: string
  /** Column headers after name/duration, e.g. «Будни», «Выходные», «Базовый». */
  columns: string[]
  rows: SkipassRow[]
  note?: string
}

export type PriceSnapshot = {
  resortId: string
  scrapedAt: string | null
  sourceUrl: string | null
  currency: 'RUB'
  /** Flat list for cards / fail-soft UI when groups are absent. */
  items: PriceItem[]
  /** Structured tables when the site splits skipasses by category. */
  groups?: SkipassGroup[]
  status: 'ok' | 'partial' | 'failed' | 'pending' | 'unavailable'
  note?: string
}

export type ImportantItem = {
  id: string
  resortId?: string
  title: string
  body?: string
  severity: 'info' | 'warn'
  updatedAt: string
  sourceUrl?: string
}

export type Meta = {
  updatedAt: string
  source: string
  note?: string
  /** Last successful «Важное» scrape (2h job). */
  importantScrapedAt?: string
  importantNote?: string
}

export type SiteData = {
  resorts: Resort[]
  hours: HoursSnapshot[]
  prices: PriceSnapshot[]
  important: ImportantItem[]
  meta: Meta
}
