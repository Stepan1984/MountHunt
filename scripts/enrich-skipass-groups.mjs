#!/usr/bin/env node
/**
 * Offline enrich public/data/prices.json with structured skipass groups
 * matching scraper output (no live network). Safe to re-run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenSkipassGroups } from './scrape/lib/parse.mjs'
import {
  clarifyInstructorLabel,
  mergeIgoraPriceTables,
  parseIgoraPriceTables,
} from './scrape/resorts/igora.mjs'
import {
  ensureKrasnoeBskTopTable,
  stripKrasnoeBskCaptions,
} from './scrape/resorts/krasnoe-ozero.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pricesPath = join(root, 'public/data/prices.json')
const prices = JSON.parse(readFileSync(pricesPath, 'utf8'))

/** @param {object} snap */
function setGroups(snap, groups) {
  const clean = (groups || []).filter((g) => g?.rows?.length)
  if (!clean.length) {
    // Fail-soft: keep previously committed groups when rebuild finds nothing
    // (title formats drift; don't wipe tuutari/zolotaya tables).
    return
  }
  snap.groups = clean
  // Keep existing items if present (card hints); else flatten.
  if (!Array.isArray(snap.items) || !snap.items.length) {
    snap.items = flattenSkipassGroups(clean)
  }
}

function enrichTuutari(snap) {
  const items = snap.items || []
  /** @type {Map<string, Map<string, Map<string, object>>>} */
  const byDay = new Map()
  for (const it of items) {
    const m = it.title.match(/^(.+?), (.+?) \((.+)\)$/)
    if (!m) continue
    const col = m[1].trim()
    const duration = m[2].trim()
    const day = m[3].trim()
    const dayKey = /будн/i.test(day) ? 'Будни' : 'Выходной/праздник'
    if (!byDay.has(dayKey)) byDay.set(dayKey, new Map())
    const rows = byDay.get(dayKey)
    if (!rows.has(duration)) rows.set(duration, new Map())
    rows.get(duration).set(col, { price: it.price, rawText: it.rawText, note: it.note })
  }
  const groups = []
  for (const [category, rowsMap] of byDay) {
    const colSet = []
    for (const cols of rowsMap.values()) {
      for (const c of cols.keys()) if (!colSet.includes(c)) colSet.push(c)
    }
    groups.push({
      category,
      columns: colSet,
      rows: [...rowsMap.entries()].map(([duration, cols]) => ({
        name: 'Ски-пасс',
        duration,
        prices: colSet.map((c) => cols.get(c) || { price: null }),
      })),
    })
  }
  setGroups(snap, groups)
}

function enrichLazurnye(snap) {
  /** @type {Map<string, { weekday?: object, weekend?: object }>} */
  const byDur = new Map()
  for (const it of snap.items || []) {
    const m = it.title.match(/Ски-пасс\s+(.+?)\s+\((будни|выходные)\)/i)
    if (!m) continue
    // Titles use «1 ч» or «1 час» — don't append another «ч» onto bare «ч».
    const rawDur = m[1].trim()
    const duration = /час|\bч\b/i.test(rawDur) ? rawDur : `${rawDur} ч`
    const row = byDur.get(duration) || {}
    const cell = { price: it.price, rawText: it.rawText }
    if (/будн/i.test(m[2])) row.weekday = cell
    else row.weekend = cell
    byDur.set(duration, row)
  }
  if (!byDur.size) return
  setGroups(snap, [
    {
      category: 'Ски-пасс',
      columns: ['Будни', 'Выходные'],
      rows: [...byDur.entries()].map(([duration, r]) => ({
        name: 'Ски-пасс',
        duration,
        prices: [r.weekday || { price: null }, r.weekend || { price: null }],
      })),
    },
  ])
}

function enrichZoldol(snap) {
  const COLUMNS = ['Детский · будни', 'Взрослый · будни', 'Детский · выходные', 'Взрослый · выходные']
  /** @type {Map<string, Map<string, object[]>>} */
  const byKind = new Map()
  for (const it of snap.items || []) {
    const m = it.title.match(/^(.+?)\s+\((детский|взрослый)\s+(будни|выходные)\)$/i)
    if (!m) continue
    const duration = m[1].replace(/подъем/gi, 'подъём')
    const kind = /час/i.test(duration) ? 'По часам' : 'По подъёмам'
    const colIdx =
      /детск/i.test(m[2]) && /будн/i.test(m[3])
        ? 0
        : /взросл/i.test(m[2]) && /будн/i.test(m[3])
          ? 1
          : /детск/i.test(m[2])
            ? 2
            : 3
    if (!byKind.has(kind)) byKind.set(kind, new Map())
    const rows = byKind.get(kind)
    if (!rows.has(duration)) {
      rows.set(duration, COLUMNS.map(() => ({ price: null })))
    }
    rows.get(duration)[colIdx] = { price: it.price, rawText: it.rawText }
  }
  const groups = [...byKind.entries()].map(([category, rows]) => ({
    category,
    columns: [...COLUMNS],
    rows: [...rows.entries()].map(([duration, prices]) => ({
      name: 'Ски-пасс',
      duration,
      prices,
    })),
  }))
  setGroups(snap, groups)
}

