/**
 * Shared Telegram / VK channel → «Важное» / news cards for all resorts.
 * Prefer existing t.me/s HTML + VK SSR patterns; fail-soft per source.
 */
import { fetchUrlResult, sleep, VK_FETCH_UA } from './http.mjs'
import {
  IMPORTANT_NEWS_MAX_AGE_DAYS,
  importantItem,
  isFreshPublishedAt,
} from './important.mjs'
import { dedupeImportantNewsItems, isNewsCollision, normalizeNewsUrl } from './news-dedupe.mjs'
import { cleanText } from './parse.mjs'
import { isDuplicateOfSiteNews, parseTelegramChannelHtml } from './telegram.mjs'
import { parseVkCommunityHtml, vkCommunityUrl } from './vk.mjs'

export { dedupeImportantNewsItems, isNewsCollision, normalizeNewsUrl }

/** Cap channel-derived cards per source (TG or VK) per scrape. */
export const CHANNEL_NEWS_LIMIT = 5

/**
 * Official TG / VK screens from seed `community_links` (active resorts).
 * `skipTelegram: true` — resort already has a specialized TG detector.
 * @type {readonly {
 *   resortId: string,
 *   name: string,
 *   telegram?: string | null,
 *   vk?: string | null,
 *   skipTelegram?: boolean,
 *   idPrefix: string,
 * }[]}
 */
export const RESORT_CHANNEL_SOURCES = Object.freeze([
  {
    resortId: 'okhta-park',
    name: 'Охта-Парк',
    telegram: 'OhtaPark',
    vk: 'ohtapark',
    idPrefix: 'okhta',
  },
  {
    resortId: 'igora',
    name: 'Игора',
    telegram: 'igora_kurort',
    vk: 'igora_kurort',
    idPrefix: 'igora',
  },
  {
    resortId: 'tuutari-park',
    name: 'Туутари-парк',
    telegram: null,
    vk: 'tyytari_activity',
    idPrefix: 'tuutari',
  },
  {
    resortId: 'krasnoe-ozero',
    name: 'Красное озеро',
    telegram: 'redlakeclub',
    vk: 'redlakeclub',
    skipTelegram: true,
    idPrefix: 'krasnoe',
  },
  {
    resortId: 'zolotaya-dolina',
    name: 'Золотая Долина',
    telegram: 'zoldoll',
    vk: 'zoldol_official',
    idPrefix: 'zoldol',
  },
  {
    resortId: 'snezhny',
    name: 'Снежный',
    telegram: 'kurort_snegny',
    vk: 'kurort_snegny',
    idPrefix: 'snezhny',
  },
  {
    resortId: 'severny-sklon',
    name: 'Северный склон',
    telegram: 'sev_sklon',
    vk: 'ssklon',
    idPrefix: 'severny',
  },
  {
    resortId: 'puhtolova-gora',
    name: 'Пухтолова гора',
    telegram: null,
    vk: 'club313388',
    idPrefix: 'puhtolova',
  },
  {
    resortId: 'yukki',
    name: 'Юкки',
    telegram: null,
    vk: 'skyukki',
    idPrefix: 'yukki',
  },
  {
    resortId: 'lazurnye-ozera',
    name: 'Лазурные озёра',
    telegram: 'lazoorsnow',
    vk: 'lazurnyi_spb',
    idPrefix: 'lazurnye',
  },
  {
    resortId: 'drop-park',
    name: 'Drop Park',
    telegram: 'dropsnowpark',
    vk: null,
    idPrefix: 'drop',
  },
  {
    resortId: 'putilovo-park',
    name: 'Спортпарк Путилово',
    telegram: 'SPORTPARKPUTILOVO',
    vk: null,
    skipTelegram: true,
    idPrefix: 'putilovo',
  },
])

/**
 * Managed id prefixes for channel cards (`{prefix}-tg-`, `{prefix}-vk-`).
 * @returns {Readonly<Record<string, readonly string[]>>}
 */
export function channelManagedPrefixes() {
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const src of RESORT_CHANNEL_SOURCES) {
    const list = out[src.resortId] || (out[src.resortId] = [])
    if (src.telegram && !src.skipTelegram) list.push(`${src.idPrefix}-tg-`)
    if (src.vk) list.push(`${src.idPrefix}-vk-`)
    // Krasnoe VK uses krasnoe-vk- alongside existing krasnoe-tg-.
    if (src.resortId === 'krasnoe-ozero' && src.vk) {
      if (!list.includes('krasnoe-vk-')) list.push('krasnoe-vk-')
    }
  }
  return Object.freeze(
    Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.freeze([...new Set(v)])])),
  )
}

