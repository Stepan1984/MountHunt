/**
 * Card hours display: no slope status badge duplicates; unified schedule lines.
 * Formatting helpers live in scripts/scrape/lib/card-hours-format.mjs
 * (keep in sync with src/lib/data.ts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  formatCardHoursFromPeriods,
  reformatCardHoursSummaryText,
} from '../lib/card-hours-format.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CY = '[а-яёa-z]*'

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
    .replace(/\n+/g, ';')
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
  return reformatCardHoursSummaryText(t)
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
      'пн–вт: выходной\nср: 12:00–22:00',
    )
    assert.equal(
      normalizeCardHoursSummary('Сезон закрыт. пн: выходной; вт–пт: 11:00–22:00'),
      'пн: выходной\nвт–пт: 11:00–22:00',
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
      'пн–пт: 12:00–18:00\nсб–вс: 10:00–18:00',
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

  it('formats periods: abbr, Mon-first, grouping, line breaks without ;', () => {
    assert.equal(
      formatCardHoursFromPeriods([
        { days: 'ср., чт., пт.', open: '15:00', close: '21:00' },
        { days: 'сб., вс.', open: '10:00', close: '21:00' },
        { days: 'пн., вт.', open: '', close: '' },
      ]),
      'пн–вт: выходной\nср–пт: 15:00–21:00\nсб–вс: 10:00–21:00',
    )
    assert.equal(
      formatCardHoursFromPeriods([
        { days: 'Понедельник', open: '', close: '' },
        { days: 'Вторник', open: '', close: '' },
        { days: 'Среда', open: '12:00', close: '22:00' },
        { days: 'Четверг', open: '12:00', close: '22:00' },
        { days: 'Пятница', open: '12:00', close: '23:00' },
        { days: 'Суббота', open: '11:00', close: '23:00' },
      ]),
      'пн–вт: выходной\nср–чт: 12:00–22:00\nпт: 12:00–23:00\nсб: 11:00–23:00',
    )
    assert.equal(
      formatCardHoursFromPeriods([
        { days: 'будни', open: '12:00', close: '18:00' },
        { days: 'выходные', open: '10:00', close: '18:00' },
      ]),
      'пн–пт: 12:00–18:00\nсб–вс: 10:00–18:00',
    )
    assert.equal(
      formatCardHoursFromPeriods([
        { days: 'пн–пт', open: '11:00', close: '22:30' },
        { days: 'сб–вс', open: '9:00', close: '22:30' },
      ]),
      'пн–пт: 11:00–22:30\nсб–вс: 9:00–22:30',
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
      // Card hours never use `;` — multi-segment schedules are newline-separated.
      assert.doesNotMatch(line, /;/, h.resortId)
      if (line.includes('\n')) {
        assert.doesNotMatch(line, /;\n|; [^\n]/, h.resortId)
      }
    }
  })

  it('ResortCard wires cardHoursText + resort-card__hours + pre-line', () => {
    const cardSrc = readFileSync(join(root, 'src/components/ResortCard.tsx'), 'utf8')
    const dataSrc = readFileSync(join(root, 'src/lib/data.ts'), 'utf8')
    const cssSrc = readFileSync(join(root, 'src/index.css'), 'utf8')
    assert.match(cardSrc, /cardHoursText/)
    assert.match(cardSrc, /resort-card__hours/)
    assert.match(dataSrc, /stripSlopeStatusFromCardHours/)
    assert.match(dataSrc, /formatCardHoursFromPeriods/)
    assert.match(dataSrc, /formatDayIndices/)
    assert.match(cssSrc, /\.resort-card__hours[\s\S]*white-space:\s*pre-line/)
  })
})
