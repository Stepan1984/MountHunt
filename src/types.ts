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

export type PriceSnapshot = {
  resortId: string
  scrapedAt: string | null
  sourceUrl: string | null
  currency: 'RUB'
  items: PriceItem[]
  status: 'ok' | 'partial' | 'failed' | 'pending'
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
}

export type SiteData = {
  resorts: Resort[]
  hours: HoursSnapshot[]
  prices: PriceSnapshot[]
  important: ImportantItem[]
  meta: Meta
}
