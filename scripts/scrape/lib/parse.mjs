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
 * Flatten structured skipass groups into PriceItem[] for cards / legacy UI.
 * @param {import('../../../src/types.ts').SkipassGroup[] | undefined} groups
 * @returns {{ title: string, price: number | null, unit?: string, note?: string, rawText?: string }[]}
 */
export function flattenSkipassGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return []
  /** @type {{ title: string, price: number | null, unit?: string, note?: string, rawText?: string }[]} */
  const items = []
  for (const group of groups) {
    const columns = group.columns?.length ? group.columns : ['Цена']
    for (const row of group.rows || []) {
      const unit = inferUnitFromDuration(row.duration) || inferUnitFromCategory(group.category)
      for (let i = 0; i < columns.length; i++) {
        const cell = row.prices?.[i]
        if (!cell || cell.price == null) continue
        const col = cleanText(columns[i] || '')
        const parts = []
        if (row.name) parts.push(row.name)
        if (row.duration) parts.push(row.duration)
        let title = parts.join(' · ') || col
        if (col && !/^цена$/i.test(col) && title) {
          title = `${title} (${col})`
        } else if (col && !title) {
          title = col
        }
        if (group.category && columns.length === 1 && /^цена$/i.test(col)) {
          // Keep category out of title when single price column — cards stay compact.
        }
        items.push({
          title,
          price: cell.price,
          ...(unit ? { unit } : {}),
          note: cell.note || row.note || undefined,
          rawText: cell.rawText,
        })
      }
    }
  }
  return items
}

/** @param {string | undefined} duration */
function inferUnitFromDuration(duration) {
  if (!duration) return undefined
  const d = duration.toLowerCase()
  if (/проход|подъ[её]м|разов/.test(d)) return /подъ[её]м/.test(d) ? 'подъём' : 'проход'
  if (/час/.test(d)) return 'час'
  if (/день|сутк/.test(d)) return 'день'
  if (/сезон/.test(d)) return 'сезон'
  return undefined
}

/** @param {string | undefined} category */
function inferUnitFromCategory(category) {
  if (!category) return undefined
  const c = category.toLowerCase()
  if (/сезон|абонемент/.test(c) && !/почасов|проход|подъ[её]м/.test(c)) return 'сезон'
  if (/проход|разов/.test(c)) return 'проход'
  if (/почасов|час/.test(c)) return 'час'
  return undefined
}

/**
 * @param {object} partial
 */
export function priceSnapshot(partial) {
  const groups = Array.isArray(partial.groups)
    ? partial.groups.filter((g) => g && Array.isArray(g.rows) && g.rows.length > 0)
    : undefined
  const fromGroups = groups?.length ? flattenSkipassGroups(groups) : []
  const items =
    Array.isArray(partial.items) && partial.items.length
      ? partial.items
      : fromGroups
  return {
    resortId: partial.resortId,
    scrapedAt: partial.scrapedAt ?? nowIso(),
    sourceUrl: partial.sourceUrl ?? null,
    currency: 'RUB',
    items,
    ...(groups?.length ? { groups } : {}),
    status: partial.status ?? 'ok',
    ...(partial.note ? { note: partial.note } : {}),
  }
}

/**
 * @param {object} partial
 * @param {boolean} [partial.slopesOpen] alpine slopes open when scrape knows; omit if unknown
 */
export function hoursSnapshot(partial) {
  const snap = {
    resortId: partial.resortId,
    scrapedAt: partial.scrapedAt ?? nowIso(),
    sourceUrl: partial.sourceUrl ?? null,
    summary: partial.summary ?? '',
    periods: partial.periods ?? [],
    status: partial.status ?? 'ok',
  }
  // Structured alpine open/closed for card badges. Omit when unknown (UI fail-soft ≠ open).
  if (partial.slopesOpen === true || partial.slopesOpen === false) {
    snap.slopesOpen = partial.slopesOpen
  }
  // Short card caption (e.g. «из новости») — omit when empty.
  const note = typeof partial.hoursNote === 'string' ? partial.hoursNote.trim() : ''
  if (note) snap.hoursNote = note
  return snap
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * «21.11.2026» / «21.11.26» → ISO date at UTC midnight (date-only signal).
 * @param {string | null | undefined} label
 * @returns {string | null}
 */
export function ruDateLabelToIso(label) {
  const m = cleanText(label).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  let yyyy = Number(m[3])
  if (yyyy < 100) yyyy += 2000
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T00:00:00Z`
}

/**
 * HTTP Last-Modified / Date header → ISO instant.
 * @param {string | null | undefined} header
 * @returns {string | null}
 */
export function httpDateToIso(header) {
  if (!header) return null
  const t = Date.parse(header)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Minimal CSV line split (handles quoted commas). */
export function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

/**
 * Parse a whole CSV text into header + row objects.
 * @param {string} csv
 */
export function parseCsv(csv) {
  const lines = String(csv || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (!lines.length) return { header: [], rows: [] }
  const header = splitCsvLine(lines[0]).map((h) => cleanText(h))
  const rows = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line)
    const obj = {}
    header.forEach((h, i) => {
      obj[h] = cols[i] ?? ''
    })
    return obj
  })
  return { header, rows }
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
    return { ...prev, status: 'failed', note: prev.note || 'Сбор данных не удался — показаны прежние данные' }
  }
  // failed after having data: keep items/summary/scrapedAt from prev
  return {
    ...prev,
    status: 'failed',
    sourceUrl: next.sourceUrl || prev.sourceUrl,
    note: next.note || prev.note || 'Сбор данных не удался — показаны прежние данные',
  }
}
