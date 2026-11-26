/**
 * Shared «Важное» helpers: detectors + fail-soft merge for hourly / daily scrapes.
 * Prefs: only site «Важное» as the notification surface (no email/Telegram push).
 * Official resort pages may still announce season status (e.g. Okhta opening).
 *
 * Cards show publishedAt (news / schedule / page date from the source).
 * Scrape time lives on meta.importantScrapedAt (freshness), not on cards.
 */
import { cleanText, httpDateToIso, loadHtml, nowIso, ruDateLabelToIso } from './parse.mjs'
import {
  isDuplicateOfSiteNews,
  parseTelegramChannelHtml,
} from './telegram.mjs'

/** Stable ids owned by automated important scrapers (cleared when a check succeeds without them). */
export const MANAGED_IMPORTANT_IDS = Object.freeze({
  'zolotaya-dolina': Object.freeze(['zoldol-slopes-closed']),
  'lazurnye-ozera': Object.freeze(['lazurnye-season-closed', 'lazurnye-season-open']),
  'krasnoe-ozero': Object.freeze(['krasnoe-slopes-closed']),
  'okhta-park': Object.freeze(['okhta-season-open', 'okhta-presale']),
  'tuutari-park': Object.freeze(['tuutari-season-prep', 'tuutari-season-open']),
  snezhny: Object.freeze(['snezhny-hours-notice']),
  'drop-park': Object.freeze(['drop-off-season']),
  'puhtolova-gora': Object.freeze(['puhtolova-season-open']),
})

/**
 * Dynamic managed id prefixes (e.g. Telegram posts). Cleared on successful scrape
 * unless the result sets `clearPrefixes: false` (TG fetch failed — keep previous cards).
 */
export const MANAGED_IMPORTANT_PREFIXES = Object.freeze({
  'krasnoe-ozero': Object.freeze(['krasnoe-tg-']),
})

/** Max age for dated news cards used as «Важное» (stale season-open posts drop out). */
export const IMPORTANT_NEWS_MAX_AGE_DAYS = 60

/** Cap Telegram-derived Krasnoe cards per scrape. */
export const KRASNOE_TG_IMPORTANT_LIMIT = 5

/**
 * @param {string | null | undefined} iso
 * @param {number} [maxAgeDays]
 */
export function isFreshPublishedAt(iso, maxAgeDays = IMPORTANT_NEWS_MAX_AGE_DAYS) {
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  return Date.now() - t <= maxAgeDays * 86_400_000
}

/**
 * Parse «DD.MM.YYYY Title…» news listing blocks (Bitrix / WP / custom).
 * @param {string} text
 * @returns {{ dateLabel: string, publishedAt: string, title: string }[]}
 */
export function parseDatedNewsItems(text) {
  const t = cleanText(text)
  if (!t) return []
  const re = /(\d{1,2}\.\d{1,2}\.\d{2,4})\s+(.+?)(?=\d{1,2}\.\d{1,2}\.\d{2,4}|$)/gs
  /** @type {{ dateLabel: string, publishedAt: string, title: string }[]} */
  const out = []
  let m
  while ((m = re.exec(t))) {
    const dateLabel = m[1]
    const publishedAt = ruDateLabelToIso(dateLabel)
    if (!publishedAt) continue
    const title = cleanText(m[2]).slice(0, 220)
    if (title.length < 8) continue
    out.push({ dateLabel, publishedAt, title })
  }
  return out
}

const OKHTA_MONTHS = Object.freeze({
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
})

/**
 * @param {string} text
 * @returns {boolean}
 */
export function okhtaSeasonOpenMatch(text) {
  const t = cleanText(text)
  if (!t) return false
  return (
    /горнолыжный\s+сезон\s+открыт/i.test(t) ||
    /сезон\s+открыт/i.test(t) ||
    /открытие\s+\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i.test(
      t,
    ) ||
    /открыт\s+первый\s+склон/i.test(t) ||
    /будет\s+открыт\s+первый\s+склон/i.test(t) ||
    /открываем\s+(?:горнолыжный\s+)?склон/i.test(t) ||
    /стартует\s+сезон/i.test(t) ||
    /сезон\s+20\d{2}\s*[–\-—]\s*20\d{2}\s+стартует/i.test(t)
  )
}

