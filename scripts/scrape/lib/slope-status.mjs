/**
 * Alpine slope open/closed detectors for hours.slopesOpen.
 *
 * Badge rule (UI): only claim «Склоны открыты» when slopesOpen === true.
 * Fail-soft: missing/unknown → not open (never invent «open»).
 *
 * Collision policy (shared across resorts):
 * - Trust official widgets / fresh managed «Важное» ids over page noise.
 * - Ignore stale news-archive HTML (old «открыты склоны» posts).
 * - Leftover «предпродажа» stays closed unless a *clear* open signal exists
 *   (service widget, season-open match, or fresh important open id).
 * - Explicit closed / closed-until-season beats weak alpine phrase matches.
 *
 * Non-alpine extras (щётки, подушка/airbag) are NOT alpine slopes — keep
 * slopesOpen false and surface them in hours.summary when detected.
 */
import { cleanText, loadHtml } from './parse.mjs'
import { okhtaSeasonOpenMatch } from './important.mjs'

/** Managed important ids that mean alpine slopes are open (fresh sources). */
export const SLOPE_OPEN_IMPORTANT_IDS = Object.freeze([
  'okhta-season-open',
  'tuutari-season-open',
  'puhtolova-season-open',
  'lazurnye-season-open',
])

/**
 * @param {boolean | null | undefined} slopesOpen
 * @returns {boolean | undefined}
 */
export function normalizeSlopesOpen(slopesOpen) {
  if (slopesOpen === true) return true
  if (slopesOpen === false) return false
  return undefined
}

/**
 * @param {string} text
 */
export function hasPresaleSignal(text) {
  return /предпродаж/i.test(cleanText(text))
}

/**
 * Fresh managed «Важное» season-open id present.
 * @param {object[]} importantItems
 * @param {string | string[]} openIds
 */
export function hasFreshImportantOpen(importantItems = [], openIds) {
  const ids = new Set(Array.isArray(openIds) ? openIds : [openIds])
  return importantItems.some((i) => i?.id && ids.has(i.id))
}

/**
 * Resolve open vs closed when signals collide.
 *
 * Clear open (widget / season-open copy / fresh important) wins over predprodazh.
 * Weak alpine phrase alone does NOT override predprodazh or explicit closed.
 *
 * @param {{
 *   clearOpen?: boolean,
 *   weakOpen?: boolean,
 *   closed?: boolean,
 *   dayClosed?: boolean,
 *   presale?: boolean,
 * }} signals
 * @returns {boolean}
 */
export function resolveSlopeOpenCollision(signals = {}) {
  const closed = Boolean(signals.closed || signals.dayClosed)
  const clearOpen = Boolean(signals.clearOpen)
  const weakOpen = Boolean(signals.weakOpen)
  const presale = Boolean(signals.presale)

  // Explicit closed / day-tariff closed always wins (fail-soft closed badge).
  if (closed) return false
  // Widget / fresh season-open / managed important — open even with leftover predprodazh.
  if (clearOpen) return true
  // Predprodazh without a clear open signal → closed (not «Склоны открыты»).
  if (presale) return false
  // Weak alpine phrase only when nothing contradicts it.
  if (weakOpen) return true
  return false
}

/**
 * Positive alpine-open phrases (news / banners). Brushes/airbag alone do not match.
 * @param {string} text
 */
export function alpineSlopesOpenMatch(text) {
  const t = cleanText(text)
  if (!t) return false
  // Exclude brush / airbag-only announcements from alpine-open.
  if (isBrushesOnlyOpenText(t) || isAirbagOnlyOpenText(t)) return false
  // Avoid \w for Cyrillic — JS \w is ASCII-only without the unicode flag.
  return (
    /горнолыжн(?:ый|ого|ому|ым|ом)?\s+сезон\s+открыт/i.test(t) ||
    /сезон\s+20\d{2}\s*[–\-—/]\s*20\d{2}\s+открыт/i.test(t) ||
    /сезон\s+открыт/i.test(t) ||
    /открыт\s+первый\s+склон/i.test(t) ||
    /будет\s+открыт\s+первый\s+склон/i.test(t) ||
    /открываем\s+(?:горнолыжный\s+)?склон/i.test(t) ||
    /открыт[ыа]?\s+(?:детский|учебный|центральный|первый).{0,40}склон/i.test(t) ||
    /склон(?:ы|ов|а)?\s+открыт/i.test(t) ||
    /стартует\s+сезон/i.test(t)
  )
}

