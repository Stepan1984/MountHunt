/**
 * Canonical resort-card hours formatting.
 * Keep in sync with src/lib/data.ts (formatCardHoursFromPeriods / normalizeCardHoursSummary).
 *
 * Rules:
 * - one day-group per line (join with `\n`, no `;`)
 * - weekdays as пн вт ср чт пт сб вс
 * - Monday-first order when days are parseable
 * - group consecutive same-hours days (пн–пт, сб–вс) or comma for gaps
 */

export const WEEKDAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const DAY_INDEX = {
  пн: 0,
  вт: 1,
  ср: 2,
  чт: 3,
  пт: 4,
  сб: 5,
  вс: 6,
  понедельник: 0,
  вторник: 1,
  среда: 2,
  четверг: 3,
  пятница: 4,
  суббота: 5,
  воскресенье: 6,
}

/** @param {string | null | undefined} raw */
export function normalizeCardTime(raw) {
  const s = (raw || '').trim().replace(/\./g, ':')
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return s
  return `${Number(m[1])}:${m[2]}`
}

/**
 * @param {string} raw
 * @returns {{ indices: number[] | null, label: string, note: string, holidayExtra: string }}
 */
export function parseCardDaysLabel(raw) {
  let days = (raw || '')
    .trim()
    .replace(/\s*\([^)]*полный[^)]*\)/gi, '')
    .replace(/\s*\([^)]*по\s+прайсу[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  let note = ''
  const noteMatch = days.match(/^(.*?)\s*(\([^)]*\))\s*$/)
  if (noteMatch) {
    days = noteMatch[1].trim()
    note = noteMatch[2].trim()
  }

  const lower = days.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
  let holidayExtra = ''

  if (!lower) return { indices: null, label: '', note, holidayExtra }

  if (/^будни$|^будние(?:\s+дни)?$/.test(lower)) {
    return { indices: [0, 1, 2, 3, 4], label: 'пн–пт', note, holidayExtra }
  }
  if (/^выходные и праздники$/.test(lower)) {
    return { indices: [5, 6], label: 'сб–вс', note, holidayExtra: ' и праздники' }
  }
  if (/^выходные$|^выходные дни$/.test(lower)) {
    return { indices: [5, 6], label: 'сб–вс', note, holidayExtra }
  }
  if (/^ежедневно$/.test(lower)) {
    return { indices: null, label: 'ежедневно', note, holidayExtra }
  }

  const range = lower.match(/^([а-яё]+)\s*[–\-−—]\s*([а-яё]+)$/)
  if (range && DAY_INDEX[range[1]] != null && DAY_INDEX[range[2]] != null) {
    const a = DAY_INDEX[range[1]]
    const b = DAY_INDEX[range[2]]
    if (a <= b) {
      const indices = []
      for (let i = a; i <= b; i++) indices.push(i)
      return { indices, label: formatDayIndices(indices), note, holidayExtra }
    }
  }

  const parts = lower.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 1 && parts.every((p) => DAY_INDEX[p] != null)) {
    const indices = [...new Set(parts.map((p) => DAY_INDEX[p]))].sort((a, b) => a - b)
    return { indices, label: formatDayIndices(indices), note, holidayExtra }
  }

  const cleaned = days
    .replace(/\s*[-−—]\s*/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
  return { indices: null, label: cleaned, note, holidayExtra }
}

/** @param {number[]} indices */
export function formatDayIndices(indices) {
  if (!indices.length) return ''
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  /** @type {string[]} */
  const ranges = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const d = sorted[i]
    if (d === prev + 1) {
      prev = d
      continue
    }
    ranges.push(
      start === prev
        ? WEEKDAY_NAMES[start]
        : `${WEEKDAY_NAMES[start]}–${WEEKDAY_NAMES[prev]}`,
    )
    start = prev = d
  }
  return ranges.join(', ')
}

/**
 * @param {{ open: string, close: string }} slot
 */
function hoursValue(slot) {
  return slot.open && slot.close ? `${slot.open}–${slot.close}` : 'выходной'
}

/**
 * Canonical multi-line card schedule from structured periods.
 * @param {{ days?: string, open?: string | null, close?: string | null }[] | undefined} periods
 * @returns {string | null}
 */
