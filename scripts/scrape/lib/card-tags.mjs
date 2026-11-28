/**
 * AI / rule-driven resort card tags (prototype: Krasnoe only).
 *
 * Pipeline writes public/data/card-tags.json; the static site only displays.
 * Fixed taxonomy — no free-form model labels.
 *
 * Krasnoe policy: never emit season_start / season_open («всё переносится
 * на неопределенный срок»). Closures / warnings / events only.
 */

/** Local ISO stamp — avoid importing parse.mjs (cheerio) for offline CI tests. */
function nowIso() {
  return new Date().toISOString()
}

/** Prototype scope — other resorts unchanged. */
export const CARD_TAGS_RESORT_IDS = Object.freeze(['krasnoe-ozero'])

/**
 * Fixed tag catalog. `id` is stable; `label` is the only Ru UI copy.
 * Season kinds exist for future resorts / LLM schema — blocked for Krasnoe.
 */
export const CARD_TAG_CATALOG = Object.freeze({
  'event.competition': {
    id: 'event.competition',
    kind: 'event',
    label: 'Соревнования',
    severity: 'info',
  },
  'event.festival': {
    id: 'event.festival',
    kind: 'event',
    label: 'Фестиваль',
    severity: 'info',
  },
  'event.holiday': {
    id: 'event.holiday',
    kind: 'event',
    label: 'Праздник',
    severity: 'info',
  },
  'closure.until_season': {
    id: 'closure.until_season',
    kind: 'closure',
    label: 'Закрыто до сезона',
    severity: 'warn',
  },
  'closure.slopes': {
    id: 'closure.slopes',
    kind: 'closure',
    label: 'Склоны закрыты',
    severity: 'warn',
  },
  'warning.postponed': {
    id: 'warning.postponed',
    kind: 'warning',
    label: 'Открытие перенесено',
    severity: 'warn',
  },
  'warning.weather': {
    id: 'warning.weather',
    kind: 'warning',
    label: 'Погодные ограничения',
    severity: 'warn',
  },
  'warning.partial': {
    id: 'warning.partial',
    kind: 'warning',
    label: 'Частичное ограничение',
    severity: 'warn',
  },
  'warning.lift': {
    id: 'warning.lift',
    kind: 'warning',
    label: 'Подъёмник закрыт',
    severity: 'warn',
  },
  // Blocked for Krasnoe — kept so LLM schema stays closed-world.
  'season.start': {
    id: 'season.start',
    kind: 'season_start',
    label: 'Начало сезона',
    severity: 'info',
  },
  'season.open': {
    id: 'season.open',
    kind: 'season_open',
    label: 'Сезон открыт',
    severity: 'info',
  },
})

/** @type {ReadonlySet<string>} */
export const SEASON_TAG_IDS = new Set(['season.start', 'season.open'])

/** Resorts that must never get season_start / season_open card tags. */
export const CARD_TAGS_SEASON_BLOCKED_RESORTS = new Set(['krasnoe-ozero'])

const GUESS_CONTEST_RE =
  /угадай|угадает|напиши\s+в\s+комментари|рос{1,2}ыгрыш.{0,100}дат[уеы]/i

const POSTPONED_RE =
  /перенос\w*.{0,40}неопредел[её]н|на\s+неопредел[её]нн\w*\s+срок|отложен\w*\s+на\s+неопредел|открытие\s+перенесен/i

const UNTIL_SEASON_RE =
  /закрыт\w*.{0,40}до\s+сезон|до\s+сезон\w*.{0,20}закрыт|склон\w*.{0,30}закрыт\w*\s+до\s+сезон/i

const SLOPES_CLOSED_RE =
  /склон\w*\s+закрыт|закрыт\w*\s+склон|трасс\w*.{0,20}закрыт|подъ[её]мник\w*.{0,20}закрыт/i

const WEATHER_RE =
  /погодн\w*\s+услов|погод\w*.{0,30}корректив|снежн\w*\s+пушк|нужно\s+чуть\s+больше\s+времени/i

const PARTIAL_RE =
  /учебн\w*\s+склон|открывается\s+учебн|основн\w*\s+склон\w*.{0,40}(?:нужно|готов|корректив)|частичн\w*\s+открыт/i

