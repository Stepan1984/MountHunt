import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchUrl, sleep } from '../lib/http.mjs'
import { fetchRenderedHtml, readSnapshotHtml } from '../lib/browser.mjs'
import { formatCardHoursFromPeriods } from '../lib/card-hours-format.mjs'
import {
  cleanText,
  extractIframeSrcs,
  hoursSnapshot,
  loadHtml,
  parsePrice,
  priceSnapshot,
  tableRows,
} from '../lib/parse.mjs'
import { detectGenericSlopeStatus } from '../lib/slope-status.mjs'

const PRICE_URL = 'https://igora.ru/price/'
/** RU /working-hours/ returns 404; EN mirror has the slope schedule table. */
const HOURS_URL = 'https://igora.ru/en/working-hours/'
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
 * Ski-pass / instructor families only — rental & ski-service use dedicated parsers.
 * @param {string} h3
 * @param {string} faqTitle
 * @param {string[]} headerCells
 * @returns {'hourly' | 'passes' | 'season' | 'instructor' | null}
 */
export function classifyIgoraCategory(h3, faqTitle, headerCells = []) {
  const blob = `${faqTitle} ${h3} ${headerCells.join(' ')}`
  // Rental / ski-service / repair are handled outside this classifier.
  if (/прокат|ски-сервис|ремонт|тюбинг|ватрушк/i.test(blob)) return null
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
 * Parse «850 / 950» cells (лыжи / сноуборд) into primary price + visitor note.
 * @param {string} raw
 * @returns {{ price: number, note?: string, rawText: string } | null}
 */
function parseSlashPriceCell(raw) {
  const text = cleanText(raw)
  if (!text) return null
  const parts = text.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const a = parsePrice(parts[0])
    const b = parsePrice(parts[1])
    if (a != null && b != null && a !== b) {
      return { price: a, note: `сноуборд ${b} ₽`, rawText: text }
    }
  }
  const price = parsePrice(text)
  if (price == null) return null
  return { price, rawText: text }
}

/**
 * Normalize site duration-band labels to the visitor wording from the
 * official rental matrix (1 час / после 1ч 30 мин / 4 часа / после 4ч 30 мин).
 * @param {string} raw
 * @param {number} index
 * @param {string[]} allDurations
 */
function clarifyRentalDurationLabel(raw, index, allDurations) {
  const t = cleanText(raw)
  if (!t) return t
  if (/после\s*1\s*часа.*30|30.*после\s*1\s*часа|каждые\s*30\s*минут\s*после\s*1/i.test(t)) {
    return 'После 1 часа каждые 30 минут'
  }
  if (/после\s*4\s*час.*30|30.*после\s*4\s*час|каждые\s*30\s*минут\s*после\s*4/i.test(t)) {
    return 'После 4 часов каждые 30 минут'
  }
  if (/^1\s*час$/i.test(t)) return '1 час'
  if (/^4\s*часа(\s*\(\s*1\s*день\s*\))?$/i.test(t)) return '4 часа'
  // Short snapshot label «каждые 30 минут»: after a 4-hour band → after-4h, else after-1h.
  if (/^каждые\s*30\s*минут$/i.test(t)) {
    const prev = allDurations.slice(0, index).join(' ')
    if (/4\s*час/i.test(prev)) return 'После 4 часов каждые 30 минут'
    return 'После 1 часа каждые 30 минут'
  }
  return softenCategoryTitle(t)
}

/**
 * Leaf day labels under each duration band (exact site wording).
 * @param {string} raw
 */
function clarifyRentalDayLabel(raw) {
  const t = cleanText(raw)
  if (!t) return t
  if (/будни|пн/i.test(t) && !/сб|вс|выходн|праздн/i.test(t)) return 'Будни, Пн-Пт'
  if (/сб|вс|праздн|выходн/i.test(t)) return 'Сб-Вс, Праздники'
  return t
}

/**
 * Weekday/weekend rental matrix with nested headers like the site / instructor UI:
 * top = duration bands (colspan 2), leaf = Будни, Пн-Пт | Сб-Вс, Праздники.
 * Tubing (ватрушки) is split into its own group with the same header shape.
 * @param {string[][]} rows
 * @returns {{ rental: object | null, tubing: object | null }}
 */
