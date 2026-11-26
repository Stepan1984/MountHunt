/**
 * Card hours display: no slope status badge duplicates; unified schedule line.
 * Mirrors src/lib/data.ts card-hours helpers (Cyrillic-safe; no Vite import).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CY = '[а-яёa-z]*'

function normalizeCardDaysLabel(raw) {
  let days = raw
    .trim()
    .replace(/\s*\([^)]*полный[^)]*\)/gi, '')
    .replace(/\s*\([^)]*по\s+прайсу[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!days) return ''
  const WEEKDAY_ABBR = new Set(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])
  const parts = days.split(/\s*,\s*/).map((p) => p.replace(/\.$/, '').trim().toLowerCase())
  if (parts.length >= 2 && parts.every((p) => WEEKDAY_ABBR.has(p))) {
    return `${parts[0]}–${parts[parts.length - 1]}`
  }
  return days.replace(/\s*[-−—]\s*/g, '–').replace(/\s+/g, ' ').trim()
}

function normalizeCardTime(raw) {
  const s = (raw || '').trim().replace(/\./g, ':')
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return s
  return `${Number(m[1])}:${m[2]}`
}

function formatCardHoursFromPeriods(periods) {
  if (!periods?.length) return null
  const seen = new Set()
  const parts = []
  for (const p of periods) {
    const days = normalizeCardDaysLabel(p.days || '')
    if (!days) continue
    const key = days.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const open = normalizeCardTime(p.open)
    const close = normalizeCardTime(p.close)
    parts.push(open && close ? `${days}: ${open}–${close}` : `${days}: выходной`)
  }
  return parts.length ? parts.join('; ') : null
}

function stripSlopeStatusFromCardHours(text) {
  let t = text.trim()
  if (!t) return ''
  t = t.replace(
    new RegExp(
      `^(?:на\\s+\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?\\s*:\\s*)?(?:горнолыжн${CY}\\s+)?(?:склон(?:ы|ов|а)?|трасс${CY})(?:\\s*\\/\\s*подъ[её]мник${CY})?\\s+(?:открыт${CY}|закрыт${CY})(?:\\s+на\\s+летн${CY}\\s+период)?(?:\\s+до\\s+сезон${CY})?[.!?]?\\s*`,
      'gi',
    ),
    '',
  )
  t = t.replace(new RegExp(`^(?:снежн${CY}\\s+)?сезон\\s+закрыт\\.?\\s*`, 'gi'), '')
  t = t.replace(new RegExp(`^закрыт(?:ы|а|о)?\\s+до\\s+сезон${CY}[.!?]?\\s*`, 'gi'), '')
  t = t.replace(
    new RegExp(`\\s*[.]\\s*(?:снежн${CY}\\s+)?сезон\\s+закрыт(?:\\s*[—–-].*)?$`, 'gi'),
    '',
  )
  t = t.replace(
    new RegExp(
      `\\s*[.]\\s*(?:горнолыжн${CY}\\s+)?склон${CY}\\s+(?:открыт${CY}|закрыт${CY})(?:\\s+на\\s+летн${CY}\\s+период)?(?:\\s+до\\s+сезон${CY})?.*$`,
      'gi',
    ),
    '',
  )
  t = t.replace(
    new RegExp(`\\s*[—–-]\\s*(?:снежн${CY}\\s+)?сезон\\s+закрыт(?:\\s*[—–-].*)?$`, 'gi'),
    '',
  )
  t = t.replace(/^\s*ближайший\s+график\s*\([^)]*\)\s*:\s*/i, '')
  t = t.replace(new RegExp(`закрыт(?:ы|а|о)?\\s+до\\s+сезон${CY}`, 'gi'), '')
  return t.replace(/\s+/g, ' ').replace(/^[,;.\s]+|[,;.\s]+$/g, '').trim()
}

function hasRealCardHoursTimes(text) {
  if (/\d{1,2}:\d{2}/.test(text)) return true
  if (/\d{1,2}\.\d{2}\s*[-−—–]\s*\d{1,2}([:.]\d{2})?/.test(text)) return true
  return false
}

function isBlankHoursScheduleLabel(text) {
  const t = text.trim()
  if (!t) return true
  if (hasRealCardHoursTimes(t)) return false
  if (/^(?:график\s+)?на\s+\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\.?$/i.test(t)) return true
  if (/^график\s+на\s+\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*:/i.test(t)) return true
  return false
}

function isPureSlopeStatusHours(text) {
  const t = text.trim()
  if (!t) return true
  if (hasRealCardHoursTimes(t)) return false
  return new RegExp(
    `сезон\\s+закрыт|склон${CY}\\s+(?:открыт|закрыт)|закрыт${CY}\\s+до\\s+сезон|горнолыжн${CY}\\s+склон`,
    'i',
  ).test(t)
}

