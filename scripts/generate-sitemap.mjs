#!/usr/bin/env node
/**
 * Writes public/sitemap.xml from public/data/resorts.json.
 * Absolute URLs use https://mounthunt.ru.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resortsPath = join(root, 'public', 'data', 'resorts.json')
const outPath = join(root, 'public', 'sitemap.xml')
const origin = 'https://mounthunt.ru'

const resorts = JSON.parse(readFileSync(resortsPath, 'utf8'))
if (!Array.isArray(resorts)) {
  console.error('resorts.json must be an array')
  process.exit(1)
}

const paths = ['/', '/about', '/news', ...resorts.map((r) => `/resort/${r.id}`)]

const body = paths
  .map(
    (path) => `  <url>
    <loc>${origin}${path === '/' ? '/' : path}</loc>
  </url>`,
  )
  .join('\n')

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`

writeFileSync(outPath, xml)
console.log(`Wrote ${outPath} (${paths.length} URLs)`)
