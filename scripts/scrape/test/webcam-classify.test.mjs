import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Mirror of src/lib/webcam.ts classify rules — keep in sync when changing embed hosts.
 * (Vite/TS unit runner not in MVP; this guards scrape/data expectations.)
 */
function classify(url) {
  let raw
  try {
    raw = new URL(url)
  } catch {
    return 'link'
  }
  const href = raw.href
  const path = raw.pathname.toLowerCase()
  const host = raw.hostname.replace(/^www\./, '').toLowerCase()
  if (/\.m3u8($|\?)/i.test(href) || path.endsWith('.m3u8')) return 'hls'
  if (/\.(mjpg|mjpeg)($|\?)/i.test(href) || /\/mjpeg\b/i.test(path)) return 'mjpeg'
  if (/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(host)) return 'iframe'
  if (/^(vk\.com|vkvideo\.ru)$/i.test(host) && /video_ext|video_embed|video-?\d/i.test(path + raw.search))
    return 'iframe'
  if (host === 'open.ivideon.com' && /\/embed\//i.test(path)) return 'iframe'
  if ((host === 'rtsp.me' || host === 'rtsp.ru') && /\/embed\//i.test(path)) return 'iframe'
  // exdesign: empty black player when iframed — link-only
  if (host === 'webcam.exdesign.ru') return 'link'
  if (host === 'ipeye.ru' && /iframe/i.test(path + raw.search)) return 'iframe'
  return 'link'
}

describe('webcam classify', () => {
  it('embeds known player hosts', () => {
    assert.equal(classify('https://rtsp.me/embed/KDYy3ZSY/'), 'iframe')
    assert.equal(classify('https://rtsp.ru/embed/AebA57ah/'), 'iframe')
    assert.equal(
      classify('https://open.ivideon.com/embed/v3/100-d029fa1f6111386709aaaf107f555963:720896'),
      'iframe',
    )
    assert.equal(
      classify(
        'https://ipeye.ru/ipeye_service/api/iframe.php?iframe_player=1&dev=abc&autoplay=1',
      ),
      'iframe',
    )
  })

  it('treats exdesign as link-only (blank iframe)', () => {
    assert.equal(classify('https://webcam.exdesign.ru/igora-1/'), 'link')
    assert.equal(classify('https://webcam.exdesign.ru/snegny/?fluid'), 'link')
  })

  it('detects HLS', () => {
    assert.equal(
      classify('https://hlsrtsp-ohtapark.cdnvideo.ru/ohtapark-rtsp/stream6/playlist.m3u8'),
      'hls',
    )
  })

  it('keeps resort pages as link-only', () => {
    assert.equal(classify('https://www.ohtapark.ru/webcam/'), 'link')
    assert.equal(classify('https://igora.ru/cam/'), 'link')
    assert.equal(classify('https://tuutari.ru/webcam.html'), 'link')
    assert.equal(classify('https://snegny.ru/'), 'link')
  })
})
