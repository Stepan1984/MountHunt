import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchUrl, sleep } from '../lib/http.mjs'
import { fetchRenderedHtml, readSnapshotHtml } from '../lib/browser.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'

const PRICE_URL = 'https://igora.ru/price/'
const HOURS_URL = 'https://igora.ru/working-hours/'
const CAM_URL = 'https://igora.ru/cam/'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_SNAPSHOT_DIR = join(root, 'data', 'snapshots', 'igora')

/** True in GitHub Actions / generic CI — never silent-fallback to bundled HTML. */
function isCiEnv() {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
}

/** Explicit opt-in for bundled/offline Igora HTML (local debug only). */
function snapshotOptIn() {
  return (
    process.env.IGORA_ALLOW_SNAPSHOT === '1' ||
    process.env.IGORA_ALLOW_SNAPSHOT === 'true' ||
    Boolean(process.env.IGORA_HTML_DIR) ||
    Boolean(process.env.SCRAPE_HTML_DIR)
  )
}

/**
 * Resolve HTML for a URL: env snapshot dir → live Playwright → plain fetch →
 * optional bundled snapshot (`IGORA_ALLOW_SNAPSHOT=1`).
 * In CI/Actions, bundled snapshot is never used unless explicitly opted in
 * (Daily workflow must not set IGORA_* snapshot vars).
 * @param {string} url
 * @param {{ waitForSelector?: string, allowBundledSnapshot?: boolean }} [opts]
 */
async function loadPageHtml(url, opts = {}) {
  const envDir = process.env.IGORA_HTML_DIR || process.env.SCRAPE_HTML_DIR || ''
  // Local/debug only — refuse IGORA_HTML_DIR / SCRAPE_HTML_DIR when running in CI/Actions
  // so a mis-set secret cannot ship snapshot tariffs as "prod".
  if (envDir && !isCiEnv()) {
    const fromEnv = readSnapshotHtml(url, envDir)
    if (fromEnv) {
      return { html: fromEnv, via: `snapshot:${envDir}` }
    }
  }

  /** @type {Error | undefined} */
  let pwErr
  // Prefer Playwright (SSR tables exist, but live GET often stalls mid-body from some networks).
  try {
    const html = await fetchRenderedHtml(url, {
      waitForSelector: opts.waitForSelector,
      timeoutMs: Number(process.env.IGORA_TIMEOUT_MS || 90_000),
    })
    if (html && html.length > 5_000) {
      return { html, via: 'playwright' }
    }
  } catch (err) {
    pwErr = err instanceof Error ? err : new Error(String(err))
  }

  try {
    const html = await fetchUrl(url, {
      retries: 1,
      timeoutMs: Number(process.env.SCRAPE_FETCH_TIMEOUT_MS || 45_000),
    })
    if (html && html.length > 5_000) {
      return { html, via: 'fetch' }
    }
  } catch {
    /* continue */
  }

  // Bundled snapshot: local opt-in only. Never in CI/Actions (even if env is set by mistake).
  const allowSnap =
    !isCiEnv() &&
    opts.allowBundledSnapshot !== false &&
    (process.env.IGORA_ALLOW_SNAPSHOT === '1' || process.env.IGORA_ALLOW_SNAPSHOT === 'true')
  if (allowSnap && existsSync(DEFAULT_SNAPSHOT_DIR)) {
    const snap = readSnapshotHtml(url, DEFAULT_SNAPSHOT_DIR)
    if (snap) {
      return {
        html: snap,
        via: `bundled-snapshot:${DEFAULT_SNAPSHOT_DIR}`,
        note: pwErr
          ? `live failed (${pwErr.message}); used bundled HTML snapshot`
          : 'used bundled HTML snapshot',
      }
    }
  }

  throw pwErr || new Error(`Could not load ${url}`)
}

/**
 * Closest preceding h3 (walk parents — tables sit inside .common-price__scroll).
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} $table
 */
function precedingH3($, $table) {
  let $el = $table
  for (let i = 0; i < 6; i++) {
    const $h = $el.prevAll('h3').first()
    if ($h.length) {
      const text = cleanText($h.text())
      // FAQ accordion titles live in the trigger, not as table headings.
      if ($h.hasClass('faq-section__item-title')) {
        /* keep walking */
      } else if (text) {
        return text
      }
    }
    const parent = $el.parent()
    if (!parent.length || parent.is('body') || parent.is('html')) break
    $el = parent
  }
  return ''
}

