/**
 * Live resort card tags from public/data/card-tags.json (scrape/CI written).
 * Keep taxonomy / Krasnoe season block in sync with scripts/scrape/lib/card-tags.mjs.
 */

export type CardTagKind = 'event' | 'closure' | 'warning' | 'season_start' | 'season_open'

export type CardTag = {
  id: string
  kind: CardTagKind
  /** Fixed Ru label from taxonomy — never free-form model text. */
  label: string
  severity: 'info' | 'warn'
  sourceItemIds?: string[]
  expiresAt?: string | null
  updatedAt?: string
}

export type CardTagsDocument = {
  updatedAt: string
  mode: 'rules' | 'llm' | 'fixture'
  resorts: Record<string, CardTag[]>
}

/** Krasnoe: never show season-start / season-open while opening is postponed. */
const SEASON_TAG_IDS = new Set(['season.start', 'season.open'])
const SEASON_BLOCKED_RESORTS = new Set(['krasnoe-ozero'])

export function liveCardTagsForResort(
  doc: CardTagsDocument | null | undefined,
  resortId: string,
  now: Date = new Date(),
): CardTag[] {
  const list = doc?.resorts?.[resortId]
  if (!Array.isArray(list)) return []
  const nowMs = now.getTime()
  return list.filter((tag) => {
    if (!tag?.id || !tag?.label) return false
    if (SEASON_BLOCKED_RESORTS.has(resortId) && SEASON_TAG_IDS.has(tag.id)) return false
    if (SEASON_TAG_IDS.has(tag.id) && SEASON_BLOCKED_RESORTS.has(resortId)) return false
    if (!tag.expiresAt) return true
    const exp = Date.parse(tag.expiresAt)
    return !Number.isFinite(exp) || exp > nowMs
  })
}

/** CSS modifier for a card tag badge. */
export function cardTagBadgeClass(tag: Pick<CardTag, 'kind' | 'severity'>): string {
  if (tag.kind === 'event') return 'badge badge--event'
  if (tag.kind === 'closure' || tag.severity === 'warn') return 'badge badge--warn'
  return 'badge badge--info'
}