function parseRentalWeekdayMatrix(rows) {
  const top = rows[0] || []
  const dayRow = rows[1] || []
  if (!/час|минут|день/i.test(top.join(' ')) || !/будни/i.test(dayRow.join(' '))) {
    return { rental: null, tubing: null }
  }
  // tableRows drops rowspan «Наименование» on the day row — durations are top.slice(1).
  const rawDurations = top.slice(1).filter(Boolean)
  if (rawDurations.length < 1 || dayRow.length < rawDurations.length * 2) {
    return { rental: null, tubing: null }
  }
  const durations = rawDurations.map((d, i) => clarifyRentalDurationLabel(d, i, rawDurations))
  /** @type {{ label: string, span: number }[]} */
  const columnGroups = durations.map((label) => ({ label, span: 2 }))
  /** @type {string[]} */
  const columns = []
  for (let d = 0; d < durations.length; d++) {
    const wd = clarifyRentalDayLabel(dayRow[d * 2] || 'Будни, Пн-Пт')
    const we = clarifyRentalDayLabel(dayRow[d * 2 + 1] || 'Сб-Вс, Праздники')
    columns.push(wd, we)
  }

  /** @type {Map<string, { name: string, prices: object[] }>} */
  const rentalByName = new Map()
  /** @type {Map<string, { name: string, prices: object[] }>} */
  const tubingByName = new Map()

  for (const row of rows.slice(2)) {
    const name = cleanText(row[0] || '')
    if (!name || /наименован/i.test(name)) continue
    const cells = row.slice(1)
    if (cells.length < durations.length * 2) continue
    const isTubing = /ватрушк|тюбинг/i.test(name)
    const displayName = isTubing
      ? softenCategoryTitle(name.replace(/\*+\s*$/g, '').trim()) || 'Ватрушки (тюбинг)'
      : name.replace(/\*+\s*$/g, '').trim()
    /** @type {object[]} */
    const prices = []
    for (let d = 0; d < durations.length; d++) {
      const wdRaw = cells[d * 2]
      const weRaw = cells[d * 2 + 1]
      const wd = parsePrice(wdRaw)
      const we = parsePrice(weRaw)
      prices.push(
        wd != null ? { price: wd, rawText: wdRaw } : { price: null },
        we != null ? { price: we, rawText: weRaw } : { price: null },
      )
    }
    if (!prices.some((p) => p.price != null)) continue
    const target = isTubing ? tubingByName : rentalByName
    target.set(displayName, { name: displayName, prices })
  }

  const rentalRows = [...rentalByName.values()]
  const tubingRows = [...tubingByName.values()]

  return {
    rental: rentalRows.length
      ? {
          kind: 'rental',
          category: 'Прокат снаряжения',
          columns,
          columnGroups,
          rows: rentalRows,
          priority: 5,
        }
      : null,
    tubing: tubingRows.length
      ? {
          kind: 'tubing',
          category: 'Тюбинг',
          columns,
          columnGroups,
          rows: tubingRows,
          priority: 7,
        }
      : null,
  }
}

/**
 * Accessory / clothing rental: duration columns, no weekday split.
 * Handles colspan quirks (БСК single price, Finnish sleds 1–4h + day).
 * @param {string[][]} rows
 * @param {string} category
 */