/**
 * Visitor-facing tariff name: Igora’s site uses jargon «с профи»;
 * show clear Russian «с тренером» (keeps N-человек count as on the site).
 * Matching still accepts «профи» from live HTML.
 * @param {string} label
 */
export function clarifyInstructorLabel(label) {
  // No \b: JS word boundaries are ASCII-only and miss Cyrillic.
  return cleanText(label).replace(/с\s+профи(?=$|[^\p{L}\p{N}])/giu, 'с тренером')
}

/**
 * Soften ALL-CAPS site headings for visitor UI while keeping meaning.
 * @param {string} raw
 */
export function softenCategoryTitle(raw) {
  const t = cleanText(raw)
  if (!t) return t
  if (t.length > 4 && t === t.toLocaleUpperCase('ru')) {
    return t.charAt(0) + t.slice(1).toLocaleLowerCase('ru')
  }
  return t
}

/**
 * Human-readable duration / pass-count label from a header cell.
 * @param {string} raw
 * @param {'hourly' | 'passes' | 'other'} kind
 */
function formatDurationLabel(raw, kind) {
  const d = cleanText(String(raw || ''))
  if (!d) return ''
  if (kind === 'passes' || /^\d+$/.test(d)) {
    const n = Number(d)
    if (Number.isFinite(n) && n > 0) {
      const mod100 = n % 100
      const mod10 = n % 10
      if (mod100 >= 11 && mod100 <= 14) return `${n} проходов`
      if (mod10 === 1) return `${n} проход`
      if (mod10 >= 2 && mod10 <= 4) return `${n} прохода`
      return `${n} проходов`
    }
  }
  return d
}

/**
 * @param {string} h3
 * @param {string} faqTitle
 * @param {'hourly' | 'passes' | 'season' | 'instructor'} kind
 */
function categoryForKind(h3, faqTitle, kind) {
  if (kind === 'instructor') {
    // Lessons cash/online share one visitor category — never dump ski-pass here.
    if (/абонемент/i.test(h3)) return softenCategoryTitle(h3) || 'Абонемент на занятия с инструктором'
    return 'Занятия с инструктором'
  }
  if (kind === 'hourly') {
    return softenCategoryTitle(h3) || softenCategoryTitle(faqTitle) || 'Почасовые абонементы'
  }
  if (kind === 'passes') {
    return softenCategoryTitle(h3) || softenCategoryTitle(faqTitle) || 'Абонементы на количество проходов'
  }
  if (kind === 'season') {
    return softenCategoryTitle(h3) || 'Сезонные абонементы'
  }
  return softenCategoryTitle(h3 || faqTitle) || 'Тарифы'
}

/**
 * Classify a site h3 / FAQ blob into a real Igora tariff family.
 * Only hours / rides / seasons / instructor — never invent rental/service groups.
 * @param {string} h3
 * @param {string} faqTitle
 * @param {string[]} headerCells
 * @returns {'hourly' | 'passes' | 'season' | 'instructor' | null}
 */
export function classifyIgoraCategory(h3, faqTitle, headerCells = []) {
  const blob = `${faqTitle} ${h3} ${headerCells.join(' ')}`
  if (/прокат|ски-сервис|ремонт/i.test(blob)) return null
  if (/инструктор|занятия с/i.test(blob)) {
    // Instructor pack (fixed hours pack) is still the instructor family.
    return 'instructor'
  }
  if (/сезонн/i.test(blob) && /ски-?пасс|абонемент/i.test(blob)) return 'season'
  if (/почасов/i.test(blob) || (/час/i.test(headerCells.join(' ')) && /ски-?пасс|абонемент/i.test(blob))) {
    return 'hourly'
  }
  if (
    /проход|разов/i.test(blob) ||
    (headerCells.length >= 2 && headerCells.every((d) => /^\d+$/.test(cleanText(d))))
  ) {
    return 'passes'
  }
  if (/ски-?пасс/i.test(faqTitle)) {
    // Ski-pass FAQ without a clear h3 — infer from duration headers.
    if (/час/i.test(headerCells.join(' '))) return 'hourly'
    if (headerCells.some((d) => /^\d+$/.test(cleanText(d)))) return 'passes'
  }
  return null
}

/**
 * Parse cash/ONLINE ski-pass matrix (hourly or pass packs).
 * @param {string[][]} rows
 * @param {'hourly' | 'passes'} kind
 * @param {string} category
 */
