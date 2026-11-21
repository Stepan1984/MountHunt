/** True when two external URLs point at the same page (ignore trailing slash / www). */
export function sameExternalUrl(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  const norm = (raw: string): string | null => {
    try {
      const u = new URL(raw)
      const host = u.hostname.replace(/^www\./i, '').toLowerCase()
      const path = (u.pathname.replace(/\/+$/, '') || '/').toLowerCase()
      return `${u.protocol}//${host}${path}${u.search}`
    } catch {
      return null
    }
  }
  const left = norm(a)
  const right = norm(b)
  return Boolean(left && right && left === right)
}

/** Human-readable Russian label for an external URL shown in the UI. */
export function linkLabelForUrl(url: string, fallback = 'Открыть ссылку'): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fallback
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
  const path = decodeURIComponent(parsed.pathname).toLowerCase()
  const haystack = `${host}${path}${parsed.search}`.toLowerCase()

  if (/yandex\.(ru|com)\/maps|maps\.yandex/i.test(haystack)) return 'Яндекс Карты'
  if (/vk\.com|t\.me|telegram\.|ok\.ru/i.test(host)) return 'Сообщество'
  if (/cam|webcam|web-camera|webcamera|twocam|\/cam\b/i.test(haystack)) {
    return 'Открыть трансляцию'
  }
  if (
    /working-hours|chasy|grafik|vremya-raboty|\/hours\b|режим/i.test(haystack)
  ) {
    return 'Часы работы'
  }
  if (
    /price|ceny|tarif|skipass|ski-pass|ски-пасс|podyomnik|\/lift\b|прейскурант|\.pdf$/i.test(
      haystack,
    )
  ) {
    return 'Тарифы на сайте'
  }
  if (/naduvnoe-prizemlenie|progression.?spot/i.test(haystack)) {
    return 'О подушке на сайте'
  }
  if (path === '/' || path === '') return 'Сайт курорта'
  return 'Сайт курорта'
}

const URL_IN_TEXT =
  /https?:\/\/[^\s<>"'`)\]|,]+|www\.[^\s<>"'`)\]|,]+/gi

/** Match absolute URLs (and www.) inside visitor-facing copy. */
export function matchUrlsInText(text: string): RegExpMatchArray[] {
  return [...text.matchAll(URL_IN_TEXT)]
}

/** Remove URL-like tokens so cards/truncation never show raw slash paths. */
export function stripUrlsFromText(text: string): string {
  return text
    .replace(URL_IN_TEXT, '')
    .replace(/\s*на\s+(сайте\s+курорта)?\s*[.,;:]?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

export type TextPart =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string }

/** Split copy into plain text and link parts with Russian labels. */
export function splitTextWithLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of matchUrlsInText(text)) {
    const raw = match[0]
    const index = match.index ?? 0
    if (index > last) {
      parts.push({ type: 'text', value: text.slice(last, index) })
    }
    const href = raw.startsWith('www.') ? `https://${raw}` : raw
    // Trim trailing punctuation accidentally captured.
    const cleaned = href.replace(/[.,;:!?)]+$/g, '')
    const trailing = href.slice(cleaned.length)
    parts.push({
      type: 'link',
      href: cleaned,
      label: linkLabelForUrl(cleaned),
    })
    if (trailing) parts.push({ type: 'text', value: trailing })
    last = index + raw.length
  }
  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) })
  }
  return parts.length > 0 ? parts : [{ type: 'text', value: text }]
}
