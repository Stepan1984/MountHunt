/**
 * Public Telegram channel helpers (t.me/s/… HTML preview — no Bot API / secrets).
 */
import { cleanText, loadHtml } from './parse.mjs'

/**
 * @typedef {{ id: string, channel: string, postId: string, url: string, text: string, publishedAt: string | null }} TelegramPost
 */

/**
 * Parse posts from a t.me/s/<channel> HTML page.
 * @param {string} html
 * @returns {TelegramPost[]}
 */
export function parseTelegramChannelHtml(html) {
  if (!html) return []
  const $ = loadHtml(html)
  /** @type {TelegramPost[]} */
  const out = []
  const seen = new Set()

  $('.tgme_widget_message[data-post]').each((_, el) => {
    const dataPost = cleanText($(el).attr('data-post') || '')
    const m = dataPost.match(/^([^/]+)\/(\d+)$/)
    if (!m) return
    const channel = m[1]
    const postId = m[2]
    const id = `${channel}/${postId}`
    if (seen.has(id)) return
    seen.add(id)

    const classes = String($(el).attr('class') || '')
    // Video notes («кружочки»): skip even if a caption appears later — preference.
    if (
      /roundvideo/i.test(classes) ||
      $(el).find('.tgme_widget_message_roundvideo, .tgme_widget_message_roundvideo_player').length
    ) {
      return
    }
    // Channel service rows («pinned a video/photo») are not news.
    if (/service_message/i.test(classes)) return

    const textEl = $(el).find('.tgme_widget_message_text').first()
    // Keep <br> as newlines for title/body split — do not run cleanText on the whole blob
    // (it collapses whitespace and would glue the first line to the rest).
    textEl.find('br').replaceWith('\n')
    const text = textEl
      .text()
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    if (!text || text.length < 8) return
    // Service-copy sometimes lands in a normal bubble without service_message class.
    if (/^[A-Za-z0-9_]+\s+pinned a (?:video|photo|message)\b/i.test(text)) return

    const dt =
      $(el).find('time[datetime]').first().attr('datetime') ||
      $(el).find('.tgme_widget_message_date time').first().attr('datetime') ||
      null
    let publishedAt = null
    if (dt) {
      const t = Date.parse(dt)
      if (Number.isFinite(t)) publishedAt = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    out.push({
      id,
      channel,
      postId,
      url: `https://t.me/${channel}/${postId}`,
      text,
      publishedAt,
    })
  })

  return out
}

/**
 * Normalize Russian text for near-duplicate checks.
 * @param {string} s
 */
export function normalizeNewsText(s) {
  return cleanText(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„“”]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
 * True when a Telegram post is the same story as a site news title/descr.
 * @param {string} postText
 * @param {string[]} siteTexts
 */
export function isDuplicateOfSiteNews(postText, siteTexts) {
  const postNorm = normalizeNewsText(postText)
  if (!postNorm || !siteTexts?.length) return false
  const postFirst = normalizeNewsText(postText.split('\n')[0] || postText.slice(0, 160))

  for (const raw of siteTexts) {
    const site = normalizeNewsText(raw)
    if (site.length < 10) continue
    if (postNorm.includes(site) || site.includes(postFirst)) return true
    if (postFirst.length >= 12 && site.includes(postFirst)) return true
    if (jaccardWords(postFirst, site) >= 0.55) return true
    // First ~12 significant words of the post vs title.
    if (jaccardWords(postNorm.split(' ').slice(0, 14).join(' '), site) >= 0.6) return true
  }
  return false
}