function parseSkiPassMatrix(rows, kind, category) {
  const top = rows[0] || []
  const durations = top.slice(1).filter((c) => c && !/^в\s*кассе$/i.test(c) && !/^online$/i.test(c))
  /** @type {Map<string, { name: string, cells: Map<string, { price: number, note?: string, rawText?: string }> }>} */
  const matrix = new Map()

  for (const row of rows) {
    const label = row[0]
    if (!label) continue
    if (/кассе|^online$|универсал|разов|кол-во|наименование|продолжит/i.test(label)) continue
    // Skip orphan BSK stub (single colspan cell) and non-tariff rows.
    if (!/базов|льгот/i.test(label)) continue

    const cells = row.slice(1)
    const pairCount = Math.floor(cells.length / 2)
    if (pairCount < 1) continue
    const name = clarifyInstructorLabel(label)
    if (!matrix.has(name)) matrix.set(name, { name, cells: new Map() })
    const entry = matrix.get(name)

    for (let i = 0; i < pairCount * 2; i += 2) {
      const cash = parsePrice(cells[i])
      const online = parsePrice(cells[i + 1])
      const price = online ?? cash
      if (price == null) continue
      // Orphan single priced cell (e.g. BSK 250 spanning columns) — skip.
      if (
        online == null &&
        cash != null &&
        pairCount === 1 &&
        cells.filter((c) => parsePrice(c) != null).length < 2
      ) {
        continue
      }
      const durRaw = durations[Math.floor(i / 2)]
      if (!durRaw && kind === 'passes') continue
      const dur = formatDurationLabel(durRaw || `${Math.floor(i / 2) + 1}`, kind)
      let note
      if (cash != null && online != null && cash !== online) note = `в кассе ${cash} ₽`
      else if (cash != null && online == null) note = 'только в кассе'
      entry.cells.set(dur, { price, note, rawText: cells[i + 1] || cells[i] })
    }
  }

  if (!matrix.size) return null
  const columns = []
  for (const entry of matrix.values()) {
    for (const dur of entry.cells.keys()) {
      if (!columns.includes(dur)) columns.push(dur)
    }
  }
  return {
    kind,
    category,
    columns,
    rows: [...matrix.values()].map((entry) => ({
      name: entry.name,
      prices: columns.map((dur) => {
        const cell = entry.cells.get(dur)
        return cell ? { price: cell.price, note: cell.note, rawText: cell.rawText } : { price: null }
      }),
    })),
    online: false,
    priority: kind === 'hourly' ? 1 : 2,
  }
}

/**
 * Parse instructor lesson table (weekday/weekend × duration slots) or pack table.
 * @param {string[][]} rows
 * @param {string} h3
 * @param {string} category
 */
function parseInstructorMatrix(rows, h3, category) {
  const top = rows[0] || []
  const isPack =
    /абонемент/i.test(h3) ||
    (/продолжит/i.test(top[0] || '') && rows.some((r) => /час/i.test(r[0] || '') && parsePrice(r[1]) != null))

  if (isPack) {
    /** @type {object[]} */
    const packRows = []
    for (const row of rows) {
      const label = row[0]
      if (!label || /продолжит|наименование/i.test(label)) continue
      const price = parsePrice(row[1])
      if (price == null) continue
      packRows.push({
        name: clarifyInstructorLabel(top[1] || '1 человек (будни)'),
        duration: cleanText(label),
        prices: [{ price, rawText: row[1] }],
      })
    }
    if (!packRows.length) return null
    return {
      kind: 'instructor',
      category,
      columns: ['Цена'],
      rows: packRows,
      online: false,
      priority: 4,
    }
  }

  // Lesson grid: Будние дни (3 slots) + Выходные (3 slots).
  const slots = ['1 час', '1,5 часа', '2 часа']
  /** @type {Map<string, { name: string, duration: string, weekday?: object, weekend?: object }>} */
  const matrix = new Map()
  const isOnline = /онлайн|online/i.test(h3)

  for (const row of rows) {
    const label = row[0]
    if (!label) continue
    if (/кассе|^online$|кол-во|наименование|продолжит|будн|выходн/i.test(label)) continue
    if (!/человек|профи|тренер/i.test(label)) continue
    const cells = row.slice(1)
    if (cells.length < 3) continue
    const name = clarifyInstructorLabel(label)
    for (let i = 0; i < cells.length; i++) {
      const price = parsePrice(cells[i])
      if (price == null) continue
      const duration = slots[i % 3] || `кол.${i + 1}`
      const day = i < 3 ? 'weekday' : 'weekend'
      const key = `${name}|${duration}`
      const entry = matrix.get(key) || { name, duration }
      entry[day] = { price, rawText: cells[i] }
      matrix.set(key, entry)
    }
  }

  if (!matrix.size) return null
  return {
    kind: 'instructor',
    category,
    columns: ['Будни', 'Выходные/праздники'],
    rows: [...matrix.values()].map((r) => ({
      name: r.name,
      duration: r.duration,
      prices: [r.weekday || { price: null }, r.weekend || { price: null }],
    })),
    online: isOnline,
    priority: 3,
  }
}

