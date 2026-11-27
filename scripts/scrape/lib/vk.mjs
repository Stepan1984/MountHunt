/**
 * Public VK community wall helpers (HTML SSR — no API token / secrets).
 * Prefer `fetchUrlResult(url, { userAgent: VK_FETCH_UA })` — default bot UA gets an empty SPA shell.
 */
import { cleanText, loadHtml, ruDateLabelToIso } from './parse.mjs'

/**
 * @typedef {{ id: string, ownerId: string, postId: string, url: string, text: string, publishedAt: string | null }} VkPost
 */

/**
 * «26-11-2026» / «26.11.2026» → ISO date at UTC midnight.
 * @param {string} label
 */
function vkDateLabelToIso(label) {
  const raw = cleanText(label)
  const iso = ruDateLabelToIso(raw.replace(/-/g, '.'))
  if (iso) return iso
  const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/)
  if (!m) return null
  return ruDateLabelToIso(`${m[1]}.${m[2]}.${m[3]}`)
}

/**
 * Strip tags from a post_text SSR chunk (stop before footer / next post chrome).
 * @param {string} inner
 */
function extractPostTextHtml(inner) {
  const cut = inner.split(
    /data-testid="post_footer|data-testid="post_date_block|data-testid="post"|class="vkuiSeparator/i,
  )[0]
  return cleanText(
    cut
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Parse posts from a vk.com/<screen> (or wall) HTML page with SSR content.
 * @param {string} html
 * @returns {VkPost[]}
 */
export function parseVkCommunityHtml(html) {
  if (!html) return []
  /** @type {VkPost[]} */
  const out = []
  const seen = new Set()

  const postIds = [...html.matchAll(/data-post-id="(-?\d+_\d+)"/g)].map((m) => m[1])
  const uniqueIds = [...new Set(postIds)]

  // Dates appear as «DD-MM-YYYY» near data-testid="post_date_block_preview".
  const dateLabels = [...html.matchAll(/data-testid="post_date_block_preview"[^>]*>\s*([\d./-]+)/g)].map(
    (m) => cleanText(m[1]),
  )

  const textChunks = []
  for (const m of html.matchAll(/data-testid="post_text"[^>]*>/g)) {
    const chunk = html.slice(m.index + m[0].length, m.index + m[0].length + 6000)
    const text = extractPostTextHtml(chunk)
    if (text && text.length >= 8) textChunks.push(text)
  }

  const n = Math.min(uniqueIds.length, textChunks.length)
  for (let i = 0; i < n; i++) {
    const fullId = uniqueIds[i]
    if (seen.has(fullId)) continue
    seen.add(fullId)
    const [ownerId, postId] = fullId.split('_')
    if (!ownerId || !postId) continue
    const text = textChunks[i]
    const publishedAt = dateLabels[i] ? vkDateLabelToIso(dateLabels[i]) : null
    out.push({
      id: fullId,
      ownerId,
      postId,
      url: `https://vk.com/wall${ownerId}_${postId}`,
      text,
      publishedAt,
    })
  }

  // Fallback: cheerio walk when regex pairing fails but post_text nodes exist.
  if (!out.length && textChunks.length) {
    const $ = loadHtml(html)
    const nodes = $('[data-testid="post_text"]')
    nodes.each((i, el) => {
      if (i >= uniqueIds.length) return
      const fullId = uniqueIds[i]
      if (!fullId || seen.has(fullId)) return
      const text = cleanText(
        $(el)
          .html()
          ?.replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ' ') || $(el).text(),
      )
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
      if (!text || text.length < 8) return
      seen.add(fullId)
      const [ownerId, postId] = fullId.split('_')
      out.push({
        id: fullId,
        ownerId,
        postId,
        url: `https://vk.com/wall${ownerId}_${postId}`,
        text,
        publishedAt: dateLabels[i] ? vkDateLabelToIso(dateLabels[i]) : null,
      })
    })
  }

  return out
}

/**
 * Normalize a community screen name from a vk.com URL or raw slug.
 * @param {string} urlOrSlug
 */
export function vkScreenFromUrl(urlOrSlug) {
  const s = cleanText(urlOrSlug)
  if (!s) return null
  const m = s.match(/vk\.com\/(?:public|club)?([A-Za-z0-9._]+)/i) || s.match(/^([A-Za-z0-9._]+)$/)
  if (!m) return null
  const screen = m[1].replace(/^public/i, '').replace(/^club(?=\d)/i, 'club')
  if (/^(feed|login|wall)$/i.test(screen)) return null
  return screen
}

/**
 * @param {string} screen
 */
export function vkCommunityUrl(screen) {
  return `https://vk.com/${screen}`
}