function normalizeCardHoursSummary(text) {
  let t = stripSlopeStatusFromCardHours(text)
  if (!t || isPureSlopeStatusHours(t) || isBlankHoursScheduleLabel(t)) return ''
  t = t
    .replace(/\s*[;|]\s*/g, '; ')
    .replace(/(\d{1,2})\.(\d{2})(?=\s*[-−—–]\s*\d)/g, '$1:$2')
    .replace(/(?<=[-−—–]\s*)(\d{1,2})\.(\d{2})\b/g, '$1:$2')
    .replace(/(\d{1,2}:\d{2})\s*[-−—]\s*(\d{1,2}:\d{2})/g, '$1–$2')
    .replace(
      /(^|;\s*)([^;:]+?)\s+(\d{1,2}:\d{2}\s*–\s*\d{1,2}:\d{2})/g,
      '$1$2: $3',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[,;.\s]+|[,;.\s]+$/g, '')
    .replace(/…\s*$/g, '')
    .trim()
  if (!t || isBlankHoursScheduleLabel(t)) return ''
  return t
}

function cardHoursText(hours) {
  if (!hours) return 'нет данных'
  const fromPeriods = formatCardHoursFromPeriods(hours.periods)
  if (fromPeriods) return fromPeriods
  const raw = (hours.summary || '').trim()
  if (!raw) return 'нет данных'
  return normalizeCardHoursSummary(raw) || 'нет данных'
}

const STATUS_LEAK =
  /склон[а-яё]*\s+(открыт|закрыт)|сезон\s+закрыт|закрыт[а-яё]*\s+до\s+сезон|горнолыжн[а-яё]*\s+склон/i

describe('card hours UI helpers', () => {
  it('strips slope status duplicates and keeps schedule', () => {
    assert.equal(
      normalizeCardHoursSummary(
        'Горнолыжные склоны закрыты на летний период. Ближайший график (прочее): Понедельник: закрыто; Вторник: закрыто; Среда: 12:00–22:00',
      ),
      'Понедельник: закрыто; Вторник: закрыто; Среда: 12:00–22:00',
    )
    assert.equal(
      normalizeCardHoursSummary('Сезон закрыт. пн: выходной; вт–пт: 11:00–22:00'),
      'пн: выходной; вт–пт: 11:00–22:00',
    )
    assert.equal(
      normalizeCardHoursSummary('На 25.11.2026: склоны/подъёмники закрыты до сезона'),
      '',
    )
    assert.equal(
      normalizeCardHoursSummary('по сеансам: 12:00–19:00. Снежный сезон закрыт'),
      'по сеансам: 12:00–19:00',
    )
    assert.equal(
      normalizeCardHoursSummary('будни 12:00–18:00; выходные 10:00–18:00'),
      'будни: 12:00–18:00; выходные: 10:00–18:00',
    )
  })

  it('date-only schedule labels become нет данных on cards', () => {
    assert.equal(normalizeCardHoursSummary('График на 25.11.2026'), '')
    assert.equal(normalizeCardHoursSummary('На 25.11.2026'), '')
    assert.equal(
      normalizeCardHoursSummary('График на 25.11.2026: данные по склонам не найдены'),
      '',
    )
    assert.equal(
      cardHoursText({
        resortId: 'krasnoe-ozero',
        summary: 'График на 25.11.2026',
        periods: [],
      }),
      'нет данных',
    )
    assert.equal(
      cardHoursText({
        resortId: 'krasnoe-ozero',
        summary: 'Нет данных о режиме склонов',
        periods: [],
      }),
      'Нет данных о режиме склонов',
    )
    // Real times after a date label must stay.
    assert.equal(
      normalizeCardHoursSummary('График на 25.11.2026: 10:00–18:00'),
      'График на 25.11.2026: 10:00–18:00',
    )
  })

  it('formats periods into a unified card line', () => {
    assert.equal(
      formatCardHoursFromPeriods([
        { days: 'ср., чт., пт.', open: '15:00', close: '21:00' },
        { days: 'сб., вс.', open: '10:00', close: '21:00' },
        { days: 'пн., вт.', open: '', close: '' },
      ]),
      'ср–пт: 15:00–21:00; сб–вс: 10:00–21:00; пн–вт: выходной',
    )
  })

  it('active committed hours have no status-leak on the card line', () => {
    const hours = JSON.parse(readFileSync(join(root, 'public/data/hours.json'), 'utf8'))
    const resorts = JSON.parse(readFileSync(join(root, 'public/data/resorts.json'), 'utf8'))
    const active = new Set(resorts.filter((r) => r.status === 'active').map((r) => r.id))
    for (const h of hours) {
      if (!active.has(h.resortId)) continue
      const line = cardHoursText(h)
      assert.doesNotMatch(line, STATUS_LEAK, h.resortId)
      assert.ok(line.length > 0, h.resortId)
      // Never a bare date-only «График на …» with empty schedule.
      assert.doesNotMatch(line, /^(?:график\s+)?на\s+\d{1,2}\.\d{1,2}/i, h.resortId)
    }
  })

  it('ResortCard wires cardHoursText + resort-card__hours', () => {
    const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
    const dataSrc = readFileSync(join(root, 'src/lib/data.ts'), 'utf8')
    assert.match(cardSrc, /cardHoursText/)
    assert.match(cardSrc, /resort-card__hours/)
    assert.match(dataSrc, /stripSlopeStatusFromCardHours/)
    assert.match(dataSrc, /formatCardHoursFromPeriods/)
    assert.match(dataSrc, /\[а-яёa-z\]\*/)
  })
})
