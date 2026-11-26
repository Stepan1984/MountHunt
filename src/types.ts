export type ResortStatus = 'active' | 'unclear' | 'closed'

/**
 * In-resort amenity (щётки, подушка и т.п.) — section on the resort page,
 * never a separate catalog resort.
 */
export type ResortFeature = {
  id: string
  title: string
  /** Short visitor blurb (plain Russian). */
  summary: string
  /** e.g. «Круглый год», «Лето / межсезонье». */
  season?: string
  hoursSummary?: string
  periods?: { days: string; open: string; close: string }[]
  /** Feature-specific tariffs (flat rows). */
  prices?: { title: string; price: number | null; unit?: string; note?: string }[]
  sourceUrl?: string
  /** Russian link label; falls back to linkLabelForUrl(sourceUrl). */
  sourceLabel?: string
  phone?: string
  note?: string
}

/** Optional single hero photo on the resort detail page (licensed source). */
export type ResortPhoto = {
  /** Filename under `public/photos/resorts/`. */
  file: string
  /** Russian alt text for the image. */
  alt: string
  /** Photographer / rights holder (for on-page credit). */
  credit: string
  /** Short license label, e.g. «CC BY 4.0», «CC0», «Public domain». */
  license: string
  /** Canonical source page (usually Wikimedia Commons file page). */
  sourceUrl: string
}

export type Resort = {
  id: string
  name: string
  /** Full address / locality for the Location section (single place). */
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
  /** Visitor contacts — own «Контакты» block; never mix into prices notes. */
  phone?: string | null
  email?: string | null
  prices_format: string
  prices_url?: string
  status: ResortStatus
  notes: string
  sources: string[]
  /**
   * Exactly one optional detail-page hero photo when a verified licensed
   * image of this place shows snowy operating slopes; omit otherwise.
   */
  photo?: ResortPhoto
  /**
   * Extra on-site spots (brushes, jump cushion, …) shown as sections
   * on this resort’s page — not separate map/list entries.
   */
  features?: ResortFeature[]
}

export type HoursSnapshot = {
  resortId: string
  scrapedAt: string | null
  sourceUrl: string | null
  summary: string
  periods?: { days: string; open: string; close: string }[]
  status: 'ok' | 'partial' | 'failed' | 'pending'
  /**
   * Alpine slopes open/closed from scrape detectors.
   * true → badge «Склоны открыты»; false/omit → do not invent open
   * (щётки / подушка are not alpine — stay in summary, not this flag).
   */
  slopesOpen?: boolean
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
  /**
   * News / schedule / page publication date from the source (shown on cards).
   * Prefer over scrape time — never display scrape stamps on Important cards.
   */
  publishedAt?: string | null
  /** Scrape/write stamp (internal / sort fallback). Not shown on Important cards. */
  updatedAt: string
  sourceUrl?: string
}

export type Meta = {
  updatedAt: string
  source: string
  note?: string
  /** Last successful «Важное» scrape (hourly job). */
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