function parseRentalDurationMatrix(rows, category = 'Прокат одежды и аксессуаров') {
  const top = rows[0] || []
  const durRow = rows[1] || []
  // Header may be «Наименование | Цена/рубли…» then a duration row, or a single header row.
  // Do not use parsePrice() to detect the duration row — «1 час» parses as 1.
  const durRowLooksLikeDurations =
    durRow.length >= 2 &&
    durRow.every((c) => /час|день|минут/i.test(c || '')) &&
    !/наименован|цена|ндс/i.test(durRow.join(' '))
  let durations = []
  let dataStart = 1
  if (durRowLooksLikeDurations) {
    durations = durRow.filter(Boolean)
    dataStart = 2
  } else {
    durations = top.slice(1).filter((c) => c && !/наименован|цена|ндс/i.test(c))
    dataStart = 1
  }
  if (!durations.length) return null

  /** @type {object[]} */
  const outRows = []
  for (const row of rows.slice(dataStart)) {
    const name = cleanText(row[0] || '')
    if (!name || /наименован/i.test(name)) continue
    const cells = row.slice(1).filter((c) => cleanText(c))
    if (!cells.length) continue

    /** @type {( { price: number, rawText?: string } | { price: null } )[]} */
    const prices = durations.map(() => ({ price: null }))
    if (cells.length === 1) {
      // Full-row colspan (e.g. БСК 250).
      const cell = parseSlashPriceCell(cells[0])
      if (!cell) continue
      for (let i = 0; i < prices.length; i++) prices[i] = { price: cell.price, rawText: cell.rawText }
    } else if (cells.length === durations.length) {
      for (let i = 0; i < durations.length; i++) {
        const cell = parseSlashPriceCell(cells[i])
        prices[i] = cell || { price: null }
      }
    } else if (cells.length === 2 && durations.length >= 2) {
      // e.g. Сани: colspan across early durations + last column.
      const a = parseSlashPriceCell(cells[0])
      const b = parseSlashPriceCell(cells[1])
      for (let i = 0; i < durations.length - 1; i++) {
        prices[i] = a || { price: null }
      }
      prices[durations.length - 1] = b || { price: null }
    } else {
      for (let i = 0; i < Math.min(cells.length, durations.length); i++) {
        const cell = parseSlashPriceCell(cells[i])
        prices[i] = cell || { price: null }
      }
    }
    if (!prices.some((p) => p.price != null)) continue
    outRows.push({ name, prices })
  }
  if (!outRows.length) return null
  return {
    kind: 'rental_extra',
    category,
    columns: durations,
    rows: outRows,
    priority: 6,
  }
}

/**
 * Ski-service / repair name→price list (optional № column).
 * @param {string[][]} rows
 * @param {string} category
 */
function parseServicePriceList(rows, category = 'Ски-сервис, ремонт оборудования') {
  const top = rows[0] || []
  const hasNum = /^№$/i.test(cleanText(top[0] || ''))
  const nameIdx = hasNum ? 1 : 0
  const priceIdx = hasNum ? 2 : top.length > 1 ? top.length - 1 : 1

  /** @type {object[]} */
  const outRows = []
  for (const row of rows.slice(1)) {
    const name = cleanText(row[nameIdx] || '')
    if (!name || /наименован/i.test(name)) continue
    const cell = parseSlashPriceCell(row[priceIdx] || '')
    if (!cell) continue
    outRows.push({
      name,
      prices: [{ price: cell.price, note: cell.note, rawText: cell.rawText }],
    })
  }
  if (!outRows.length) return null
  return {
    kind: 'service',
    category: softenCategoryTitle(category) || 'Ски-сервис, ремонт оборудования',
    columns: ['Цена'],
    rows: outRows,
    priority: 8,
  }
}

/**
 * @param {string[][]} rows
 */
function isRentalWeekdayMatrixRows(rows) {
  const top = rows[0] || []
  const dayRow = rows[1] || []
  return (
    /час|минут|день/i.test(top.join(' ')) &&
    /будни/i.test(dayRow.join(' ')) &&
    /(сб|вс|выходн|праздн)/i.test(dayRow.join(' '))
  )
}

/**
 * @param {string[][]} rows
 */
function isRentalDurationMatrixRows(rows) {
  if (rows.length < 2) return false
  if (isRentalWeekdayMatrixRows(rows)) return false
  const top = rows[0] || []
  const second = rows[1] || []
  const blob = `${top.join(' ')} ${second.join(' ')}`
  return /час|день/i.test(blob) && /наименован|цена/i.test(top.join(' '))
}

/**
 * @param {string[][]} rows
 */
