/**
 * Optional Playwright HTML loader for JS-heavy / flaky resort pages (Igora).
 * Soft-fails when playwright is not installed or Chromium is missing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USER_AGENT } from './http.mjs'

/**
 * @param {string} url
 * @param {{
 *   waitForSelector?: string,
 *   timeoutMs?: number,
 *   blockAssets?: boolean,
 * }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchRenderedHtml(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90_000
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    throw new Error('playwright package not installed (npm i -D playwright && npx playwright install chromium)')
  }

  const browser = await playwright.chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT })
    page.setDefaultTimeout(timeoutMs)

    if (opts.blockAssets !== false) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType()
        if (['image', 'media', 'font'].includes(type)) return route.abort()
        // Large CSS often stalls on flaky paths to igora.ru; DOM content does not need it.
        if (type === 'stylesheet') return route.abort()
        return route.continue()
      })
    }

    // commit: headers received — full domcontentloaded may never fire if the document stream stalls.
    await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs })

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: timeoutMs })
    } else {
      await page.waitForTimeout(Math.min(8_000, timeoutMs))
    }

    return await page.content()
  } finally {
    await browser.close()
  }
}

/**
 * Read HTML from a snapshot directory (IGORA_HTML_DIR / SCRAPE_HTML_DIR).
 * File name is derived from the URL path (e.g. /price/ → price.html).
 * @param {string} url
 * @param {string} dir
 * @returns {string | null}
 */
export function readSnapshotHtml(url, dir) {
  if (!dir || !existsSync(dir)) return null
  let pathName
  try {
    pathName = new URL(url).pathname.replace(/\/+$/, '') || '/index'
  } catch {
    return null
  }
  const base = pathName.split('/').filter(Boolean).pop() || 'index'
  const candidates = [
    join(dir, `${base}.html`),
    join(dir, `${base}.htm`),
    join(dir, 'index.html'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8')
  }
  return null
}
