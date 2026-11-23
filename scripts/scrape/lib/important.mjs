/**
 * Shared «Важное» helpers: detectors + fail-soft merge for 2h / daily scrapes.
 * Prefs: only site «Важное» as the notification surface (no email/Telegram push).
 * Official resort pages may still announce season status (e.g. Okhta opening).
 *
 * Cards show publishedAt (news / schedule / page date from the source).
 * Scrape time lives on meta.importantScrapedAt (freshness), not on cards.
 */
import { cleanText, httpDateToIso, loadHtml, nowIso, ruDateLabelToIso } from './parse.mjs'

/** Stable ids owned by automated important scrapers (cleared when a check succeeds without them). */
export const MANAGED_IMPORTANT_IDS = Object.freeze({
  'zolotaya-dolina': Object.freeze(['zoldol-slopes-closed']),
  'lazurnye-ozera': Object.freeze(['lazurnye-season-closed']),
  'krasnoe-ozero': Object.freeze(['krasnoe-slopes-closed']),
  'okhta-park': Object.freeze(['okhta-season-open', 'okhta-presale']),
})

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
 * Fail-soft merge:
 * - successful resort checks clear that resort's managed ids, then upsert new items
 * - failed checks leave previous managed ids untouched
 * - chrome notes (mvp-data-note) always refreshed when provided
 * - publishedAt preserved from previous item when the new scrape has none
 *
 * @param {object[]} prev
 * @param {{ resortId: string, ok: boolean, items?: object[], error?: string }[]} results
 * @param {{ chromeNote?: object | null }} [opts]
 */
export function mergeImportantFailSoft(prev, results, opts = {}) {
  const byId = new Map((Array.isArray(prev) ? prev : []).map((i) => [i.id, i]))

  for (const result of results) {
    const managed = MANAGED_IMPORTANT_IDS[result.resortId] || []
    if (!result.ok) continue
    for (const id of managed) byId.delete(id)
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
 *
 * @param {object[]} prev
 * @param {object[]} importantAdds
 * @param {{ id: string, error?: string | null, prices?: string | null, hours?: string | null }[]} scrapeResults
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
    if (!MANAGED_IMPORTANT_IDS[r.id]) continue
    results.push({
      resortId: r.id,
      ok: !hardFail,
      items: addsByResort.get(r.id) || [],
      error: r.error || undefined,
    })
  }

  // Also upsert any important items for resorts without managed-id registry.
  for (const [resortId, items] of addsByResort) {
    if (MANAGED_IMPORTANT_IDS[resortId]) continue
    results.push({ resortId, ok: true, items })
  }

  return mergeImportantFailSoft(prev, results, {
    chromeNote: importantItem({
      id: 'mvp-data-note',
      title: 'Данные обновляются регулярно',
      body: 'Цены и часы — ежедневно; блок «Важное» — примерно каждые 2 часа с официальных страниц курортов. Это не оферта — перед выездом сверяйте с сайтом курорта.',
      severity: 'info',
    }),
  })
}