/**
 * Prefer ONLINE instructor lesson table; annotate cash desk prices as notes.
 * @param {object[]} drafts
 */
function collapseInstructorDrafts(drafts) {
  /** @type {object[]} */
  const out = []
  /** @type {object[]} */
  const lesson = []
  for (const d of drafts) {
    if (d.kind === 'instructor' && d.columns?.length === 2 && /Будни/i.test(d.columns[0])) {
      lesson.push(d)
    } else {
      out.push(d)
    }
  }
  if (!lesson.length) return out

  const online = lesson.find((d) => d.online) || null
  const cash = lesson.find((d) => !d.online) || null
  const primary = online || cash
  if (!primary) return out

  if (online && cash) {
    /** @type {Map<string, object>} */
    const cashByKey = new Map()
    for (const row of cash.rows || []) {
      cashByKey.set(`${row.name}|${row.duration}`, row)
    }
    primary.rows = (primary.rows || []).map((row) => {
      const cashRow = cashByKey.get(`${row.name}|${row.duration}`)
      if (!cashRow) return row
      const prices = (row.prices || []).map((cell, i) => {
        const cashCell = cashRow.prices?.[i]
        if (!cell || cell.price == null || !cashCell || cashCell.price == null) return cell
        if (cashCell.price === cell.price) return cell
        return { ...cell, note: `в кассе ${cashCell.price} ₽` }
      })
      return { ...row, prices }
    })
  }

  out.push({
    kind: 'instructor',
    category: 'Занятия с инструктором',
    columns: primary.columns,
    rows: primary.rows,
    priority: 3,
  })
  return out
}

/**
 * Flat card/list items from structured groups (stable RU titles for tests + cards).
 * @param {object[]} groups
 */
