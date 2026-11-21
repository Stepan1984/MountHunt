import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fetchUrl, sleep } from '../lib/http.mjs'
import { cleanText, hoursSnapshot, loadHtml, parsePrice, priceSnapshot } from '../lib/parse.mjs'

const PAGE_URL = 'https://stc.lenobl.ru/ru/obekty-gau-lo-stc/sk-yukki/'

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * @param {Buffer} pdfBuf
 * @returns {string}
 */
function extractPdfText(pdfBuf) {
  const pdftotext = which('pdftotext')
  if (pdftotext) {
    const dir = mkdtempSync(join(tmpdir(), 'yukki-pdf-'))
    try {
      const pdfPath = join(dir, 'yukki.pdf')
      const txtPath = join(dir, 'yukki.txt')
      writeFileSync(pdfPath, pdfBuf)
      const r = spawnSync(pdftotext, ['-layout', pdfPath, txtPath], { encoding: 'utf8' })
      if (r.status === 0) {
        const text = readFileSync(txtPath, 'utf8')
        // Scanned PDFs often yield empty/near-empty text — require price-like signals
        if (/руб|час|ски-?пас|прейскурант/i.test(text) && /\d{3,}/.test(text)) return text
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return ''
}

/**
 * OCR scanned PDF via pdftoppm + tesseract (optional tools).
 * @param {Buffer} pdfBuf
 */
function ocrPdf(pdfBuf) {
  const pdftoppm = which('pdftoppm')
  const tesseract = which('tesseract')
  if (!pdftoppm || !tesseract) return ''
  const dir = mkdtempSync(join(tmpdir(), 'yukki-ocr-'))
  try {
    const pdfPath = join(dir, 'yukki.pdf')
    writeFileSync(pdfPath, pdfBuf)
    const prefix = join(dir, 'page')
    const conv = spawnSync(pdftoppm, ['-png', '-r', '200', '-f', '1', '-l', '3', pdfPath, prefix], {
      encoding: 'utf8',
    })
    if (conv.status !== 0) return ''
    const chunks = []
    for (const page of [1, 2, 3]) {
      const img = `${prefix}-${page}.png`
      try {
        readFileSync(img)
      } catch {
        continue
      }
      const ocr = spawnSync(tesseract, [img, 'stdout', '-l', 'rus+eng'], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      })
      if (ocr.status === 0 && ocr.stdout) chunks.push(ocr.stdout)
    }
    return chunks.join('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Pull key visit prices from OCR/text.
 * @param {string} text
 */
function parseYukkiPrices(text) {
  const items = []
  const seen = new Set()
  const add = (title, price, unit) => {
    if (price == null || seen.has(title)) return
    seen.add(title)
    items.push({ title, price, unit })
  }

  // Patterns like: "1 час 1000,00" / "1,5 часа 1300,00" / "2 часа 1700,00"
  const durationRe =
    /(30\s*минут|1(?:,5|\.5)?\s*час(?:а)?|2\s*часа|3\s*часа|4\s*часа)\s+(\d{1,3}(?:\s?\d{3})?[,.]?\d{0,2})/gi
  // Prefer block after "Разовое посещение" — first duration cluster (skip noisy later OCR)
  const visitIdx = text.search(/Разовое посещение/i)
  const slice = visitIdx >= 0 ? text.slice(visitIdx, visitIdx + 1200) : text.slice(0, 2500)
  let m
  while ((m = durationRe.exec(slice))) {
    const unitRaw = cleanText(m[1]).toLowerCase()
    const price = parsePrice(m[2])
    if (price == null || price < 100) continue
    let unit = 'час'
    if (/30/.test(unitRaw)) unit = '30 мин'
    add(`Разовое посещение ${unitRaw}`, price, unit)
    if (items.length >= 8) break
  }

  // Seasonal ski-pass hints
  const season = text.match(/Сезонный ски-пас[^\n]{0,80}?(\d{1,3}(?:\s?\d{3})[,.]?\d{0,2})/i)
  if (season) {
    add('Сезонный ски-пасс (группа, от)', parsePrice(season[1]), 'сезон')
  }

  return items
}

/**
 * @returns {Promise<object>}
 */
export async function scrapeYukki() {
  const resortId = 'yukki'
  try {
    const pageHtml = await fetchUrl(PAGE_URL)
    await sleep()
    const $ = loadHtml(pageHtml)
    const text = cleanText($('body').text())

    // Only mark hours ok when «Режим работы» is present — do not invent 10:00–21:00 as ok.
    const hoursMatch = text.match(
      /Режим работы:\s*Ежедневно с\s*(\d{1,2}:\d{2})\s*до\s*(\d{1,2}:\d{2})/i,
    )
    let summary = 'Часы работы уточняйте на странице СТЦ Юкки'
    /** @type {{ days: string, open: string, close: string }[]} */
    const periods = []
    let hoursStatus = 'partial'
    if (hoursMatch) {
      summary = `ежедневно ${hoursMatch[1]}–${hoursMatch[2]}`
      periods.push({ days: 'ежедневно', open: hoursMatch[1], close: hoursMatch[2] })
      hoursStatus = 'ok'
    }

    let pdfHref = null
    $('a[href*=".pdf"]').each((_, el) => {
      const href = $(el).attr('href')
      const label = cleanText($(el).text())
      if (href && (/юкки|прейскурант|приказ/i.test(href + label) || /14180/.test(href))) {
        pdfHref = new URL(href, PAGE_URL).href
      }
    })
    if (!pdfHref) {
      // fallback from audit hint
      pdfHref = new URL(
        '/media/content/docs/14180/%D0%A1%D0%9A_%D0%AE%D0%BA%D0%BA%D0%B8_%D0%9F%D1%80%D0%B8%D0%BA%D0%B0%D0%B7_%D0%BE%D1%82_19.08.2026_01-03-79%D0%BE%D0%B4_26_%D0%9E%D0%B1_%D1%83%D1%82%D0%B2%D0%B5%D1%80%D0%B6%D0%B4%D0%B5%D0%BD%D0%B8_%D0%BF%D1%80%D0%B5%D0%B9%D1%81%D0%BA%D1%83%D1%80%D0%B0%D0%BD%D1%82%D0%B0_%D0%BD%D0%B0_%D1%81%D0%BB%D1%83%D0%B3%D0%B8_01.09.26.pdf',
        'https://stc.lenobl.ru',
      ).href
    }

    const pdfBuf = await fetchUrl(pdfHref, { as: 'buffer' })
    let pdfText = extractPdfText(pdfBuf)
    let usedOcr = false
    if (cleanText(pdfText).length < 40) {
      pdfText = ocrPdf(pdfBuf)
      usedOcr = true
    }
    const items = parseYukkiPrices(pdfText)

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: pdfHref,
        items,
        status: items.length ? (usedOcr ? 'partial' : 'ok') : 'partial',
        note: items.length
          ? usedOcr
            ? 'Цены со скана прейскуранта — возможны неточности, сверяйте с сайтом курорта'
            : 'Источник: официальный прейскурант курорта'
          : 'Прейскурант найден, но тарифы не удалось прочитать — откройте на сайте курорта',
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary,
        periods,
        status: hoursStatus,
      }),
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
      hours: hoursSnapshot({
        resortId,
        sourceUrl: PAGE_URL,
        summary: 'Не удалось обновить часы',
        status: 'failed',
      }),
    }
  }
}
