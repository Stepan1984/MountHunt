/**
 * Cross-source news collision / near-duplicate helpers (URL + text).
 */
import { cleanText } from './parse.mjs'
import { normalizeNewsText } from './telegram.mjs'

/**
 * Canonical URL for collision checks (strip query/hash, lowercase host).
 * @param {string | null | undefined} url
 */
export function normalizeNewsUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.host.toLowerCase()}${path}`
  } catch {
    return cleanText(url).toLowerCase()
  }
}

/**
 * @param {string} a
 * @param {string} b
 */
function jaccardWords(a, b) {
  const wa = new Set(a.split(' ').filter((w) => w.length > 2))
  const wb = new Set(b.split(' ').filter((w) => w.length > 2))
  if (!wa.size || !wb.size) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

/**
 * Source preference: site > Telegram > VK > unknown (lower wins).
 * @param {object} item
 */
function sourceRank(item) {
  const url = String(item.sourceUrl || '')
  if (/t\.me\//i.test(url)) return 20
  if (/vk\.com\//i.test(url)) return 30
  if (url) return 10
  return 40
}

/**
 * @param {object} item
 */
function newsTextKey(item) {
  return normalizeNewsText(`${item.title || ''} ${item.body || ''}`)
}

/**
 * True when two news cards are the same story (URL or near-duplicate text).
 * Same resort when both have resortId; chrome/global items compared globally.
 * @param {object} a
 * @param {object} b
 */
export function isNewsCollision(a, b) {
  if (!a || !b || a.id === b.id) return false
  if (a.resortId && b.resortId && a.resortId !== b.resortId) return false

  const ua = normalizeNewsUrl(a.sourceUrl)
  const ub = normalizeNewsUrl(b.sourceUrl)
  if (ua && ub && ua === ub) return true

  const ta = newsTextKey(a)
  const tb = newsTextKey(b)
  if (!ta || !tb || ta.length < 12 || tb.length < 12) return false
  if (ta === tb) return true

  const aFirst = normalizeNewsText(String(a.title || '').slice(0, 160))
  const bFirst = normalizeNewsText(String(b.title || '').slice(0, 160))
  if (aFirst.length >= 12 && bFirst.length >= 12) {
    if (ta.includes(bFirst) || tb.includes(aFirst)) return true
    if (jaccardWords(aFirst, bFirst) >= 0.55) return true
  }
  if (
    jaccardWords(ta.split(' ').slice(0, 18).join(' '), tb.split(' ').slice(0, 18).join(' ')) >= 0.6
  ) {
    return true
  }
  return false
}

/**
 * Drop near-duplicates across sources. Keeps preferred source / newer card.
 * @param {object[]} items
 */
export function dedupeImportantNewsItems(items) {
  const list = Array.isArray(items) ? [...items] : []
  list.sort((a, b) => {
    const ra = sourceRank(a)
    const rb = sourceRank(b)
    if (ra !== rb) return ra - rb
    const pa = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const pb = b.publishedAt ? Date.parse(b.publishedAt) : 0
    if (pa !== pb) return pb - pa
    return String(a.id).localeCompare(String(b.id))
  })

  /** @type {object[]} */
  const kept = []
  for (const item of list) {
    if (!item?.id) continue
    if (kept.some((k) => isNewsCollision(k, item))) continue
    kept.push(item)
  }
  return kept
}