/**
 * Prefer lenta <time datetime> near an opening post; else «Открытие N месяца»; else HTTP.
 * @param {string} lentaHtml
 * @param {string} trailsHtml
 * @param {{ lastModified?: string | null }} [opts]
 */
function extractOkhtaOpeningPublishedAt(lentaHtml, trailsHtml, opts = {}) {
  if (lentaHtml) {
    const $ = loadHtml(lentaHtml)
    /** @type {string | null} */
    let best = null
    $('time[datetime]').each((_, el) => {
      const dt = $(el).attr('datetime')
      if (!dt) return
      const vicinity = cleanText($(el).parent().text()) || cleanText($(el).closest('div').text())
      if (!okhtaSeasonOpenMatch(vicinity)) return
      const t = Date.parse(dt)
      if (!Number.isFinite(t)) return
      const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
      if (!best || iso > best) best = iso
    })
    if (best) return best
  }

  const text = cleanText(loadHtml(`${trailsHtml || ''}\n${lentaHtml || ''}`)('body').text())
  const m = text.match(
    /(?:открытие|с)\s+(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i,
  )
  if (m) {
    const dd = Number(m[1])
    const mm = OKHTA_MONTHS[m[2].toLowerCase()]
    if (mm && dd >= 1 && dd <= 31) {
      const year = new Date().getUTCFullYear()
      return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00Z`
    }
  }

  return (
    extractPublishedAtFromHtml(lentaHtml) ||
    extractPublishedAtFromHtml(trailsHtml) ||
    httpDateToIso(opts.lastModified) ||
    null
  )
}

/**
 * Prefer article/og/time metadata from the page; ignore random schedule tables.
 * @param {string} html
 * @returns {string | null}
 */
export function extractPublishedAtFromHtml(html) {
  if (!html) return null
  const $ = loadHtml(html)
  const metas = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[property="article:modified_time"]').attr('content'),
    $('meta[property="og:updated_time"]').attr('content'),
    $('meta[name="pubdate"]').attr('content'),
    $('meta[itemprop="datePublished"]').attr('content'),
    $('meta[itemprop="dateModified"]').attr('content'),
  ]
  for (const raw of metas) {
    if (!raw) continue
    const t = Date.parse(raw)
    if (Number.isFinite(t)) return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  const dt = $('time[datetime]').first().attr('datetime')
  if (dt) {
    const t = Date.parse(dt)
    if (Number.isFinite(t)) return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  return null
}

/**
 * @param {{ id: string, resortId?: string, title: string, body?: string, severity: 'info'|'warn', sourceUrl?: string, updatedAt?: string, publishedAt?: string | null }} partial
 */
export function importantItem(partial) {
  const item = {
    id: partial.id,
    ...(partial.resortId ? { resortId: partial.resortId } : {}),
    title: partial.title,
    ...(partial.body ? { body: partial.body } : {}),
    severity: partial.severity,
    // Write/scrape stamp — not shown on Important cards.
    updatedAt: partial.updatedAt || nowIso(),
    ...(partial.sourceUrl ? { sourceUrl: partial.sourceUrl } : {}),
  }
  if (partial.publishedAt) item.publishedAt = partial.publishedAt
  return item
}

/**
 * @param {string} hoursHtml
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null }} [opts]
 */
export function detectZoldolImportant(hoursHtml, sourceUrl, opts = {}) {
  const text = cleanText(loadHtml(hoursHtml)('body').text())
  if (!/Горнолыжные склоны закрыты/i.test(text)) return []
  const publishedAt =
    extractPublishedAtFromHtml(hoursHtml) || httpDateToIso(opts.lastModified) || null
  return [
    importantItem({
      id: 'zoldol-slopes-closed',
      resortId: 'zolotaya-dolina',
      title: 'Золотая Долина: склоны закрыты',
      body: 'На странице часов работы указано, что горнолыжные склоны закрыты на летний период.',
      severity: 'warn',
      sourceUrl,
      ...(publishedAt ? { publishedAt } : {}),
    }),
  ]
}

/**
 * @param {string} homeHtml
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null }} [opts]
 */
export function detectLazurnyeImportant(homeHtml, sourceUrl, opts = {}) {
  const text = cleanText(loadHtml(homeHtml)('body').text())
  const seasonClosed =
    /Сезон\s*20\d{2}\s*закрыт/i.test(text) || /сезон.*закрыт/i.test(text)
  if (!seasonClosed) return []
  const publishedAt =
    extractPublishedAtFromHtml(homeHtml) || httpDateToIso(opts.lastModified) || null
  return [
    importantItem({
      id: 'lazurnye-season-closed',
      resortId: 'lazurnye-ozera',
      title: 'Лазурные озёра: сезон закрыт',
      body: 'На сайте курорта есть сообщение о закрытии сезона. Перед выездом проверьте актуальность.',
      severity: 'warn',
      sourceUrl,
      ...(publishedAt ? { publishedAt } : {}),
    }),
  ]
}

/**
 * Okhta «Важное»: season opening wins over leftover nav «предпродажа».
 * Accepts a single HTML string (legacy) or `{ trailsHtml, lentaHtml, homeHtml }`.
 *
 * @param {string | { trailsHtml?: string, lentaHtml?: string, homeHtml?: string }} htmlOrPages
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null, trailsUrl?: string, lentaUrl?: string, winterUrl?: string }} [opts]
 */
export function detectOkhtaImportant(htmlOrPages, sourceUrl, opts = {}) {
  const pages =
    typeof htmlOrPages === 'string'
      ? { trailsHtml: htmlOrPages, lentaHtml: '', homeHtml: '' }
      : {
          trailsHtml: htmlOrPages?.trailsHtml || '',
          lentaHtml: htmlOrPages?.lentaHtml || '',
          homeHtml: htmlOrPages?.homeHtml || '',
        }

  const trailsText = cleanText(loadHtml(pages.trailsHtml || '<body></body>')('body').text())
  const lentaText = cleanText(loadHtml(pages.lentaHtml || '<body></body>')('body').text())
  const homeText = cleanText(loadHtml(pages.homeHtml || '<body></body>')('body').text())
  const combined = [trailsText, lentaText, homeText].filter(Boolean).join('\n')

  if (okhtaSeasonOpenMatch(combined)) {
    const publishedAt = extractOkhtaOpeningPublishedAt(pages.lentaHtml, pages.trailsHtml, opts)
    const openSource =
      opts.lentaUrl && okhtaSeasonOpenMatch(lentaText)
        ? opts.lentaUrl
        : opts.trailsUrl || sourceUrl
    return [
      importantItem({
        id: 'okhta-season-open',
        resortId: 'okhta-park',
        title: 'Охта-Парк: горнолыжный сезон открыт',
        body: 'На официальных страницах курорта объявлено открытие склонов. Перед выездом сверьте часы и тарифы на сайте.',
        severity: 'info',
        sourceUrl: openSource,
        ...(publishedAt ? { publishedAt } : {}),
      }),
    ]
  }

  if (!/предпродаж/i.test(combined)) return []
  const publishedAt =
    extractPublishedAtFromHtml(pages.trailsHtml) || httpDateToIso(opts.lastModified) || null
  return [
    importantItem({
      id: 'okhta-presale',
      resortId: 'okhta-park',
      title: 'Охта-Парк: предпродажа ски-пассов',
      body: 'На сайте курорта открыта предпродажа сезонных ски-пассов. Дневные тарифы уточняйте ближе к сезону.',
      severity: 'info',
      sourceUrl: opts.winterUrl || sourceUrl,
      ...(publishedAt ? { publishedAt } : {}),
    }),
  ]
}

/**
 * Build Krasnoe «Важное» from an already-parsed schedule summary.
 * publishedAt comes from the CSV date column (news/schedule day), not scrape time.
 * @param {{ closedUntilSeason: boolean, allClosed: boolean, slopesCount: number, dateCol: string }} pack
 * @param {string} sourceUrl
 */
export function detectKrasnoeImportantFromFlags(pack, sourceUrl) {
  if (!(pack.closedUntilSeason || (pack.allClosed && pack.slopesCount))) return []
  const publishedAt = ruDateLabelToIso(pack.dateCol)
  return [
    importantItem({
      id: 'krasnoe-slopes-closed',
      resortId: 'krasnoe-ozero',
      title: 'Красное озеро: склоны закрыты до сезона',
      body: `На ${pack.dateCol} трассы и подъёмники отмечены как закрытые до сезона.`,
      severity: 'warn',
      sourceUrl,
      ...(publishedAt ? { publishedAt } : {}),
    }),
  ]
}

/**
 * Include: schedule/hours, season/slope open/close, lift changes, giveaways, competitions.
 * Skip pure ads / booking promo when they do not also match include signals.
 * @param {string} text
 */
export function krasnoeTelegramPostRelevant(text) {
  const t = cleanText(text)
  if (!t || t.length < 12) return false

  const giveaway = /розыгрыш|разыгрыва\w*|разыграем/i.test(t)
  const competition =
    /соревнован\w*|чемпионат|кубок\b|конкурс\w*(?:\s+\w+){0,3}\s+(?:по|среди|на)\b/i.test(t)
  const schedule =
    /график\s+работ|режим\s+работ|расписан\w*|час[ыа]?\s+работ|работаем\s+с\s+\d/i.test(t)
  const seasonSlope =
    /открытие\s+сезон|сезон\s+(?:20\d{2}\s*[–\-/]\s*20\d{2}\s+)?(?:открыт|закрыт|закончен)|открыт[аы]?\s+(?:сезон|склон|трасс)|склон[ыа]?\s+(?:открыт|закрыт)|трасс[ыа]?\s+(?:открыт|закрыт)|закрыт[аы]?\s+до\s+сезон|закрытие\s+сезон/i.test(
      t,
    )
  const lift =
    /подъ[её]мник\w*.{0,40}(?:закрыт|открыт|не\s+работает|работает)|(?:закрыт|открыт|не\s+работает)\w*.{0,40}подъ[её]мник/i.test(
      t,
    )

  if (!(giveaway || competition || schedule || seasonSlope || lift)) return false

  // Booking / partner fluff that only name-drops a lift or «сезон» in a promo.
  const promoOnly =
    /успей\s+забронировать|бронирован\w+\s+коттедж|ищем\s+партн|pet-friendly|новогодн\w+\s+банкет|скидка\s*-?\s*\d+\s*%/i.test(
      t,
    )
  if (promoOnly && !(giveaway || competition || schedule || lift)) return false

  return true
}

/**
 * @param {string} text
 * @returns {'info' | 'warn'}
 */
function krasnoeTelegramSeverity(text) {
  if (
    /график\s+работ|режим\s+работ|закрыт|не\s+работает|подъ[её]мник/i.test(text) &&
    !/розыгрыш|соревнован|открытие\s+сезон|сезон\s+открыт/i.test(text)
  ) {
    return 'warn'
  }
  return 'info'
}

/**
 * First non-empty line → short Russian title; rest → body.
 * @param {string} text
 */
export function krasnoeTelegramTitleBody(text) {
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
  if (!/^красн/i.test(title)) title = `Красное озеро: ${title}`
  const bodyRaw = lines.slice(1).join(' ') || cleanText(text)
  let body = cleanText(bodyRaw)
  if (body.length > 420) body = `${body.slice(0, 417).trim()}…`
  return { title, body }
}

/**
 * Krasnoe official TG (@redlakeclub / t.me/s/redlakeclub) → filtered «Важное» cards.
 * Dedupes against site news titles/descriptions when provided.
 *
 * @param {string} tgHtml
 * @param {string} sourceUrl
 * @param {{ siteNewsTexts?: string[], maxAgeDays?: number, limit?: number }} [opts]
 */
export function detectKrasnoeTelegramImportant(tgHtml, sourceUrl, opts = {}) {
  const posts = parseTelegramChannelHtml(tgHtml)
  const siteTexts = opts.siteNewsTexts || []
  const maxAgeDays = opts.maxAgeDays ?? IMPORTANT_NEWS_MAX_AGE_DAYS
  const limit = opts.limit ?? KRASNOE_TG_IMPORTANT_LIMIT
  /** @type {object[]} */
  const items = []

  // Newest first (channel HTML is usually chronological ascending).
  const ordered = [...posts].reverse()
  for (const post of ordered) {
    if (items.length >= limit) break
    if (!krasnoeTelegramPostRelevant(post.text)) continue
    if (post.publishedAt && !isFreshPublishedAt(post.publishedAt, maxAgeDays)) continue
    if (isDuplicateOfSiteNews(post.text, siteTexts)) continue

    const { title, body } = krasnoeTelegramTitleBody(post.text)
    items.push(
      importantItem({
        id: `krasnoe-tg-${post.postId}`,
        resortId: 'krasnoe-ozero',
        title,
        body,
        severity: krasnoeTelegramSeverity(post.text),
        sourceUrl: post.url || sourceUrl,
        ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
      }),
    )
  }

  return items
}

/**
 * Parse Tilda feed JSON (krasnoeozero.ru/events/news/) into plain texts for dedupe.
 * Fail-soft: bad JSON → [].
 * @param {string} jsonText
 * @returns {string[]}
 */
export function parseKrasnoeSiteNewsTexts(jsonText) {
  if (!jsonText) return []
  try {
    const data = JSON.parse(jsonText)
    const posts = Array.isArray(data?.posts) ? data.posts : []
    /** @type {string[]} */
    const out = []
    for (const p of posts) {
      const title = cleanText(p?.title || '')
      const descr = cleanText(p?.descr || p?.description || '')
      if (title) out.push(title)
      if (descr && descr.length >= 8) out.push(descr)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Tuutari: news listing — season prep («ждём морозов») or fresh opening.
 * @param {string} newsHtml
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null }} [opts]
 */
export function detectTuutariImportant(newsHtml, sourceUrl, opts = {}) {
  const text = cleanText(loadHtml(newsHtml)('body').text())
  const items = parseDatedNewsItems(text)
  const open = items.find(
    (it) =>
      isFreshPublishedAt(it.publishedAt) &&
      (/открытие\s+сезон/i.test(it.title) ||
        /открыт[ыа]?\s+(?:детский|учебный|центральный|первый).{0,40}склон/i.test(it.title) ||
        /горнолыжн\w+\s+сезон\s+открыт/i.test(it.title)),
  )
  if (open) {
    return [
      importantItem({
        id: 'tuutari-season-open',
        resortId: 'tuutari-park',
        title: 'Туутари-парк: открытие сезона',
        body: 'В официальных новостях курорта есть сообщение об открытии склонов. Перед выездом сверьте часы на сайте.',
        severity: 'info',
        sourceUrl,
        publishedAt: open.publishedAt,
      }),
    ]
  }

  const prep = items.find(
    (it) =>
      isFreshPublishedAt(it.publishedAt) &&
      (/сезон\s+20\d{2}\s*[-–—]\s*20\d{2}/i.test(it.title) ||
        /ждём?\s+первых\s+мороз/i.test(it.title) ||
        /ждем\s+первых\s+мороз/i.test(it.title) ||
        /подготовк\w+\s+к\s+(?:новому\s+)?сезон/i.test(it.title)),
  )
  if (!prep) {
    // Fallback: undated blob still carries the headline (rare).
    if (
      /сезон\s+20\d{2}\s*[-–—]\s*20\d{2}.{0,80}мороз/i.test(text) ||
      /ждём?\s+первых\s+мороз/i.test(text)
    ) {
      const publishedAt =
        extractPublishedAtFromHtml(newsHtml) || httpDateToIso(opts.lastModified) || null
      if (publishedAt && !isFreshPublishedAt(publishedAt)) return []
      return [
        importantItem({
          id: 'tuutari-season-prep',
          resortId: 'tuutari-park',
          title: 'Туутари-парк: готовимся к сезону',
          body: 'В новостях курорта — подготовка к горнолыжному сезону. Точную дату открытия уточняйте на сайте.',
          severity: 'info',
          sourceUrl,
          ...(publishedAt ? { publishedAt } : {}),
        }),
      ]
    }
    return []
  }

  return [
    importantItem({
      id: 'tuutari-season-prep',
      resortId: 'tuutari-park',
      title: 'Туутари-парк: готовимся к сезону',
      body: 'В новостях курорта — подготовка к горнолыжному сезону. Точную дату открытия уточняйте на сайте.',
      severity: 'info',
      sourceUrl,
      publishedAt: prep.publishedAt,
    }),
  ]
}

/**
 * Snezhny: fresh «режим работы склонов» / weather shortened day from news or hours post.
 * @param {string} html
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null }} [opts]
 */
export function detectSnezhnyImportant(html, sourceUrl, opts = {}) {
  const text = cleanText(loadHtml(html)('body').text())
  const publishedAt =
    extractPublishedAtFromHtml(html) ||
    (() => {
      const m = text.match(/(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s*,?\s*20\d{2})/i)
      if (!m) return null
      // WP often prints «10 декабря, 2025» near the title — not always DD.MM.YYYY.
      return httpDateToIso(opts.lastModified)
    })() ||
    httpDateToIso(opts.lastModified) ||
    null

  // Prefer dated listing items when scanning the news index.
  const dated = parseDatedNewsItems(text).find(
    (it) =>
      isFreshPublishedAt(it.publishedAt) &&
      (/режим\s+работы\s+склон/i.test(it.title) ||
        /аномально\s+тёпл/i.test(it.title) ||
        /аномально\s+тепл/i.test(it.title) ||
        /склон[ыа]?\s+закрыт/i.test(it.title) ||
        /будет\s+работать\s+до/i.test(it.title)),
  )
  if (dated) {
    return [
      importantItem({
        id: 'snezhny-hours-notice',
        resortId: 'snezhny',
        title: 'Снежный: изменение режима склонов',
        body: 'В новостях курорта есть актуальное сообщение о режиме работы склонов. Перед выездом сверьте на сайте.',
        severity: 'warn',
        sourceUrl,
        publishedAt: dated.publishedAt,
      }),
    ]
  }

  const weatherNotice =
    /аномально\s+тёпл/i.test(text) ||
    /аномально\s+тепл/i.test(text) ||
    (/режим\s+работы\s+склон/i.test(text) && /будет\s+работать\s+до/i.test(text)) ||
    (/горнолыжный\s+комплекс.{0,40}будет\s+работать\s+до/i.test(text) && /погод/i.test(text))

  if (!weatherNotice) return []
  // Without a fresh date, do not revive last-season weather posts.
  if (publishedAt && !isFreshPublishedAt(publishedAt, 21)) return []
  if (!publishedAt) return []

  return [
    importantItem({
      id: 'snezhny-hours-notice',
      resortId: 'snezhny',
      title: 'Снежный: изменение режима склонов',
      body: 'На сайте курорта есть сообщение об особом режиме работы склонов (погода). Перед выездом уточните актуальность.',
      severity: 'warn',
      sourceUrl,
      publishedAt,
    }),
  ]
}

/**
 * @param {string} text
 */
function dropParkSeasonOpenMatch(text) {
  const t = cleanText(text)
  if (!t) return false
  return (
    /сезон\s+20\d{2}\s*\/\s*20\d{2}\s+открыт/i.test(t) ||
    /горнолыжн(?:ый|ого|ому)?\s+сезон\s+открыт/i.test(t) ||
    /сезон\s+открыт/i.test(t) ||
    /сноупарк.{0,40}открыт/i.test(t) ||
    /открытие\s+сезон/i.test(t)
  )
}

/**
 * @param {string} text
 */
function dropParkOffSeasonMatch(text) {
  const t = cleanText(text)
  if (!t) return false
  return /сезон\s+[\d/]+\s+закончен/i.test(t) || /сезон\s+закрыт/i.test(t)
}

/**
 * Drop Park: official TG channel about / page — off-season until opening copy appears.
 *
 * Fail-soft: without a successful TG fetch, do not treat an empty match as
 * authoritative clear of `drop-off-season` (signal lives in TG about). Page-only
 * open/off-season text may still clear/upsert.
 *
 * @param {string | { pageHtml?: string, tgHtml?: string }} htmlOrPages
 * @param {string} sourceUrl
 * @param {{ pageUrl?: string, tgUrl?: string, lastModified?: string | null, tgFetched?: boolean, pageFetched?: boolean }} [opts]
 * @returns {{ items: object[], ok: boolean }}
 */
export function detectDropParkImportant(htmlOrPages, sourceUrl, opts = {}) {
  const pages =
    typeof htmlOrPages === 'string'
      ? { pageHtml: htmlOrPages, tgHtml: '' }
      : { pageHtml: htmlOrPages?.pageHtml || '', tgHtml: htmlOrPages?.tgHtml || '' }
  const pageFetched = opts.pageFetched ?? Boolean(pages.pageHtml)
  const tgFetched = opts.tgFetched ?? Boolean(pages.tgHtml)
  const pageText = cleanText(loadHtml(pages.pageHtml || '<body></body>')('body').text())
  const tgText = cleanText(loadHtml(pages.tgHtml || '<body></body>')('body').text())
  const combined = [pageText, tgText].filter(Boolean).join('\n')

  if (dropParkSeasonOpenMatch(combined)) {
    return { ok: true, items: [] }
  }

  if (dropParkOffSeasonMatch(tgText) || dropParkOffSeasonMatch(pageText)) {
    const publishedAt =
      extractPublishedAtFromHtml(pages.tgHtml) ||
      extractPublishedAtFromHtml(pages.pageHtml) ||
      httpDateToIso(opts.lastModified) ||
      null
    return {
      ok: true,
      items: [
        importantItem({
          id: 'drop-off-season',
          resortId: 'drop-park',
          title: 'Drop Park: межсезонье',
          body: 'В официальном канале парка указано, что прошлый снежный сезон закончен. Актуальный режим и открытие уточняйте на сайте и в сообществе парка.',
          severity: 'info',
          sourceUrl: opts.tgUrl || sourceUrl,
          ...(publishedAt ? { publishedAt } : {}),
        }),
      ],
    }
  }

  // No open/off-season signal. Clearing managed ids requires an authoritative TG read
  // (or both sources unavailable is also non-authoritative → keep previous).
  if (!tgFetched || (!pageFetched && !tgFetched)) {
    return { ok: false, items: [] }
  }

  return { ok: true, items: [] }
}

/**
 * Пухтолова гора: fresh «открытие сезона» from news listing.
 * @param {string} newsHtml
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null }} [opts]
 */
export function detectPuhtolovaImportant(newsHtml, sourceUrl, opts = {}) {
  const text = cleanText(loadHtml(newsHtml)('body').text())
  const items = parseDatedNewsItems(text)
  const open = items.find(
    (it) =>
      isFreshPublishedAt(it.publishedAt) &&
      (/открытие\s+сезон/i.test(it.title) ||
        /открытие\s+центрального\s+склон/i.test(it.title) ||
        /склон.{0,20}открыт/i.test(it.title)),
  )
  if (!open) return []
  return [
    importantItem({
      id: 'puhtolova-season-open',
      resortId: 'puhtolova-gora',
      title: 'Пухтолова гора: открытие сезона',
      body: 'В новостях курорта есть сообщение об открытии склонов. Перед выездом сверьте часы и тарифы на сайте.',
      severity: 'info',
      sourceUrl,
      publishedAt: open.publishedAt,
    }),
  ]
}

/**
 * Lazurnye: home banner still primary; news may announce opening (clears closed).
 * @param {string | { homeHtml?: string, newsHtml?: string }} htmlOrPages
 * @param {string} sourceUrl
 * @param {{ lastModified?: string | null, homeUrl?: string, newsUrl?: string }} [opts]
 */
export function detectLazurnyeImportantFromPages(htmlOrPages, sourceUrl, opts = {}) {
  const pages =
    typeof htmlOrPages === 'string'
      ? { homeHtml: htmlOrPages, newsHtml: '' }
      : { homeHtml: htmlOrPages?.homeHtml || '', newsHtml: htmlOrPages?.newsHtml || '' }

  const newsText = cleanText(loadHtml(pages.newsHtml || '<body></body>')('body').text())
  const newsItems = parseDatedNewsItems(newsText)
  const open = newsItems.find(
    (it) =>
      isFreshPublishedAt(it.publishedAt) &&
      (/открывает\s+сезон/i.test(it.title) ||
        /открытие.{0,40}сезон/i.test(it.title) ||
        /сезон\s+открыт/i.test(it.title)),
  )
  if (open) {
    return [
      importantItem({
        id: 'lazurnye-season-open',
        resortId: 'lazurnye-ozera',
        title: 'Лазурные озёра: открытие сезона',
        body: 'В новостях курорта есть сообщение об открытии сезона. Перед выездом сверьте режим на сайте.',
        severity: 'info',
        sourceUrl: opts.newsUrl || sourceUrl,
        publishedAt: open.publishedAt,
      }),
    ]
  }

  return detectLazurnyeImportant(pages.homeHtml || '', opts.homeUrl || sourceUrl, opts)
}

/**
 * Fail-soft merge:
 * - successful resort checks clear that resort's managed ids, then upsert new items
 * - managed id prefixes (Telegram posts) clear unless `clearPrefixes: false`
 * - failed checks leave previous managed ids untouched
 * - chrome notes (mvp-data-note) always refreshed when provided
 * - publishedAt preserved from previous item when the new scrape has none
 *
 * @param {object[]} prev
 * @param {{ resortId: string, ok: boolean, items?: object[], error?: string, clearPrefixes?: boolean }[]} results
 * @param {{ chromeNote?: object | null }} [opts]
 */
export function mergeImportantFailSoft(prev, results, opts = {}) {
  const byId = new Map((Array.isArray(prev) ? prev : []).map((i) => [i.id, i]))

  for (const result of results) {
    const managed = MANAGED_IMPORTANT_IDS[result.resortId] || []
    if (!result.ok) continue
    for (const id of managed) byId.delete(id)
    const clearPrefixes = result.clearPrefixes !== false
    if (clearPrefixes) {
      const prefixes = MANAGED_IMPORTANT_PREFIXES[result.resortId] || []
      if (prefixes.length) {
        for (const id of [...byId.keys()]) {
          if (prefixes.some((p) => id.startsWith(p))) byId.delete(id)
        }
      }
    }
    for (const item of result.items || []) {
      if (!item?.id) continue
      // Managed ids were just cleared from byId — read prior publishedAt from prev.
      const prior = Array.isArray(prev) ? prev.find((p) => p.id === item.id) : null
      const publishedAt = item.publishedAt || prior?.publishedAt || null
      const merged = { ...item }
      if (publishedAt) merged.publishedAt = publishedAt
      else delete merged.publishedAt
      byId.set(item.id, merged)
    }
  }

  if (opts.chromeNote?.id) {
    byId.set(opts.chromeNote.id, opts.chromeNote)
  }

  return [...byId.values()]
}

/**
 * Daily full scrape helper: treat every target that returned (even with empty important)
 * as a successful clear for its managed ids when the resort scrape did not hard-fail.
 * `importantInconclusive: true` keeps previous managed ids (e.g. Drop Park TG down).
 * `clearImportantPrefixes: false` keeps previous prefix-managed cards (e.g. Krasnoe TG down).
 *
 * @param {object[]} prev
 * @param {object[]} importantAdds
 * @param {{ id: string, error?: string | null, prices?: string | null, hours?: string | null, importantInconclusive?: boolean, clearImportantPrefixes?: boolean }[]} scrapeResults
 */
export function mergeImportantFromDailyScrape(prev, importantAdds, scrapeResults) {
  const results = []
  const addsByResort = new Map()
  for (const item of importantAdds || []) {
    if (!item?.resortId) continue
    const list = addsByResort.get(item.resortId) || []
    list.push(item)
    addsByResort.set(item.resortId, list)
  }

  for (const r of scrapeResults || []) {
    const hardFail = Boolean(r.error) || r.prices === 'failed'
    if (!MANAGED_IMPORTANT_IDS[r.id] && !MANAGED_IMPORTANT_PREFIXES[r.id]) continue
    results.push({
      resortId: r.id,
      ok: !hardFail && !r.importantInconclusive,
      items: addsByResort.get(r.id) || [],
      error: r.error || undefined,
      clearPrefixes: r.clearImportantPrefixes !== false,
    })
  }

  // Also upsert any important items for resorts without managed-id registry.
  for (const [resortId, items] of addsByResort) {
    if (MANAGED_IMPORTANT_IDS[resortId] || MANAGED_IMPORTANT_PREFIXES[resortId]) continue
    results.push({ resortId, ok: true, items })
  }

  return mergeImportantFailSoft(prev, results, {
    chromeNote: importantItem({
      id: 'mvp-data-note',
      title: 'Данные обновляются регулярно',
      body: 'Цены и часы — дважды в день (около 10:00 и 22:00 МСК); блок «Важное» — примерно каждый час с официальных страниц курортов. Это не оферта — перед выездом сверяйте с сайтом курорта.',
      severity: 'info',
    }),
  })
}
