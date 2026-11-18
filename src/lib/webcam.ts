export type WebcamEmbedKind = 'iframe' | 'hls' | 'mjpeg' | 'link'

export type ClassifiedWebcam = {
  url: string
  kind: WebcamEmbedKind
  /** URL suitable for iframe/video src (YouTube/VK normalized). */
  playUrl: string
}

function youtubeEmbedUrl(raw: URL): string | null {
  const host = raw.hostname.replace(/^www\./, '').toLowerCase()
  if (host === 'youtu.be') {
    const id = raw.pathname.split('/').filter(Boolean)[0]
    return id ? `https://www.youtube.com/embed/${id}` : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (raw.pathname.startsWith('/embed/')) return raw.href
    const v = raw.searchParams.get('v')
    if (v) return `https://www.youtube.com/embed/${v}`
    const shorts = raw.pathname.match(/^\/shorts\/([^/]+)/)
    if (shorts?.[1]) return `https://www.youtube.com/embed/${shorts[1]}`
  }
  return null
}

function vkEmbedUrl(raw: URL): string | null {
  const host = raw.hostname.replace(/^www\./, '').toLowerCase()
  if (host !== 'vk.com' && host !== 'vkvideo.ru') return null
  if (/video_ext\.php/i.test(raw.pathname) || /\/video_embed/i.test(raw.pathname)) {
    return raw.href
  }
  // vk.com/video-123_456 or video123_456
  const m = raw.pathname.match(/video(-?\d+)_(\d+)/i)
  if (m) {
    return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&hd=2`
  }
  return null
}

/**
 * Classify a webcam URL: platform iframe, HLS, MJPEG, or external page (link-only).
 */
export function classifyWebcamUrl(url: string): ClassifiedWebcam {
  let raw: URL
  try {
    raw = new URL(url)
  } catch {
    return { url, kind: 'link', playUrl: url }
  }

  const href = raw.href
  const path = raw.pathname.toLowerCase()
  const host = raw.hostname.replace(/^www\./, '').toLowerCase()

  if (/\.m3u8($|\?)/i.test(href) || path.endsWith('.m3u8')) {
    return { url, kind: 'hls', playUrl: href }
  }

  if (/\.(mjpg|mjpeg)($|\?)/i.test(href) || /\/mjpeg\b/i.test(path)) {
    return { url, kind: 'mjpeg', playUrl: href }
  }

  const yt = youtubeEmbedUrl(raw)
  if (yt) return { url, kind: 'iframe', playUrl: yt }

  const vk = vkEmbedUrl(raw)
  if (vk) return { url, kind: 'iframe', playUrl: vk }

  if (host === 'open.ivideon.com' && /\/embed\//i.test(path)) {
    return { url, kind: 'iframe', playUrl: href }
  }

  if ((host === 'rtsp.me' || host === 'rtsp.ru') && /\/embed\//i.test(path)) {
    return { url, kind: 'iframe', playUrl: href }
  }

  // webcam.exdesign.ru: pages hang / render an empty black player when iframed
  // (Igora, Снежный). Prefer link-only «Открыть трансляцию» over a blank box.
  if (host === 'webcam.exdesign.ru') {
    return { url, kind: 'link', playUrl: href }
  }

  if (host === 'ipeye.ru' && /iframe/i.test(path + raw.search)) {
    return { url, kind: 'iframe', playUrl: href }
  }

  return { url, kind: 'link', playUrl: href }
}

/** Prefer explicit embeds; also accept a webcam_url that is itself embeddable. */
export function resolveWebcamPlayers(
  webcamUrl: string | null | undefined,
  embeds: string[] | null | undefined,
): ClassifiedWebcam[] {
  const seen = new Set<string>()
  const out: ClassifiedWebcam[] = []

  const push = (u: string | null | undefined) => {
    if (!u) return
    const c = classifyWebcamUrl(u)
    if (c.kind === 'link') return
    const key = c.playUrl
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  for (const e of embeds ?? []) push(e)
  push(webcamUrl)

  return out
}

/** External page / stream link for «открыть трансляцию». */
export function webcamExternalLink(
  webcamUrl: string | null | undefined,
  embeds: string[] | null | undefined,
): string | null {
  if (webcamUrl) return webcamUrl
  if (embeds?.length) return embeds[0]
  return null
}