function isServiceListRows(rows) {
  const top = rows[0] || []
  if (/^№$/i.test(cleanText(top[0] || ''))) return true
  return (
    /наименован/i.test(top.join(' ')) &&
    /цена|руб/i.test(top.join(' ')) &&
    !/час|будни/i.test(top.join(' ')) &&
    top.length <= 4
  )
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
 * Source layout (igora.ru/price/):
 *   row0: Кол-во… | Будние дни | Выходные/Праздничные дни
 *   row1: 1 час | 1,5 часа | 2 часа | 1 час | 1,5 часа | 2 часа
 *   data: one tariff name × 6 prices
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

  // Nested headers from the live/snapshot table — never invent day/duration labels.
  const dayHeaders = top.slice(1).map((c) => cleanText(c)).filter(Boolean)
  const slotRow = rows[1] || []
  const slotCells = slotRow.map((c) => cleanText(c)).filter(Boolean)
  const slotsFromHeader =
    slotCells.length >= 3 && slotCells.every((c) => /час/i.test(c)) ? slotCells : null
  const columns = slotsFromHeader || ['1 час', '1,5 часа', '2 часа', '1 час', '1,5 часа', '2 часа']
  const half = Math.max(1, Math.floor(columns.length / 2))
  /** @type {{ label: string, span: number }[]} */
  const columnGroups =
    dayHeaders.length >= 2
      ? [
          { label: dayHeaders[0], span: half },
          { label: dayHeaders[1], span: columns.length - half },
        ]
      : [
          { label: 'Будние дни', span: half },
          { label: 'Выходные/Праздничные дни', span: columns.length - half },
        ]

  const dataStart = slotsFromHeader ? 2 : 1
  /** @type {Map<string, { name: string, prices: object[] }>} */
  const matrix = new Map()
  const isOnline = /онлайн|online/i.test(h3)

  for (const row of rows.slice(dataStart)) {
    const label = row[0]
    if (!label) continue
    if (/кассе|^online$|кол-во|наименование|продолжит|будн|выходн/i.test(label)) continue
    if (!/человек|профи|тренер/i.test(label)) continue
    // Keep site group-size wording; only clarify jargon «с профи» → «с тренером».
    const name = clarifyInstructorLabel(label)
    const cells = row.slice(1)
    if (cells.length < columns.length) continue
    const prices = columns.map((_, i) => {
      const raw = cells[i]
      const price = parsePrice(raw)
      return price != null ? { price, rawText: raw } : { price: null }
    })
    if (!prices.some((p) => p.price != null)) continue
    matrix.set(name, { name, prices })
  }

  if (!matrix.size) return null
  return {
    kind: 'instructor',
    category,
    columns,
    columnGroups,
    rows: [...matrix.values()],
    online: isOnline,
    priority: 3,
  }
}

