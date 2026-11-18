import { fetchUrl } from '../lib/http.mjs'
import { cleanText, parsePrice, priceSnapshot } from '../lib/parse.mjs'

const PAGE_URL = 'https://krasnoeozero.ru/winter/skipass-and-lifts'
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSuTEvLg230S45pOu7aSVs--gOtknAPG2vYD6HwVEMcwTHhAd33FlU6aGrWAmQB68F4uDWeYkgzuWbj/pub?gid=1912036084&single=true&output=csv'
const WEBCAM_URL = 'https://krasnoeozero.ru/cam/'

/** Minimal CSV line split (handles quoted commas). */
function splitCsvLine(line) {
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
 * Optional wave-1.5: public Google Sheets CSV for ski-pass.
 * Hours left for P2 (Tilda/JS).
 * @returns {Promise<object>}
 */
export async function scrapeKrasnoeOzero() {
  const resortId = 'krasnoe-ozero'
  try {
    const csv = await fetchUrl(CSV_URL)
    const lines = csv.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) throw new Error('CSV пустой')
    const header = splitCsvLine(lines[0]).map((h) => cleanText(h))
    const idx = Object.fromEntries(header.map((h, i) => [h, i]))
    const pageKeyCol = idx['Ключ страницы']
    const showCol = idx['Показывать']
    const nameCol = idx['Название'] ?? 0
    const hourWeekday = idx['1 час будни']
    const hourWeekend = idx['1 час выходные']
    const hourGeneric = idx['1 час']
    const noteCol = idx['Уточнение']

    const items = []
    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line)
      const pageKey = cleanText(cols[pageKeyCol] || '')
      const show = cleanText(cols[showCol] || '').toLowerCase()
      if (pageKey !== 'ski-pass' || show !== 'yes') continue
      const name = cleanText(cols[nameCol] || '')
      if (!name) continue
      const candidates = [
        ['1 ч будни', hourWeekday],
        ['1 ч выходные', hourWeekend],
        ['1 ч', hourGeneric],
      ]
      for (const [label, col] of candidates) {
        if (col == null) continue
        const price = parsePrice(cols[col])
        if (price == null) continue
        items.push({
          title: `${name} (${label})`,
          price,
          unit: 'час',
          note: noteCol != null ? cleanText(cols[noteCol] || '') || undefined : undefined,
          rawText: cols[col],
        })
      }
    }

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items: items.slice(0, 30),
        status: items.length ? 'ok' : 'partial',
        note: items.length
          ? 'Источник: публичный CSV виджета цен курорта'
          : 'CSV получен, ski-pass строки не найдены',
      }),
      // hours intentionally omitted (P2)
      webcamUrl: WEBCAM_URL,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      webcamUrl: WEBCAM_URL,
    }
  }
}
