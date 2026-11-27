/** Shared polite HTTP helpers for MountHunt scrapers. */

export const USER_AGENT =
  'MountHuntBot/0.1 (+https://github.com/Stepan1984/MountHunt; contact via GitHub Issues)'

export const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1500)

export function sleep(ms = DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * VK community walls often return an empty SPA shell to unknown bots.
 * A well-known crawler UA gets SSR HTML with `data-testid="post_text"`.
 */
export const VK_FETCH_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

/**
 * @param {string} url
 * @param {{ as?: 'text' | 'buffer', retries?: number, timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<{ body: string | Buffer, lastModified: string | null }>}
 */
export async function fetchUrlResult(url, opts = {}) {
  const as = opts.as || 'text'
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SCRAPE_FETCH_TIMEOUT_MS || 45_000)
  const userAgent = opts.userAgent || USER_AGENT
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: as === 'buffer' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru,en;q=0.8',
        },
        redirect: 'follow',
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`)
      }
      const lastModified = res.headers.get('last-modified')
      if (as === 'buffer') {
        return { body: Buffer.from(await res.arrayBuffer()), lastModified }
      }
      return { body: await res.text(), lastModified }
    } catch (err) {
      lastErr = err?.name === 'AbortError' ? new Error(`Timeout ${timeoutMs}ms for ${url}`) : err
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1))
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/**
 * @param {string} url
 * @param {{ as?: 'text' | 'buffer', retries?: number, timeoutMs?: number }} [opts]
 */
export async function fetchUrl(url, opts = {}) {
  const { body } = await fetchUrlResult(url, opts)
  return body
}