function enrichSnezhny(snap) {
  const DAY_COLUMNS = [
    'Будни, льготный',
    'Будни, взрослый',
    'Выходные, льготный',
    'Выходные, взрослый',
  ]
  /** @type {Map<string, object[]>} */
  const lift = new Map()
  /** @type {object[]} */
  const season = []
  /** @type {object[]} */
  const unified = []

  for (const it of snap.items || []) {
    // Flat titles: «Ски-пасс · 1 проход (Будни, льготный)» or legacy bare duration.
    const liftM = it.title.match(
      /^(?:Ски-пасс\s*·\s*)?(.+?)\s+\((будни|выходные),\s*(льготный|взрослый)\)$/i,
    )
    if (liftM) {
      const duration = liftM[1].replace(/^Ски-пасс\s*·\s*/i, '').trim()
      const col =
        /будн/i.test(liftM[2]) && /льгот/i.test(liftM[3])
          ? 0
          : /будн/i.test(liftM[2])
            ? 1
            : /льгот/i.test(liftM[3])
              ? 2
              : 3
      if (!lift.has(duration)) lift.set(duration, DAY_COLUMNS.map(() => ({ price: null })))
      lift.get(duration)[col] = { price: it.price, rawText: it.rawText }
      continue
    }
    // Flat: «Абонемент «Взрослый» · сезон» (also legacy «Абонемент: …»).
    // No \b — JS word boundaries are ASCII-only and miss Cyrillic.
    if (/^Абонемент(?=$|[^\p{L}\p{N}])/iu.test(it.title)) {
      let name = it.title.replace(/\s*·\s*сезон\s*$/i, '').trim()
      if (/^Абонемент:\s*/i.test(name)) {
        name = `Абонемент ${name.replace(/^Абонемент:\s*/i, '').trim()}`
      }
      season.push({
        name,
        duration: 'сезон',
        prices: [{ price: it.price, rawText: it.rawText }],
      })
      continue
    }
    // Flat unified (category omitted when column is «Цена»): «Взрослый · сезон».
    const uniFlat = it.title.match(/^(Взрослый|Детский)\s*·\s*сезон$/i)
    if (uniFlat) {
      unified.push({
        name: uniFlat[1],
        duration: 'сезон',
        prices: [{ price: it.price, rawText: it.rawText }],
      })
      continue
    }
    if (/^Единый ски-пасс/i.test(it.title)) {
      unified.push({
        name: it.title
          .replace(/^Единый ски-пасс Снежный\/Золотая Долина:\s*/i, '')
          .replace(/\s*·\s*сезон\s*$/i, '')
          .trim(),
        duration: 'сезон',
        prices: [{ price: it.price, rawText: it.rawText }],
      })
    }
  }

  // Fail-soft: if items still used old titles, keep prior season/unified rows.
  if (!season.length) {
    const prev = (snap.groups || []).find(
      (g) => /абонемент/i.test(g.category || '') && !/единый/i.test(g.category || ''),
    )
    if (prev?.rows?.length) season.push(...prev.rows)
  }
  if (!unified.length) {
    const prev = (snap.groups || []).find((g) => /единый/i.test(g.category || ''))
    if (prev?.rows?.length) unified.push(...prev.rows)
  }

  const groups = []
  if (lift.size) {
    groups.push({
      category: 'Ски-пассы (часы и проходы)',
      columns: [...DAY_COLUMNS],
      rows: [...lift.entries()].map(([duration, prices]) => ({
        name: 'Ски-пасс',
        duration,
        prices,
      })),
    })
  }
  if (season.length) groups.push({ category: 'Абонементы', columns: ['Цена'], rows: season })
  if (unified.length) {
    groups.push({
      category: 'Единый ски-пасс Снежный/Золотая Долина',
      columns: ['Цена'],
      rows: unified,
    })
  }
  setGroups(snap, groups)
}