/**
 * Shared include filter (schedule / season / slopes / lifts / contests).
 * Mirrors Krasnoe TG relevance without resort-specific promo rules.
 * @param {string} text
 */
export function resortChannelPostRelevant(text) {
  const t = cleanText(text)
  if (!t || t.length < 12) return false

  const giveaway = /розыгрыш|разыгрыва\w*|разыграем/i.test(t)
  const competition =
    /соревнован\w*|чемпионат|кубок\b|контест\w*|конкурс\w*(?:\s+\w+){0,3}\s+(?:по|среди|на)\b/i.test(
      t,
    )
  const schedule =
    /график\s+работ|режим\s+работ|расписан\w*|час[ыа]?\s+работ|работаем\s+с\s+\d|с\s+\d{1,2}:\d{2}\s*(?:[-–—]|до)\s*\d{1,2}:\d{2}/i.test(
      t,
    )
  const seasonSlope =
    /открываемс|открываем\s+сезон|открываем.{0,60}склон|открытие\s+сезон|стартует\s+(?:\S+\s+){0,2}сезон|сезон\s+стартует|сезон\s+(?:20\d{2}\s*[–\-/]\s*20\d{2}\s+)?(?:открыт|закрыт|закончен|стартует)|открыт[аы]?\s+(?:сезон|склон|трасс|второй\s+склон)|склон[ыа]?\s+(?:открыт|закрыт)|трасс[ыа]?\s+(?:открыт|закрыт)|закрыт[аы]?\s+до\s+сезон|закрытие\s+сезон|запускаем.{0,80}трасс|горнолыжн\w+\s+сезон\s+открыт|межсезонь/i.test(
      t,
    )
  const lift =
    /подъ[её]мник\w*.{0,40}(?:закрыт|открыт|не\s+работает|работает)|(?:закрыт|открыт|не\s+работает)\w*.{0,40}подъ[её]мник|канат\w*.{0,30}(?:открыт|закрыт|работает)/i.test(
      t,
    )

  if (!(giveaway || competition || schedule || seasonSlope || lift)) return false

  const promoOnly =
    /успей\s+забронировать|бронирован\w+\s+коттедж|ищем\s+партн|pet-friendly|новогодн\w+\s+банкет|скидка\s*-?\s*\d+\s*%|тариф\s+«|спа-комплекс|ohtakai/i.test(
      t,
    )
  if (promoOnly && !(giveaway || competition || schedule || lift || /склон|сезон\s+открыт|открываемс/i.test(t))) {
    return false
  }

  return true
}

/**
 * @param {string} text
 * @returns {'info' | 'warn'}
 */
function channelSeverity(text) {
  if (
    /график\s+работ|режим\s+работ|закрыт|не\s+работает|межсезонь|сезон\s+закончен/i.test(text) &&
    !/розыгрыш|соревнован|открытие\s+сезон|сезон\s+открыт|открываемс|стартует\s+(?:\S+\s+){0,2}сезон/i.test(
      text,
    )
  ) {
    return 'warn'
  }
  return 'info'
}

/**
 * @param {string} text
 * @param {string} resortName
 */
export function channelTitleBody(text, resortName) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => cleanText(l))
    .filter(Boolean)
  let title = (lines[0] || cleanText(text)).trim()
  title = title
    .replace(/^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*)+/gu, '')
    .replace(/(?:\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⤵️👇⬇️⬅➡]+)+$/gu, '')
    .trim()
  if (title.length > 140) title = `${title.slice(0, 137).trim()}…`
  const name = cleanText(resortName)
  if (name && !title.toLowerCase().includes(name.split(/\s+/)[0].toLowerCase())) {
    title = `${name}: ${title}`
  }
  const bodyRaw = lines.slice(1).join(' ') || cleanText(text)
  let body = cleanText(bodyRaw)
  if (body.length > 420) body = `${body.slice(0, 417).trim()}…`
  return { title, body }
}