export function formatCardHoursFromPeriods(periods) {
  if (!periods?.length) return null

  /** @type {({ open: string, close: string, note: string, holidayExtra: string } | null)[]} */
  const daySlots = Array.from({ length: 7 }, () => null)
  /** @type {{ label: string, open: string, close: string }[]} */
  const extras = []

  for (const p of periods) {
    const parsed = parseCardDaysLabel(p.days || '')
    if (!parsed.label && !parsed.indices) continue
    const open = normalizeCardTime(p.open)
    const close = normalizeCardTime(p.close)

    if (parsed.indices) {
      for (const i of parsed.indices) {
        if (daySlots[i]) continue
        daySlots[i] = {
          open,
          close,
          note: parsed.note,
          holidayExtra: parsed.holidayExtra,
        }
      }
    } else {
      const label = parsed.note ? `${parsed.label} ${parsed.note}` : parsed.label
      extras.push({ label, open, close })
    }
  }

  /** @type {string[]} */
  const parts = []

  let i = 0
  while (i < 7) {
    const slot = daySlots[i]
    if (!slot) {
      i++
      continue
    }
    let j = i
    while (
      j + 1 < 7 &&
      daySlots[j + 1] &&
      hoursValue(daySlots[j + 1]) === hoursValue(slot)
    ) {
      j++
    }
    const indices = []
    for (let k = i; k <= j; k++) indices.push(k)
    const notes = new Set()
    let holidayExtra = ''
    for (let k = i; k <= j; k++) {
      const s = daySlots[k]
      if (s.note) notes.add(s.note)
      if (s.holidayExtra) holidayExtra = s.holidayExtra
    }
    const note = notes.size === 1 ? [...notes][0] : ''
    let days = formatDayIndices(indices) + holidayExtra
    if (note) days = `${days} ${note}`
    parts.push(`${days}: ${hoursValue(slot)}`)
    i = j + 1
  }

  for (const ex of extras) {
    parts.push(
      ex.open && ex.close
        ? `${ex.label}: ${ex.open}–${ex.close}`
        : `${ex.label}: выходной`,
    )
  }

  return parts.length ? parts.join('\n') : null
}

/**
 * Join schedule segments with `\n` (and trim). No trailing/separating `;`.
 * @param {string[]} parts
 */
export function joinCardHoursParts(parts) {
  return parts
    .map((p) => p.trim().replace(/;+\s*$/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Reformat a free-text summary into card style (abbr, Mon-first, grouping, line breaks).
 * Non-weekday segments (lift names etc.) keep order and only get `\n` joins.
 * @param {string} text
 */
export function reformatCardHoursSummaryText(text) {
  const segments = text
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!segments.length) return ''

  /** @type {{ days: string, open: string, close: string }[]} */
  const periods = []
  /** @type {string[]} */
  const opaque = []

  for (const seg of segments) {
    const m = seg.match(/^(.+?):\s*(.+)$/)
    if (!m) {
      opaque.push(seg)
      continue
    }
    let days = m[1].trim()
    let rest = m[2].trim()
    // Drop trailing prose after a time range («…21:00. Щётки…»).
    rest = rest.replace(
      /^(\d{1,2}:\d{2}\s*[–\-−—]\s*\d{1,2}:\d{2}).*$/,
      '$1',
    )
    const oc = rest.match(
      /^(\d{1,2}:\d{2})\s*[–\-−—]\s*(\d{1,2}:\d{2})$/,
    )
    const parsed = parseCardDaysLabel(days)
    if (parsed.indices || /^ежедневно$/i.test(parsed.label)) {
      if (oc) {
        periods.push({ days, open: oc[1], close: oc[2] })
      } else if (/выходн|закрыт/i.test(rest)) {
        periods.push({ days, open: '', close: '' })
      } else {
        opaque.push(seg)
      }
    } else {
      opaque.push(oc ? `${days}: ${oc[1]}–${oc[2]}` : `${days}: ${rest}`)
    }
  }

  const formatted = formatCardHoursFromPeriods(periods)
  const parts = []
  if (formatted) parts.push(...formatted.split(/\n/))
  parts.push(...opaque)
  return joinCardHoursParts(parts)
}