/**
 * Strong alpine-closed phrases.
 * @param {string} text
 */
export function alpineSlopesClosedMatch(text) {
  const t = cleanText(text)
  if (!t) return false
  return (
    /горнолыжн(?:ые|ых|ыми)?\s+склон(?:ы|ов)?\s+закрыт/i.test(t) ||
    /склон(?:ы|ов|а)?\s+закрыт(?:ы|а|о)?\s+на\s+летн/i.test(t) ||
    /склон(?:ы|ов|а)?\s+закрыт(?:ы|а|о)?\s+до\s+сезон/i.test(t) ||
    /закрыт(?:ы|а|о)?\s+до\s+сезон/i.test(t) ||
    /сезон\s+20\d{2}\s*закрыт/i.test(t) ||
    /сезон\s+закрыт/i.test(t) ||
    /сезон\s+[\d/]+\s+закончен/i.test(t) ||
    /сезон\s+закончен/i.test(t)
  )
}

/**
 * @param {string} text
 */
export function isBrushesOnlyOpenText(text) {
  const t = cleanText(text)
  if (!t) return false
  const brushes =
    /щ[её]тк/i.test(t) ||
    /джиб\s*палас/i.test(t) ||
    /jib\s*palace/i.test(t) ||
    /пластиков\w*\s+склон/i.test(t)
  if (!brushes) return false
  // Mentions alpine snow season opening → not brushes-only.
  if (/горнолыжн(?:ый|ого)?\s+сезон\s+открыт|снежн(?:ый|ого)?\s+сезон\s+открыт/i.test(t)) {
    return false
  }
  return /открыт|открыли|работа|ждём\s+в/i.test(t)
}

/**
 * @param {string} text
 */
export function isAirbagOnlyOpenText(text) {
  const t = cleanText(text)
  if (!t) return false
  const airbag = /подушк/i.test(t) || /airbag/i.test(t) || /воздушн\w*\s+подушк/i.test(t)
  if (!airbag) return false
  if (
    /горнолыжн(?:ый|ого)?\s+сезон\s+открыт|склон(?:ы|ов|а)?\s+открыт/i.test(t) &&
    !/подушк|airbag/i.test(t)
  ) {
    return false
  }
  return /открыт|работает|доступн/i.test(t)
}

/**
 * Drop Park: brushes / Jib Palace signals from TG + page (not alpine slopes).
 * @param {string} pageHtml
 * @param {string} tgHtml
 * @returns {{ brushesOpen: boolean, note: string | null }}
 */
export function detectDropParkBrushExtras(pageHtml, tgHtml) {
  const pageText = cleanText(loadHtml(pageHtml || '<body></body>')('body').text())
  const tgText = cleanText(loadHtml(tgHtml || '<body></body>')('body').text())
  const combined = [tgText, pageText].filter(Boolean).join('\n')

  const brushesOpen =
    (/открыли\s+втор/i.test(tgText) && /джиб\s*палас/i.test(tgText)) ||
    (/щ[её]тк/i.test(tgText) && /(?:тренер|открыл|работа|джиб)/i.test(tgText)) ||
    (/джиб\s*палас/i.test(tgText) &&
      /(?:открыли|ждём\s+в\s+джиб|работа)/i.test(tgText) &&
      !/джиб\s*палас.{0,40}закрыт/i.test(tgText)) ||
    isBrushesOnlyOpenText(combined)

  if (!brushesOpen) return { brushesOpen: false, note: null }
  return {
    brushesOpen: true,
    note: 'Щётки (Джиб Палас) работают',
  }
}

/**
 * @param {string} pageHtml
 * @param {string} tgHtml
 * @returns {{ slopesOpen: boolean, brushesOpen: boolean, note: string | null }}
 */
export function detectDropParkSlopeStatus(pageHtml, tgHtml) {
  const pageText = cleanText(loadHtml(pageHtml || '<body></body>')('body').text())
  const tgText = cleanText(loadHtml(tgHtml || '<body></body>')('body').text())
  const combined = [pageText, tgText].filter(Boolean).join('\n')
  const extras = detectDropParkBrushExtras(pageHtml, tgHtml)

  // Alpine / snow season: off-season or finished → closed. Do not treat brush open as slopes.
  const seasonFinished =
    /сезон\s+[\d/]+\s+закончен/i.test(combined) ||
    /сезон\s+закрыт/i.test(combined) ||
    /снежн(?:ый|ого)?\s+сезон.{0,20}закончен/i.test(combined)
  const alpineOpen =
    alpineSlopesOpenMatch(combined) &&
    !seasonFinished &&
    !/сезон\s+[\d/]+\s+закончен/i.test(combined)

  return {
    slopesOpen: resolveSlopeOpenCollision({
      clearOpen: Boolean(alpineOpen),
      closed: seasonFinished,
    }),
    brushesOpen: extras.brushesOpen,
    note: extras.note,
  }
}