function isInstructorLessonDraft(d) {
  if (d?.kind !== 'instructor') return false
  if (Array.isArray(d.columnGroups) && d.columnGroups.length === 2) return true
  // Legacy shape: Будни | Выходные as leaf columns + duration on each row.
  return Array.isArray(d.columns) && d.columns.length === 2 && /будни/i.test(d.columns[0] || '')
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
    if (isInstructorLessonDraft(d)) {
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
      // Nested matrix: one row per tariff name; legacy: name|duration.
      const key = row.duration ? `${row.name}|${row.duration}` : row.name
      cashByKey.set(key, row)
    }
    primary.rows = (primary.rows || []).map((row) => {
      const key = row.duration ? `${row.name}|${row.duration}` : row.name
      const cashRow = cashByKey.get(key)
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
    ...(primary.columnGroups ? { columnGroups: primary.columnGroups } : {}),
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
    const priority =
      kind === 'hourly'
        ? 1
        : kind === 'passes'
          ? 2
          : kind === 'instructor'
            ? 3
            : kind === 'rental'
              ? 5
              : kind === 'rental_extra'
                ? 6
                : kind === 'tubing'
                  ? 7
                  : kind === 'service'
                    ? 8
                    : 4
    const columns = g.columns?.length ? g.columns : ['Цена']
    const columnGroups = Array.isArray(g.columnGroups) ? g.columnGroups : null
    for (const row of g.rows || []) {
      for (let i = 0; i < columns.length; i++) {
        const cell = row.prices?.[i]
        if (!cell || cell.price == null) continue
        const col = cleanText(columns[i] || '')
        // Nested instructor matrix: leaf cols are durations under day groups.
        if (kind === 'instructor' && columnGroups?.length === 2) {
          let offset = 0
          let dayLabel = ''
          for (const cg of columnGroups) {
            if (i >= offset && i < offset + cg.span) {
              dayLabel = /выходн/i.test(cg.label || '') ? 'выходные/праздники' : 'будни'
              break
            }
            offset += cg.span
          }
          const duration = col || row.duration || ''
          const suffix = /online|онлайн/i.test(g.note || '') ? 'инструктор online' : 'инструктор'
          const onlineTag = cell.note && /в кассе/i.test(cell.note) ? 'инструктор online' : suffix
          items.push({
            title: `${row.name} · ${duration} · ${dayLabel} (${onlineTag})`,
            price: cell.price,
            unit: 'час',
            note: cell.note,
            rawText: cell.rawText,
            priority,
          })
          continue
        }
        // Legacy instructor shape: Будни | Выходные + duration on the row.
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
        // Nested rental/tubing: duration bands above leaf day columns.
        if ((kind === 'rental' || kind === 'tubing') && columnGroups?.length) {
          let offset = 0
          let band = ''
          for (const cg of columnGroups) {
            if (i >= offset && i < offset + cg.span) {
              band = cg.label || ''
              break
            }
            offset += cg.span
          }
          const day = /сб|вс|выходн|праздн/i.test(col) ? 'выходные/праздники' : 'будни'
          items.push({
            title: `${row.name} · ${band} · ${day} (${g.category})`,
            price: cell.price,
            unit: 'аренда',
            note: cell.note,
            rawText: cell.rawText,
            priority,
          })
          continue
        }
        // Legacy rental shape: Будни | Выходные + duration on the row.
        if (
          (kind === 'rental' || kind === 'tubing') &&
          columns.length === 2 &&
          /будни/i.test(columns[0] || '')
        ) {
          const day = /выходн|сб|вс|праздн/i.test(col) ? 'выходные/праздники' : 'будни'
          items.push({
            title: `${row.name} · ${row.duration} · ${day} (${g.category})`,
            price: cell.price,
            unit: /час|минут|день/i.test(row.duration || '') ? 'аренда' : 'тариф',
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
            : kind === 'service'
              ? 'услуга'
              : kind === 'rental' || kind === 'rental_extra' || kind === 'tubing'
                ? 'аренда'
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
 * Collect ordered h3 / table blocks inside a FAQ content root.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} $root
 */
function faqOrderedBlocks($, $root) {
  /** @type {{ type: 'h3' | 'table', text?: string, el?: import('cheerio').Element }[]} */
  const blocks = []
  $root.children().each((_, child) => {
    const $child = $(child)
    if ($child.is('h3')) {
      blocks.push({ type: 'h3', text: cleanText($child.text()) })
      return
    }
    $child.find('h3, table.common-price__table').addBack('h3, table.common-price__table').each((__, el) => {
      const $el = $(el)
      if ($el.is('h3')) blocks.push({ type: 'h3', text: cleanText($el.text()) })
      else if ($el.is('table.common-price__table')) blocks.push({ type: 'table', el })
    })
  })
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
  return ordered
}

/**
 * Parse rental / tubing / clothing tables from a «прокат» FAQ section.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} $root
 * @param {object[]} drafts
 */
function pushRentalDrafts($, $root, drafts) {
  for (const block of faqOrderedBlocks($, $root)) {
    if (block.type !== 'table') continue
    const rows = tableRows($, $(block.el))
    if (rows.length < 2) continue
    if (isRentalWeekdayMatrixRows(rows)) {
      const { rental, tubing } = parseRentalWeekdayMatrix(rows)
      if (rental) drafts.push(rental)
      if (tubing) drafts.push(tubing)
    } else if (isRentalDurationMatrixRows(rows)) {
      const parsed = parseRentalDurationMatrix(rows)
      if (parsed) drafts.push(parsed)
    }
  }
}

/**
 * Parse ski-service / repair tables from the matching FAQ section.
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} $root
 * @param {object[]} drafts
 */
function pushServiceDrafts($, $root, drafts) {
  for (const block of faqOrderedBlocks($, $root)) {
    if (block.type !== 'table') continue
    const rows = tableRows($, $(block.el))
    if (rows.length < 2) continue
    if (!isServiceListRows(rows)) continue
    // FAQ title on the site combines ski-service + repair into one family.
    const parsed = parseServicePriceList(rows, 'Ски-сервис, ремонт оборудования')
    if (parsed) drafts.push(parsed)
  }
}

/**
 * Rebuild Igora tariffs from site FAQ categories:
 * ski-pass / instructor / rental / tubing / ski-service & repair.
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
      const isRentalFaq = /прокат/i.test(faqTitle)
      const isServiceFaq = /ски-сервис|ремонт/i.test(faqTitle)
      const isSkiOrInstr = /ски-?пасс|инструктор/i.test(faqTitle)
      if (!isRentalFaq && !isServiceFaq && !isSkiOrInstr) return

      const $content = $section.find('.faq-section__item-content, .js-collapse-content').first()
      const $root = $content.length ? $content : $section

      if (isRentalFaq) {
        pushRentalDrafts($, $root, drafts)
        return
      }
      if (isServiceFaq) {
        pushServiceDrafts($, $root, drafts)
        return
      }

      const ordered = faqOrderedBlocks($, $root)
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
      const rows = tableRows($, $table)
      if (rows.length < 2) return
      if (/прокат/i.test(faqTitle) || isRentalWeekdayMatrixRows(rows) || isRentalDurationMatrixRows(rows)) {
        if (isRentalWeekdayMatrixRows(rows)) {
          const { rental, tubing } = parseRentalWeekdayMatrix(rows)
          if (rental) drafts.push(rental)
          if (tubing) drafts.push(tubing)
        } else if (isRentalDurationMatrixRows(rows)) {
          const parsed = parseRentalDurationMatrix(rows)
          if (parsed) drafts.push(parsed)
        }
        return
      }
      if (/ски-сервис|ремонт/i.test(faqTitle) || isServiceListRows(rows)) {
        const h3 = precedingH3($, $table)
        const parsed = parseServicePriceList(
          rows,
          /прейскурант/i.test(h3) ? 'Ски-сервис, ремонт оборудования' : h3 || 'Ски-сервис, ремонт оборудования',
        )
        if (parsed) drafts.push(parsed)
        return
      }
      const h3 = precedingH3($, $table)
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
    .map(({ category, columns, rows, note, columnGroups }) => ({
      category,
      columns,
      rows,
      ...(columnGroups ? { columnGroups } : {}),
      ...(note ? { note } : {}),
    }))
    .filter((g) => g.rows?.length)

  return { items: itemsFromIgoraGroups(groups), groups }
}

/**
 * @param {string | undefined} category
 * @returns {'hourly' | 'passes' | 'season' | 'instructor' | 'rental' | 'rental_extra' | 'tubing' | 'service' | 'other'}
 */
export function igoraGroupKind(category) {
  const c = cleanText(category || '')
  if (/инструктор|занятия с/i.test(c)) return 'instructor'
  if (/тюбинг|ватрушк/i.test(c)) return 'tubing'
  if (/ски-сервис|ремонт/i.test(c)) return 'service'
  if (/одежд|аксессуар/i.test(c)) return 'rental_extra'
  if (/прокат/i.test(c)) return 'rental'
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
  if (igoraGroupKind(g.category) !== 'instructor') return false
  if (Array.isArray(g.columnGroups) && g.columnGroups.length === 2) return true
  return (
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
 * present; fill missing ski-pass / rental / service groups from fallback.
 * Live-only instructor scrapes must not wipe ski-pass or rental categories.
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

  // Rental / tubing / ski-service after ski-pass + instructor (site FAQ order).
  // Prefer nested duration×day headers (columnGroups) over legacy flat Будни/Выходные rows.
  for (const kind of /** @type {const} */ (['rental', 'rental_extra', 'tubing', 'service'])) {
    const fromP = (p.groups || []).filter((g) => igoraGroupKind(g.category) === kind)
    const fromF = (f.groups || []).filter((g) => igoraGroupKind(g.category) === kind)
    const nestedP = fromP.filter((g) => Array.isArray(g.columnGroups) && g.columnGroups.length)
    const nestedF = fromF.filter((g) => Array.isArray(g.columnGroups) && g.columnGroups.length)
    if (nestedP.length) groups.push(...nestedP)
    else if (nestedF.length) {
      groups.push(...nestedF)
      filled.push(kind)
    } else if (fromP.length) groups.push(...fromP)
    else if (fromF.length) {
      groups.push(...fromF)
      filled.push(kind)
    }
  }

  // Flat items always follow the merged group set (live preferred per family above).
  const items = itemsFromIgoraGroups(groups)

  return {
    items,
    groups,
    // Any snapshot-filled gap (ski-pass or rental/service) → honest partial.
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
 * EN working-hours page uses Mon/Tue… — visitor copy must stay Russian.
 * @param {string} raw
 */
export function localizeIgoraDayLabel(raw) {
  let s = cleanText(raw)
  if (!s) return s
  const map = [
    [/monday/gi, 'пн'],
    [/tuesday/gi, 'вт'],
    [/wednesday/gi, 'ср'],
    [/thursday/gi, 'чт'],
    [/friday/gi, 'пт'],
    [/saturday/gi, 'сб'],
    [/sunday/gi, 'вс'],
    [/\bmon\b/gi, 'пн'],
    [/\btue\b/gi, 'вт'],
    [/\bwed\b/gi, 'ср'],
    [/\bthu\b/gi, 'чт'],
    [/\bfri\b/gi, 'пт'],
    [/\bsat\b/gi, 'сб'],
    [/\bsun\b/gi, 'вс'],
  ]
  for (const [re, ru] of map) s = s.replace(re, ru)
  s = s.replace(/\s*[–\-—]\s*/g, '–')
  return s
}

/**
 * @param {string} html
 */
export function parseIgoraHours(html) {
  const $ = loadHtml(html)
  const text = cleanText($('body').text())
  const periods = []
  let summary = 'Нет данных о часах склонов'

  // Prefer explicit slope / working-hours wording (avoid false hits like "Montserrat").
  const slopeBlock = text.match(
    /(?:slopes?|ski\s*lifts?|горнолыжн|склон(?:ы|ов)?|working hours)[^\d]{0,60}?(\d{1,2}:\d{2})\s*[–\-—]\s*(\d{1,2}:\d{2})/i,
  )

  const dayRe =
    /\b((?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:\s*[–\-—]\s*(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?))?|пн(?:\s*[–\-—]\s*(?:пт|вс))?|сб(?:\s*[–\-—]\s*вс)?|ежедневно)\b[^\d]{0,24}(\d{1,2}:\d{2})\s*[–\-—]\s*(\d{1,2}:\d{2})/gi
  const generic = [...text.matchAll(dayRe)]

  if (generic.length) {
    const seenExact = new Set()
    const seenDay = new Set()
    for (const m of generic) {
      const days = localizeIgoraDayLabel(m[1])
      const exact = `${days}|${m[2]}|${m[3]}`
      if (seenExact.has(exact)) continue
      seenExact.add(exact)
      // Prefer the first schedule block (usually slopes) over later
      // instructor/rental duplicates with the same day label.
      if (seenDay.has(days)) continue
      seenDay.add(days)
      periods.push({ days, open: m[2], close: m[3] })
      // Classic slopes block: weekday + sat + sun — stop before other venues.
      if (
        periods.length >= 3 &&
        /пн/i.test(periods[0].days) &&
        /сб/i.test(periods[1].days) &&
        /вс/i.test(periods[2].days)
      ) {
        break
      }
      if (periods.length >= 6) break
    }
    summary = formatCardHoursFromPeriods(periods) || periods.map((p) => `${p.days}: ${p.open}–${p.close}`).join('\n')
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
          summary: 'Нет данных о часах склонов',
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
      notes.push('Часть тарифов может быть неполной')
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
        // Schedule alone ≠ season open; need alpine-open copy on the page.
        slopesOpen: detectGenericSlopeStatus(hoursHtml || '').slopesOpen,
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