const LIFT_CLOSED_RE =
  /кресельн\w*\s+подъ[её]мник\w*.{0,20}закрыт|ленточн\w*\s+подъ[её]мник\w*.{0,20}закрыт|подъ[её]мник\s*[№#]?\s*\d+\s*[:—-]?\s*закрыт/i

const EVENT_COMPETITION_RE = /соревнован|чемпионат|кубок\b|гонка\b|слалом/i
const EVENT_FESTIVAL_RE = /фестивал/i
const EVENT_HOLIDAY_RE =
  /праздник|новый\s+год|новогодн|день\s+матер|банкет/i

/** Default TTLs (ms) from source publishedAt / updatedAt. */
export const CARD_TAG_TTL_MS = Object.freeze({
  event: 14 * 24 * 60 * 60 * 1000,
  closure: 21 * 24 * 60 * 60 * 1000,
  warning: 7 * 24 * 60 * 60 * 1000,
  season_start: 0,
  season_open: 14 * 24 * 60 * 60 * 1000,
})

/**
 * @param {string} text
 */
function blob(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {{ title?: string, body?: string }} item
 */
export function itemText(item) {
  return blob(`${item?.title || ''} ${item?.body || ''}`)
}

/**
 * @param {string} tagId
 * @returns {boolean}
 */
export function isKnownCardTagId(tagId) {
  return Object.prototype.hasOwnProperty.call(CARD_TAG_CATALOG, tagId)
}

/**
 * @param {string} resortId
 * @param {string} tagId
 */
export function isSeasonTagBlocked(resortId, tagId) {
  return CARD_TAGS_SEASON_BLOCKED_RESORTS.has(resortId) && SEASON_TAG_IDS.has(tagId)
}

/**
 * Rule classifier for one news item → catalog tag ids (0..n).
 * @param {{ id?: string, resortId?: string, title?: string, body?: string }} item
 * @param {string} resortId
 * @returns {string[]}
 */
export function classifyImportantItemRules(item, resortId) {
  if (!item || item.resortId !== resortId) return []
  const t = itemText(item)
  if (!t) return []

  /** @type {string[]} */
  const ids = []

  if (POSTPONED_RE.test(t)) ids.push('warning.postponed')
  if (UNTIL_SEASON_RE.test(t)) ids.push('closure.until_season')
  else if (SLOPES_CLOSED_RE.test(t) && !/открыт/i.test(t)) ids.push('closure.slopes')

  if (WEATHER_RE.test(t)) ids.push('warning.weather')
  if (PARTIAL_RE.test(t)) ids.push('warning.partial')
  if (LIFT_CLOSED_RE.test(t)) ids.push('warning.lift')

  // Contests that ask to guess opening date are not events.
  if (!GUESS_CONTEST_RE.test(t)) {
    if (EVENT_COMPETITION_RE.test(t)) ids.push('event.competition')
    else if (EVENT_FESTIVAL_RE.test(t)) ids.push('event.festival')
    else if (EVENT_HOLIDAY_RE.test(t)) ids.push('event.holiday')
  }

  // Explicit season announcements — only for non-blocked resorts.
  if (
    !CARD_TAGS_SEASON_BLOCKED_RESORTS.has(resortId) &&
    !GUESS_CONTEST_RE.test(t) &&
    (/стартует\s+(?:\S+\s+){0,3}сезон|сезон\s+стартует|открываемс|открытие\s+сезон/i.test(t) ||
      /сезон\s+открыт/i.test(t))
  ) {
    if (/сезон\s+открыт/i.test(t)) ids.push('season.open')
    else ids.push('season.start')
  }

  return [...new Set(ids)].filter((id) => isKnownCardTagId(id) && !isSeasonTagBlocked(resortId, id))
}

/**
 * @param {string} iso
 * @param {number} ttlMs
 * @returns {string | null}
 */
function expiresAtFrom(iso, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return null
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return null
  return new Date(t + ttlMs).toISOString()
}

/**
 * Merge classified hits into live tags (newest source wins per tag id; drop expired).
 * @param {string} resortId
 * @param {object[]} important
 * @param {Date} [now]
 * @param {{ previous?: object[] }} [opts]
 */
export function buildResortCardTags(resortId, important, now = new Date(), opts = {}) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  const prev = Array.isArray(opts.previous) ? opts.previous : []
  for (const tag of prev) {
    if (tag?.id && isKnownCardTagId(tag.id) && !isSeasonTagBlocked(resortId, tag.id)) {
      byId.set(tag.id, { ...tag })
    }
  }

  const items = (Array.isArray(important) ? important : [])
    .filter((i) => i && i.resortId === resortId)
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.publishedAt || a.updatedAt || '') || 0
      const tb = Date.parse(b.publishedAt || b.updatedAt || '') || 0
      return ta - tb
    })

  for (const item of items) {
    const tagIds = classifyImportantItemRules(item, resortId)
    const sourceIso = item.publishedAt || item.updatedAt || now.toISOString()
    for (const tagId of tagIds) {
      const meta = CARD_TAG_CATALOG[tagId]
      const ttl = CARD_TAG_TTL_MS[meta.kind] ?? CARD_TAG_TTL_MS.warning
      const sourceItemIds = [item.id].filter(Boolean)
      const prevTag = byId.get(tagId)
      byId.set(tagId, {
        id: meta.id,
        kind: meta.kind,
        label: meta.label,
        severity: meta.severity,
        sourceItemIds:
          prevTag && Array.isArray(prevTag.sourceItemIds)
            ? [...new Set([...prevTag.sourceItemIds, ...sourceItemIds])]
            : sourceItemIds,
        expiresAt: expiresAtFrom(sourceIso, ttl),
        updatedAt: nowIso(),
      })
    }
  }

  // Supersede: postponement clears any leftover season tags (defense in depth).
  if (byId.has('warning.postponed') || CARD_TAGS_SEASON_BLOCKED_RESORTS.has(resortId)) {
    for (const sid of SEASON_TAG_IDS) byId.delete(sid)
  }
  // Fresh until_season supersedes generic slopes closed.
  if (byId.has('closure.until_season')) byId.delete('closure.slopes')

  const nowMs = now.getTime()
  return [...byId.values()]
    .filter((tag) => {
      if (!tag?.id || isSeasonTagBlocked(resortId, tag.id)) return false
      if (!tag.expiresAt) return true
      const exp = Date.parse(tag.expiresAt)
      return !Number.isFinite(exp) || exp > nowMs
    })
    .sort((a, b) => {
      const order = { warning: 0, closure: 1, event: 2, season_start: 3, season_open: 4 }
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.id.localeCompare(b.id)
    })
}