/**
 * Okhta trails page marks alpine service with Bitrix widget class
 * `service_widget_status--open` (caption «Горнолыжные трассы»).
 * @param {string} trailsHtml
 */
export function okhtaTrailsServiceOpen(trailsHtml) {
  const html = String(trailsHtml || '')
  if (
    /Горнолыжные\s+трассы[\s\S]{0,500}service_widget_status--open/i.test(html) ||
    /service_widget_status--open[\s\S]{0,500}Горнолыжные\s+трассы/i.test(html)
  ) {
    return true
  }
  const trailsText = cleanText(loadHtml(html || '<body></body>')('body').text())
  return /горнолыжные\s+трассы\s+открыто/i.test(trailsText)
}

/**
 * Okhta: trust trails widget + season-open copy; day-closed / no clear open → closed.
 * Clear open wins over leftover «предпродажа»; weak alpine alone does not.
 * @param {{ trailsHtml?: string, lentaHtml?: string, homeHtml?: string }} pages
 * @param {{ dayClosed?: boolean }} [opts]
 */
export function detectOkhtaSlopeStatus(pages, opts = {}) {
  const trailsHtml = pages.trailsHtml || ''
  const trailsText = cleanText(loadHtml(trailsHtml || '<body></body>')('body').text())
  const lentaText = cleanText(loadHtml(pages.lentaHtml || '<body></body>')('body').text())
  const homeText = cleanText(loadHtml(pages.homeHtml || '<body></body>')('body').text())
  const combined = [trailsText, lentaText, homeText].filter(Boolean).join('\n')

  const widgetOpen = okhtaTrailsServiceOpen(trailsHtml)
  const seasonOpen = okhtaSeasonOpenMatch(combined)
  const weakOpen = alpineSlopesOpenMatch(combined) && !seasonOpen && !widgetOpen

  return {
    slopesOpen: resolveSlopeOpenCollision({
      clearOpen: widgetOpen || seasonOpen,
      weakOpen,
      dayClosed: opts.dayClosed,
      closed: alpineSlopesClosedMatch(combined),
      presale: hasPresaleSignal(combined),
    }),
  }
}

/**
 * Krasnoe schedule CSV flags + optional airbag/подушка row for today's column.
 * @param {{ closedUntilSeason: boolean, allClosed: boolean, slopesCount: number, dateCol: string }} pack
 * @param {{ header?: string[], rows?: Record<string, string>[], dateCol?: string }} [csv]
 */
export function detectKrasnoeSlopeStatus(pack, csv = {}) {
  const alpineClosed =
    pack.closedUntilSeason || (pack.allClosed && pack.slopesCount > 0)
  const alpineOpen = !alpineClosed && pack.slopesCount > 0 && !pack.allClosed

  let airbagNote = null
  const dateCol = csv.dateCol || pack.dateCol
  const rows = Array.isArray(csv.rows) ? csv.rows : []
  if (dateCol && rows.length) {
    for (const r of rows) {
      const name = cleanText(r['Наименование'] || '')
      if (!/подушк|airbag|воздушн/i.test(name)) continue
      const val = cleanText(r[dateCol] || '')
      if (!val) continue
      if (/закрыт/i.test(val)) continue
      if (
        /\d{1,2}[:.]\d{2}/.test(val) ||
        /открыт|работа/i.test(val)
      ) {
        airbagNote = `Подушка/airbag: ${val} (${dateCol}) — не горнолыжные склоны`
        break
      }
    }
  }

  return {
    slopesOpen: resolveSlopeOpenCollision({
      clearOpen: Boolean(alpineOpen) && !alpineClosed,
      closed: alpineClosed,
    }),
    note: airbagNote,
  }
}

/**
 * Zolotaya Dolina hours page.
 * @param {string} hoursHtml
 */
export function detectZoldolSlopeStatus(hoursHtml) {
  const text = cleanText(loadHtml(hoursHtml || '<body></body>')('body').text())
  const closed =
    /Горнолыжные склоны закрыты/i.test(text) || alpineSlopesClosedMatch(text)
  return {
    slopesOpen: resolveSlopeOpenCollision({
      clearOpen: alpineSlopesOpenMatch(text) && !closed,
      weakOpen: alpineSlopesOpenMatch(text),
      closed,
    }),
  }
}

