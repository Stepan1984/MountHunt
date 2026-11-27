/**
 * Home active-resort card order:
 * 1) slopes open
 * 2) known future season-open date badge
 * 3) not yet open / closed
 *
 * Uses the same badge helpers as ResortCard so list order matches UI.
 * Keep ranking rules in sync with scripts/scrape/lib/resort-card-sort.mjs.
 */

import { hoursFor, slopesBadgeLabel } from './data'
import { seasonOpenBadgeLabel } from './season-open-badge'
import type { HoursSnapshot, ImportantItem, Resort } from '../types'

/** Lower sorts earlier. */
export type ResortCardSortTier = 0 | 1 | 2

export function resortCardSortTier(
  slopesBadge: string | null | undefined,
  seasonBadge: string | null | undefined,
): ResortCardSortTier {
  if (slopesBadge === 'Склоны открыты') return 0
  if (seasonBadge) return 1
  return 2
}

/**
 * Stable sort of active (or any) resorts for the home card list.
 * Inactive / secondary lists are unchanged by callers.
 */
export function sortResortsForCards(
  resorts: Resort[],
  hours: HoursSnapshot[],
  important: ImportantItem[],
  now: Date = new Date(),
): Resort[] {
  const decorated = resorts.map((resort, index) => {
    const inactive = resort.status !== 'active'
    const h = hoursFor(resort.id, hours)
    const slopesBadge = !inactive ? slopesBadgeLabel(resort.id, h, important) : null
    const seasonBadge = !inactive ? seasonOpenBadgeLabel(resort.id, important, now) : null
    return {
      resort,
      index,
      tier: resortCardSortTier(slopesBadge, seasonBadge),
    }
  })
  decorated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.index - b.index
  })
  return decorated.map((d) => d.resort)
}
