/** Shared polite HTTP helpers for MountHunt scrapers. */

export const USER_AGENT =
  'MountHuntBot/0.1 (+https://github.com/Stepan1984/MountHunt; contact via GitHub Issues)'

export const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS || 1500)

export function sleep(ms = DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {string} url
 * @param {{ as?: 'text' | 'buffer', retries?: number, timeoutMs?: number }} [opts]
 */
export async function fetchUrl(url, opts = {}) {
  const as = opts.as || 'text'
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SCRAPE_FETCH_TIMEOUT_MS || 45_000)
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: as === 'buffer' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru,en;q=0.8',
        },
        redirect: 'follow',
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`)
      }
      if (as === 'buffer') {
        return Buffer.from(await res.arrayBuffer())
      }
      return await res.text()
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
