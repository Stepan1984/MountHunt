/**
 * Pure card-sort tier ranking (mirrors src/lib/resort-card-sort.ts).
 * Keep in sync with the TypeScript helper used by HomePage.
 */

/**
 * @param {string | null | undefined} slopesBadge
 * @param {string | null | undefined} seasonBadge
 * @returns {0 | 1 | 2}
 */
export function resortCardSortTier(slopesBadge, seasonBadge) {
  if (slopesBadge === 'Склоны открыты') return 0
  if (seasonBadge) return 1
  return 2
}

/**
 * Stable sort by tier; preserves relative order within a tier via index.
 * @template {{ id?: string }} T
 * @param {T[]} items
 * @param {(item: T) => { slopesBadge?: string | null, seasonBadge?: string | null }} badgesFor
 * @returns {T[]}
 */
export function sortByResortCardTiers(items, badgesFor) {
  const decorated = items.map((item, index) => {
    const { slopesBadge = null, seasonBadge = null } = badgesFor(item) || {}
    return {
      item,
      index,
      tier: resortCardSortTier(slopesBadge, seasonBadge),
    }
  })
  decorated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.index - b.index
  })
  return decorated.map((d) => d.item)
}
