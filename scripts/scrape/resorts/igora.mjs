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
const HOURS_URL = 'https://igora.ru/en/working-hours/'
const CAM_URL = 'https://igora.ru/cam/'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_SNAPSHOT_DIR = join(root, 'data', 'snapshots', 'igora')

/**
 * Resolve HTML for a URL: env snapshot dir → live Playwright → plain fetch →
 * optional bundled snapshot (`IGORA_ALLOW_SNAPSHOT=1`).
 * @param {string} url
 * @param {{ waitForSelector?: string, allowBundledSnapshot?: boolean }} [opts]
 */
async function loadPageHtml(url, opts = {}) {
  const envDir = process.env.IGORA_HTML_DIR || process.env.SCRAPE_HTML_DIR || ''
  const fromEnv = envDir ? readSnapshotHtml(url, envDir) : null
  if (fromEnv) {
    return { html: fromEnv, via: `snapshot:${envDir}` }
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

  const allowSnap =
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
 * Parse ski-pass / instructor tables from Igora price page.
 * Prefer ONLINE column when present; keep cash price as note.
 * @param {string} html
 */
export function parseIgoraPrices(html) {
  const $ = loadHtml(html)
  const items = []

  $('.common-price__table').each((_, table) => {
    const $table = $(table)
    const faqTitle = cleanText(
      $table.closest('.faq-section__item, .js-collapse').find('.faq-section__item-title').first().text(),
    )
    const h3 = cleanText($table.prevAll('h3').first().text())
    const section = h3 || faqTitle || 'тариф'

    // Focus on ski-pass blocks; skip bulky rental/service catalogs for MVP noise control.
    const focus = /ски-?пасс|почасов|проход|абонемент|инструктор/i.test(`${faqTitle} ${h3}`)
    const isRentalOrService = /прокат|ски-сервис|ремонт/i.test(`${faqTitle} ${h3}`)
    if (!focus || isRentalOrService) return

    const rows = tableRows($, $table)
    if (rows.length < 2) return

    // Build column labels from thead-like first rows (duration × КАССА/ONLINE).
    const headerNums = []
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      const row = rows[r]
      const joined = row.join(' ').toLowerCase()
      if (/кассе|online/.test(joined) || /\d+\s*час|разов|^\d+$/.test(joined)) {
        headerNums.push(row)
      }
    }

    // Duration / count labels from first header row cells after title
    const top = rows[0] || []
    const durations = top.slice(1).filter((c) => c && !/^в\s*кассе$/i.test(c) && !/^online$/i.test(c))

    for (const row of rows) {
      const label = row[0]
      if (!label) continue
      if (/кассе|^online$|универсал|разов|кол-во|наименование|продолжит/i.test(label)) continue
      if (!/базов|льгот|бск|человек|профи/i.test(label)) continue

      const cells = row.slice(1)
      // Pair cash/online when even count and headers suggest it
      const hasOnline = rows.some((r) => r.some((c) => /^online$/i.test(c)))
      if (hasOnline && cells.length >= 2) {
        for (let i = 0; i < cells.length; i += 2) {
          const cash = parsePrice(cells[i])
          const online = parsePrice(cells[i + 1])
          const price = online ?? cash
          if (price == null) continue
          const dur = durations[Math.floor(i / 2)] || `${Math.floor(i / 2) + 1}`
          const unit = /час/i.test(String(dur)) ? 'час' : /проход|^\d+$/.test(String(dur)) ? 'проход' : 'тариф'
          items.push({
            title: `${cleanText(label)} · ${cleanText(String(dur))} (${section})`,
            price,
            unit,
            note: cash != null && online != null && cash !== online ? `в кассе ${cash} ₽` : undefined,
            rawText: cells[i + 1] || cells[i],
          })
        }
      } else {
        // Instructor-style: weekday then weekend blocks of 3 durations
        const slots = ['1 час', '1,5 часа', '2 часа']
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
          })
        }
      }
    }
  })

  // Dedup
  const seen = new Set()
  return items.filter((it) => {
    const key = `${it.title}|${it.price}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
    if (priceLoad.via.startsWith('bundled-snapshot') || priceLoad.via.startsWith('snapshot')) {
      notes.push(`источник HTML: ${priceLoad.via}`)
    }

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
    try {
      const camLoad = await loadPageHtml(CAM_URL, {
        waitForSelector: 'iframe[src*="exdesign"], iframe[src*="ivideon"], iframe[src*="rtsp"]',
        allowBundledSnapshot: Boolean(process.env.IGORA_ALLOW_SNAPSHOT || process.env.IGORA_HTML_DIR),
      })
      camHtml = camLoad.html
      if (camLoad.via.includes('snapshot')) notes.push(`камеры: ${camLoad.via}`)
    } catch {
      // bundled cam snapshot if explicitly allowed
      if (process.env.IGORA_ALLOW_SNAPSHOT === '1' || process.env.IGORA_HTML_DIR) {
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

    const items = parseIgoraPrices(priceLoad.html).slice(0, 40)
    const hours = hoursHtml
      ? parseIgoraHours(hoursHtml)
      : { summary: 'Часы склонов уточняйте на https://igora.ru/en/working-hours/', periods: [], status: 'partial' }
    const embeds = camHtml ? parseCameras(camHtml, CAM_URL) : []

    if (!items.length) {
      notes.push('Таблицы .common-price__table не распознаны или пусты')
    }

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PRICE_URL,
        items,
        status: items.length ? (priceLoad.via.includes('snapshot') ? 'partial' : 'ok') : 'partial',
        note: notes.filter(Boolean).join('. ') || undefined,
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: hoursVia ? HOURS_URL : PRICE_URL,
        summary: hours.summary,
        periods: hours.periods,
        status: hours.status,
      }),
      webcamUrl: embeds[0] || CAM_URL,
      cameraEmbeds: embeds,
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
