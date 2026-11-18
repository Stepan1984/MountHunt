import { fetchUrl } from '../lib/http.mjs'
import {
  cleanText,
  hoursSnapshot,
  loadHtml,
  priceSnapshot,
} from '../lib/parse.mjs'

/** Preferred official site (Tilda). Seed historically pointed at sev-sklon.ru. */
const SITE_URL = 'https://severnysklon.ru/'

/**
 * Ski-pass prices are not published on the official site (audit 2026-11-18).
 * Scrape contacts + restaurant hours that do exist; mark lift prices unavailable.
 * @returns {Promise<object>}
 */
export async function scrapeSevernySklon() {
  const resortId = 'severny-sklon'
  try {
    const html = await fetchUrl(SITE_URL)
    const $ = loadHtml(html)
    const text = cleanText($('body').text())

    const phoneMatch = text.match(/\+7\s*\(?\s*911\s*\)?\s*924[-\s]?81[-\s]?81/)
    const phone = phoneMatch ? cleanText(phoneMatch[0].replace(/\s+/g, ' ')) : '+7 (911) 924-81-81'
    const emailMatch = text.match(/sevsklon_toxovo@mail\.ru/i)
    const email = emailMatch ? emailMatch[0] : 'sevsklon_toxovo@mail.ru'
    const addressMatch = text.match(
      /Офицерская\s+ул\.,?\s*17Б(?:,\s*городской посёлок Токсово)?/i,
    )
    const address = addressMatch
      ? cleanText(addressMatch[0])
      : 'Офицерская ул., 17Б, городской посёлок Токсово'

    // Restaurant hours (only published schedule on the marketing site).
    const periods = []
    let summary = 'Часы горнолыжного склона на сайте не опубликованы'
    const restIdx = text.search(/Режим работы ресторана/i)
    const restChunk = restIdx >= 0 ? text.slice(restIdx, restIdx + 320) : ''
    const bar = restChunk.match(
      /Понедельник\s*[—–-]\s*Четверг:\s*Режим бара с\s*([\d:]+)\s*[–\-—]\s*([\d:]+)/i,
    )
    const fri = restChunk.match(/Пятница:\s*Ресторан с\s*([\d:]+)\s*[–\-—]\s*([\d:]+)/i)
    const weekend = restChunk.match(
      /Суббота и Воскресенье:\s*Полный:\s*с\s*([\d:]+)\s*[–\-—]\s*([\d:]+)/i,
    )
    if (bar) periods.push({ days: 'пн–чт (бар)', open: bar[1], close: bar[2] })
    if (fri) periods.push({ days: 'пт', open: fri[1], close: fri[2] })
    if (weekend) periods.push({ days: 'сб–вс', open: weekend[1], close: weekend[2] })
    if (periods.length) {
      summary = `Склон: часы не найдены на сайте. Ресторан: ${periods
        .map((p) => `${p.days} ${p.open}–${p.close}`)
        .join('; ')}`
    } else if (restChunk) {
      summary = `Склон: часы не найдены. ${cleanText(restChunk).slice(0, 180)}`
    }

    // Decorative "цены на ski pass" buttons have data-redactor-nohref — no actual price page.
    const fakeSkiCta = /цены на ski pass/i.test(html) && /data-redactor-nohref/i.test(html)

    const contactNote = [
      `Контакты: ${phone}, ${email}, ${address}`,
      'Цены ski-pass / подъёмников на официальном сайте (severnysklon.ru) не опубликованы',
      fakeSkiCta ? 'Кнопки «цены на ski pass» без ссылки (Tilda nohref)' : null,
      'Не использовать устаревший sev-sklon.ru как источник прайса',
    ]
      .filter(Boolean)
      .join('. ')

    return {
      resortId,
      prices: priceSnapshot({
        resortId,
        sourceUrl: SITE_URL,
        items: [],
        status: 'unavailable',
        note: contactNote,
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: SITE_URL,
        summary,
        periods,
        status: periods.length ? 'partial' : 'partial',
      }),
      webcamUrl: null,
      // Hint for seed patch in scrape.mjs
      website: SITE_URL,
    }
  } catch (err) {
    return {
      resortId,
      error: String(err?.message || err),
      prices: priceSnapshot({
        resortId,
        sourceUrl: SITE_URL,
        items: [],
        status: 'failed',
        note: String(err?.message || err),
      }),
      hours: hoursSnapshot({
        resortId,
        sourceUrl: SITE_URL,
        summary: 'Не удалось обновить данные',
        status: 'failed',
      }),
      website: SITE_URL,
    }
  }
}
