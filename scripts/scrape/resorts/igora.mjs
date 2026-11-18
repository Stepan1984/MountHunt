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
    if ($h.length) return cleanText($h.text())
    const parent = $el.parent()
    if (!parent.length || parent.is('body') || parent.is('html')) break
    $el = parent
  }
  return ''
}

/**
 * Prefer ONLINE instructor tariffs when cash + online tables share labels.
 * Keeps the lower (online) price and annotates cash when different.
 * @param {{ title: string, price: number, unit?: string, note?: string, rawText?: string, priority: number }[]} items
 */
export function preferInstructorOnline(items) {
  const ski = []
  /** @type {typeof items} */
  const instructor = []
  for (const it of items) {
    if (/ · (?:будни|выходные)/i.test(it.title) || /\(инструктор/i.test(it.title)) {
      instructor.push(it)
    } else {
      ski.push(it)
    }
  }
  if (!instructor.length) return items

  /** Strip trailing (section) so cash/online pairs share a key. */
  const keyOf = (title) => title.replace(/\s*\([^)]*\)\s*$/u, '').trim()
  /** @type {Map<string, typeof items>} */
  const byKey = new Map()
  for (const it of instructor) {
    const k = keyOf(it.title)
    const arr = byKey.get(k) || []
    arr.push(it)
    byKey.set(k, arr)
  }

  /** @type {typeof items} */
  const collapsed = []
  for (const [k, arr] of byKey) {
    if (arr.length === 1) {
      collapsed.push(arr[0])
      continue
    }
    const prices = arr.map((a) => a.price)
    const online = Math.min(...prices)
    const cash = Math.max(...prices)
    const base = arr.find((a) => a.price === online) || arr[0]
    collapsed.push({
      ...base,
      title: `${k} (инструктор online)`,
      note: cash !== online ? `в кассе ${cash} ₽` : base.note,
    })
  }
  return [...ski, ...collapsed]
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
 * Parse ski-pass / instructor tables from Igora price page into flat items + groups.
 * Prefer ONLINE column when present; keep cash price as note.
 * Skip incomplete rows (e.g. BSK with a single orphan cell).
 * @param {string} html
 * @returns {{ items: object[], groups: object[] }}
 */
export function parseIgoraPriceTables(html) {
  const $ = loadHtml(html)
  /** @type {{ title: string, price: number, unit?: string, note?: string, rawText?: string, priority: number }[]} */
  const items = []
  /** @type {{ category: string, columns: string[], rows: object[], priority: number }[]} */
  const groupDrafts = []

  $('.common-price__table').each((_, table) => {
    const $table = $(table)
    const faqTitle = cleanText(
      $table.closest('.faq-section__item, .js-collapse').find('.faq-section__item-title').first().text(),
    )
    const h3 = precedingH3($, $table)
    const sectionBlob = `${faqTitle} ${h3}`
    const isInstructor = /инструктор/i.test(sectionBlob)
    const isOnlineInstructor = isInstructor && /онлайн|online/i.test(h3)
    const section = isOnlineInstructor
      ? 'инструктор online'
      : isInstructor
        ? h3 && !/^цены на занятия/i.test(h3)
          ? 'инструктор'
          : faqTitle || 'инструктор'
        : h3 || faqTitle || 'тариф'

    const focus = /ски-?пасс|почасов|проход|абонемент|инструктор/i.test(sectionBlob)
    const isRentalOrService = /прокат|ски-сервис|ремонт/i.test(sectionBlob)
    if (!focus || isRentalOrService) return

    const rows = tableRows($, $table)
    if (rows.length < 2) return

    const top = rows[0] || []
    const durations = top.slice(1).filter((c) => c && !/^в\s*кассе$/i.test(c) && !/^online$/i.test(c))
    const looksLikePasses =
      /разов|проход/i.test(sectionBlob + ' ' + top.join(' ')) ||
      (durations.length >= 2 && durations.every((d) => /^\d+$/.test(d)))
    const kind = looksLikePasses ? 'passes' : /час/i.test(durations.join(' ')) ? 'hourly' : 'other'
    const priority = isInstructor ? 3 : kind === 'hourly' ? 1 : kind === 'passes' ? 2 : 4

    /** Matrix: duration columns × tariff name rows (ski-pass ONLINE tables). */
    /** @type {Map<string, { name: string, cells: Map<string, { price: number, note?: string, rawText?: string }> }>} */
    const matrix = new Map()

    for (const row of rows) {
      const label = row[0]
      if (!label) continue
      if (/кассе|^online$|универсал|разов|кол-во|наименование|продолжит/i.test(label)) continue
      if (!/базов|льгот|бск|человек|профи/i.test(label)) continue

      const cells = row.slice(1)
      const hasOnline = rows.some((r) => r.some((c) => /^online$/i.test(c)))

      if (hasOnline && cells.length >= 2 && !isInstructor) {
        const pairCount = Math.floor(cells.length / 2)
        if (pairCount < 1) continue
        const name = cleanText(label)
        if (!matrix.has(name)) matrix.set(name, { name, cells: new Map() })
        const entry = matrix.get(name)
        for (let i = 0; i < pairCount * 2; i += 2) {
          const cash = parsePrice(cells[i])
          const online = parsePrice(cells[i + 1])
          const price = online ?? cash
          if (price == null) continue
          if (online == null && cash != null && pairCount === 1 && cells.filter((c) => parsePrice(c) != null).length < 2) {
            continue
          }
          const durRaw = durations[Math.floor(i / 2)]
          if (!durRaw && kind === 'passes') continue
          const dur = formatDurationLabel(durRaw || `${Math.floor(i / 2) + 1}`, kind)
          const unit = kind === 'passes' || /^\d+\s*проход/i.test(dur) ? 'проход' : /час/i.test(dur) ? 'час' : 'тариф'
          const note = cash != null && online != null && cash !== online ? `в кассе ${cash} ₽` : undefined
          entry.cells.set(dur, { price, note, rawText: cells[i + 1] || cells[i] })
          items.push({
            title: `${name} · ${dur} (${section})`,
            price,
            unit,
            note,
            rawText: cells[i + 1] || cells[i],
            priority,
          })
        }
      } else if (/инструктор|человек|профи/i.test(label + sectionBlob)) {
        const slots = ['1 час', '1,5 часа', '2 часа']
        if (cells.length < 3) continue
        for (let i = 0; i < cells.length; i++) {
          const price = parsePrice(cells[i])
          if (price == null) continue
          const day = i < 3 ? 'будни' : 'выходные/праздники'
          const dur = slots[i % 3] || `кол.${i + 1}`
          items.push({
            title: `${cleanText(label)} · ${dur} · ${day} (${section})`,
            price,
            unit: 'час',
            rawText: cells[i],
            priority,
          })
        }
      }
    }

    if (matrix.size) {
      const colSet = []
      for (const entry of matrix.values()) {
        for (const dur of entry.cells.keys()) {
          if (!colSet.includes(dur)) colSet.push(dur)
        }
      }
      const category =
        kind === 'hourly'
          ? h3 || faqTitle || 'Почасовые абонементы'
          : kind === 'passes'
            ? h3 || faqTitle || 'Абонементы на количество проходов'
            : section
      groupDrafts.push({
        category: cleanText(category),
        columns: colSet,
        rows: [...matrix.values()].map((entry) => ({
          name: entry.name,
          prices: colSet.map((dur) => {
            const cell = entry.cells.get(dur)
            return cell ? { price: cell.price, note: cell.note, rawText: cell.rawText } : { price: null }
          }),
        })),
        priority,
      })
    }
  })

  const seen = new Set()
  const flat = preferInstructorOnline(items)
    .filter((it) => {
      const key = `${it.title}|${it.price}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'ru'))
    .map(({ priority: _p, ...rest }) => rest)

  // Instructor group from collapsed flat items (site day columns).
  const instructorFlat = flat.filter((i) => / · (?:будни|выходные)/i.test(i.title))
  /** @type {Map<string, { name: string, duration: string, weekday?: object, weekend?: object }>} */
  const instrMatrix = new Map()
  for (const it of instructorFlat) {
    const m = it.title.match(/^(.+?) · (.+?) · (будни|выходные(?:\/праздники)?)(?:\s*\(|$)/i)
    if (!m) continue
    const name = cleanText(m[1])
    const duration = cleanText(m[2])
    const day = /выходн/i.test(m[3]) ? 'weekend' : 'weekday'
    const key = `${name}|${duration}`
    const row = instrMatrix.get(key) || { name, duration }
    row[day] = { price: it.price, note: it.note, rawText: it.rawText }
    instrMatrix.set(key, row)
  }

  /** @type {object[]} */
  const groups = groupDrafts
    .sort((a, b) => a.priority - b.priority)
    .map(({ category, columns, rows }) => ({ category, columns, rows }))

  if (instrMatrix.size) {
    groups.push({
      category: 'Инструктор',
      columns: ['Будни', 'Выходные/праздники'],
      rows: [...instrMatrix.values()].map((r) => ({
        name: r.name,
        duration: r.duration,
        prices: [r.weekday || { price: null }, r.weekend || { price: null }],
      })),
    })
  }

  return { items: flat, groups }
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
    if (priceLoad.note) notes.push(priceLoad.note)

    await sleep(500)

    let hoursHtml = ''
    let hoursVia = ''
    // Skip fragile live hours when running against HTML snapshots only.
    if (!process.env.IGORA_HTML_DIR && !process.env.SCRAPE_HTML_DIR) {
      try {
        const hoursLoad = await loadPageHtml(HOURS_URL, {
          waitForSelector: 'table',
          allowBundledSnapshot: false,
        })
        hoursHtml = hoursLoad.html
        hoursVia = hoursLoad.via
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

    const parsed = parseIgoraPriceTables(priceLoad.html)
    const items = parsed.items.slice(0, 40)
    const groups = parsed.groups
    const hours = hoursHtml
      ? parseIgoraHours(hoursHtml)
      : {
          summary: 'Часы склонов уточняйте на https://igora.ru/working-hours/',
          periods: [],
          status: 'partial',
        }
    const embeds = camHtml ? parseCameras(camHtml, CAM_URL) : []
    const fromSnapshot = /snapshot/i.test(priceLoad.via)

    if (!items.length) {
      notes.push('Таблицы .common-price__table не распознаны или пусты')
    }
    if (fromSnapshot) {
      notes.push(
        `Цены из HTML-снимка (${priceLoad.via}), не live — дождитесь успешного Playwright в CI`,
      )
    } else if (priceLoad.via === 'playwright' || priceLoad.via === 'fetch') {
      notes.push(`источник: ${priceLoad.via}`)
    }

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICE_URL,
        items,
        groups,
        // Snapshot-sourced tariffs stay partial until a live Playwright/fetch run succeeds.
        status: items.length ? (fromSnapshot ? 'partial' : 'ok') : 'partial',
        note: notes.filter(Boolean).join('. ') || undefined,
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: hoursVia ? HOURS_URL : PRICE_URL,
        summary: hours.summary,
        periods: hours.periods,
        status: hours.status,
      }),
      webcamUrl: CAM_URL,
      cameraEmbeds: embeds.map((u) => u.replace(/\?$/, '')),
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