function enrichKrasnoe(snap) {
  // Prefer structured scrape groups; only lift БСК into a top table + strip captions.
  if (Array.isArray(snap.groups) && snap.groups.some((g) => g?.rows?.length)) {
    setGroups(snap, ensureKrasnoeBskTopTable(snap.groups))
    for (const it of snap.items || []) {
      const note = stripKrasnoeBskCaptions(it.note)
      if (note) it.note = note
      else delete it.note
    }
    return
  }

  /** @type {Map<string, { weekday?: object, weekend?: object }>} */
  const byName = new Map()
  for (const it of snap.items || []) {
    const m = it.title.match(/^(.+?)\s+\((1 ч будни|1 ч выходные|1 ч)\)$/i)
    if (!m) continue
    const row = byName.get(m[1]) || {}
    const cell = { price: it.price, rawText: it.rawText }
    if (/выходн/i.test(m[2])) row.weekend = cell
    else row.weekday = cell
    byName.set(m[1], row)
  }
  if (!byName.size) return
  setGroups(
    snap,
    ensureKrasnoeBskTopTable([
      {
        category: 'Ски-пасс (часы)',
        columns: ['1 ч будни', '1 ч выходные'],
        rows: [...byName.entries()].map(([name, r]) => ({
          name,
          duration: '1 час',
          prices: [r.weekday || { price: null }, r.weekend || { price: null }],
        })),
      },
    ]),
  )
}

function enrichOkhta(snap) {
  // Prefer groups already emitted by scrapeOkhtaPark / parseOkhtaDayTariffGroups.
  if (Array.isArray(snap.groups) && snap.groups.some((g) => g?.rows?.length)) {
    snap.groups = snap.groups.filter((g) => g?.rows?.length)
    return
  }
  const rows = (snap.items || [])
    .filter((it) => /сезонн/i.test(it.title))
    .map((it) => {
      const m = it.title.match(/сезонный ски-пасс\s+(взрослый|детский)\s*\[([^\]]+)\]/i)
      return {
        name: m ? `Сезонный ски-пасс ${m[1].toLowerCase()}` : it.title,
        duration: m ? m[2] : 'сезон',
        prices: [{ price: it.price, note: it.note, rawText: it.rawText }],
      }
    })
  if (!rows.length) return
  setGroups(snap, [
    {
      category: 'Сезонные ски-пассы',
      columns: ['Цена'],
      rows,
    },
  ])
}

function enrichIgora(snap) {
  const snapHtml = join(root, 'data/snapshots/igora/price.html')
  const snapshotParsed = existsSync(snapHtml)
    ? parseIgoraPriceTables(readFileSync(snapHtml, 'utf8'))
    : { items: [], groups: [] }
  // Keep live instructor prices when present; restore missing ski-pass groups
  // from the committed HTML snapshot (daily live often drops them).
  // Rename legacy catch-all «Инструктор» so merge keeps site categories.
  const liveGroups = (snap.groups || []).map((g) =>
    /^Инструктор$/i.test(g.category || '')
      ? { ...g, category: 'Занятия с инструктором' }
      : g,
  )
  const liveParsed = { items: snap.items || [], groups: liveGroups }
  const merged = mergeIgoraPriceTables(liveParsed, snapshotParsed)
  setGroups(snap, merged.groups)
  snap.items = merged.items.slice(0, 80)
  if (merged.filledSkiPass && snap.status === 'ok') {
    snap.status = 'partial'
  }
  if (merged.filledSkiPass) {
    const extra = 'Часть тарифов может быть неполной'
    if (!String(snap.note || '').includes('Часть тарифов может быть неполной')) {
      snap.note = snap.note ? `${snap.note}. ${extra}` : extra
    }
  }
  // Fail-soft: clarify visitor wording («с тренером») on any leftover labels.
  for (const it of snap.items || []) {
    if (typeof it.title === 'string') it.title = clarifyInstructorLabel(it.title)
  }
  for (const g of snap.groups || []) {
    for (const row of g.rows || []) {
      if (typeof row.name === 'string') row.name = clarifyInstructorLabel(row.name)
    }
  }
}

function enrichDropPark(snap) {
  // Prefer groups already emitted by scrapeDropPark / parseDropParkPriceList.
  // If only flat items remain (older commit), leave them — do not invent categories.
  if (Array.isArray(snap.groups) && snap.groups.some((g) => g?.rows?.length)) {
    snap.groups = snap.groups.filter((g) => g?.rows?.length)
    return
  }
  delete snap.groups
}

for (const snap of prices) {
  switch (snap.resortId) {
    case 'tuutari-park':
      enrichTuutari(snap)
      break
    case 'lazurnye-ozera':
      enrichLazurnye(snap)
      break
    case 'zolotaya-dolina':
      enrichZoldol(snap)
      break
    case 'snezhny':
      enrichSnezhny(snap)
      break
    case 'krasnoe-ozero':
      enrichKrasnoe(snap)
      break
    case 'okhta-park':
      enrichOkhta(snap)
      break
    case 'igora':
      enrichIgora(snap)
      break
    case 'drop-park':
      enrichDropPark(snap)
      break
    default:
      // No invented categories for empty/pending/unavailable resorts.
      break
  }
}

writeFileSync(pricesPath, `${JSON.stringify(prices, null, 2)}\n`)

const summary = prices
  .filter((p) => p.groups?.length)
  .map((p) => `${p.resortId}: ${p.groups.map((g) => `${g.category}(${g.rows.length})`).join('; ')}`)
console.log(summary.join('\n') || 'no groups')
