import * as cheerio from 'cheerio'

/** @param {string} html */
export function loadHtml(html) {
  return cheerio.load(html)
}

/** Normalize whitespace. */
export function cleanText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse Russian-style money: "1 500", "1500", "1.500,00", "1500 руб."
 * @param {string} raw
 * @returns {number | null}
 */
export function parsePrice(raw) {
  if (raw == null) return null
  let s = cleanText(String(raw))
  if (!s || /^[—–−-]+$/.test(s) || s === '&nbsp;') return null
  s = s.replace(/руб\.?/gi, '').replace(/₽/g, '').replace(/[)^\]]+$/g, '').trim()
  // "1 500,00" / "1.500,00" / "1500.00" / "2 600,00"
  const spaced = s.match(/^(\d{1,3}(?:\s\d{3})+)([.,]\d{1,2})?$/)
  if (spaced) {
    const n = Number(spaced[1].replace(/\s/g, '') + (spaced[2] ? spaced[2].replace(',', '.') : ''))
    return Number.isFinite(n) ? Math.round(n) : null
  }
  s = s.replace(/\s/g, '')
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,(?=\d{1,2}$)/, '.')
  }
  const m = s.match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? Math.round(n) : null
}

/**
 * Extract absolute iframe src values (skip analytics).
 * @param {cheerio.CheerioAPI} $
 * @param {string} baseUrl
 */
export function extractIframeSrcs($, baseUrl) {
  const out = []
  $('iframe[src]').each((_, el) => {
    const src = $(el).attr('src')
    if (!src) return
    if (/googletagmanager|google-analytics|facebook|doubleclick/i.test(src)) return
    try {
      out.push(new URL(src, baseUrl).href)
    } catch {
      /* ignore */
    }
  })
  return [...new Set(out)]
}

/**
 * Read HTML table rows as arrays of cell text.
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio} table
 */
export function tableRows($, table) {
  const rows = []
  table.find('tr').each((_, tr) => {
    const cells = []
    $(tr)
      .find('th,td')
      .each((__, cell) => {
        cells.push(cleanText($(cell).text()))
      })
    if (cells.some(Boolean)) rows.push(cells)
  })
  return rows
}

/**
 * @param {string} now
 * @param {object} partial
 */
export function priceSnapshot(partial) {
  return {
    resortId: partial.resortId,
    scrapedAt: partial.scrapedAt ?? nowIso(),
    sourceUrl: partial.sourceUrl ?? null,
    currency: 'RUB',
    items: partial.items ?? [],
    status: partial.status ?? 'ok',
    ...(partial.note ? { note: partial.note } : {}),
  }
}

/**
 * @param {object} partial
 */
export function hoursSnapshot(partial) {
  return {
    resortId: partial.resortId,
    scrapedAt: partial.scrapedAt ?? nowIso(),
    sourceUrl: partial.sourceUrl ?? null,
    summary: partial.summary ?? '',
    periods: partial.periods ?? [],
    status: partial.status ?? 'ok',
  }
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Fail-soft merge: on failure keep previous content, mark status failed.
 * @template T
 * @param {T | undefined} prev
 * @param {T | null | undefined} next
 * @param {string} resortId
 * @param {(id: string) => T} blank
 */
export function mergeSnapshot(prev, next, resortId, blank) {
  if (next && next.status !== 'failed') return next
  if (next && next.status === 'failed' && (!prev || prev.status === 'pending')) return next
  if (!prev) return next || blank(resortId)
  if (!next) {
    return { ...prev, status: 'failed', note: prev.note || 'Сбор данных не удался — показан прошлый снимок' }
  }
  // failed after having data: keep items/summary/scrapedAt from prev
  return {
    ...prev,
    status: 'failed',
    sourceUrl: next.sourceUrl || prev.sourceUrl,
    note: next.note || prev.note || 'Сбор данных не удался — показан прошлый снимок',
  }
}