/**
 * Lazurnye: trust fresh important ids; home page only for closed banner.
 * Do not invent open from home alpine phrases (stale footer / old news).
 * @param {string} homeHtml
 * @param {object[]} [importantItems]
 */
export function detectLazurnyeSlopeStatus(homeHtml, importantItems = []) {
  if (hasFreshImportantOpen(importantItems, 'lazurnye-season-open')) {
    return { slopesOpen: true }
  }
  if (importantItems.some((i) => i?.id === 'lazurnye-season-closed')) {
    return { slopesOpen: false }
  }
  const text = cleanText(loadHtml(homeHtml || '<body></body>')('body').text())
  if (alpineSlopesClosedMatch(text) || /Сезон\s*20\d{2}\s*закрыт/i.test(text)) {
    return { slopesOpen: false }
  }
  // No fresh open id and no closed banner → fail-soft closed (never invent open).
  return { slopesOpen: false }
}

/**
 * Tuutari from important detectors only.
 * Do not scan the full news archive HTML: old «открыты … склоны» posts
 * (2021+) false-trigger alpineSlopesOpenMatch and invent «Склоны открыты».
 * @param {object[]} importantItems
 * @param {string} [_newsHtml] unused; kept for call-site compatibility
 */
export function detectTuutariSlopeStatus(importantItems = [], _newsHtml = '') {
  if (hasFreshImportantOpen(importantItems, 'tuutari-season-open')) {
    return { slopesOpen: true }
  }
  // Prep / unknown / stale archive → closed (fail-soft).
  return { slopesOpen: false }
}

/**
 * Puhtolova from fresh important only (same archive risk as Tuutari).
 * @param {object[]} importantItems
 * @param {string} [_newsHtml] unused; kept for call-site compatibility
 */
export function detectPuhtolovaSlopeStatus(importantItems = [], _newsHtml = '') {
  if (hasFreshImportantOpen(importantItems, 'puhtolova-season-open')) {
    return { slopesOpen: true }
  }
  return { slopesOpen: false }
}

/**
 * Snezhny: do not scan the news archive for alpine-open phrases.
 * Only a fresh hours-notice page may claim open; otherwise fail-soft closed.
 * @param {{ newsHtml?: string, hoursNoticeHtml?: string }} pages
 */
export function detectSnezhnySlopeStatus(pages = {}) {
  // News listing is a multi-year archive — ignore for slopesOpen.
  const noticeText = cleanText(
    loadHtml(pages.hoursNoticeHtml || '<body></body>')('body').text(),
  )
  if (!noticeText) return { slopesOpen: false }
  return {
    slopesOpen: resolveSlopeOpenCollision({
      clearOpen: alpineSlopesOpenMatch(noticeText),
      closed: alpineSlopesClosedMatch(noticeText),
      presale: hasPresaleSignal(noticeText),
    }),
  }
}

/**
 * Generic fail-soft: open only on positive alpine match; else closed.
 * Prefer resort-specific detectors when a page may embed a news archive.
 * @param {string} htmlOrText
 * @param {{ asText?: boolean, allowWeakOpen?: boolean }} [opts]
 */
export function detectGenericSlopeStatus(htmlOrText, opts = {}) {
  const text = opts.asText
    ? cleanText(htmlOrText)
    : cleanText(loadHtml(htmlOrText || '<body></body>')('body').text())
  const closed = alpineSlopesClosedMatch(text)
  const open = alpineSlopesOpenMatch(text)
  return {
    slopesOpen: resolveSlopeOpenCollision({
      // Generic pages rarely have a widget — treat season-open copy as clear
      // when there is no closed signal; still fail-soft when both/neither.
      clearOpen: open && !closed,
      weakOpen: opts.allowWeakOpen === true && open,
      closed,
      presale: hasPresaleSignal(text),
    }),
  }
}

/**
 * Append extras note to hours summary without duplicating.
 * Keeps card-hours `\n` line breaks in the base schedule (do not collapse via cleanText).
 * @param {string} summary
 * @param {string | null | undefined} note
 */
export function appendHoursExtraNote(summary, note) {
  const base = String(summary || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  const extra = cleanText(note || '')
  if (!extra) return base
  if (base.includes(extra)) return base
  return base ? `${base}. ${extra}` : extra
}
