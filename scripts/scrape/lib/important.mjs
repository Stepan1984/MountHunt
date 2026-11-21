/**
 * Shared «Важное» helpers: detectors + fail-soft merge for 2h / daily scrapes.
 * Prefs: only site «Важное» (no email/Telegram); no first-snow / season-open themes.
 */
import { cleanText, loadHtml, nowIso } from './parse.mjs'

/** Stable ids owned by automated important scrapers (cleared when a check succeeds without them). */
export const MANAGED_IMPORTANT_IDS = Object.freeze({
  'zolotaya-dolina': Object.freeze(['zoldol-slopes-closed']),
  'lazurnye-ozera': Object.freeze(['lazurnye-season-closed']),
  'krasnoe-ozero': Object.freeze(['krasnoe-slopes-closed']),
  'okhta-park': Object.freeze(['okhta-presale']),
})

/**
 * @param {{ id: string, resortId?: string, title: string, body?: string, severity: 'info'|'warn', sourceUrl?: string, updatedAt?: string }} partial
 */
export function importantItem(partial) {
  return {
    id: partial.id,
    ...(partial.resortId ? { resortId: partial.resortId } : {}),
    title: partial.title,
    ...(partial.body ? { body: partial.body } : {}),
    severity: partial.severity,
    updatedAt: partial.updatedAt || nowIso(),
    ...(partial.sourceUrl ? { sourceUrl: partial.sourceUrl } : {}),
  }
}

/**
 * @param {string} hoursHtml
 * @param {string} sourceUrl
 */
export function detectZoldolImportant(hoursHtml, sourceUrl) {
  const text = cleanText(loadHtml(hoursHtml)('body').text())
  if (!/Горнолыжные склоны закрыты/i.test(text)) return []
  return [
    importantItem({
      id: 'zoldol-slopes-closed',
      resortId: 'zolotaya-dolina',
      title: 'Золотая Долина: склоны закрыты',
      body: 'На странице часов работы указано, что горнолыжные склоны закрыты на летний период.',
      severity: 'warn',
      sourceUrl,
    }),
  ]
}

/**
 * @param {string} homeHtml
 * @param {string} sourceUrl
 */
export function detectLazurnyeImportant(homeHtml, sourceUrl) {
  const text = cleanText(loadHtml(homeHtml)('body').text())
  const seasonClosed =
    /Сезон\s*20\d{2}\s*закрыт/i.test(text) || /сезон.*закрыт/i.test(text)
  if (!seasonClosed) return []
  return [
    importantItem({
      id: 'lazurnye-season-closed',
      resortId: 'lazurnye-ozera',
      title: 'Лазурные озёра: сезон закрыт',
      body: 'На сайте курорта есть сообщение о закрытии сезона. Перед выездом проверьте актуальность.',
      severity: 'warn',
      sourceUrl,
    }),
  ]
}

/**
 * @param {string} trailsHtml
 * @param {string} sourceUrl
 */
export function detectOkhtaImportant(trailsHtml, sourceUrl) {
  const text = cleanText(loadHtml(trailsHtml)('body').text())
  if (!/предпродаж/i.test(text)) return []
  return [
    importantItem({
      id: 'okhta-presale',
      resortId: 'okhta-park',
      title: 'Охта-Парк: предпродажа ски-пассов',
      body: 'На сайте курорта открыта предпродажа сезонных ски-пассов. Дневные тарифы уточняйте ближе к сезону.',
      severity: 'info',
      sourceUrl,
    }),
  ]
}

/**
 * Build Krasnoe «Важное» from an already-parsed schedule summary.
 * @param {{ closedUntilSeason: boolean, allClosed: boolean, slopesCount: number, dateCol: string }} pack
 * @param {string} sourceUrl
 */
export function detectKrasnoeImportantFromFlags(pack, sourceUrl) {
  if (!(pack.closedUntilSeason || (pack.allClosed && pack.slopesCount))) return []
  return [
    importantItem({
      id: 'krasnoe-slopes-closed',
      resortId: 'krasnoe-ozero',
      title: 'Красное озеро: склоны закрыты до сезона',
      body: `По публичному CSV графика на ${pack.dateCol} трассы/подъёмники отмечены как закрытые до сезона.`,
      severity: 'warn',
      sourceUrl,
    }),
  ]
}

/**
 * Fail-soft merge:
 * - successful resort checks clear that resort's managed ids, then upsert new items
 * - failed checks leave previous managed ids untouched
 * - chrome notes (mvp-data-note) always refreshed when provided
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
      byId.set(item.id, item)
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