function itemsFromIgoraGroups(groups) {
  /** @type {{ title: string, price: number, unit?: string, note?: string, rawText?: string, priority: number }[]} */
  const items = []
  for (const g of groups) {
    const kind = igoraGroupKind(g.category)
    const priority = kind === 'hourly' ? 1 : kind === 'passes' ? 2 : kind === 'instructor' ? 3 : 4
    const columns = g.columns?.length ? g.columns : ['Цена']
    for (const row of g.rows || []) {
      for (let i = 0; i < columns.length; i++) {
        const cell = row.prices?.[i]
        if (!cell || cell.price == null) continue
        const col = cleanText(columns[i] || '')
        if (kind === 'instructor' && columns.length === 2) {
          const day = /выходн/i.test(col) ? 'выходные/праздники' : 'будни'
          const suffix = /online|онлайн/i.test(g.note || '') ? 'инструктор online' : 'инструктор'
          // Prefer explicit online annotation when cash note present.
          const onlineTag = cell.note && /в кассе/i.test(cell.note) ? 'инструктор online' : suffix
          items.push({
            title: `${row.name} · ${row.duration} · ${day} (${onlineTag})`,
            price: cell.price,
            unit: 'час',
            note: cell.note,
            rawText: cell.rawText,
            priority,
          })
          continue
        }
        const parts = []
        if (row.name) parts.push(row.name)
        if (row.duration) parts.push(row.duration)
        else if (col && !/^цена$/i.test(col)) parts.push(col)
        let title = parts.join(' · ')
        if (kind === 'hourly' || kind === 'passes') {
          // Duration already in parts via column when no row.duration.
          if (!row.duration && col && !/^цена$/i.test(col) && row.name) {
            title = `${row.name} · ${col}`
          }
          title = `${title} (${g.category})`
        } else if (col && !/^цена$/i.test(col)) {
          title = `${title} (${col})`
        } else {
          title = `${title} (${g.category})`
        }
        const unit =
          kind === 'passes' || /^\d+\s*проход/i.test(row.duration || col)
            ? 'проход'
            : /час/i.test(row.duration || col || '')
              ? 'час'
              : 'тариф'
        items.push({
          title,
          price: cell.price,
          unit,
          note: cell.note,
          rawText: cell.rawText,
          priority,
        })
      }
    }
  }
  const seen = new Set()
  return items
    .filter((it) => {
      const key = `${it.title}|${it.price}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'ru'))
    .map(({ priority: _p, ...rest }) => rest)
}

/**
 * Rebuild Igora tariffs from site FAQ categories only:
 * hours / rides / seasons / instructor. Skip rental & ski-service.
 * @param {string} html
 * @returns {{ items: object[], groups: object[] }}
 */
export function parseIgoraPriceTables(html) {
  const $ = loadHtml(html)
  /** @type {object[]} */
  const drafts = []

  const $faqs = $('.faq-section__item, .js-collapse')
  if ($faqs.length) {
    $faqs.each((_, section) => {
      const $section = $(section)
      const faqTitle = cleanText($section.find('.faq-section__item-title').first().text())
      if (/прокат|ски-сервис|ремонт/i.test(faqTitle)) return
      if (!/ски-?пасс|инструктор/i.test(faqTitle)) return

      const $content = $section.find('.faq-section__item-content, .js-collapse-content').first()
      const $root = $content.length ? $content : $section
      /** @type {{ type: 'h3' | 'table', text?: string, el?: import('cheerio').Element }[]} */
      const blocks = []
      $root.children().each((__, child) => {
        const $child = $(child)
        if ($child.is('h3')) {
          blocks.push({ type: 'h3', text: cleanText($child.text()) })
          return
        }
        $child.find('h3, table.common-price__table').addBack('h3, table.common-price__table').each((___, el) => {
          const $el = $(el)
          if ($el.is('h3')) blocks.push({ type: 'h3', text: cleanText($el.text()) })
          else if ($el.is('table.common-price__table')) blocks.push({ type: 'table', el })
        })
      })

      // Dedupe tables if addBack double-counted; keep order.
      /** @type {typeof blocks} */
      const ordered = []
      const seenTables = new Set()
      for (const b of blocks) {
        if (b.type === 'table') {
          if (seenTables.has(b.el)) continue
          seenTables.add(b.el)
        }
        ordered.push(b)
      }

      let currentH3 = ''
      for (const block of ordered) {
        if (block.type === 'h3') {
          currentH3 = block.text || ''
          continue
        }
        const rows = tableRows($, $(block.el))
        if (rows.length < 2) continue
        const top = rows[0] || []
        const headerDurations = top.slice(1).filter((c) => c && !/^в\s*кассе$/i.test(c) && !/^online$/i.test(c))
        const kind = classifyIgoraCategory(currentH3, faqTitle, headerDurations)
        if (!kind) continue

        if (kind === 'hourly' || kind === 'passes') {
          const category = categoryForKind(currentH3, faqTitle, kind)
          const parsed = parseSkiPassMatrix(rows, kind, category)
          if (parsed) drafts.push(parsed)
        } else if (kind === 'instructor') {
          const category = categoryForKind(currentH3, faqTitle, kind)
          const parsed = parseInstructorMatrix(rows, currentH3, category)
          if (parsed) drafts.push(parsed)
        } else if (kind === 'season') {
          // Rare on Igora /price/; keep structure ready if site adds seasonal ski-pass.
          const category = categoryForKind(currentH3, faqTitle, 'season')
          const parsed = parseSkiPassMatrix(rows, 'hourly', category)
          if (parsed) {
            parsed.kind = 'season'
            parsed.priority = 2.5
            drafts.push(parsed)
          }
        }
      }
    })
  }

  // Fallback: flat table walk when FAQ markup is missing/truncated.
  if (!drafts.length) {
    $('.common-price__table').each((_, table) => {
      const $table = $(table)
      const faqTitle = cleanText(
        $table.closest('.faq-section__item, .js-collapse').find('.faq-section__item-title').first().text(),
      )
      if (/прокат|ски-сервис|ремонт/i.test(faqTitle)) return
      const h3 = precedingH3($, $table)
      const rows = tableRows($, $table)
      if (rows.length < 2) return
      const top = rows[0] || []
      const headerDurations = top.slice(1).filter((c) => c && !/^в\s*кассе$/i.test(c) && !/^online$/i.test(c))
      const kind = classifyIgoraCategory(h3, faqTitle, headerDurations)
      if (!kind) return
      if (kind === 'hourly' || kind === 'passes') {
        const parsed = parseSkiPassMatrix(rows, kind, categoryForKind(h3, faqTitle, kind))
        if (parsed) drafts.push(parsed)
      } else if (kind === 'instructor') {
        const parsed = parseInstructorMatrix(rows, h3, categoryForKind(h3, faqTitle, kind))
        if (parsed) drafts.push(parsed)
      }
    })
  }

  const collapsed = collapseInstructorDrafts(drafts)
  const groups = collapsed
    .sort((a, b) => a.priority - b.priority)
    .map(({ category, columns, rows }) => ({ category, columns, rows }))
    .filter((g) => g.rows?.length)

  return { items: itemsFromIgoraGroups(groups), groups }
}

/**
 * @param {string | undefined} category
 * @returns {'hourly' | 'passes' | 'season' | 'instructor' | 'other'}
 */
export function igoraGroupKind(category) {
  const c = cleanText(category || '')
  if (/инструктор|занятия с/i.test(c)) return 'instructor'
  if (/почасов/i.test(c)) return 'hourly'
  if (/проход/i.test(c)) return 'passes'
  if (/сезон/i.test(c)) return 'season'
  return 'other'
}

/** @param {{ title?: string }} item */
export function isInstructorPriceItem(item) {
  return / · (?:будни|выходные)/i.test(item?.title || '') || /\(инструктор/i.test(item?.title || '')
}

/**
 * Apply visitor wording («с тренером») on flat items + group row names.
 * @param {{ items?: object[], groups?: object[] }} parsed
 */
export function clarifyIgoraParsed(parsed) {
  const items = (parsed.items || []).map((it) => ({
    ...it,
    title: typeof it.title === 'string' ? clarifyInstructorLabel(it.title) : it.title,
  }))
  const groups = (parsed.groups || []).map((g) => ({
    ...g,
    category: typeof g.category === 'string' ? softenCategoryTitle(g.category) : g.category,
    rows: (g.rows || []).map((row) => ({
      ...row,
      name: typeof row.name === 'string' ? clarifyInstructorLabel(row.name) : row.name,
    })),
  }))
  return { items, groups }
}

/** @param {object} g */
function isInstructorLessonGroup(g) {
  return (
    igoraGroupKind(g.category) === 'instructor' &&
    Array.isArray(g.columns) &&
    g.columns.length === 2 &&
    /будни/i.test(g.columns[0] || '')
  )
}

/** @param {object} g */
function isInstructorPackGroup(g) {
  if (igoraGroupKind(g.category) !== 'instructor') return false
  if (/абонемент/i.test(g.category || '')) return true
  return Array.isArray(g.columns) && g.columns.length === 1 && /^цена$/i.test(g.columns[0] || '')
}

/** Rename legacy catch-all «Инструктор» to the real lessons category. */
function normalizeInstructorCategory(g) {
  if (!g) return g
  if (/^Инструктор$/i.test(g.category || '')) {
    return { ...g, category: 'Занятия с инструктором' }
  }
  return g
}

/**
 * Merge live parse with fallback (bundled snapshot): keep live instructor when
 * present; fill missing ski-pass (hourly / passes / season) groups from fallback.
 * Live-only instructor scrapes must not wipe ski-pass categories.
 * @param {{ items?: object[], groups?: object[] }} primary
 * @param {{ items?: object[], groups?: object[] }} fallback
 */
export function mergeIgoraPriceTables(primary, fallback) {
  const p = clarifyIgoraParsed(primary || {})
  const f = clarifyIgoraParsed(fallback || {})
  /** @type {object[]} */
  const groups = []
  /** @type {string[]} */
  const filled = []

  for (const kind of /** @type {const} */ (['hourly', 'passes', 'season'])) {
    const fromP = (p.groups || []).filter((g) => igoraGroupKind(g.category) === kind)
    const fromF = (f.groups || []).filter((g) => igoraGroupKind(g.category) === kind)
    if (fromP.length) groups.push(...fromP)
    else if (fromF.length) {
      groups.push(...fromF)
      filled.push(kind)
    }
  }

  // Instructor family: lessons (prefer live prices) + optional pack — never a catch-all dump.
  const lesson =
    normalizeInstructorCategory((p.groups || []).find(isInstructorLessonGroup)) ||
    normalizeInstructorCategory((f.groups || []).find(isInstructorLessonGroup))
  const pack =
    (p.groups || []).find(isInstructorPackGroup) || (f.groups || []).find(isInstructorPackGroup)
  if (lesson) groups.push(lesson)
  if (pack) groups.push(pack)
  // Legacy primary may only expose catch-all «Инструктор» without 2-col shape detection
  // after clarify — still normalize any leftover instructor groups from primary.
  if (!lesson) {
    for (const g of p.groups || []) {
      if (igoraGroupKind(g.category) !== 'instructor') continue
      if (isInstructorPackGroup(g)) continue
      groups.push(normalizeInstructorCategory(g))
    }
  }

  const primaryHasSki = (p.groups || []).some((g) => {
    const k = igoraGroupKind(g.category)
    return k === 'hourly' || k === 'passes' || k === 'season'
  })
  const primaryHasInstr =
    (p.groups || []).some((g) => igoraGroupKind(g.category) === 'instructor') ||
    (p.items || []).some(isInstructorPriceItem)

  const skiItems = (primaryHasSki ? p.items : f.items || []).filter((it) => !isInstructorPriceItem(it))
  const instrItems = (primaryHasInstr ? p.items : f.items || []).filter(isInstructorPriceItem)

  const seen = new Set()
  const items = [...skiItems, ...instrItems].filter((it) => {
    const key = `${it.title}|${it.price}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    items,
    groups,
    filledSkiPass: filled.length > 0,
    filledKinds: filled,
  }
}

/**
 * If live HTML missed ski-pass tables, fold in bundled snapshot categories.
 * Safe in CI: only fills gaps; status/note stay honest (partial).
 * @param {{ items: object[], groups: object[] }} parsed
 */
export function supplementIgoraSkiPassFromSnapshot(parsed) {
  const hasSki = (parsed.groups || []).some((g) => {
    const k = igoraGroupKind(g.category)
    return k === 'hourly' || k === 'passes' || k === 'season'
  })
  if (hasSki || !existsSync(DEFAULT_SNAPSHOT_DIR)) {
    return { ...clarifyIgoraParsed(parsed), filledSkiPass: false, filledKinds: [] }
  }
  const snapHtml = readSnapshotHtml(PRICE_URL, DEFAULT_SNAPSHOT_DIR)
  if (!snapHtml) {
    return { ...clarifyIgoraParsed(parsed), filledSkiPass: false, filledKinds: [] }
  }
  return mergeIgoraPriceTables(parsed, parseIgoraPriceTables(snapHtml))
}

/**
 * Parse ski-pass / instructor tables from Igora price page.
 * @param {string} html
 */
export function parseIgoraPrices(html) {
  return parseIgoraPriceTables(html).items
}

/**
 * @param {string} html
 */
export function parseIgoraHours(html) {
  const $ = loadHtml(html)
  const text = cleanText($('body').text())
  const periods = []
  let summary = 'Часы склонов уточняйте на сайте Игоры'

  // Prefer explicit slope / working-hours wording (avoid false hits like "Montserrat").
  const slopeBlock = text.match(
    /(?:slopes?|ski\s*lifts?|горнолыжн|склон(?:ы|ов)?|working hours)[^\d]{0,60}?(\d{1,2}:\d{2})\s*[–\-—]\s*(\d{1,2}:\d{2})/i,
  )

  const dayRe =
    /\b((?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:\s*[–\-—]\s*(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))?|пн(?:\s*[–\-—]\s*(?:пт|вс))?|сб(?:\s*[–\-—]\s*вс)?|ежедневно)\b[^\d]{0,24}(\d{1,2}:\d{2})\s*[–\-—]\s*(\d{1,2}:\d{2})/gi
  const generic = [...text.matchAll(dayRe)]

  if (generic.length) {
    const seen = new Set()
    for (const m of generic) {
      const days = cleanText(m[1])
      const key = `${days}|${m[2]}|${m[3]}`
      if (seen.has(key)) continue
      seen.add(key)
      periods.push({ days, open: m[2], close: m[3] })
      if (periods.length >= 6) break
    }
    summary = periods.map((p) => `${p.days}: ${p.open}–${p.close}`).join('; ')
  } else if (slopeBlock) {
    periods.push({ days: 'склоны', open: slopeBlock[1], close: slopeBlock[2] })
    summary = `склоны: ${slopeBlock[1]}–${slopeBlock[2]}`
  }

  return {
    summary,
    periods,
    status: periods.length ? 'ok' : 'partial',
  }
}

/**
 * @param {string} html
 * @param {string} baseUrl
 */
function parseCameras(html, baseUrl) {
  const $ = loadHtml(html)
  const fromDom = extractIframeSrcs($, baseUrl)
  // Igora often injects webcam iframes from inline JS — also scan raw HTML.
  const fromText = [...html.matchAll(/https?:\/\/webcam\.exdesign\.ru\/[^\s"'<>]+/gi)].map((m) => m[0])
  const embeds = [...fromDom, ...fromText].filter(
    (u) => /webcam\.exdesign\.ru|ivideon|rtsp\.(ru|me)|youtube|youtu\.be/i.test(u),
  )
  return [...new Set(embeds.map((u) => u.replace(/^http:\/\//i, 'https://').replace(/\?.*$/, '')))]
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeIgora() {
  const resortId = 'igora'
  const notes = []
  try {
    const priceLoad = await loadPageHtml(PRICE_URL, { waitForSelector: '.common-price__table' })
    // priceLoad.note is scrape/debug English — never copy into visitor price.note.

    await sleep(500)

    let hoursHtml = ''
    // Skip fragile live hours when running against HTML snapshots only.
    if (!process.env.IGORA_HTML_DIR && !process.env.SCRAPE_HTML_DIR) {
      try {
        const hoursLoad = await loadPageHtml(HOURS_URL, {
          waitForSelector: 'table',
          allowBundledSnapshot: false,
        })
        hoursHtml = hoursLoad.html
      } catch {
        hoursHtml = ''
      }
    }

    await sleep(400)

    let camHtml = ''
    const allowCamSnap = snapshotOptIn() && !isCiEnv()
    try {
      const camLoad = await loadPageHtml(CAM_URL, {
        waitForSelector: 'iframe[src*="exdesign"], iframe[src*="ivideon"], iframe[src*="rtsp"]',
        allowBundledSnapshot: allowCamSnap,
      })
      camHtml = camLoad.html
    } catch {
      // bundled cam snapshot if explicitly allowed (never in CI)
      if (allowCamSnap) {
        try {
          const camLoad = await loadPageHtml(CAM_URL, {
            waitForSelector: undefined,
            allowBundledSnapshot: true,
          })
          camHtml = camLoad.html
        } catch {
          camHtml = ''
        }
      }
    }

    const liveParsed = parseIgoraPriceTables(priceLoad.html)
    // Live often returns instructor-only (truncated /price/ body). Fill ski-pass
    // categories from the committed HTML snapshot — fail-soft, never silent ok.
    const merged = supplementIgoraSkiPassFromSnapshot(liveParsed)
    const items = merged.items.slice(0, 80)
    const groups = merged.groups
    const hours = hoursHtml
      ? parseIgoraHours(hoursHtml)
      : {
          summary: 'Часы склонов уточняйте на сайте курорта',
          periods: [],
          status: 'partial',
        }
    const embeds = camHtml ? parseCameras(camHtml, CAM_URL) : []
    const fromSnapshot = /snapshot/i.test(priceLoad.via)
    const incompleteLive = merged.filledSkiPass

    // Visitor-facing notes only — scrape/CI debug stays in meta/logs, not price.note.
    if (!items.length) {
      notes.push('Таблицы цен не удалось прочитать — смотрите сайт курорта')
    }
    if (fromSnapshot || incompleteLive) {
      notes.push('Часть тарифов может быть неполной — уточняйте на сайте курорта')
    }

    const priceStatus = !items.length
      ? 'partial'
      : fromSnapshot || incompleteLive
        ? 'partial'
        : 'ok'

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICE_URL,
        items,
        groups,
        status: priceStatus,
        note: notes.filter(Boolean).join('. ') || undefined,
      }),
      hours: hoursSnapshot({
        resortId,
        // Always point visitors at the hours page (not /price/), even on fallback.
        sourceUrl: HOURS_URL,
        summary: hours.summary,
        periods: hours.periods,
        status: hours.status,
      }),
      webcamUrl: CAM_URL,
      // exdesign iframes render empty black boxes on MountHunt — link-only.
      cameraEmbeds: embeds.filter(() => false),
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICE_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: HOURS_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
      webcamUrl: CAM_URL,
    }
  }
}