/**
 * @param {{ text: string, url: string, publishedAt?: string | null, postId: string }[]} posts
 * @param {{
 *   resortId: string,
 *   resortName: string,
 *   idPrefix: string,
 *   sourceKind: 'tg' | 'vk',
 *   siteNewsTexts?: string[],
 *   maxAgeDays?: number,
 *   limit?: number,
 * }} opts
 */
export function detectChannelNewsFromPosts(posts, opts) {
  const siteTexts = opts.siteNewsTexts || []
  const maxAgeDays = opts.maxAgeDays ?? IMPORTANT_NEWS_MAX_AGE_DAYS
  const limit = opts.limit ?? CHANNEL_NEWS_LIMIT
  /** @type {object[]} */
  const items = []

  for (const post of posts) {
    if (items.length >= limit) break
    if (!resortChannelPostRelevant(post.text)) continue
    if (post.publishedAt && !isFreshPublishedAt(post.publishedAt, maxAgeDays)) continue
    if (isDuplicateOfSiteNews(post.text, siteTexts)) continue

    const { title, body } = channelTitleBody(post.text, opts.resortName)
    items.push(
      importantItem({
        id: `${opts.idPrefix}-${opts.sourceKind}-${post.postId}`,
        resortId: opts.resortId,
        title,
        body,
        severity: channelSeverity(post.text),
        sourceUrl: post.url,
        ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
      }),
    )
  }

  return items
}

/**
 * @param {string} tgHtml
 * @param {object} opts
 */
export function detectChannelNewsFromTelegram(tgHtml, opts) {
  const posts = parseTelegramChannelHtml(tgHtml)
  const ordered = [...posts].reverse()
  return detectChannelNewsFromPosts(
    ordered.map((p) => ({
      text: p.text,
      url: p.url,
      publishedAt: p.publishedAt,
      postId: p.postId,
    })),
    { ...opts, sourceKind: 'tg' },
  )
}

/**
 * @param {string} vkHtml
 * @param {object} opts
 */
export function detectChannelNewsFromVk(vkHtml, opts) {
  const posts = parseVkCommunityHtml(vkHtml)
  return detectChannelNewsFromPosts(
    posts.map((p) => ({
      text: p.text,
      url: p.url,
      publishedAt: p.publishedAt,
      postId: p.postId,
    })),
    { ...opts, sourceKind: 'vk' },
  )
}

/**
 * Fetch TG and/or VK for one resort. Fail-soft per source.
 * @param {(typeof RESORT_CHANNEL_SOURCES)[number]} src
 * @param {{ siteNewsTexts?: string[], skipTelegram?: boolean }} [opts]
 * @returns {Promise<{ items: object[], clearPrefixes: boolean, tgFetched: boolean, vkFetched: boolean }>}
 */
export async function fetchResortChannelNews(src, opts = {}) {
  /** @type {object[]} */
  const items = []
  let tgFetched = false
  let vkFetched = false
  const skipTg = opts.skipTelegram ?? src.skipTelegram
  const siteNewsTexts = opts.siteNewsTexts || []

  if (src.telegram && !skipTg) {
    try {
      const url = `https://t.me/s/${src.telegram}`
      const { body } = await fetchUrlResult(url)
      tgFetched = true
      items.push(
        ...detectChannelNewsFromTelegram(body, {
          resortId: src.resortId,
          resortName: src.name,
          idPrefix: src.idPrefix,
          siteNewsTexts,
        }),
      )
    } catch {
      tgFetched = false
    }
  }

  if (src.vk) {
    if (src.telegram && !skipTg) await sleep()
    try {
      const url = vkCommunityUrl(src.vk)
      const { body } = await fetchUrlResult(url, { userAgent: VK_FETCH_UA })
      vkFetched = true
      const existingTexts = [
        ...siteNewsTexts,
        ...items.map((i) => `${i.title || ''} ${i.body || ''}`),
      ]
      items.push(
        ...detectChannelNewsFromVk(body, {
          resortId: src.resortId,
          resortName: src.name,
          idPrefix: src.idPrefix,
          siteNewsTexts: existingTexts,
        }),
      )
    } catch {
      vkFetched = false
    }
  }

  const expectedTg = Boolean(src.telegram && !skipTg)
  const expectedVk = Boolean(src.vk)
  const clearPrefixes =
    (!expectedTg || tgFetched) && (!expectedVk || vkFetched)

  return { items, clearPrefixes, tgFetched, vkFetched }
}