/**
 * Optional LLM classification. Returns null when no API key / dry skip.
 * Response must be JSON: { "tags": ["event.competition", ...] } using catalog ids only.
 *
 * Env:
 * - MOUNTHUNT_LLM_API_KEY or OPENAI_API_KEY
 * - MOUNTHUNT_LLM_BASE_URL (default https://api.openai.com/v1)
 * - MOUNTHUNT_LLM_MODEL (default gpt-4o-mini)
 *
 * @param {string} resortId
 * @param {object[]} important
 * @returns {Promise<string[] | null>}
 */
export async function classifyWithLlm(resortId, important) {
  const apiKey = process.env.MOUNTHUNT_LLM_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (process.env.CARD_TAGS_FORCE_RULES === '1') return null

  const items = (Array.isArray(important) ? important : [])
    .filter((i) => i?.resortId === resortId)
    .slice(0, 12)
    .map((i) => ({
      id: i.id,
      title: i.title,
      body: String(i.body || '').slice(0, 600),
      publishedAt: i.publishedAt || i.updatedAt || null,
    }))
  if (!items.length) return []

  const allowed = Object.keys(CARD_TAG_CATALOG).filter((id) => !isSeasonTagBlocked(resortId, id))
  const baseUrl = (process.env.MOUNTHUNT_LLM_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  )
  const model = process.env.MOUNTHUNT_LLM_MODEL || 'gpt-4o-mini'
  const system = [
    'Ты классификатор новостей горнолыжного курорта для бейджей на карточке.',
    'Верни только JSON вида {"tags":["id",...]} — только id из списка.',
    'Не придумывай свободный текст. Не ставь season.start / season.open для Красного озера.',
    `Разрешённые id: ${allowed.join(', ')}`,
  ].join(' ')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: JSON.stringify({ resortId, news: items }),
        },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`LLM card-tags HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('LLM card-tags: invalid JSON')
  }
  const tags = Array.isArray(parsed?.tags) ? parsed.tags : []
  return [
    ...new Set(
      tags.filter((id) => typeof id === 'string' && isKnownCardTagId(id) && !isSeasonTagBlocked(resortId, id)),
    ),
  ]
}

/**
 * Apply LLM tag id list onto rule-built tags (LLM ids must be in catalog).
 * @param {string} resortId
 * @param {string[]} llmTagIds
 * @param {object[]} important
 * @param {Date} [now]
 */
export function tagsFromLlmIds(resortId, llmTagIds, important, now = new Date()) {
  const newest = (Array.isArray(important) ? important : [])
    .filter((i) => i?.resortId === resortId)
    .sort((a, b) => {
      const ta = Date.parse(a.publishedAt || a.updatedAt || '') || 0
      const tb = Date.parse(b.publishedAt || b.updatedAt || '') || 0
      return tb - ta
    })[0]
  const sourceIso = newest?.publishedAt || newest?.updatedAt || now.toISOString()
  const sourceItemIds = newest?.id ? [newest.id] : []
  /** @type {object[]} */
  const out = []
  for (const tagId of llmTagIds || []) {
    if (!isKnownCardTagId(tagId) || isSeasonTagBlocked(resortId, tagId)) continue
    const meta = CARD_TAG_CATALOG[tagId]
    const ttl = CARD_TAG_TTL_MS[meta.kind] ?? CARD_TAG_TTL_MS.warning
    out.push({
      id: meta.id,
      kind: meta.kind,
      label: meta.label,
      severity: meta.severity,
      sourceItemIds,
      expiresAt: expiresAtFrom(sourceIso, ttl),
      updatedAt: nowIso(),
    })
  }
  if (CARD_TAGS_SEASON_BLOCKED_RESORTS.has(resortId)) {
    return out.filter((t) => !SEASON_TAG_IDS.has(t.id))
  }
  return out
}

/**
 * Build full card-tags.json document.
 * @param {object[]} important
 * @param {{
 *   previous?: { resorts?: Record<string, object[]> },
 *   now?: Date,
 *   mode?: 'rules' | 'llm' | 'fixture',
 *   llmTagIdsByResort?: Record<string, string[]>,
 * }} [opts]
 */
export function buildCardTagsDocument(important, opts = {}) {
  const now = opts.now || new Date()
  const prevDoc = opts.previous || {}
  /** @type {Record<string, object[]>} */
  const resorts = {}
  let mode = opts.mode || 'rules'

  for (const resortId of CARD_TAGS_RESORT_IDS) {
    const previous = prevDoc.resorts?.[resortId] || []
    let tags
    if (opts.llmTagIdsByResort?.[resortId]) {
      mode = 'llm'
      tags = tagsFromLlmIds(resortId, opts.llmTagIdsByResort[resortId], important, now)
    } else {
      tags = buildResortCardTags(resortId, important, now, { previous })
    }
    // Final hard filter: never persist season tags for blocked resorts.
    resorts[resortId] = tags.filter((t) => !isSeasonTagBlocked(resortId, t.id))
  }

  return {
    updatedAt: nowIso(),
    mode,
    resorts,
  }
}

/**
 * Enrich / rewrite card tags from important news.
 * Tries LLM when a key is present; otherwise deterministic rules (CI-safe).
 *
 * @param {object[]} important
 * @param {{ previous?: object, now?: Date }} [opts]
 */
export async function enrichCardTags(important, opts = {}) {
  /** @type {Record<string, string[]> | undefined} */
  let llmTagIdsByResort
  let mode = 'rules'
  try {
    for (const resortId of CARD_TAGS_RESORT_IDS) {
      const llmIds = await classifyWithLlm(resortId, important)
      if (llmIds) {
        llmTagIdsByResort = llmTagIdsByResort || {}
        llmTagIdsByResort[resortId] = llmIds
        mode = 'llm'
      }
    }
  } catch (err) {
    console.warn(`[card-tags] LLM failed, falling back to rules: ${err?.message || err}`)
    llmTagIdsByResort = undefined
    mode = 'rules'
  }

  if (process.env.CARD_TAGS_MODE === 'fixture') {
    mode = 'fixture'
  }

  return buildCardTagsDocument(important, {
    previous: opts.previous,
    now: opts.now,
    mode,
    llmTagIdsByResort,
  })
}

/**
 * Live tags for UI (drop expired; Krasnoe season block).
 * @param {object | null | undefined} doc
 * @param {string} resortId
 * @param {Date} [now]
 */
export function liveCardTagsForResort(doc, resortId, now = new Date()) {
  const list = doc?.resorts?.[resortId]
  if (!Array.isArray(list)) return []
  const nowMs = now.getTime()
  return list.filter((tag) => {
    if (!tag?.id || !tag?.label) return false
    if (isSeasonTagBlocked(resortId, tag.id)) return false
    if (SEASON_TAG_IDS.has(tag.id)) return false
    if (!tag.expiresAt) return true
    const exp = Date.parse(tag.expiresAt)
    return !Number.isFinite(exp) || exp > nowMs
  })
}
